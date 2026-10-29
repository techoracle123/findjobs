/** Durable public discovery, independent of account/D1 storage. No credentials or
 * user data live in this namespace. Publish the pointer only after its data. */
import { specialistRole } from '../shared/specialisms'
import { buildQualitySnapshot, dedupeJobs, qualityPass } from './quality'
import type { QualitySnapshot } from '../shared/quality'
import { withTimeout } from './timeouts'
import { logger } from './logging'
import type { Job } from '../shared/types'
import { SEED_SOURCES } from './sources/seed'
import { fetchPublicSource } from './live-public'

export const REFRESH_HOURS = 12
export const PUBLIC_SOURCES = SEED_SOURCES.filter(
  (source) =>
    source.enabled &&
    [
      'greenhouse',
      'lever',
      'ashby',
      'recruitee',
      'workable',
      'rss',
      'arbeitnow',
      'remoteok',
      'himalayas',
      'workingnomads',
      'jobicy',
      'hn-hiring',
      'themuse',
      'smartrecruiters',
      'teamtailor',
      'personio',
      'breezy',
    ].includes(source.parser),
)
// Sources confirm aliveness by rewriting only when content changes (plus a
// periodic freshness touch), so the confirmation window is 8 days, not 36h.
const MAX_AGE = 8 * 86_400_000
const EXPIRY = 3 * 86400
export interface IndexedJob extends Job {
  detailKey: string
}
export interface SourceIndex {
  sourceId: string
  fetchedAt: number
  contentHash?: string
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
  moderationWithheld?: number
  jobs: IndexedJob[]
  parts?: string[]
  ids?: string[]
  duplicatesDropped?: number
}

/**
 * A disable is a cooldown, not a life sentence: after 24 hours the source
 * gets one more chance. Without this, every board knocked out by a since-
 * fixed bug (the robots.txt misfire disabled all of Ashby) stays dead
 * forever even though the underlying problem is gone.
 */
const DISABLED_COOLDOWN_MS = 24 * 3600_000

export async function isSourceDisabled(kv: KVNamespace, sourceId: string): Promise<boolean> {
  const record = await kv.get<{ at?: number }>(`source:disabled:${sourceId}`, 'json')
  if (!record) return false
  if (typeof record.at === 'number' && Date.now() - record.at > DISABLED_COOLDOWN_MS) return false
  return true
}

/** One source's last observed run, as shown to operators. */
export interface SourceRunRecord {
  sourceId: string
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastError: string
  durationMs: number | null
  itemCount: number | null
  consecutiveFailures: number
}

export const SOURCE_RUNS_KEY = 'source-runs'
export const HEARTBEAT_KEY = 'scheduler:heartbeat'

export interface SchedulerHeartbeat {
  at: string
  detail: string
}

/** The scheduler proves it is alive on every tick and every publish. */
export async function noteSchedulerHeartbeat(kv: KVNamespace, detail: string): Promise<void> {
  try {
    await kv.put(HEARTBEAT_KEY, JSON.stringify({ at: new Date().toISOString(), detail }))
  } catch {
    /* A heartbeat must never break the run it describes. */
  }
}

export async function getSchedulerHeartbeat(kv: KVNamespace): Promise<SchedulerHeartbeat | null> {
  return kv.get<SchedulerHeartbeat>(HEARTBEAT_KEY, 'json')
}

export async function getSourceRuns(kv: KVNamespace): Promise<SourceRunRecord[]> {
  return (await kv.get<SourceRunRecord[]>(SOURCE_RUNS_KEY, 'json')) ?? []
}

