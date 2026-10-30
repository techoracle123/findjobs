import { roleFamilyLabel } from '../shared/taxonomy'
import { marketRank } from '../shared/scoring'
import type { Job } from '../shared/types'
import type { JobSearch, JobSearchResult } from './jobs'
import { SEED_SOURCES } from './sources/seed'
import { getParser } from './sources/registry'
import { normalizePosting } from './sources/normalize'
import { createPoliteFetch, createTimedFetch, robotsGatedKind } from './sources/polite'

const TTL = 30 * 60 * 1000
const SOURCES = [
  'myjobmag-ng',
  'weworkremotely',
  'greenhouse-oneacrefund',
  'greenhouse-givedirectly',
  'arbeitnow',
]
interface Snapshot {
  fetchedAt: number
  jobs: Job[]
}
let memory: Snapshot | null = null
let pending: Promise<Snapshot> | null = null
let retryAfter = 0

export function livePublicEnabled(mode?: string): boolean {
  return mode === 'production' || mode === 'staging'
}

/** No database, credentials, fixtures or fabricated jobs. Publisher robots rules
 * and request deadlines still apply. Successful observations expire in 30 min. */
export async function fetchLivePublic(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Snapshot> {
  const groups = await Promise.allSettled(
    SOURCES.map(async (id) => {
      const source = SEED_SOURCES.find((item) => item.id === id)!
      return fetchPublicSource(source, fetcher, now, 100)
    }),
  )
  const jobs = [
    ...new Map(
      groups
        .flatMap((group) => (group.status === 'fulfilled' ? group.value : []))
        .filter((job) => job.jobStatus === 'open')
        .map((job) => [job.id, job]),
    ).values(),
  ]
  if (!jobs.length) throw new Error('Live public sources are temporarily unavailable')
  return { fetchedAt: now, jobs }
}

export async function fetchPublicSource(
  source: (typeof SEED_SOURCES)[number],
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  limit = 10000,
): Promise<Job[]> {
  const id = source.id
  const parser = getParser(source.parser)!
  const raw = await parser.fetchPostings(
    {
      id,
      listingUrl: source.listingUrl,
      options: {
        company: source.company,
        companyLabel: source.companyLabel,
        country: source.country,
      },
      verification: 'unverified',
      verificationReason: 'A public opportunity; verify with the employer.',
    },
    robotsGatedKind(parser.kind)
      ? createPoliteFetch(
          id,
          'RoleSignalBot/1.0 (+https://fj-find-jobs.pages.dev; public job discovery)',
          fetcher,
        )
      : createTimedFetch(
          'RoleSignalBot/1.0 (+https://fj-find-jobs.pages.dev; public job discovery)',
          fetcher,
        ),
  )
  if (limit !== 100 && raw.length > limit)
    throw new Error('Publisher exceeds ingestion safety bound')
  return Promise.all(
    raw
      .slice(0, limit)
      .filter(
        (item) => item.title && item.externalId && /^https?:\/\//i.test(item.applyUrl || item.url),
      )
      .map(async (item) => {
        const bytes = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(`${id}:${item.externalId}`),
        )
        const hash = [...new Uint8Array(bytes)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
        const job = normalizePosting(item, {
          now,
          verification: 'unverified',
          verificationReason: 'A public opportunity; verify with the employer.',
          sourceKind: parser.kind,
          sourcePlatform: parser.platform,
          // Nigerian boards/feeds (MyJobMag NG, Hot Nigerian Jobs) stamp NG:
          // the board itself is the evidence. Aggregators with a home
          // country (e.g. a German board listing worldwide remote roles)
          // and company ATS boards must never stamp a country.
          sourceCountry: parser.kind !== 'ats' && source.country === 'NG' ? 'NG' : undefined,
        })
        return {
          ...job,
          id: `job_${hash.slice(0, 24)}`,
          sourceName: source.name,
          sourceUrl: item.url,
          postedAt: job.postedAt || '',
        } satisfies Job
      }),
  )
}

export async function livePublicJobs(origin: string): Promise<Job[]> {
  const now = Date.now()
  if (memory && now - memory.fetchedAt < TTL) return memory.jobs
  if (pending) return (await pending).jobs
  const cache =
    typeof caches !== 'undefined'
      ? (caches as CacheStorage & { default?: Cache }).default
      : undefined
  const key = new Request(new URL('/_fj/live-public-feed-v1', origin))
  if (cache) {
    try {
      const response = await cache.match(key)
      if (response) {
        const snapshot = (await response.json()) as Snapshot
        if (
          now - snapshot.fetchedAt < TTL &&
          snapshot.jobs.length &&
          snapshot.jobs.every((job) => job.isDemo === false)
        ) {
          memory = snapshot
          return snapshot.jobs
        }
      }
    } catch {
      /* A cache outage must not prevent real source retrieval. */
    }
  }
  // Another request may start a fetch while Cache API is awaited.
  const concurrent = ((): Promise<Snapshot> | null => pending)()
  if (concurrent) return (await concurrent).jobs
  if (now < retryAfter) throw new Error('Live public sources are temporarily unavailable')
  pending = fetchLivePublic()
    .then(async (snapshot) => {
      memory = snapshot
      if (cache)
        try {
          await cache.put(
            key,
            Response.json(snapshot, {
              headers: { 'cache-control': `public,max-age=${TTL / 1000}` },
            }),
          )
        } catch {
          /* Best effort. */
        }
      return snapshot
    })
    .catch((error) => {
      retryAfter = Date.now() + 30000
      throw error
    })
    .finally(() => {
      pending = null
    })
  return (await pending).jobs
}

export function searchLivePublic(jobs: Job[], search: JobSearch): JobSearchResult {
  // Nigeria-first ordering for unfiltered browsing: in-market roles (NG or
  // remote) lead, newest first inside each group. Explicit country/search
  // filters already narrowed the set, so this only shapes the default feed.
  const filtered = matchingPublicJobs(jobs, search).sort(
    (a, b) =>
      marketRank(b) - marketRank(a) ||
      b.postedAt.localeCompare(a.postedAt) ||
      a.id.localeCompare(b.id),
  )
  const limit = Math.min(200, Math.max(1, search.limit ?? 50)),
    offset = Math.max(0, search.offset ?? 0)
  return { jobs: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }
}

const haystackCache = new WeakMap<Job, string>()
function haystack(job: Job): string {
  let value = haystackCache.get(job)
  if (value === undefined) {
    value =
      `${job.title} ${job.company} ${job.locationLabel} ${roleFamilyLabel(job.roleFamily)} ${job.description} ${job.requiredSkills.join(' ')} ${job.usefulSkills.join(' ')}`.toLowerCase()
    haystackCache.set(job, value)
  }
  return value
}

export function matchingPublicJobs(jobs: Job[], search: JobSearch): Job[] {
  const terms = (search.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  const place = (search.location || '').toLowerCase().trim()
  return jobs.filter(
    (job) =>
      search.status !== 'closed' &&
      // Confirmed non-English listings are hidden unless Worldwide is asked for.
      (search.worldwide || job.quality?.isEnglish !== false) &&
      (!search.country || job.locationCountry === search.country) &&
      (!place ||
        `${job.locationLabel} ${job.quality?.location.city ?? ''} ${job.quality?.location.state ?? ''}`
          .toLowerCase()
          .includes(place)) &&
      (!search.roleFamilies?.length || search.roleFamilies.includes(job.roleFamily)) &&
      (!search.workModes?.length || search.workModes.includes(job.workMode)) &&
      (!search.seniorities?.length || search.seniorities.includes(job.seniority)) &&
      (!search.verification?.length ||
        search.verification.includes(job.verification || 'unverified')) &&
      terms.every((term) => haystack(job).includes(term)),
  )
}
