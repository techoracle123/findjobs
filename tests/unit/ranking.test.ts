import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, filterJobs, salaryView, sortJobs } from '../../src/lib/ranking'
import { scoreJob } from '../../src/shared/scoring'
import type { Job, Profile, RatesPayload } from '../../src/shared/types'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Senior Backend Engineer',
    company: 'Example Co',
    roleFamily: 'backend',
    seniority: 'senior',
    workMode: 'hybrid',
    locationCountry: 'DE',
    locationLabel: 'Berlin, Germany',
    salaryMin: 80_000,
    salaryMax: 100_000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    description: 'A role.',
    requiredSkills: ['Go'],
    usefulSkills: [],
    eligibleCountries: [],
    sponsorship: 'unknown',
    sourceName: 'Test',
    sourceUrl: 'https://example.com',
    postedAt: '2026-10-01T00:00:00.000Z',
    isDemo: false,
    ...overrides,
  }
}

const profile: Profile = {
  skills: ['Go'],
  targetRoleFamilies: ['backend'],
  targetSeniority: ['senior'],
  preferredWorkModes: ['hybrid'],
  workCountry: 'DE',
}

const rates: RatesPayload = {
  base: 'USD',
  date: '2026-10-15',
  source: 'frankfurter',
  rates: { USD: 1, EUR: 0.5, GBP: 0.25 },
}

const jobs = [
  makeJob({ id: 'a', title: 'Alpha', salaryMax: 90_000 }),
  makeJob({ id: 'b', title: 'Beta', workMode: 'remote', salaryMax: 70_000 }),
  makeJob({ id: 'c', title: 'Gamma', roleFamily: 'design', salaryMax: 60_000 }),
  makeJob({
    id: 'd',
    title: 'Delta',
    salaryMax: 60,
    salaryMin: 50,
    salaryCurrency: 'GBP',
    salaryPeriod: 'hour',
  }),
]

const scored = jobs.map((job) => scoreJob(job, profile))

describe('filterJobs', () => {
  it('returns everything with default filters', () => {
    expect(filterJobs(scored, DEFAULT_FILTERS)).toHaveLength(4)
  })

  it('matches on title, company and skill', () => {
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, query: 'alpha' })).toHaveLength(1)
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, query: 'go' })).toHaveLength(4)
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, query: 'nothing here' })).toHaveLength(0)
  })

  it('requires every search token to match', () => {
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, query: 'alpha beta' })).toHaveLength(0)
  })

  it('filters by work mode, level and role family', () => {
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, workModes: ['remote'] })).toHaveLength(1)
    expect(filterJobs(scored, { ...DEFAULT_FILTERS, roleFamilies: ['design'] })).toHaveLength(1)
  })

  it('filters by minimum score', () => {
    const filtered = filterJobs(scored, { ...DEFAULT_FILTERS, minScore: 50 })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((entry) => entry.score >= 50)).toBe(true)
  })
})

describe('sortJobs', () => {
  it('sorts by relevance using the shared comparator', () => {
    const result = sortJobs(scored, 'relevance', rates, 'USD')
    expect(result.jobs).toHaveLength(4)
    expect(result.mixedPeriods).toBe(false)
  })

  it('sorts by recency', () => {
    const result = sortJobs(scored, 'newest', rates, 'USD')
    const times = result.jobs.map((entry) => Date.parse(entry.job.postedAt))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('groups salary results by pay period and never annualises them', () => {
    const result = sortJobs(scored, 'salary-desc', rates, 'USD')
    expect(result.mixedPeriods).toBe(true)
    expect(result.buckets.map((bucket) => bucket.period).sort()).toEqual(['hour', 'year'])

    // The hourly posting is not inflated into a yearly figure; it keeps its
    // own bucket rather than being compared against yearly amounts.
    const hourly = result.jobs.find((entry) => entry.job.id === 'd')!
    expect(hourly.job.salaryPeriod).toBe('hour')
    expect(hourly.job.salaryMax).toBe(60)
  })

  it('orders postings within a pay period by their own values', () => {
    const result = sortJobs(scored, 'salary-asc', rates, 'USD')
    const yearlyIds = result.jobs
      .filter((entry) => entry.job.salaryPeriod === 'year')
      .map((entry) => entry.job.id)
    // 60k, 70k and 90k EUR, converted to USD.
    expect(yearlyIds).toEqual(['c', 'b', 'a'])
  })
})

describe('salaryView', () => {
  it('converts into the display currency when a rate exists', () => {
    const view = salaryView(makeJob({ salaryMax: 100_000 }), rates, 'USD')
    expect(view.converted).toBe(true)
    expect(view.max).toBe(200_000)
    expect(view.currency).toBe('USD')
  })

  it('keeps the original currency when no rate is available', () => {
    const view = salaryView(makeJob({ salaryCurrency: 'JPY', salaryMax: 5_000_000 }), rates, 'USD')
    expect(view.converted).toBe(false)
    expect(view.sameCurrency).toBe(false)
    expect(view.currency).toBe('JPY')
    expect(view.max).toBe(5_000_000)
  })

  it('does not restate a posting that is already in the display currency', () => {
    const view = salaryView(makeJob({ salaryCurrency: 'EUR', salaryMax: 100_000 }), rates, 'EUR')
    expect(view.converted).toBe(false)
    expect(view.sameCurrency).toBe(true)
  })
})
