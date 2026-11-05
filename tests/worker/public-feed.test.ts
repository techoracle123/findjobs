import { describe, expect, it } from 'vitest'
import {
  assemblePublicSnapshot,
  refreshPublicSource,
  publishPublicSnapshot,
  readPublicationPointer,
  readPublicationShards,
  PUBLIC_SOURCES,
  type IndexedJob,
  type PublicSnapshot,
  type SourceIndex,
} from '../../src/server/public-feed'
import { fetchPublicSource } from '../../src/server/live-public'
import { SEED_SOURCES } from '../../src/server/sources/seed'
import { resetHostCache } from '../../src/server/sources/polite'
import { enqueuePublicRefresh } from '../../src/server/public-schedule'
import greenhouse from '../fixtures/greenhouse.json'

function storage() {
  const data = new Map<string, string>()
  const kv = {
    get: async (key: string) => (data.has(key) ? JSON.parse(data.get(key)!) : null),
    put: async (key: string, value: string) => {
      data.set(key, value)
    },
  } as unknown as KVNamespace
  return { kv, data }
}
const fetcher = (async (input: RequestInfo | URL) =>
  String(input).endsWith('/robots.txt')
    ? new Response('User-agent: *\nAllow: /\nCrawl-delay: 0')
    : Response.json(greenhouse)) as typeof fetch
async function index(now = Date.now()): Promise<SourceIndex> {
  resetHostCache()
  const jobs = await fetchPublicSource(
    SEED_SOURCES.find((source) => source.id === 'greenhouse-oneacrefund')!,
    fetcher,
    now,
  )
  return {
    sourceId: 'greenhouse-oneacrefund',
    fetchedAt: now,
    jobs: jobs
      .filter((job) => job.jobStatus === 'open')
      .map((job) => ({ ...job, detailKey: 'details:test' })),
  }
}

describe('durable broad public feed', () => {
  it('deduplicates canonical application links, strips tracking and excludes closed/demo jobs', async () => {
    const source = await index()
    const original = source.jobs[0]
    const duplicate = {
      ...original,
      id: 'duplicate',
      applyUrl: `${original.applyUrl || original.sourceUrl}?utm_campaign=test#track`,
    } as IndexedJob
    const snapshot = assemblePublicSnapshot(
      [
        {
          ...source,
          jobs: [
            original,
            duplicate,
            { ...original, id: 'demo', isDemo: true },
            { ...original, id: 'closed', jobStatus: 'closed' },
          ],
        },
      ],
      new Set(),
    )
    expect(snapshot.jobs).toHaveLength(1)
    expect(snapshot.refreshHours).toBe(12)
    // List shards never carry per-skill evidence (it lives in detail
    // payloads); carrying it once made every deploy republish the corpus.
    expect(snapshot.jobs[0].quality?.skillEvidence ?? []).toHaveLength(0)
    expect(snapshot.jobs[0].id).toBe(original.id)
  })
  it('drops publishers that have not confirmed content within the freshness window', async () => {
    const now = Date.now(),
      fresh = await index(now)
    const old = {
      ...fresh,
      sourceId: 'outage',
      fetchedAt: now - 9 * 86_400_000,
      jobs: fresh.jobs.map((job) => ({ ...job, id: 'expired-source' })),
    }
    const snapshot = assemblePublicSnapshot([fresh, old], new Set([fresh.jobs[0].id]), now)
    expect(snapshot.sourceCount).toBe(1)
    expect(snapshot.jobs.some((job) => job.id === 'expired-source')).toBe(false)
    expect(snapshot.added).toBe(snapshot.jobs.length - 1)
  })
  it('does not impose the emergency 100-per-source cap on scheduled discovery', async () => {
    const { kv, data } = storage()
    resetHostCache()
    const many = {
      jobs: Array.from({ length: 135 }, (_, i) => ({
        ...greenhouse.jobs[0],
        id: 90000 + i,
        absolute_url: `https://example.org/jobs/${i}`,
      })),
    }
    const feeds = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/robots.txt')
        ? new Response('User-agent: *\nAllow: /')
        : Response.json(many)) as typeof fetch
    expect(await refreshPublicSource(kv, 'greenhouse-oneacrefund', 'test', feeds)).toBe(135)
    expect(JSON.parse(data.get('source:greenhouse-oneacrefund')!).jobs).toHaveLength(135)
    expect(JSON.parse(data.get('details:greenhouse-oneacrefund:test:0')!)).toHaveLength(135)
  })
  it('writes immutable index shards before atomically publishing their pointer', async () => {
    const { kv, data } = storage(),
      source = await index()
    data.set(`source:${source.sourceId}`, JSON.stringify(source))
    const result = await publishPublicSnapshot(kv)
    const head = JSON.parse(data.get('published')!)
    expect(head.jobs).toEqual([])
    expect(head.parts.length).toBeGreaterThan(0)
    expect(JSON.parse(data.get(head.parts[0])!).length).toBe(result.jobs.length)
    expect(head.ids).toEqual(result.jobs.map((job) => job.id))
    data.clear()
    data.set('published', '{"previous":true}')
    await expect(publishPublicSnapshot(kv)).rejects.toThrow('keeping previous')
    expect(data.get('published')).toBe('{"previous":true}')
  })
  it('queues every permitted registry source and a delayed publisher without D1', async () => {
    const { kv } = storage(),
      batches: unknown[][] = [],
      delays: number[] = []
    const queue = {
      sendBatch: async (items: unknown[]) => {
        batches.push(items)
      },
      send: async (_body: unknown, options: { delaySeconds: number }) => {
        delays.push(options.delaySeconds)
      },
    } as unknown as Queue
    expect(await enqueuePublicRefresh({ PUBLIC_JOBS: kv, INGEST_QUEUE: queue }, 'test-run')).toBe(
      PUBLIC_SOURCES.length,
    )
    expect(batches.flat()).toHaveLength(PUBLIC_SOURCES.length)
    expect(batches.every((batch) => batch.length <= 100)).toBe(true)
    expect(delays[0]).toBeGreaterThanOrEqual(600)
    expect(PUBLIC_SOURCES.some((source) => source.id === 'remotive')).toBe(false)
    expect(PUBLIC_SOURCES.length).toBeGreaterThan(140)
  })
})

