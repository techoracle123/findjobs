import type { Job } from '../shared/types'
import type { JobSearch } from './jobs'
import { paginatePublicJobs, publicFacetMatch, searchLivePublic } from './live-public'
import { coverageOf } from './quality'
import type { FieldCoverage } from '../shared/quality'

export interface JobFacets {
  total: number
  globalTotal: number
  remote: number
  locations: number
  unknownLocation: number
  countries: Record<string, number>
  professions: Record<string, number>
  opportunities: { all: number; job: number; gig: number }
  /** Share of matched listings carrying a caution flag; banners stay quiet above 20%. */
  cautionShare: number
  /** Field completeness across the full matching set; drives control visibility. */
  coverage: FieldCoverage
}
function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] || 0) + 1
}
/** Disjunctive facet counts: each selector excludes only its own selection.
 * Summary metrics always describe the exact full result set before pagination. */
const facetCache = new Map<string, { at: number; value: JobFacets }>()

function cacheKey(jobs: Job[], search: JobSearch): string {
  return `${jobs.length}:${JSON.stringify(search)}`
}
function cachedFacets(key: string): JobFacets | null {
  const hit = facetCache.get(key)
  return hit && Date.now() - hit.at < 60_000 ? hit.value : null
}
function storeFacets(key: string, value: JobFacets): void {
  if (facetCache.size > 50) facetCache.clear()
  facetCache.set(key, { at: Date.now(), value })
}

export function jobFacets(jobs: Job[], search: JobSearch): JobFacets {
  const key = cacheKey(jobs, search)
  const cached = cachedFacets(key)
  if (cached) return cached
  const value = computeFacets(jobs, search)
  storeFacets(key, value)
  return value
}

/** Results and disjunctive facets from one full-corpus pass on the hot route. */
export function searchPublicJobs(jobs: Job[], search: JobSearch) {
  const key = cacheKey(jobs, search)
  const cached = cachedFacets(key)
  if (cached) return { ...searchLivePublic(jobs, search), facets: cached }
  const matched: Job[] = []
  const facets = computeFacets(jobs, search, matched)
  storeFacets(key, facets)
  return { ...paginatePublicJobs(matched, search), facets }
}

function computeFacets(jobs: Job[], search: JobSearch, matched: Job[] = []): JobFacets {
  const countries: Record<string, number> = Object.create(null)
  const professions: Record<string, number> = Object.create(null)
  const locations = new Set<string>()
  let allOpportunities = 0
  let gigCount = 0
  let remote = 0
  let unknownLocation = 0
  let cautions = 0

  for (const job of jobs) {
    const match = publicFacetMatch(job, search)
    if (match.withoutCountry) increment(countries, job.locationCountry || 'unknown')
    if (match.withoutRoleFamily) increment(professions, job.roleFamily || 'unknown')
    if (match.withoutOpportunityType) {
      allOpportunities += 1
      if (match.gig) gigCount += 1
    }
    if (match.matched) {
      matched.push(job)
      if (job.workMode === 'remote') remote += 1
      if (job.locationCountry) locations.add(job.locationCountry)
      else unknownLocation += 1
      if (job.moderationState === 'caution') cautions += 1
    }
  }

  return {
    total: matched.length,
    globalTotal: jobs.length,
    remote,
    locations: locations.size,
    unknownLocation,
    countries,
    professions,
    opportunities: {
      all: allOpportunities,
      gig: gigCount,
      job: allOpportunities - gigCount,
    },
    cautionShare: matched.length ? cautions / matched.length : 0,
    coverage: coverageOf(matched),
  }
}
