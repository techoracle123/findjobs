import { describe, expect, it } from 'vitest'
import {
  assemblePublicSnapshot,
  refreshPublicSource,
  publishPublicSnapshot,
  PUBLIC_SOURCES,
  type IndexedJob,
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
    expect(snapshot.jobs[0].id).toBe(original.id)
  })
  it('does not keep a failed publisher alive indefinitely through other publishers', async () => {
    const now = Date.now(),
      fresh = await index(now)
    const old = {
      ...fresh,
      sourceId: 'outage',
      fetchedAt: now - 37 * 3600000,
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
  const complete = source.jobs.map((job) => ({
    ...job,
    description: job.description + ' Full listing detail only.',
  }))
  data.set('details:test', JSON.stringify(complete))
  data.set('published', JSON.stringify(snapshot))
  const { default: app } = await import('../../src/server/app')
  const env = {
    APP_MODE: 'production',
    PUBLIC_JOBS: kv,
    DB: {
      prepare: () => {
        throw new Error('Database must not be consulted')
      },
    } as unknown as D1Database,
  }
  const feed = await app.request(
    'https://public-feed-tests.example/api/jobs?status=open&limit=1&ww=1',
    {},
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
  // The default feed is English-first: confirmed non-English listings stay out
  // unless Worldwide is requested.
  const englishOnly = await app.request(
    'https://public-feed-tests.example/api/jobs?status=open&limit=5',
    {},
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
    {},
    env,
  )
  expect(detail.status).toBe(200)
  expect(((await detail.json()) as { job: IndexedJob }).job.description).toContain(
    'Full listing detail only.',
  )
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
