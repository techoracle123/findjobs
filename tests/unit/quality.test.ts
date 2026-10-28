import { describe, expect, it } from 'vitest'
import {
  cleanCompany,
  cleanTitle,
  coverageOf,
  dedupeJobs,
  detectLanguage,
  inferSeniorityQuality,
  inferWorkModeQuality,
  parseLocation,
  qualityPass,
  salaryPlausible,
} from '../../src/server/quality'
import { controlEnabled, FIELD_THRESHOLD, NORMALIZER_VERSION } from '../../src/shared/quality'
import { extractSkills } from '../../src/shared/skills-dictionary'
import type { Job } from '../../src/shared/types'

describe('language detection', () => {
  it('detects German listings and marks them non-English', () => {
    const result = detectLanguage(
      'Senior Software Engineer',
      'Wir suchen eine erfahrene Persönlichkeit für die Entwicklung unserer Plattform in München. Sie arbeiten im Team.',
    )
    expect(result.language).toBe('de')
    expect(result.isEnglish).toBe(false)
  })
  it('detects an explicitly required language even in an English listing', () => {
    const result = detectLanguage(
      'Account Manager',
      'You will manage key accounts across Europe. German required for daily communication with clients in DACH.',
    )
    expect(result.isEnglish).toBe(false)
    expect(result.languageRequired).toBe('de')
  })
  it('keeps plain English listings as English', () => {
    const result = detectLanguage(
      'Registered Nurse',
      'We are hiring a registered nurse for our hospital in Lagos. You will provide patient care on the ward.',
    )
    expect(result.isEnglish).toBe(true)
    expect(result.languageRequired).toBeNull()
  })
})

describe('title and company cleanup', () => {
  it('strips German gender markers and remote suffixes', () => {
    expect(cleanTitle('Software Engineer (m/w/d) - 100% Remote')).toBe('Software Engineer')
    expect(cleanTitle('Head of Design (f/m/d)')).toBe('Head of Design')
  })
  it('fixes ALL-CAPS titles', () => {
    expect(cleanTitle('SENIOR ACCOUNTANT')).toBe('Senior Accountant')
  })
  it('normalises company legal suffixes', () => {
    expect(cleanCompany('Acme Ventures Limited')).toBe('Acme Ventures')
    expect(cleanCompany('Tech GmbH')).toBe('Tech')
    expect(cleanCompany('Paystack')).toBe('Paystack')
  })
})

describe('location parsing', () => {
  it('resolves Nigerian cities and states and never invents values', () => {
    expect(parseLocation('Lagos State, Nigeria', 'NG')).toEqual({
      city: 'Lagos',
      state: 'Lagos State',
      country: 'NG',
    })
    expect(parseLocation('', '')).toEqual({ city: null, state: null, country: null })
    expect(parseLocation('Berlin', 'DE')).toEqual({ city: null, state: null, country: 'DE' })
  })
})

describe('confidence-gated inference', () => {
  it('keeps unknown rather than guessing a work mode', () => {
    expect(inferWorkModeQuality('Software Engineer', 'unknown').mode).toBe('unknown')
    expect(inferWorkModeQuality('Work from home developer role', 'unknown')).toMatchObject({
      mode: 'remote',
      confidence: 0.85,
    })
  })
  it('does not read "Head of" as a seniority below lead', () => {
    expect(inferSeniorityQuality('Head of Design', 'unknown').level).toBe('lead')
    expect(inferSeniorityQuality('Receptionist', 'unknown').level).toBe('unknown')
  })
})

describe('salary plausibility', () => {
  it('rejects the hourly-mistaken-for-yearly Head of Design bug', () => {
    // 29-45 EUR/hour for a design lead is a parse error; annualised it would be
    // ~60-94k, but the band check catches the mis-scaled hourly figure.
    expect(salaryPlausible(29, 45, 'EUR', 'hour')).toBe(true) // plausible as hourly
    expect(salaryPlausible(29, 45, 'EUR', 'year')).toBe(false) // absurd as yearly
    expect(salaryPlausible(50_000_000, 60_000_000, 'NGN', 'month')).toBe(false) // absurd monthly
    expect(salaryPlausible(200_000, 400_000, 'NGN', 'month')).toBe(true)
  })
})

describe('skill extraction with evidence', () => {
  it('marks requirements-section skills as required and records the sentence', () => {
    const matches = extractSkills(
      'About the role\n\nRequirements\n- 3 years of PostgreSQL experience\n- Strong Python skills\n\nNice to have\n- Kubernetes exposure',
    )
    const postgres = matches.find((m) => m.name === 'PostgreSQL')
    expect(postgres?.required).toBe(true)
    expect(postgres?.sentence).toContain('PostgreSQL')
    expect(matches.find((m) => m.name === 'Kubernetes')?.required).toBe(false)
  })
  it('defaults to not-required when the structure is unclear', () => {
    const matches = extractSkills('We use React and Node.js every day.')
    expect(matches.every((m) => !m.required)).toBe(true)
  })
})

