import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import './setup'
import arbeitnowFixture from '../fixtures/arbeitnow.json'
import remotiveFixture from '../fixtures/remotive.json'
import { jobIdFor, runIngestion } from '../../src/server/ingest'
import { inferCountry, inferRoleFamily, inferSeniority } from '../../src/server/sources/normalize'
import { listJobs } from '../../src/server/jobs'

/**
 * A stand-in for the network that replays a recorded API response. The
 * ingestion pipeline is exercised end to end without touching the internet,
 * so the tests are deterministic and run in CI.
 */
function fixtureFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM jobs').run()
  await env.DB.prepare('DELETE FROM source_postings').run()
  await env.DB.prepare('DELETE FROM ingestion_runs').run()
  await env.DB.prepare('DELETE FROM jobs_fts').run()
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
    expect(jobs).toHaveLength(3)

    const backend = jobs.find((job) => job.title.includes('Senior Backend Engineer'))!
    expect(backend.company).toBe('Nordlicht Systems')
    expect(backend.roleFamily).toBe('backend')
    expect(backend.seniority).toBe('senior')
    expect(backend.workMode).toBe('onsite')
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

    const rust = jobs.find((job) => job.title === 'Rust Engineer')!
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
    expect(jobs).toHaveLength(3)
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
    expect(jobs.some((job) => job.title === 'Staff Backend Engineer (Go)')).toBe(true)
    expect(jobs).toHaveLength(3)
  })

  it('retires a posting that the source has dropped', async () => {
    await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(arbeitnowFixture) })

    const reduced = JSON.parse(JSON.stringify(arbeitnowFixture)) as { data: unknown[] }
    reduced.data = reduced.data.slice(0, 2)

    const result = await runIngestion(env.DB, 'arbeitnow', { fetchImpl: fixtureFetch(reduced) })
    expect(result.expired).toBe(1)

    const { jobs } = await listJobs(env.DB)
    expect(jobs).toHaveLength(2)
    expect(jobs.some((job) => job.title === 'Product Designer')).toBe(false)
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
    expect(inferSeniority('Engineer', '')).toBe('mid')
  })

  it('only claims a country it can actually see', () => {
    expect(inferCountry('Berlin, Germany')).toBe('DE')
    expect(inferCountry('Remote, Europe')).toBe('')
    expect(inferCountry('')).toBe('')
  })
})
