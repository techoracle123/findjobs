import { roleFamilyLabel } from '../shared/taxonomy'
import { matchesOpportunityFilter, opportunityOf } from '../shared/opportunities'
import { gigCategoryFor } from '../shared/gig-categories'
import { compileSearch, normalizeSearchText } from '../shared/search-matching'
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
        ...(source.options ?? {}),
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

export function paginateSortedPublicJobs(filtered: Job[], search: JobSearch): JobSearchResult {
  const limit = Math.min(200, Math.max(1, search.limit ?? 50)),
    offset = Math.max(0, search.offset ?? 0)
  return { jobs: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }
}

export function paginatePublicJobs(matched: Job[], search: JobSearch): JobSearchResult {
  // Nigeria-first ordering for unfiltered browsing: in-market roles (NG or
  // remote) lead, newest first inside each group. Explicit country/search
  // filters already narrowed the set, so this only shapes the default feed.
  const filtered = matched.sort(
    (a, b) =>
      marketRank(b) - marketRank(a) ||
      b.postedAt.localeCompare(a.postedAt) ||
      a.id.localeCompare(b.id),
  )
  return paginateSortedPublicJobs(filtered, search)
}

export function searchLivePublic(jobs: Job[], search: JobSearch): JobSearchResult {
  return paginatePublicJobs(matchingPublicJobs(jobs, search), search)
}

const haystackCache = new WeakMap<Job, string>()

// One compiled matcher per request search object. Rebuilding term variants
// for every listing burned enough CPU, on a cold isolate with a
// 20,000-listing snapshot, to fail live searches outright.
const matcherCache = new WeakMap<JobSearch, ((normalizedHaystack: string) => boolean) | null>()
function matcherFor(search: JobSearch): ((normalizedHaystack: string) => boolean) | null {
  let matcher = matcherCache.get(search)
  if (matcher === undefined) {
    matcher = compileSearch(search.query || '')
    matcherCache.set(search, matcher)
  }
  return matcher
}
export function buildPublicSearchText(job: Job): string {
  const opportunity = opportunityOf(job)
  const gigCategory = opportunity.opportunityType === 'gig' ? gigCategoryFor(job) : null
  const opportunityTerms = [
    opportunity.opportunityType,
    opportunity.engagementType,
    opportunity.engagementLabel,
    opportunity.projectDuration ?? '',
    gigCategory?.label ?? '',
    gigCategory?.search ?? '',
    opportunity.opportunityType === 'gig' ? 'gig gigs contract freelance project' : 'job jobs',
  ].join(' ')
  // Keep only the opening slice of the description: over a 20,000-listing
  // snapshot, full-description copies pushed a cold isolate over its CPU and
  // memory budget. Skill extraction already ran over the full advert at
  // ingest and those skills remain searchable in full.
  return normalizeSearchText(
    `${job.title} ${job.company} ${job.locationLabel} ${roleFamilyLabel(job.roleFamily)} ${opportunityTerms} ${job.requiredSkills.join(' ')} ${job.usefulSkills.join(' ')} ${job.description.slice(0, 800)}`,
  )
}

function haystack(job: Job): string {
  let value = haystackCache.get(job)
  if (value === undefined) {
    // Current publications carry this derived text. Older snapshots and the
    // small live fallback still use the same builder on demand.
    value = (job as Job & { searchText?: string }).searchText ?? buildPublicSearchText(job)
    haystackCache.set(job, value)
  }
  return value
}

export interface PublicFacetMatch {
  matched: boolean
  withoutOpportunityType: boolean
  withoutCountry: boolean
  withoutRoleFamily: boolean
  gig: boolean
}

// There are only 32 possible answers. Sharing them avoids allocating a fresh
// object for every listing in a full-corpus search and then immediately
// throwing almost all of those objects away.
const FACET_MATCHES: PublicFacetMatch[] = Array.from({ length: 32 }, (_, bits) => ({
  matched: Boolean(bits & 1),
  withoutOpportunityType: Boolean(bits & 2),
  withoutCountry: Boolean(bits & 4),
  withoutRoleFamily: Boolean(bits & 8),
  gig: Boolean(bits & 16),
}))
function facetMatch(
  matched: boolean,
  withoutOpportunityType: boolean,
  withoutCountry: boolean,
  withoutRoleFamily: boolean,
  gig: boolean,
): PublicFacetMatch {
  return FACET_MATCHES[
    Number(matched) |
      (Number(withoutOpportunityType) << 1) |
      (Number(withoutCountry) << 2) |
      (Number(withoutRoleFamily) << 3) |
      (Number(gig) << 4)
  ]
}
const NO_FACET_MATCH = FACET_MATCHES[0]

/**
 * One-pass facet predicate. The jobs route needs the exact result plus three
 * disjunctive variants (country, profession and work lane removed one at a
 * time). Evaluating those as four full-corpus filters was enough, on a cold
 * isolate, to push the 15,000-listing snapshot over the Worker CPU budget.
 */
export function publicFacetMatch(job: Job, search: JobSearch): PublicFacetMatch {
  const place = (search.location || '').toLowerCase().trim()
  const common =
    search.status !== 'closed' &&
    (search.worldwide || job.quality?.isEnglish !== false) &&
    (!place ||
      `${job.locationLabel} ${job.quality?.location.city ?? ''} ${job.quality?.location.state ?? ''}`
        .toLowerCase()
        .includes(place)) &&
    (!search.workModes?.length || search.workModes.includes(job.workMode)) &&
    (!search.seniorities?.length || search.seniorities.includes(job.seniority)) &&
    (!search.verification?.length || search.verification.includes(job.verification || 'unverified'))
  if (!common) return NO_FACET_MATCH

  const country = !search.country || job.locationCountry === search.country
  const roleFamily = !search.roleFamilies?.length || search.roleFamilies.includes(job.roleFamily)
  if (!country && !roleFamily) return NO_FACET_MATCH

  const opportunityType = opportunityOf(job).opportunityType
  const gig = opportunityType === 'gig'
  const opportunity =
    !search.opportunityType || search.opportunityType === 'all'
      ? true
      : search.opportunityType === 'gig'
        ? gig
        : !gig
  // Every facet variant still applies two of these three dimensions. If fewer
  // than two pass, building a search haystack for this job cannot change any
  // count.
  if (Number(country) + Number(roleFamily) + Number(opportunity) < 2)
    return facetMatch(false, false, false, false, gig)

  const matcher = matcherFor(search)
  if (matcher && !matcher(haystack(job))) return facetMatch(false, false, false, false, gig)

  return facetMatch(
    country && roleFamily && opportunity,
    country && roleFamily,
    roleFamily && opportunity,
    country && opportunity,
    gig,
  )
}

export function matchingPublicJobs(jobs: Job[], search: JobSearch): Job[] {
  const place = (search.location || '').toLowerCase().trim()
  const matcher = matcherFor(search)
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
      matchesOpportunityFilter(job, search.opportunityType) &&
      (!search.verification?.length ||
        search.verification.includes(job.verification || 'unverified')) &&
      // No search terms: never build a haystack (the expensive part) at all.
      (matcher === null || matcher(haystack(job))),
  )
}