it('serves the broad index without D1 and returns full descriptions on individual pages', async () => {
  const { kv, data } = storage(),
    source = await index()
  const snapshot = assemblePublicSnapshot([source], new Set())
  expect(snapshot.opportunityVersion).toBe(1)
  expect(snapshot.stats?.totalAllLanguages).toBe(snapshot.jobs.length)
  expect(snapshot.stats?.total).toBeLessThanOrEqual(snapshot.jobs.length)
  // Simulate the snapshot production served before gig fields existed. Its
  // rows must gain an evidence-backed lane when loaded, not wait for the
  // next scheduled publication.
  const legacyJobs = snapshot.jobs.map((job, position) => ({
    ...job,
    ...(position === 0
      ? {
          title: 'Contract React Developer',
          description: 'This is a 6 month contract role building a client portal.',
        }
      : {}),
    opportunityType: undefined,
    engagementType: undefined,
    engagementLabel: undefined,
    engagementBasis: undefined,
    projectDuration: undefined,
  }))
  const legacyById = new Map(legacyJobs.map((job) => [job.id, job]))
  const complete = source.jobs.map((job) => {
    const legacy = legacyById.get(job.id)
    return {
      ...job,
      ...(legacy ? { title: legacy.title, description: legacy.description } : {}),
      description: `${legacy?.description ?? job.description} Full listing detail only.`,
      opportunityType: undefined,
      engagementType: undefined,
      engagementLabel: undefined,
      engagementBasis: undefined,
      projectDuration: undefined,
    }
  })
  data.set('details:test', JSON.stringify(complete))
  data.set(
    'published',
    JSON.stringify({
      ...snapshot,
      jobs: legacyJobs,
      opportunityVersion: undefined,
      stats: undefined,
    }),
  )
  const { default: app } = await import('../../src/server/app')
  // Test mode + dev identity: jobs need an account now, and the point of
  // this test is that job data itself comes from the snapshot, never D1.
  const auth = { headers: { 'x-dev-user-email': 'feed@example.com' } }
  const env = {
    APP_MODE: 'test',
    PUBLIC_JOBS: kv,
    DB: {
      prepare: () => {
        throw new Error('Database must not be consulted')
      },
    } as unknown as D1Database,
  }
  const feed = await app.request(
    'https://public-feed-tests.example/api/jobs?status=open&limit=1&ww=1',
    auth,
    env,
  )
  expect(feed.status).toBe(200)
  const body = (await feed.json()) as {
    jobs: (IndexedJob & { descriptionPreview: boolean })[]
    total: number
    dataSource: string
  }
  expect(body.total).toBe(snapshot.jobs.length)
  expect(body.dataSource).toBe('public-snapshot')
  expect(body.jobs[0].descriptionPreview).toBe(true)
  expect(body.jobs[0].detailKey).toBeUndefined()
  expect(body.jobs.every((job) => typeof job.opportunityType === 'string')).toBe(true)
  const gigFeed = await app.request(
    'https://public-feed-tests.example/api/jobs?status=open&limit=20&ww=1&type=gig',
    auth,
    env,
  )
  expect(gigFeed.status).toBe(200)
  const gigBody = (await gigFeed.json()) as { jobs: IndexedJob[]; total: number }
  expect(gigBody.total).toBeGreaterThan(0)
  expect(gigBody.jobs.every((job) => job.opportunityType === 'gig')).toBe(true)
  // The default feed is English-first: confirmed non-English listings stay out
  // unless Worldwide is requested.
  const englishOnly = await app.request(
    'https://public-feed-tests.example/api/jobs?status=open&limit=5',
    auth,
    env,
  )
  const englishBody = (await englishOnly.json()) as {
    jobs: (IndexedJob & { quality?: { isEnglish?: boolean } })[]
    total: number
  }
  expect(englishBody.total).toBeLessThanOrEqual(body.total)
  expect(englishBody.jobs.every((job) => job.quality?.isEnglish !== false)).toBe(true)
  const detail = await app.request(
    `https://public-feed-tests.example/api/jobs/${body.jobs[0].id}`,
    auth,
    env,
  )
  expect(detail.status).toBe(200)
  const detailBody = (await detail.json()) as { job: IndexedJob }
  expect(detailBody.job.description).toContain('Full listing detail only.')
  expect(typeof detailBody.job.opportunityType).toBe('string')
  const denied = await app.request('https://public-feed-tests.example/api/account', {}, env)
  expect(denied.status).toBe(401)
})

