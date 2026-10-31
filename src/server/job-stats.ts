import type { Job } from '../shared/types'
import type { JobSearch } from './jobs'
import { publicFacetMatch } from './live-public'
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

export function jobFacets(jobs: Job[], search: JobSearch): JobFacets {
  const key = `${jobs.length}:${JSON.stringify(search)}`
  const hit = facetCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const value = computeFacets(jobs, search)
  if (facetCache.size > 50) facetCache.clear()
  facetCache.set(key, { at: Date.now(), value })
  return value
}

function computeFacets(jobs: Job[], search: JobSearch): JobFacets {
  const matched: Job[] = []
  const countries: Record<string, number> = Object.create(null)
  const professions: Record<string, number> = Object.create(null)
  let allOpportunities = 0
  let gigCount = 0

  for (const job of jobs) {
    const match = publicFacetMatch(job, search)
    if (match.withoutCountry) increment(countries, job.locationCountry || 'unknown')
    if (match.withoutRoleFamily) increment(professions, job.roleFamily || 'unknown')
    if (match.withoutOpportunityType) {
      allOpportunities += 1
      if (match.gig) gigCount += 1
    }
    if (match.matched) matched.push(job)
  }

  return {
    total: matched.length,
    globalTotal: jobs.length,
    remote: matched.filter((job) => job.workMode === 'remote').length,
    locations: new Set(matched.map((job) => job.locationCountry).filter(Boolean)).size,
    unknownLocation: matched.filter((job) => !job.locationCountry).length,
    countries,
    professions,
    opportunities: {
      all: allOpportunities,
      gig: gigCount,
      job: allOpportunities - gigCount,
    },
    cautionShare: matched.length
      ? matched.filter((job) => job.moderationState === 'caution').length / matched.length
      : 0,
    coverage: coverageOf(matched),
  }
}
