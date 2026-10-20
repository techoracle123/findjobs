import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import './setup'
import app from '../../src/server/app'
import { detectLanguage, fallbackTips, validatedTips } from '../../src/server/routes/insights'
import { findJob, searchJobs } from '../../src/server/jobs'
import { rss } from '../../src/server/sources/feeds'

const description =
  'Wir suchen eine erfahrene Pflegekraft für unser Krankenhaus. Sie betreuen unsere Patienten und arbeiten eng mit dem medizinischen Team zusammen. Eine abgeschlossene Ausbildung in der Pflege ist erforderlich.'
const english =
  'We are looking for an experienced nurse for our hospital. You will care for our patients and work closely with the medical team. Completed training in nursing is required.'
const bindings = { ...env, APP_MODE: 'test', OPENROUTER_API_KEY: 'test-only-secret' }
afterEach(() => vi.restoreAllMocks())

function request(path: string, body: unknown = {}, config = bindings) {
  return app.request(
    `http://localhost/api/jobs/${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.6' },
      body: JSON.stringify(body),
    },
    config,
  )
}
async function prepareGerman() {
  await env.DB.prepare('UPDATE jobs SET description = ?1 WHERE id = ?2')
    .bind(description, 'demo-0001')
    .run()
}

describe('English translation and application guidance', () => {
  it('recognises English and German without paid inference', () => {
    expect(detectLanguage(description)).toBe('deu')
    expect(detectLanguage(english)).toBe('eng')
  })
  it('returns the original honestly when a secret is not configured', async () => {
    await prepareGerman()
    const response = await request(
      'demo-0001/translation',
      {},
      { ...bindings, OPENROUTER_API_KEY: '' },
    )
    const body = (await response.json()) as {
      description: string
      available: boolean
      translated: boolean
      message: string
    }
    expect(body.available).toBe(false)
    expect(body.translated).toBe(false)
    expect(body.description).toBe(description)
    expect(body.message).toContain('not configured')
  })
  it('caches English against the exact description and never leaks the key', async () => {
    await prepareGerman()
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ description: english }) },
          },
        ],
      }),
    )
    const first = await request('demo-0001/translation')
    expect(first.status).toBe(200)
    const body = (await first.json()) as { description: string; translated: boolean }
    expect(body.description).toBe(english)
    expect(body.translated).toBe(true)
    const second = await request('demo-0001/translation')
    expect(((await second.json()) as { translated: boolean }).translated).toBe(true)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(body)).not.toContain('test-only-secret')
  })
  it('does not send an English description to the provider', async () => {
    await env.DB.prepare('UPDATE jobs SET description = ?1 WHERE id = ?2')
      .bind(english, 'demo-0001')
      .run()
    const mock = vi.spyOn(globalThis, 'fetch')
    const response = await request('demo-0001/translation')
    expect(((await response.json()) as { translated: boolean }).translated).toBe(false)
    expect(mock).not.toHaveBeenCalled()
  })
  it('returns listing-based advice if AI is missing, and adapts it to the job', async () => {
    const response = await request(
      'demo-0001/tips',
      { skills: ['React'] },
      { ...bindings, OPENROUTER_API_KEY: '' },
    )
    const body = (await response.json()) as { provider: string; tips: { text: string }[] }
    expect(body.provider).toBe('listing-based')
    expect(body.tips).toHaveLength(3)
    const job = (await findJob(env.DB, 'demo-0001'))!
    expect(fallbackTips({ ...job, roleFamily: 'healthcare' })[1].text).toContain('patient')
    expect(fallbackTips({ ...job, roleFamily: 'education' })[1].text).toContain('lesson')
  })
  it('validates advice structure and rejects invented contact links', () => {
    expect(() =>
      validatedTips([{ title: 'Contact', text: 'Apply at https://fake.example' }]),
    ).toThrow()
    expect(
      validatedTips([
        { title: 'Example', text: 'Prepare an example.' },
        { title: 'Skills', text: 'Highlight relevant skills.' },
      ]),
    ).toHaveLength(2)
  })
  it('rejects oversized advice bodies, cross-origin calls and missing jobs', async () => {
    expect((await request('demo-0001/tips', { skills: ['x'.repeat(9000)] })).status).toBe(413)
    expect((await request('missing/translation')).status).toBe(404)
    expect(
      (
        await app.request(
          'http://localhost/api/jobs/demo-0001/tips',
          { method: 'POST', headers: { origin: 'https://other.example' }, body: '{}' },
          bindings,
        )
      ).status,
    ).toBe(403)
  })
})

describe('general jobs ingestion and server-side discovery', () => {
  it('parses Nigerian feed employers, locations, deadlines and malformed dates safely', async () => {
    const xml =
      '<rss><channel><item><title><![CDATA[Registered Nurse at Care Hospital]]></title><link>https://example.com/nurse</link><description><![CDATA[<p>Location: Abuja</p><p>Nursing and patient care.</p>]]></description><pubDate>bad date</pubDate><expirationDate>2026-11-04</expirationDate></item><item><title>Jobs at Example</title><link>https://example.com/all</link></item><item><title>Sales</title><link>javascript:alert(1)</link></item></channel></rss>'
    const jobs = await rss.fetchPostings(
      {
        id: 'myjobmag-ng',
        listingUrl: 'https://example.com/feed',
        options: { country: 'NG' },
        verification: 'unverified',
        verificationReason: '',
      },
      (async () => new Response(xml)) as typeof fetch,
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe('Registered Nurse')
    expect(jobs[0].company).toBe('Care Hospital')
    expect(jobs[0].location).toBe('Abuja, Nigeria')
    expect(jobs[0].publishedAt).toBeNull()
    expect(jobs[0].validThrough).toBe('2026-11-04T00:00:00.000Z')
  })
  it('filters countries and professions in D1, not just the first browser page', async () => {
    await env.DB.prepare(
      "UPDATE jobs SET location_country = 'NG', role_family = 'healthcare', work_mode = 'onsite', seniority = 'mid' WHERE id = 'demo-0001'",
    ).run()
    const result = await searchJobs(env.DB, {
      country: 'NG',
      roleFamilies: ['healthcare'],
      workModes: ['onsite'],
      seniorities: ['mid'],
      limit: 1,
    })
    expect(result.total).toBe(1)
    expect(result.jobs[0].id).toBe('demo-0001')
    const empty = await searchJobs(env.DB, { country: 'NG', roleFamilies: ['education'] })
    expect(empty.total).toBe(0)
  })
})
