import { describe, expect, it } from 'vitest'
import {
  compareScoredJobs,
  ELIGIBILITY_ORDER,
  SCORE_WEIGHTS,
  scoreJob,
} from '../../src/shared/scoring'
import type { Job, Profile } from '../../src/shared/types'

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
    requiredSkills: ['Go', 'PostgreSQL', 'Kubernetes'],
    usefulSkills: ['Kafka', 'Terraform'],
    eligibleCountries: ['DE', 'AT'],
    sponsorship: 'unavailable',
    sourceName: 'Test source',
    sourceUrl: 'https://example.com/job-1',
    postedAt: '2026-10-01T00:00:00.000Z',
    isDemo: false,
    ...overrides,
  }
}

const profile: Profile = {
  skills: ['Go', 'PostgreSQL'],
  targetRoleFamilies: ['backend'],
  targetSeniority: ['senior'],
  preferredWorkModes: ['hybrid'],
  workCountry: 'DE',
}

describe('score weights', () => {
  it('sum to 100', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
    expect(total).toBe(100)
  })

  it('weights required skills most heavily', () => {
    expect(SCORE_WEIGHTS.requiredSkills).toBeGreaterThan(SCORE_WEIGHTS.usefulSkills)
    expect(SCORE_WEIGHTS.usefulSkills).toBeLessThan(SCORE_WEIGHTS.roleFamily)
  })
})

describe('scoreJob', () => {
  it('returns 0 when the profile has no signal at all', () => {
    const scored = scoreJob(makeJob(), {
      skills: [],
      targetRoleFamilies: [],
      targetSeniority: [],
      preferredWorkModes: [],
      workCountry: '',
    })
    expect(scored.score).toBe(0)
    expect(scored.components.every((component) => !component.applicable)).toBe(true)
  })

  it('scores partial required-skill coverage against the full weight', () => {
    const scored = scoreJob(makeJob(), profile)
    const required = scored.components.find((c) => c.key === 'requiredSkills')!
    expect(required.applicable).toBe(true)
    expect(required.earned).toBeCloseTo((2 / 3) * SCORE_WEIGHTS.requiredSkills, 5)
  })

  it('marks a component inapplicable when either side is unknown', () => {
    const sparse = makeJob({ roleFamily: '', workMode: '' as Job['workMode'] })
    const scored = scoreJob(sparse, {
      ...profile,
      targetRoleFamilies: [],
      preferredWorkModes: [],
    })

    const applicable = scored.components.filter((c) => c.applicable)
    expect(applicable.map((c) => c.key)).toEqual(['requiredSkills', 'usefulSkills', 'seniority'])

    const role = scored.components.find((c) => c.key === 'roleFamily')!
    expect(role.applicable).toBe(false)
    expect(role.earned).toBe(0)
    expect(role.weight).toBe(SCORE_WEIGHTS.roleFamily)
  })

  it('does not penalise a posting for omitting a detail', () => {
    const withRole = makeJob({ requiredSkills: ['Go'], usefulSkills: [] })
    const withoutRole = makeJob({ requiredSkills: ['Go'], usefulSkills: [], roleFamily: '' })
    const partial: Profile = {
      skills: ['Go'],
      targetRoleFamilies: ['backend'],
      targetSeniority: [],
      preferredWorkModes: [],
      workCountry: 'DE',
    }

    // The role family the profile would have matched is simply not counted
    // when the posting does not state one, so the score is unchanged.
    expect(scoreJob(withoutRole, partial).score).toBe(scoreJob(withRole, partial).score)
    expect(scoreJob(withoutRole, partial).score).toBe(100)
  })

  it('rescales the total over the applicable weights only', () => {
    const job = makeJob({ requiredSkills: ['Go'], usefulSkills: [] })
    const perfect: Profile = {
      skills: ['Go'],
      targetRoleFamilies: ['backend'],
      targetSeniority: ['senior'],
      preferredWorkModes: ['hybrid'],
      workCountry: 'DE',
    }

    expect(scoreJob(job, perfect).score).toBe(100)

    // Dropping components the profile cannot answer removes their weight from
    // the denominator rather than counting them as failures.
    const partial = scoreJob(job, { ...perfect, targetSeniority: [], preferredWorkModes: [] })
    expect(partial.score).toBe(100)
    expect(partial.components.filter((c) => c.applicable).map((c) => c.key)).toEqual([
      'requiredSkills',
      'roleFamily',
    ])
  })

  it('awards nothing for a role family outside the target', () => {
    const scored = scoreJob(makeJob(), { ...profile, targetRoleFamilies: ['design'] })
    const role = scored.components.find((c) => c.key === 'roleFamily')!
    expect(role.applicable).toBe(true)
    expect(role.earned).toBe(0)
  })

  it('keeps the score inside 0..100', () => {
    const perfect = scoreJob(makeJob(), {
      skills: ['Go', 'PostgreSQL', 'Kubernetes', 'Kafka', 'Terraform'],
      targetRoleFamilies: ['backend'],
      targetSeniority: ['senior'],
      preferredWorkModes: ['hybrid'],
      workCountry: 'DE',
    })
    expect(perfect.score).toBe(100)
  })
})

describe('compareScoredJobs', () => {
  const weak: Profile = {
    skills: ['Rust'],
    targetRoleFamilies: ['design'],
    targetSeniority: [],
    preferredWorkModes: [],
    workCountry: 'DE',
  }
  const strong: Profile = {
    skills: ['Go', 'PostgreSQL', 'Kubernetes'],
    targetRoleFamilies: ['backend'],
    targetSeniority: ['senior'],
    preferredWorkModes: ['hybrid'],
    workCountry: 'DE',
  }

  it('ranks eligible above unknown above restricted regardless of score', () => {
    const eligible = scoreJob(makeJob({ eligibleCountries: ['DE'] }), weak)
    const unknown = scoreJob(makeJob({ eligibleCountries: [], sponsorship: 'unknown' }), strong)
    const restricted = scoreJob(
      makeJob({ eligibleCountries: ['US'], sponsorship: 'unavailable' }),
      weak,
    )

    // The score would put the strong "unknown" role first; eligibility wins.
    expect(eligible.score).toBeLessThan(unknown.score)
    expect(restricted.score).toBeLessThan(unknown.score)

    const ranked = [restricted, unknown, eligible].sort(compareScoredJobs)
    expect(ranked.map((entry) => entry.tier)).toEqual(['eligible', 'unknown', 'restricted'])
  })

  it('orders the eligibility tiers', () => {
    expect(ELIGIBILITY_ORDER.eligible).toBeLessThan(ELIGIBILITY_ORDER.unknown)
    expect(ELIGIBILITY_ORDER.unknown).toBeLessThan(ELIGIBILITY_ORDER.restricted)
  })
})
