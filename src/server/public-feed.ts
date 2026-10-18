/** Durable public discovery, independent of account/D1 storage. No credentials or
 * user data live in this namespace. Publish the pointer only after its data. */
import type { Job } from '../shared/types'
import { SEED_SOURCES } from './sources/seed'
import { fetchPublicSource } from './live-public'

export const REFRESH_HOURS = 12
export const PUBLIC_SOURCES = SEED_SOURCES.filter(
  (source) => source.enabled && ['greenhouse', 'lever', 'rss', 'arbeitnow'].includes(source.parser),
)
const MAX_AGE = 36 * 3600000
const EXPIRY = 3 * 86400
export interface IndexedJob extends Job {
  detailKey: string
}
export interface SourceIndex {
  sourceId: string
  fetchedAt: number
  jobs: IndexedJob[]
}
export interface PublicSnapshot {
  version: 1
  refreshedAt: string
  refreshHours: number
  sourceCount: number
  attemptedSources: number
  olderSources: number
  added: number
  jobs: IndexedJob[]
  parts?: string[]
  ids?: string[]
}

export async function refreshPublicSource(
  kv: KVNamespace,
  sourceId: string,
  run: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<number> {
  const source = PUBLIC_SOURCES.find((item) => item.id === sourceId)
  if (!source) throw new Error('Unknown public source')
  const jobs = (await fetchPublicSource(source, fetcher, now)).filter(
    (job) => job.jobStatus === 'open',
  )
  // Do not truncate huge boards to make storage appear successful.
  const detail = JSON.stringify(jobs)
  if (new TextEncoder().encode(detail).byteLength > 20 * 1024 * 1024)
    throw new Error('Source exceeds public storage safety bound')
  const detailKey = `details:${sourceId}:${run}`
  await kv.put(detailKey, detail, { expirationTtl: EXPIRY })
  const index: SourceIndex = {
    sourceId,
    fetchedAt: now,
    jobs: jobs.map((job) => ({ ...job, description: job.description.slice(0, 600), detailKey })),
  }
  await kv.put(`source:${sourceId}`, JSON.stringify(index), { expirationTtl: EXPIRY })
  return jobs.length
}

export function canonicalJobUrl(job: Job): string {
  const url = new URL(job.applyUrl || job.sourceUrl)
  url.hash = ''
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gh_src|source|ref$|referrer$)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return url.href.replace(/\/\/?$/, '').replace('://www.', '://')
}

export function assemblePublicSnapshot(
  indexes: SourceIndex[],
  previousIds: Set<string>,
  now = Date.now(),
): PublicSnapshot {
  const valid = indexes.filter((index) => now - index.fetchedAt < MAX_AGE)
  const unique = new Map<string, IndexedJob>()
  const syndicated = new Map<string, string>()
  for (const index of valid)
    for (const job of index.jobs) {
      if (job.isDemo || job.jobStatus !== 'open') continue
      try {
        const key = canonicalJobUrl(job)
        const fingerprint = [job.company, job.title, job.locationLabel]
          .map((value) =>
            value
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim(),
          )
          .join('|')
        const priorSource = syndicated.get(fingerprint)
        if (priorSource && priorSource !== index.sourceId) continue
        if (!unique.has(key)) {
          unique.set(key, job)
          syndicated.set(fingerprint, index.sourceId)
        }
      } catch {
        /* Invalid publisher URLs are not opportunities. */
      }
    }
  const jobs = [...unique.values()].sort(
    (a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id),
  )
  if (!jobs.length) throw new Error('No genuine public listings; keeping previous publication')
  return {
    version: 1,
    refreshedAt: new Date(now).toISOString(),
    refreshHours: REFRESH_HOURS,
    sourceCount: valid.length,
    attemptedSources: PUBLIC_SOURCES.length,
    olderSources: valid.filter((index) => now - index.fetchedAt > 13 * 3600000).length,
    added: previousIds.size ? jobs.filter((job) => !previousIds.has(job.id)).length : 0,
    jobs,
  }
}

export async function publishPublicSnapshot(
  kv: KVNamespace,
  now = Date.now(),
): Promise<PublicSnapshot> {
  const indexes: SourceIndex[] = []
  // Bounded concurrency, not hundreds of simultaneous large reads.
  for (let i = 0; i < PUBLIC_SOURCES.length; i += 4) {
    const batch = await Promise.all(
      PUBLIC_SOURCES.slice(i, i + 4).map((source) =>
        kv.get<SourceIndex>(`source:${source.id}`, 'json'),
      ),
    )
    indexes.push(...batch.filter((index): index is SourceIndex => !!index))
  }
  const previous = await kv.get<PublicSnapshot>('published', 'json')
  const snapshot = assemblePublicSnapshot(
    indexes,
    new Set(previous?.ids || previous?.jobs?.map((job) => job.id)),
    now,
  )
  const parts: string[] = []
  for (let i = 0; i < snapshot.jobs.length; i += 500) {
    const key = `publication:${now}:${i / 500}`
    await kv.put(key, JSON.stringify(snapshot.jobs.slice(i, i + 500)), { expirationTtl: EXPIRY })
    parts.push(key)
  }
  // The small pointer is written LAST; a failed shard write keeps the old feed.
  await kv.put(
    'published',
    JSON.stringify({ ...snapshot, jobs: [], ids: snapshot.jobs.map((job) => job.id), parts }),
    { expirationTtl: EXPIRY },
  )
  return snapshot
}

let cached: PublicSnapshot | null = null
let loadedAt = 0
let pending: Promise<PublicSnapshot | null> | null = null
export async function publishedPublicJobs(kv?: KVNamespace): Promise<PublicSnapshot | null> {
  if (!kv) return null
  if (cached && Date.now() - loadedAt < 15 * 60000) return cached
  if (pending) return pending
  pending = kv
    .get<PublicSnapshot>('published', { type: 'json', cacheTtl: 900 })
    .then(async (snapshot) => {
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        Date.now() - Date.parse(snapshot.refreshedAt) > MAX_AGE
      )
        return null
      if (snapshot.parts?.length) {
        const jobs: IndexedJob[] = []
        for (let i = 0; i < snapshot.parts.length; i += 4) {
          const parts = await Promise.all(
            snapshot.parts
              .slice(i, i + 4)
              .map((key) => kv.get<IndexedJob[]>(key, { type: 'json', cacheTtl: 3600 })),
          )
          if (parts.some((part) => !part)) return null
          jobs.push(...parts.flatMap((part) => part || []))
        }
        snapshot.jobs = jobs
      }
      // Individual failed sources must not stay 'open' indefinitely just because
      // other sources continued refreshing the shared publication.
      snapshot.jobs = snapshot.jobs.filter(
        (job) =>
          !job.isDemo &&
          job.jobStatus === 'open' &&
          Date.now() - Date.parse(job.lastSeenAt || '') < MAX_AGE,
      )
      if (!snapshot.jobs.length) return null
      cached = snapshot
      loadedAt = Date.now()
      return snapshot
    })
    .catch(() => null)
    .finally(() => {
      pending = null
    })
  return pending
}

export async function findPublishedJob(
  kv: KVNamespace | undefined,
  id: string,
): Promise<Job | null> {
  const snapshot = await publishedPublicJobs(kv)
  const entry = snapshot?.jobs.find((job) => job.id === id)
  if (!kv || !entry) return null
  const details = await kv
    .get<Job[]>(entry.detailKey, { type: 'json', cacheTtl: 3600 })
    .catch(() => null)
  return details?.find((job) => job.id === id) || null
}
