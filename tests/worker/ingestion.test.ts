import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './setup'
import arbeitnowFixture from '../fixtures/arbeitnow.json'
import remotiveFixture from '../fixtures/remotive.json'
import greenhouseFixture from '../fixtures/greenhouse.json'
import { jobIdFor, runIngestion } from '../../src/server/ingest'
import { inferCountry, inferRoleFamily, inferSeniority } from '../../src/server/sources/normalize'
import { listJobs } from '../../src/server/jobs'
import { enqueueDue } from '../../src/ingest'

/**
 * A stand-in for the network that replays a recorded API response. The
 * ingestion pipeline is exercised end to end without touching the internet,
 * so the tests are deterministic and run in CI.
 */
function fixtureFetch(payload: unknown, status = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/robots.txt'))
      return new Response('User-agent: *\nAllow: /', { status: 200 })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

beforeEach(async () => {
  // Only the postings this suite created are removed. The seeded demo rows
  // are part of the fixture and other suites depend on them.
  await env.DB.prepare('DELETE FROM jobs WHERE source_id IS NOT NULL').run()
  await env.DB.prepare('DELETE FROM source_postings').run()
  await env.DB.prepare('DELETE FROM ingestion_runs').run()
  await env.DB.prepare('DELETE FROM jobs_fts').run()
  await env.DB.prepare('DELETE FROM job_events').run()
})

describe('ingestion', () => {
  it('turns a recorded feed into normalised postings', async () => {
    const result = await runIngestion(env.DB, 'arbeitnow', {
      fetchImpl: fixtureFetch(arbeitnowFixture),
    })

    expect(result.status).toBe('ok')
    expect(result.fetched).toBe(3)
    expect(result.inserted).toBe(3)
    expect(result.error).toBeNull()

    const { jobs } = await listJobs(env.DB)
    const ingested = jobs.filter((job) => !job.id.startsWith('demo-'))
    expect(ingested).toHaveLength(3)

    const backend = ingested.find((job) => job.title.includes('Senior Backend Engineer'))!
    expect(backend.company).toBe('Nordlicht Systems')
    expect(backend.roleFamily).toBe('backend')
    expect(backend.seniority).toBe('senior')
    expect(backend.workMode).toBe('unknown')
    expect(backend.locationCountry).toBe('DE')
    expect(backend.salaryCurrency).toBe('EUR')
    expect(backend.salaryMin).toBe(80_000)
    expect(backend.salaryMax).toBe(100_000)
    expect(backend.salaryPeriod).toBe('year')
    expect(backend.requiredSkills).toContain('Go')
    expect(backend.sourceName).toContain('Arbeitnow')
    expect(backend.isDemo).toBe(false)
  })

  it('marks a remote posting as remote and finds the country', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })
    const { jobs } = await listJobs(env.DB)

    const rust = jobs
      .filter((job) => !job.id.startsWith('demo-'))
      .find((job) => job.title === 'Rust Engineer')!
    expect(rust.workMode).toBe('remote')
    expect(rust.locationCountry).toBe('')
    expect(rust.requiredSkills).toContain('Rust')
  })

  it('is idempotent: a second run does not duplicate or change anything', async () => {
    const first = await runIngestion(env.DB, 'arbeitnow', {
      fetchImpl: fixtureFetch(arbeitnowFixture),
    })
    expect(first.inserted).toBe(3)

    const second = await runIngestion(env.DB, 'arbeitnow', {
      fetchImpl: fixtureFetch(arbeitnowFixture),
    })
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)

    const { jobs } = await listJobs(env.DB)
    expect(jobs.filter((job) => !job.id.startsWith('demo-'))).toHaveLength(3)
  })

  it('updates a posting when the source changes it', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })

    const changed = JSON.parse(JSON.stringify(arbeitnowFixture)) as {
      data: { title: string; slug: string }[]
    }
    changed.data[0].title = 'Staff Backend Engineer (Go)'

    const result = await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(changed) })
    expect(result.updated).toBe(1)

    const { jobs } = await listJobs(env.DB)
    const ingested = jobs.filter((job) => !job.id.startsWith('demo-'))
    expect(ingested.some((job) => job.title === 'Staff Backend Engineer (Go)')).toBe(true)
    expect(ingested).toHaveLength(3)
  })

  it('closes a posting that the source has dropped, and keeps the record', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })

    const reduced = JSON.parse(JSON.stringify(arbeitnowFixture)) as { data: unknown[] }
    reduced.data = reduced.data.slice(0, 2)

    const result = await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(reduced) })
    expect(result.expired).toBe(1)
    expect(result.closed).toBe(1)

    // The role stays in the feed, marked closed, so people can see that it
    // existed rather than finding it silently missing.
    const { jobs } = await listJobs(env.DB)
    const ingested = jobs.filter((job) => !job.id.startsWith('demo-'))
    expect(ingested).toHaveLength(3)
    const dropped = ingested.find((job) => job.title === 'Product Designer')
    expect(dropped?.jobStatus).toBe('closed')
    expect(dropped?.closedAt).toBeTruthy()
    expect(dropped?.closedReason).toContain('no longer advertised')
  })

  it('records the life of a posting', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })

    const row = await env.DB.prepare('SELECT id FROM jobs WHERE title = ?1')
      .bind('Product Designer')
      .first<{ id: string }>()

    const events = await env.DB.prepare(
      'SELECT type FROM job_events WHERE job_id = ?1 ORDER BY created_at',
    )
      .bind(row?.id ?? '')
      .all<{ type: string }>()

    expect((events.results ?? []).map((event) => event.type)).toContain('opened')
  })

  it('marks postings from an employer board as verified', async () => {
    await env.DB.prepare(
      `INSERT INTO sources (id, name, adapter, kind, platform, listing_url, enabled, verification,
        refresh_tier, rate_limit_per_hour, config)
       VALUES ('gh-test', 'Example Corp - Greenhouse', 'greenhouse', 'ats', 'greenhouse',
        'https://boards.greenhouse.io/examplecorp', 1, 'verified', 'daily', 30,
        '{"company":"examplecorp"}')`,
    ).run()

    const result = await runIngestion(env.DB, 'gh-test', {
      fetchImpl: fixtureFetch(greenhouseFixture),
      now: Date.parse('2026-10-17T00:00:00Z'),
    })

    expect(result.status).toBe('ok')
    expect(result.inserted).toBe(2)

    const row = await env.DB.prepare(
      'SELECT verification, verification_reason, source_platform FROM jobs WHERE source_id = ?1 LIMIT 1',
    )
      .bind('gh-test')
      .first<{ verification: string; verification_reason: string; source_platform: string }>()

    expect(row?.verification).toBe('verified')
    expect(row?.verification_reason).toContain('own board')
    expect(row?.source_platform).toBe('greenhouse')
  })

  it('records a failure against the source instead of throwing', async () => {
    const result = await runIngestion(env.DB, 'remotive', {
      fetchImpl: fixtureFetch({ error: 'nope' }, 500),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('500')

    const run = await env.DB.prepare('SELECT status, error FROM ingestion_runs LIMIT 1').first<{
      status: string
      error: string
    }>()
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('500')
  })

  it('does not let one source break another', async () => {
    const failing = await runIngestion(env.DB, 'arbeitnow', {
      fetchImpl: fixtureFetch({}, 503),
    })
    expect(failing.status).toBe('failed')

    const working = await runIngestion(env.DB, 'remotive', {
      fetchImpl: fixtureFetch(remotiveFixture),
    })
    expect(working.status).toBe('ok')
    expect(working.inserted).toBe(2)
  })

  it('gives a posting a stable id derived from the source and its own id', async () => {
    const expected = await jobIdFor('arbeitnow', 'senior-backend-engineer-berlin-1')
    const again = await jobIdFor('arbeitnow', 'senior-backend-engineer-berlin-1')
    expect(expected).toBe(again)
    expect(expected.startsWith('job_')).toBe(true)
  })

  it('indexes postings for search', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jobs_fts WHERE jobs_fts MATCH 'PostgreSQL'",
    ).first<{ n: number }>()
    expect(row?.n).toBeGreaterThan(0)
  })
})