/** Consecutive failures auto-disable a source after three, with the reason kept. */
export async function noteSourceHealth(
  kv: KVNamespace,
  sourceId: string,
  ok: boolean,
  error = '',
  extra: { durationMs?: number; itemCount?: number } = {},
): Promise<void> {
  const key = `source:health:${sourceId}`
  const previous = (await kv.get<{ fails: number }>(key, 'json')) ?? { fails: 0 }
  const fails = ok ? 0 : previous.fails + 1
  await kv.put(
    key,
    JSON.stringify({
      fails,
      at: Date.now(),
      status: ok ? 'ok' : 'error',
      error: error.slice(0, 300),
      durationMs: extra.durationMs ?? null,
      itemCount: extra.itemCount ?? null,
    }),
  )
  if (ok) {
    // A success clears any disable outright; the cooldown is only the
    // backstop for sources nobody has retried yet.
    try {
      await kv.delete(`source:disabled:${sourceId}`)
    } catch {
      /* The 24h cooldown still applies if the delete races. */
    }
  }
  if (fails >= 3) {
    await kv.put(
      `source:disabled:${sourceId}`,
      JSON.stringify({ at: Date.now(), error: error.slice(0, 300) }),
    )
    logger.error('source disabled after consecutive failures', { sourceId, fails, error })
  }
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
  if (await isSourceDisabled(kv, sourceId))
    throw new Error('Source disabled after repeated failures')
  let jobs: Job[]
  const startedAt = Date.now()
  try {
    jobs = (await fetchPublicSource(source, fetcher, now)).filter((job) => job.jobStatus === 'open')
    await noteSourceHealth(kv, sourceId, true, '', {
      durationMs: Date.now() - startedAt,
      itemCount: jobs.length,
    })
  } catch (error) {
    await noteSourceHealth(
      kv,
      sourceId,
      false,
      error instanceof Error ? error.message : String(error),
      { durationMs: Date.now() - startedAt },
    )
    throw error
  }
  // Immutable raw archive keyed by content hash. The hash doubles as the
  // "content unchanged" test that keeps the free KV write budget intact.
  let rawHash = ''
  try {
    rawHash = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(jobs))),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    /* Hashing failure falls through to a normal write. */
  }
  const previousIndex = rawHash ? await kv.get<SourceIndex>(`source:${sourceId}`, 'json') : null
  const contentUnchanged = Boolean(rawHash) && previousIndex?.contentHash === rawHash
  const ageingOut = previousIndex ? now - previousIndex.fetchedAt > 6 * 86_400_000 : false
  if (rawHash) {
    try {
      const rawKey = `raw:${rawHash}`
      if (!(await kv.get(rawKey)))
        await kv.put(rawKey, JSON.stringify(jobs), { expirationTtl: 90 * 86_400 })
    } catch {
      /* The raw archive is observability, never a publication dependency. */
    }
  }
  if (contentUnchanged && !ageingOut && previousIndex) return jobs.length

  // Bounded detail shards avoid rejecting a real, large employer board or
  // loading its entire descriptions collection for one job page.
  const index: SourceIndex = {
    sourceId,
    fetchedAt: now,
    contentHash: rawHash || undefined,
    jobs: [],
  }
  for (let i = 0; i < jobs.length; i += 500) {
    const chunk = jobs.slice(i, i + 500),
      detailKey = `details:${sourceId}:${run}:${i / 500}`
    const text = JSON.stringify(chunk)
    if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024)
      throw new Error('Detail shard exceeds public storage safety bound')
    await kv.put(detailKey, text, { expirationTtl: EXPIRY })
    index.jobs.push(
      ...chunk.map((job) => ({
        ...job,
        description: job.description.slice(0, 600),
        // Evidence sentences are debug detail — they live in the detail shard
        // only, so the hot index stays small enough for the request budget.
        quality: job.quality ? { ...job.quality, skillEvidence: [] } : undefined,
        detailKey,
      })),
    )
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
  let moderationWithheld = 0
  const collected: IndexedJob[] = []
  const syndicated = new Map<string, string>()
  for (const index of valid)
    for (const job of index.jobs) {
      if (job.isDemo || job.jobStatus !== 'open') continue
      try {
        canonicalJobUrl(job) // invalid publisher URLs are not opportunities
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
        syndicated.set(fingerprint, index.sourceId)
        collected.push(job)
      } catch {
        /* Invalid publisher URLs are not opportunities. */
      }
    }
  // Re-running the quality pass here is the backfill: stored rows are
  // reprocessed on every publication until the normalizer version settles.
  const normalised = collected.map((job) => {
    const { patch } = qualityPass({
      title: job.title,
      company: job.company,
      description: job.description,
      applyUrl: job.applyUrl,
      sourceUrl: job.sourceUrl,
      tags: [...job.requiredSkills, ...job.usefulSkills],
      locationLabel: job.locationLabel,
      locationCountry: job.locationCountry,
      workMode: job.workMode,
      seniority: job.seniority,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryPeriod: job.salaryPeriod,
      requiredSkills: job.requiredSkills,
      usefulSkills: job.usefulSkills,
    })
    return {
      ...job,
      ...patch,
      roleFamily: specialistRole(job.title) || job.roleFamily,
      locationCountry: patch.quality.location.country || job.locationCountry,
    }
  })
  const { unique, dropped } = dedupeJobs(normalised)
  const withheld = unique.filter(
    (job) => job.moderationState === 'hold' || job.moderationState === 'reject',
  )
  const published = unique.filter(
    (job) => job.moderationState !== 'hold' && job.moderationState !== 'reject',
  )
  moderationWithheld = withheld.length
  void published
  const jobs = published.sort(
    (a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id),
  )
  if (!valid.length) throw new Error('No genuine public listings; keeping previous publication')
  return {
    version: 1,
    refreshedAt: new Date(now).toISOString(),
    refreshHours: REFRESH_HOURS,
    sourceCount: valid.length,
    attemptedSources: PUBLIC_SOURCES.length,
    olderSources: valid.filter((index) => now - index.fetchedAt > 13 * 3600000).length,
    added: previousIds.size ? jobs.filter((job) => !previousIds.has(job.id)).length : 0,
    moderationWithheld,
    duplicatesDropped: dropped,
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
  // Quality snapshots are durable history: date-keyed, never overwritten.
  try {
    const previousQuality = await kv.get<QualitySnapshot>('quality:latest', 'json')
    const quality = buildQualitySnapshot(
      snapshot.jobs,
      snapshot.duplicatesDropped ?? 0,
      previousQuality,
      now,
    )
    await kv.put(`quality:${quality.date}`, JSON.stringify(quality), { expirationTtl: 40 * EXPIRY })
    await kv.put('quality:latest', JSON.stringify(quality), { expirationTtl: 40 * EXPIRY })
  } catch {
    /* A quality snapshot must never block publication. */
  }
  // The small pointer is written LAST; a failed shard write keeps the old feed.
  await kv.put(
    'published',
    JSON.stringify({ ...snapshot, jobs: [], ids: snapshot.jobs.map((job) => job.id), parts }),
    { expirationTtl: EXPIRY },
  )
  // Operator truth in one read: every source's last run, plus the heartbeat.
  // Assembled here because publish already holds every source index.
  try {
    const byId = new Map(indexes.map((index) => [index.sourceId, index]))
    const runs: SourceRunRecord[] = []
    for (let i = 0; i < PUBLIC_SOURCES.length; i += 4) {
      const batch = PUBLIC_SOURCES.slice(i, i + 4)
      const health = await Promise.all(
        batch.map((source) =>
          kv.get<{
            fails: number
            at: number
            status?: 'ok' | 'error'
            error?: string
            durationMs?: number | null
            itemCount?: number | null
          }>(`source:health:${source.id}`, 'json'),
        ),
      )
      batch.forEach((source, position) => {
        const index = byId.get(source.id)
        const record = health[position]
        runs.push({
          sourceId: source.id,
          lastRunAt: record?.at
            ? new Date(record.at).toISOString()
            : index
              ? new Date(index.fetchedAt).toISOString()
              : null,
          lastStatus: record?.status ?? (index ? 'ok' : null),
          lastError: record?.error ?? '',
          durationMs: record?.durationMs ?? null,
          itemCount: record?.itemCount ?? index?.jobs.length ?? null,
          consecutiveFailures: record?.fails ?? 0,
        })
      })
    }
    await kv.put(SOURCE_RUNS_KEY, JSON.stringify(runs), { expirationTtl: EXPIRY })
    await noteSchedulerHeartbeat(
      kv,
      `published ${snapshot.jobs.length} jobs from ${snapshot.sourceCount} sources`,
    )
  } catch {
    /* Observability writes never block the feed. */
  }
  return snapshot
}