describe('the versioned quality pass', () => {
  const base = {
    title: 'DATA ANALYST (m/w/d)',
    company: 'Acme Limited',
    description:
      'Requirements\n- Strong SQL and Excel skills\n- Data analysis experience\nNice to have\n- Power BI',
    tags: ['analytics'],
    locationLabel: 'Lagos, Nigeria',
    locationCountry: 'NG',
    workMode: 'unknown' as const,
    seniority: 'unknown' as const,
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: '',
    salaryPeriod: 'year' as const,
    requiredSkills: [],
    usefulSkills: [],
  }

  it('produces the canonical fields with version and completeness', () => {
    const { patch } = qualityPass(base)
    expect(patch.title).toBe('Data Analyst')
    expect(patch.company).toBe('Acme')
    expect(patch.normalizerVersion).toBe(NORMALIZER_VERSION)
    expect(patch.quality.location).toEqual({ city: 'Lagos', state: 'Lagos State', country: 'NG' })
    expect(patch.quality.completeness).toBeGreaterThan(0)
    expect(patch.requiredSkills.length).toBeGreaterThan(0)
  })
  it('is idempotent', () => {
    const first = qualityPass(base).patch
    const second = qualityPass({
      ...base,
      ...first,
      tags: base.tags,
      locationLabel: base.locationLabel,
    }).patch
    expect(second.title).toBe(first.title)
    expect(second.requiredSkills.sort()).toEqual(first.requiredSkills.sort())
  })
})

describe('deduplication', () => {
  const job = (id: string, title: string, location = 'Lagos'): Job => ({
    id,
    title,
    company: 'Acme',
    roleFamily: 'data',
    seniority: 'unknown',
    workMode: 'unknown',
    locationCountry: 'NG',
    locationLabel: location,
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: '',
    salaryPeriod: 'year',
    description: 'x',
    requiredSkills: [],
    usefulSkills: [],
    eligibleCountries: [],
    sponsorship: 'unknown',
    sourceName: 'source',
    sourceUrl: `https://example.org/${id}`,
    postedAt: '2026-10-27T00:00:00Z',
    isDemo: false,
    firstSeenAt: '2026-10-26T00:00:00Z',
    lastSeenAt: '2026-10-27T00:00:00Z',
    jobStatus: 'open',
    applyUrl: `https://example.org/${id}`,
  })
  it('collapses exact and near-identical titles in one company', () => {
    const { unique, dropped } = dedupeJobs([
      job('a', 'Senior Software Engineer (Identity)'),
      job('b', 'Senior Software Engineer Identity'),
      job('c', 'Registered Nurse', 'Abuja'),
    ])
    expect(unique).toHaveLength(2)
    expect(dropped).toBe(1)
    expect(unique.find((j) => j.locationLabel === 'Abuja')).toBeTruthy()
  })
})

describe('control visibility thresholds', () => {
  it('hides controls for fields under 60% populated', () => {
    expect(controlEnabled({ eligibleCountries: 0 }, 'eligibleCountries')).toBe(false)
    expect(controlEnabled({ seniority: 0.59 }, 'seniority')).toBe(false)
    expect(controlEnabled({ seniority: 0.6 }, 'seniority')).toBe(true)
    expect(controlEnabled({ eligibleCountries: 0 }, 'eligibleCountries', true)).toBe(true)
    expect(FIELD_THRESHOLD).toBe(0.6)
  })
  it('computes whole-corpus coverage', () => {
    const jobs = [
      {
        locationCountry: 'NG',
        workMode: 'remote',
        seniority: 'mid',
        salaryMin: 1,
        salaryMax: 2,
        requiredSkills: ['SQL'],
        roleFamily: 'data',
        language: 'en',
        eligibleCountries: [],
      },
      {
        locationCountry: '',
        workMode: 'unknown',
        seniority: 'unknown',
        salaryMin: 0,
        salaryMax: 0,
        requiredSkills: [],
        roleFamily: 'unknown',
        language: '',
        eligibleCountries: [],
      },
    ] as unknown as Job[]
    const coverage = coverageOf(jobs)
    expect(coverage.locationCountry).toBe(0.5)
    expect(coverage.workMode).toBe(0.5)
    expect(coverage.requiredSkills).toBe(0.5)
    expect(coverage.eligibleCountries).toBe(0)
  })
})
