import type { EligibilityTier, Job, RatesPayload, SalaryPeriod, ScoredJob } from '../shared/types'
import { bucketByPeriod, convertAmount } from '../shared/format'
import { compareScoredJobs } from '../shared/scoring'

export interface Filters {
  query: string
  workModes: string[]
  seniorities: string[]
  roleFamilies: string[]
  minScore: number
  eligibility: 'all' | EligibilityTier
}

export const DEFAULT_FILTERS: Filters = {
  query: '',
  workModes: [],
  seniorities: [],
  roleFamilies: [],
  minScore: 0,
  eligibility: 'all',
}

export type SortKey = 'relevance' | 'newest' | 'salary-asc' | 'salary-desc'

export interface SalaryView {
  min: number
  max: number
  currency: string
  period: SalaryPeriod
  /** The amount was restated in the display currency. */
  converted: boolean
  /** The posting is already denominated in the display currency. */
  sameCurrency: boolean
}

/**
 * The figure shown for a posting. When a rate is available the amount is
 * converted into the display currency; otherwise the employer's original
 * currency is kept, as the product spec requires.
 */
export function salaryView(
  job: Job,
  rates: RatesPayload | null,
  displayCurrency: string,
): SalaryView {
  if (job.salaryCurrency === displayCurrency) {
    return {
      min: job.salaryMin,
      max: job.salaryMax,
      currency: job.salaryCurrency,
      period: job.salaryPeriod,
      converted: false,
      sameCurrency: true,
    }
  }

  const convertedMin = convertAmount(job.salaryMin, job.salaryCurrency, displayCurrency, rates)
  const convertedMax = convertAmount(job.salaryMax, job.salaryCurrency, displayCurrency, rates)

  if (convertedMin === null || convertedMax === null) {
    return {
      min: job.salaryMin,
      max: job.salaryMax,
      currency: job.salaryCurrency,
      period: job.salaryPeriod,
      converted: false,
      sameCurrency: false,
    }
  }

  return {
    min: convertedMin,
    max: convertedMax,
    currency: displayCurrency,
    period: job.salaryPeriod,
    converted: true,
    sameCurrency: false,
  }
}

function matchesQuery(job: Job, query: string): boolean {
  if (!query) return true
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  const haystack = [
    job.title,
    job.company,
    job.description,
    job.locationLabel,
    job.roleFamily,
    ...job.requiredSkills,
    ...job.usefulSkills,
  ]
    .join(' ')
    .toLowerCase()

  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

export function filterJobs(scored: ScoredJob[], filters: Filters): ScoredJob[] {
  return scored.filter((entry) => {
    const { job } = entry
    if (!matchesQuery(job, filters.query)) return false
    if (filters.workModes.length > 0 && !filters.workModes.includes(job.workMode)) return false
    if (filters.seniorities.length > 0 && !filters.seniorities.includes(job.seniority)) return false
    if (filters.roleFamilies.length > 0 && !filters.roleFamilies.includes(job.roleFamily))
      return false
    if (filters.eligibility !== 'all' && entry.tier !== filters.eligibility) return false
    if (entry.score < filters.minScore) return false
    return true
  })
}

export interface SortResult {
  jobs: ScoredJob[]
  /** True when the visible set mixes pay periods, which are never annualised. */
  mixedPeriods: boolean
  buckets: { period: SalaryPeriod; count: number }[]
}

/**
 * Salary ordering never annualises across pay periods. Results are grouped by
 * period, each group is ordered on its own converted values, and the groups
 * themselves are ordered by their median value.
 */
export function sortJobs(
  scored: ScoredJob[],
  sort: SortKey,
  rates: RatesPayload | null,
  displayCurrency: string,
): SortResult {
  if (sort === 'relevance') {
    return {
      jobs: [...scored].sort(compareScoredJobs),
      mixedPeriods: false,
      buckets: [],
    }
  }

  if (sort === 'newest') {
    return {
      jobs: [...scored].sort((a, b) => Date.parse(b.job.postedAt) - Date.parse(a.job.postedAt)),
      mixedPeriods: false,
      buckets: [],
    }
  }

  const direction = sort === 'salary-asc' ? 1 : -1
  const valued = scored.map((entry) => {
    const view = salaryView(entry.job, rates, displayCurrency)
    return { entry, value: view.max || view.min }
  })

  const buckets = bucketByPeriod(valued.map((item) => ({ job: item.entry.job, value: item.value })))
  const byJobId = new Map(valued.map((item) => [item.entry.job.id, item.entry]))

  const ordered = buckets
    .map((bucket) => {
      const median = bucket.jobs.length ? bucket.jobs[Math.floor(bucket.jobs.length / 2)].value : 0
      return {
        period: bucket.period,
        median,
        entries: bucket.jobs.map((item) => byJobId.get(item.job.id)!),
      }
    })
    .sort((a, b) => (a.median - b.median) * direction)

  const jobs = ordered.flatMap((bucket) =>
    direction === 1 ? bucket.entries : [...bucket.entries].reverse(),
  )

  return {
    jobs,
    mixedPeriods: ordered.length > 1,
    buckets: ordered.map((bucket) => ({ period: bucket.period, count: bucket.entries.length })),
  }
}
