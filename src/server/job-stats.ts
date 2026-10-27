import type { Job } from '../shared/types'
import type { JobSearch } from './jobs'
import { matchingPublicJobs } from './live-public'
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
  /** Field completeness across the full matching set; drives control visibility. */
  coverage: FieldCoverage
}
function count(jobs: Job[], field: 'locationCountry' | 'roleFamily'): Record<string, number> {
  const result: Record<string, number> = Object.create(null)
  for (const job of jobs) {
    const key = job[field] || 'unknown'
    result[key] = (result[key] || 0) + 1
  }
  return result
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
  const matched = matchingPublicJobs(jobs, search)
  return {
    total: matched.length,
    globalTotal: jobs.length,
    remote: matched.filter((job) => job.workMode === 'remote').length,
    locations: new Set(matched.map((job) => job.locationCountry).filter(Boolean)).size,
    unknownLocation: matched.filter((job) => !job.locationCountry).length,
    countries: count(
      matchingPublicJobs(jobs, { ...search, country: undefined }),
      'locationCountry',
    ),
    professions: count(matchingPublicJobs(jobs, { ...search, roleFamilies: [] }), 'roleFamily'),
    coverage: coverageOf(matched),
  }
}
