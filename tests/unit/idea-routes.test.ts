import { describe, expect, it } from 'vitest'
import { onRequest } from '../../functions/[[path]]'
import { searchIdeas } from '../../src/server/ideas/catalog'
import type { IdeaEvidenceSnapshot } from '../../src/shared/ideas'
import { makeIdeaSnapshot } from '../fixtures/ideas'

function kv(snapshot: IdeaEvidenceSnapshot | null): KVNamespace {
  return {
    get: async () => snapshot,
  } as unknown as KVNamespace
}

function context(request: Request, snapshot?: IdeaEvidenceSnapshot | null) {
  return {
    request,
    env: {
      ...(snapshot === undefined ? {} : { PUBLIC_JOBS: kv(snapshot) }),
      ASSETS: { fetch: async () => new Response('asset fallback') },
    },
    next: async () => new Response('single-page app', { status: 200 }),
  } as never
}

describe('Pages idea routes', () => {
  it('resolves an encoded idea id and renders evidence-rich crawler HTML', async () => {
    const snapshot = makeIdeaSnapshot(2)
    const idea = searchIdeas(snapshot, { country: 'NGA', limit: 1 }).ideas[0]
    const response = await onRequest(
      context(
        new Request(`https://fj.example/ideas/${encodeURIComponent(idea.id)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        }),
        snapshot,
      ),
    )
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(idea.location.name)
    expect(html).toContain(idea.evidence.displayValue)
    expect(html).toContain(`Exact figure from the source: ${idea.evidence.value}`)
    expect(html).toContain('unit: Percent')
    expect(html).toContain('Source last updated:')
    expect(html).toContain('This is an idea to test, not proof that people will buy it.')
    expect(html).toContain(`/ideas/${encodeURIComponent(idea.id)}`)
    expect(response.headers.get('Vary')).toBe('User-Agent')
  })

  it('passes a known human idea route to the app without prerendering it', async () => {
    const snapshot = makeIdeaSnapshot(2)
    const idea = searchIdeas(snapshot, { country: 'NGA', limit: 1 }).ideas[0]
    const response = await onRequest(
      context(new Request(`https://fj.example/ideas/${encodeURIComponent(idea.id)}`), snapshot),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('single-page app')
  })

  it('returns a real 404 for an unknown idea and 503 when evidence is unavailable', async () => {
    const missing = await onRequest(
      context(new Request('https://fj.example/ideas/not-a-real-idea'), makeIdeaSnapshot(2)),
    )
    expect(missing.status).toBe(404)
    expect(missing.headers.get('X-Robots-Tag')).toBe('noindex')

    const unavailable = await onRequest(
      context(new Request('https://fj.example/ideas/energy-solar-kit%3ANGA'), null),
    )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).toContain('temporarily unavailable')
  })

  it('lists Ideas and Pricing in the public pages sitemap', async () => {
    const response = await onRequest(
      context(new Request('https://fj.example/sitemap-pages.xml'), undefined),
    )
    expect(response.status).toBe(200)
    const xml = await response.text()
    expect(xml).toContain('https://fj.example/ideas</loc>')
    expect(xml).toContain('https://fj.example/pricing</loc>')
  })
})