it('publishes more than 500 records exactly once, with no overlapping index shards', async () => {
  const { kv, data } = storage(),
    now = Date.now(),
    source = await index(now),
    job = source.jobs[0]
  source.jobs = Array.from({ length: 1105 }, (_, i) => ({
    ...job,
    id: `shard-check-${i}`,
    applyUrl: `https://example.org/careers/${i}`,
    title: `Test-only role ${i}`,
  }))
  data.set('source:' + source.sourceId, JSON.stringify(source))
  const snapshot = await publishPublicSnapshot(kv, now)
  const published = JSON.parse(data.get('published')!) as { parts: string[]; ids: string[] }
  const rows = published.parts.flatMap((part) => JSON.parse(data.get(part)!) as IndexedJob[])
  expect(snapshot.jobs).toHaveLength(1105)
  expect(published.parts).toHaveLength(3)
  expect(rows).toHaveLength(1105)
  expect(new Set(rows.map((job) => job.id)).size).toBe(1105)
})

it('keeps cold shard reads bounded, ordered and complete across a transient miss', async () => {
  const keys = Array.from({ length: 12 }, (_, index) => `part:${index}`)
  const rows = new Map(keys.map((key, index) => [key, [{ id: `job-${index}` } as IndexedJob]]))
  rows.set('part:1', [{ id: 'job-0' } as IndexedJob, { id: 'job-1' } as IndexedJob])
  let attempts = 0
  let active = 0
  let maxActive = 0
  const kv = {
    get: async (key: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        await new Promise((resolve) => setTimeout(resolve, 2))
        if (key === 'part:2' && ++attempts < 3) throw new Error('transient KV timeout')
        return rows.get(key) ?? null
      } finally {
        active -= 1
      }
    },
  } as unknown as KVNamespace
  const jobs = await readPublicationShards(kv, keys)
  expect(jobs.map((job) => job.id)).toEqual(
    Array.from({ length: 12 }, (_, index) => `job-${index}`),
  )
  expect(attempts).toBe(3)
  expect(maxActive).toBe(3)
})

it('never returns a partial publication after a persistent shard miss', async () => {
  let attempts = 0
  const kv = {
    get: async (key: string) => {
      if (key === 'missing') attempts += 1
      return key === 'missing' ? null : [{ id: key }]
    },
  } as unknown as KVNamespace
  await expect(readPublicationShards(kv, ['present', 'missing'])).rejects.toThrow(
    'temporarily unavailable',
  )
  expect(attempts).toBe(3)
})

it('retries a cold publication pointer without retrying a genuinely absent one', async () => {
  const pointer = { version: 1 } as PublicSnapshot
  let attempts = 0
  const kv = {
    get: async () => {
      attempts += 1
      if (attempts < 3) throw new Error('transient pointer timeout')
      return pointer
    },
  } as unknown as KVNamespace
  expect(await readPublicationPointer(kv)).toBe(pointer)
  expect(attempts).toBe(3)

  let missingReads = 0
  const missing = {
    get: async () => {
      missingReads += 1
      return null
    },
  } as unknown as KVNamespace
  expect(await readPublicationPointer(missing)).toBeNull()
  expect(missingReads).toBe(1)
})

it('bounds repeated publication pointer failures', async () => {
  let attempts = 0
  const kv = {
    get: async () => {
      attempts += 1
      throw new Error('pointer timeout')
    },
  } as unknown as KVNamespace
  await expect(readPublicationPointer(kv)).rejects.toThrow('pointer timeout')
  expect(attempts).toBe(3)
})
