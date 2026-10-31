import { describe, expect, it } from 'vitest'
import {
  bucketByPeriod,
  convertAmount,
  currencySymbol,
  formatAmount,
  formatRange,
  formatRelativeTime,
  freshnessOf,
} from '../../src/shared/format'
import type { Job, RatesPayload } from '../../src/shared/types'

const rates: RatesPayload = {
  base: 'USD',
  date: '2026-10-15',
  source: 'frankfurter',
  rates: { USD: 1, EUR: 0.5, NGN: 1000 },
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Engineer',
    company: 'Example Co',
    roleFamily: 'backend',
    seniority: 'mid',
    workMode: 'remote',
    locationCountry: 'DE',
    locationLabel: 'Berlin',
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    description: '',
    requiredSkills: [],
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

describe('currency formatting', () => {
  it('uses the right symbol', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('GBP')).toBe('£')
  })

  it('falls back to the code for an unknown currency', () => {
    expect(currencySymbol('ZZZ')).toBe('ZZZ')
  })

  it('compacts large amounts', () => {
    expect(formatAmount(120_000, 'USD')).toBe('$120k')
    expect(formatAmount(2_500_000, 'USD')).toBe('$2.5M')
  })

  it('leaves small amounts alone', () => {
    expect(formatAmount(55, 'GBP')).toBe('£55')
  })

  it('formats a range', () => {
    expect(formatRange(80_000, 100_000, 'EUR')).toBe('€80k to €100k')
  })

  it('describes a one-sided range', () => {
    expect(formatRange(0, 100_000, 'EUR')).toBe('up to €100k')
    expect(formatRange(100_000, 0, 'EUR')).toBe('from €100k')
  })
})

describe('time formatting', () => {
  const now = Date.parse('2026-10-18T12:00:00.000Z')

  it('describes recent times', () => {
    expect(formatRelativeTime('2026-10-18T11:59:30.000Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-10-18T11:30:00.000Z', now)).toBe('30m ago')
    expect(formatRelativeTime('2026-10-18T06:00:00.000Z', now)).toBe('6h ago')
    expect(formatRelativeTime('2026-10-16T12:00:00.000Z', now)).toBe('2d ago')
  })

  it('describes old times', () => {
    expect(formatRelativeTime('2026-06-18T12:00:00.000Z', now)).toBe('4mo ago')
    expect(formatRelativeTime('2024-10-18T12:00:00.000Z', now)).toBe('2y ago')
  })

  it('handles an unparseable date', () => {
    expect(formatRelativeTime('not a date', now)).toBe('unknown')
  })
})

describe('freshness', () => {
  const now = Date.parse('2026-10-18T12:00:00.000Z')

  it('grades postings by age', () => {
    expect(freshnessOf('2026-10-17T12:00:00.000Z', now)).toBe('fresh')
    expect(freshnessOf('2026-10-05T12:00:00.000Z', now)).toBe('recent')
    expect(freshnessOf('2026-08-18T12:00:00.000Z', now)).toBe('aging')
    expect(freshnessOf('2026-01-18T12:00:00.000Z', now)).toBe('stale')
  })
})

describe('convertAmount', () => {
  it('converts between currencies', () => {
    expect(convertAmount(100, 'EUR', 'USD', rates)).toBe(200)
  })

  it('returns the amount unchanged for the same currency', () => {
    expect(convertAmount(100, 'USD', 'USD', rates)).toBe(100)
  })

  it('returns null when a rate is missing so the original currency is kept', () => {
    expect(convertAmount(100, 'JPY', 'USD', rates)).toBeNull()
  })

  it('returns null when there are no rates at all', () => {
    expect(convertAmount(100, 'EUR', 'USD', null)).toBeNull()
  })
})

describe('bucketByPeriod', () => {
  it('groups postings by pay period without annualising them', () => {
    const entries = [
      { job: makeJob({ id: 'a', salaryPeriod: 'year' }), value: 100 },
      { job: makeJob({ id: 'b', salaryPeriod: 'hour' }), value: 50 },
      { job: makeJob({ id: 'c', salaryPeriod: 'year' }), value: 20 },
    ]
    const buckets = bucketByPeriod(entries)
    expect(buckets).toHaveLength(2)

    const yearly = buckets.find((bucket) => bucket.period === 'year')!
    expect(yearly.jobs.map((entry) => entry.job.id)).toEqual(['c', 'a'])
    expect(yearly.jobs[0].value).toBe(20)
  })
})
