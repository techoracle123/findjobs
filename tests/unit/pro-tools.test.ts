import { describe, expect, it } from 'vitest'
import type { ApplicationAnswers, Job, Profile } from '../../src/shared/types'
import {
  EMPTY_APPLICATION_ANSWERS,
  buildCvCheck,
  buildInterviewPrep,
  buildPreparedApplication,
  buildSalaryGuide,
  findApplicationEmail,
  normaliseApplicationAnswers,
} from '../../src/server/pro-tools'

const profile: Profile = {
  skills: ['TypeScript', 'React'],
  targetRoleFamilies: ['frontend'],
  targetSeniority: ['mid'],
  preferredWorkModes: ['remote'],
  workCountry: 'NG',
}

const answers: ApplicationAnswers = {
  ...EMPTY_APPLICATION_ANSWERS,
  fullName: 'Ada Example',
  location: 'Abuja, Nigeria',
  summary: 'Frontend engineer with four years of product work.',
  achievement: 'I rebuilt a checkout flow and reduced drop-off.',
  availability: 'Two weeks',
  workPermission: 'I live in Nigeria and can work remotely from Abuja, Nigeria.',
}

function job(patch: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Frontend Engineer',
    company: 'Example Health',
    roleFamily: 'frontend',
    seniority: 'mid',
    workMode: 'remote',
    locationCountry: 'NG',
    locationLabel: 'Nigeria · Remote',
    salaryMin: 300_000,
    salaryMax: 400_000,
    salaryCurrency: 'NGN',
    salaryPeriod: 'month',
    description: 'Build patient dashboards. Send your CV to hiring@example.com before Friday.',
    requiredSkills: ['TypeScript', 'React', 'CSS'],
    usefulSkills: ['GraphQL'],
    eligibleCountries: ['NG'],
    sponsorship: 'unknown',
    sourceName: 'Example board',
    sourceUrl: 'https://example.com/jobs/1',
    postedAt: '2026-10-30T00:00:00.000Z',
    isDemo: false,
    jobStatus: 'open',
    applyUrl: 'https://example.com/jobs/1/apply',
    applyMode: 'external',
    ...patch,
  }
}

describe('Pro application tools', () => {
  it('normalises saved answers without keeping oversized or non-string values', () => {
    const cleaned = normaliseApplicationAnswers({
      fullName: '  Ada   Example  ',
      summary: 'x'.repeat(1400),
      phone: 123,
    })
    expect(cleaned.fullName).toBe('Ada Example')
    expect(cleaned.summary).toHaveLength(1200)
    expect(cleaned.phone).toBe('')
  })

  it('prepares a truthful application and detects an apply-by-email address', () => {
    const prepared = buildPreparedApplication(job(), profile, answers, 'ada@example.com')
    expect(findApplicationEmail(job())).toBe('hiring@example.com')
    expect(prepared.subject).toBe('Application for Frontend Engineer - Ada Example')
    expect(prepared.recipientEmail).toBe('hiring@example.com')
    expect(prepared.mailtoUrl).toContain('mailto:hiring@example.com')
    expect(prepared.coverLetter).toContain('I rebuilt a checkout flow')
    expect(prepared.answers).toHaveLength(7)
    expect(prepared.missingInfo).toEqual([])
  })

  it('checks profile and pasted CV text against the skills named in the advert', () => {
    const check = buildCvCheck(
      job(),
      profile,
      'Frontend engineer. I built React and GraphQL dashboards for clinics and wrote accessible interfaces.',
    )
    expect(check.basis).toBe('cv-and-profile')
    expect(check.requiredMatched).toEqual(['TypeScript', 'React'])
    expect(check.requiredMissing).toEqual(['CSS'])
    expect(check.usefulMatched).toEqual(['GraphQL'])
    expect(check.requiredPercent).toBe(67)
    expect(check.overallPercent).toBe(74)
    expect(check.actions.join(' ')).toContain('Do not add a skill only to match the advert')
  })

  it('builds interview questions from the role, matched skills and gaps', () => {
    const prep = buildInterviewPrep(job(), profile, answers)
    expect(prep.questions).toHaveLength(8)
    expect(prep.questions.map((item) => item.question).join(' ')).toContain('CSS')
    expect(prep.questions.map((item) => item.question).join(' ')).toContain('accessible')
    expect(prep.examplesToPrepare.join(' ')).toContain('TypeScript')
    expect(prep.checklist.join(' ')).toContain('Never pay')
  })

  it('builds a salary guide only from at least three real adverts with pay stated', () => {
    const jobs = [
      job({ id: 's1', salaryMin: 90_000, salaryMax: 110_000 }),
      job({ id: 's2', salaryMin: 190_000, salaryMax: 210_000 }),
      job({ id: 's3', salaryMin: 290_000, salaryMax: 310_000 }),
      job({ id: 's4', salaryMin: 390_000, salaryMax: 410_000 }),
      job({ id: 'demo', salaryMin: 900_000, salaryMax: 1_000_000, isDemo: true }),
      job({ id: 'closed', salaryMin: 900_000, salaryMax: 1_000_000, jobStatus: 'closed' }),
    ]
    const guide = buildSalaryGuide(jobs, {
      roleFamily: 'frontend',
      country: 'NG',
      workMode: 'remote',
      seniority: 'senior',
      currency: 'NGN',
      period: 'month',
    })
    expect(guide).toMatchObject({
      available: true,
      sampleCount: 4,
      currency: 'NGN',
      period: 'month',
      medianMidpoint: 250_000,
      lowerQuartileMidpoint: 175_000,
      upperQuartileMidpoint: 325_000,
      lowest: 90_000,
      highest: 410_000,
    })
    expect(guide.scope).not.toContain('Senior')

    const thin = buildSalaryGuide(jobs.slice(0, 2), {
      roleFamily: 'frontend',
      currency: 'NGN',
      period: 'month',
    })
    expect(thin.available).toBe(false)
    expect(thin.sampleCount).toBe(2)
    expect(thin.medianMidpoint).toBeNull()
  })
})
