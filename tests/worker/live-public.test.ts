import { beforeEach, describe, expect, it } from 'vitest'
import { fetchLivePublic, searchLivePublic, livePublicEnabled } from '../../src/server/live-public'
import { resetHostCache } from '../../src/server/sources/polite'
import { jobIdFor } from '../../src/server/ingest'
import greenhouse from '../fixtures/greenhouse.json'
import arbeitnow from '../fixtures/arbeitnow.json'
import rss from '../fixtures/jobs.xml?raw'

beforeEach(() => resetHostCache())
const fetcher = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /')
  if (url.includes('greenhouse.io')) return Response.json(greenhouse)
  if (url.includes('arbeitnow')) return Response.json(arbeitnow)
  return new Response(rss)
}) as typeof fetch

describe('database-independent real public listings', () => {
  it('uses publisher parsers and canonical IDs without touching a database', async () => {
    const result = await fetchLivePublic(fetcher)
    expect(result.jobs.length).toBeGreaterThan(4)
    expect(
      result.jobs.every(
        (job) => job.isDemo === false && job.jobStatus === 'open' && !!job.lastSeenAt,
      ),
    ).toBe(true)
  })
  it('keeps IDs compatible with database ingestion and applies filters before paging', async () => {
    const result = await fetchLivePublic(fetcher)
    const id = await jobIdFor('greenhouse-oneacrefund', '99101')
    expect(result.jobs.find((job) => job.id === id)?.title).toBe('Senior Site Reliability Engineer')
    const ng = searchLivePublic(result.jobs, { country: 'NG', limit: 1 })
    expect(ng.total).toBeGreaterThan(0)
    expect(ng.jobs).toHaveLength(1)
    expect(ng.jobs[0].locationCountry).toBe('NG')
    expect(searchLivePublic(result.jobs, { query: 'impossible-not-a-real-role' }).total).toBe(0)
    expect(searchLivePublic(result.jobs, { status: 'closed' }).total).toBe(0)
  })
  it('rejects unavailable/disallowed publishers rather than inventing jobs', async () => {
    const failed = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /')
        : new Response('', { status: 503 })) as typeof fetch
    await expect(fetchLivePublic(failed)).rejects.toThrow('temporarily unavailable')
  })
  it('does not enable network fallback implicitly in unit/local/test modes', () => {
    expect(livePublicEnabled('test')).toBe(false)
    expect(livePublicEnabled('local-preview')).toBe(false)
    expect(livePublicEnabled('production')).toBe(true)
  })
})
