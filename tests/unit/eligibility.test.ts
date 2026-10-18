import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../../src/shared/scoring'
import type { Job } from '../../src/shared/types'

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

describe('evaluateEligibility', () => {
  it('cannot check anything without a work country', () => {
    const result = evaluateEligibility(makeJob({ eligibleCountries: ['DE'] }), '')
    expect(result.tier).toBe('unknown')
  })

  it('is eligible when the work country is listed', () => {
    const result = evaluateEligibility(makeJob({ eligibleCountries: ['DE', 'AT'] }), 'DE')
    expect(result.tier).toBe('eligible')
  })

  it('is eligible when the country is unlisted but sponsorship is offered', () => {
    const result = evaluateEligibility(
      makeJob({ eligibleCountries: ['DE'], sponsorship: 'available' }),
      'FR',
    )
    expect(result.tier).toBe('eligible')
  })

  it('is unknown when the country is unlisted and sponsorship is not stated', () => {
    const result = evaluateEligibility(
      makeJob({ eligibleCountries: ['DE'], sponsorship: 'unknown' }),
      'FR',
    )
    expect(result.tier).toBe('unknown')
  })

  it('is restricted when the country is unlisted and sponsorship is refused', () => {
    const result = evaluateEligibility(
      makeJob({ eligibleCountries: ['DE'], sponsorship: 'unavailable' }),
      'FR',
    )
    expect(result.tier).toBe('restricted')
  })

  it('is unknown for an unrestricted posting that does not sponsor', () => {
    const result = evaluateEligibility(
      makeJob({ eligibleCountries: [], sponsorship: 'unavailable' }),
      'FR',
    )
    expect(result.tier).toBe('unknown')
  })

  it('is eligible for an unrestricted posting that sponsors', () => {
    const result = evaluateEligibility(
      makeJob({ eligibleCountries: [], sponsorship: 'available' }),
      'FR',
    )
    expect(result.tier).toBe('eligible')
  })

  it('is case insensitive about the work country', () => {
    const result = evaluateEligibility(makeJob({ eligibleCountries: ['DE'] }), 'de')
    expect(result.tier).toBe('eligible')
  })

  it('always explains itself', () => {
    const result = evaluateEligibility(makeJob(), 'NG')
    expect(result.reason.length).toBeGreaterThan(10)
  })
})