describe('normalisation', () => {
  it('infers a role family from the title', () => {
    expect(inferRoleFamily('Senior Backend Engineer', [], '')).toBe('backend')
    expect(inferRoleFamily('Product Designer', ['design'], '')).toBe('design')
    expect(inferRoleFamily('Data Scientist', [], 'python and machine learning')).toBe('data')
  })

  it('infers a seniority from the title', () => {
    expect(inferSeniority('Staff Engineer', '')).toBe('staff')
    expect(inferSeniority('Engineer', '')).toBe('unknown')
  })

  it('only claims a country it can actually see', () => {
    expect(inferCountry('Berlin, Germany')).toBe('DE')
    expect(inferCountry('Remote, Europe')).toBe('')
    expect(inferCountry('')).toBe('')
  })
})

describe('queue producer', () => {
  it('splits a large due registry into batches of at most 100 messages', async () => {
    await env.DB.prepare('UPDATE sources SET enabled = 1, last_run_at = NULL').run()
    const sendBatch = vi.fn().mockResolvedValue(undefined)
    const count = await enqueueDue({ ...env, INGEST_QUEUE: { sendBatch } as unknown as Queue })
    expect(count).toBeGreaterThan(100)
    const batches = sendBatch.mock.calls.map((call) => call[0] as unknown[])
    expect(batches.every((batch) => batch.length <= 100)).toBe(true)
    expect(batches.reduce((sum, batch) => sum + batch.length, 0)).toBe(count)
  })
})