let cached: PublicSnapshot | null = null
let loadedAt = 0
let pending: Promise<PublicSnapshot | null> | null = null
export async function publishedPublicJobs(kv?: KVNamespace): Promise<PublicSnapshot | null> {
  if (!kv) return null
  if (cached && Date.now() - loadedAt < 15 * 60000) return cached
  if (pending) return pending
  pending = withTimeout(kv.get<PublicSnapshot>('published', { type: 'json', cacheTtl: 60 }))
    .then(async (snapshot) => {
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        Date.now() - Date.parse(snapshot.refreshedAt) > MAX_AGE
      )
        return null
      if (snapshot.parts?.length) {
        const jobs = new Map<string, IndexedJob>()
        // KV's bulk API resolves the publication in one RPC, rather than
        // serial cold-region round trips for each shard. Keep negative cache
        // short during eventual-consistency propagation of a new publication.
        for (let i = 0; i < snapshot.parts.length; i += 10) {
          const keys = snapshot.parts.slice(i, i + 10)
          const parts = await withTimeout(
            kv.get<IndexedJob[]>(keys, { type: 'json', cacheTtl: 60 }),
            5000,
          )
          if (keys.some((key) => !parts.get(key))) return null
          for (const key of keys)
            for (const job of parts.get(key)!) if (!jobs.has(job.id)) jobs.set(job.id, job)
        }
        snapshot.jobs = [...jobs.values()]
        if (snapshot.ids && new Set(snapshot.ids).size !== snapshot.jobs.length) return null
      }
      // Individual failed sources must not stay 'open' indefinitely just because
      // other sources continued refreshing the shared publication.
      for (const job of snapshot.jobs) job.roleFamily = specialistRole(job.title) || job.roleFamily
      // Held/rejected listings and report-hidden listings never reach users.
      const hidden = await kv
        .get<Record<string, number>>('moderation:hidden', { type: 'json', cacheTtl: 60 })
        .catch(() => null)
      snapshot.jobs = snapshot.jobs.filter(
        (job) =>
          !job.isDemo &&
          job.jobStatus === 'open' &&
          (job.moderationState ?? 'publish') !== 'hold' &&
          (job.moderationState ?? 'publish') !== 'reject' &&
          !(hidden && Object.hasOwn(hidden, job.id)) &&
          Date.now() - Date.parse(job.lastSeenAt || '') < MAX_AGE,
      )
      if (!snapshot.jobs.length && snapshot.ids?.length !== 0) return null
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
  const details = await withTimeout(
    kv.get<Job[]>(entry.detailKey, { type: 'json', cacheTtl: 60 }),
    5000,
  ).catch(() => null)
  const job = details?.find((job) => job.id === id)
  return job ? { ...job, roleFamily: specialistRole(job.title) || job.roleFamily } : null
}
