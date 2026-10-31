import { describe, expect, it } from 'vitest'
import { analyzeMatchIntelligence } from '../../src/server/match-intelligence'
import type { Job, Profile } from '../../src/shared/types'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'target',
    title: 'Contract React Developer',
    company: 'Example Client',
    roleFamily: 'frontend',
    seniority: 'senior',
    workMode: 'remote',
    locationCountry: 'NG',
    locationLabel: 'Nigeria, Remote',
    salaryMin: 70,
    salaryMax: 90,
    salaryCurrency: 'USD',
    salaryPeriod: 'hour',
    opportunityType: 'gig',
    engagementType: 'contract',
    engagementLabel: 'Contract',
    engagementBasis: 'source',
    projectDuration: '3 months',
    description: [
      'Requirements',
      'You must have at least 5 years of experience building web applications.',
      'Required skills include React, TypeScript and Kubernetes.',
      "A bachelor's degree is required.",
      'Nice to have',
      'GraphQL experience is desirable.',
      'This contract is open to applicants in Nigeria.',
    ].join('\n'),
    requiredSkills: ['React', 'TypeScript', 'Kubernetes'],
    usefulSkills: ['GraphQL'],
    eligibleCountries: ['NG'],
    sponsorship: 'unavailable',
    sourceName: 'Example Source',
    sourceUrl: 'https://example.com/target',
    postedAt: '2026-10-30T00:00:00.000Z',
    isDemo: false,
    jobStatus: 'open',
    ...overrides,
  }
}

const profile: Profile = {
  skills: ['React', 'TypeScript'],
  targetRoleFamilies: ['frontend'],
  targetSeniority: ['senior'],
  preferredWorkModes: ['remote'],
  workCountry: 'NG',
  opportunityTypes: ['gig'],
}

const CV = [
  'Frontend Developer',
  '6 years of experience building production web applications.',
  'Built a React and TypeScript dashboard that cut reporting time by 30%.',
  'Used GraphQL APIs for customer account pages.',
  'B.Sc. Computer Science, University of Lagos.',
].join('\n')

describe('FJ Match Intelligence', () => {
  it('separates essential and desirable evidence and names the missing skill', () => {
    const result = analyzeMatchIntelligence(makeJob(), CV, profile)
    const byLabel = new Map(result.requirements.map((item) => [item.label, item]))

    expect(result.basis).toBe('cv-and-profile')
    expect(byLabel.get('React')).toMatchObject({ group: 'essential', status: 'met' })
    expect(byLabel.get('React')?.evidence.join(' ')).toContain('Your CV:')
    expect(byLabel.get('Kubernetes')).toMatchObject({ group: 'essential', status: 'missing' })
    expect(byLabel.get('GraphQL')).toMatchObject({ group: 'desirable', status: 'met' })
    expect(byLabel.get('5+ years of relevant experience')?.status).toBe('met')
    expect(result.essentialPercent).toBeGreaterThan(0)
    expect(result.desirablePercent).toBe(100)
    expect(result.gaps.join(' ')).toContain('Kubernetes')
    expect(result.actions.join(' ')).toContain('payment is released')
    expect(result.limitations.join(' ')).toContain('makes the final decision')
  })

  it('recommends a related advert when the essential evidence is stronger', () => {
    const alternative = makeJob({
      id: 'better',
      title: 'Freelance Frontend Developer',
      description: [
        'Requirements',
        'Required skills include React and TypeScript.',
        'This freelance engagement is open to applicants in Nigeria.',
      ].join('\n'),
      requiredSkills: ['React', 'TypeScript'],
      usefulSkills: [],
    })
    const result = analyzeMatchIntelligence(makeJob(), CV, profile, [alternative])
    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0].job.id).toBe('better')
    expect(result.alternatives[0].essentialPercent).toBe(100)
    expect(result.alternatives[0].missingEssential).toEqual([])
    expect(result.alternatives[0].reasons.join(' ')).toContain('Essential fit is 100%')
  })

  it('still finds the strongest alternative in a large related pool', () => {
    const alternative = makeJob({
      id: 'better-in-large-pool',
      title: 'Freelance Frontend Developer',
      description: [
        'Requirements',
        'Required skills include React and TypeScript.',
        'This freelance engagement is open to applicants in Nigeria.',
      ].join('\n'),
      requiredSkills: ['React', 'TypeScript'],
      usefulSkills: [],
    })
    const weak = Array.from({ length: 80 }, (_, index) =>
      makeJob({
        id: `weak-${index}`,
        title: `Frontend role ${index}`,
        description: 'Requirements\nKubernetes is required.',
        requiredSkills: ['Kubernetes'],
        usefulSkills: [],
      }),
    )

    const result = analyzeMatchIntelligence(makeJob(), CV, profile, [...weak, alternative])
    expect(result.alternatives[0]?.job.id).toBe('better-in-large-pool')
  })

  it('does not turn tools, certifications or company history in prose into candidate requirements', () => {
    const result = analyzeMatchIntelligence(
      makeJob({
        description: [
          'About us',
          'We have 12 years of experience and our team includes CISSP holders.',
          'Responsibilities',
          'You will maintain React screens and may work near our Kubernetes platform.',
          'Requirements',
          'React is required.',
        ].join('\n'),
        requiredSkills: ['React'],
        usefulSkills: [],
      }),
      CV,
      profile,
    )
    const labels = result.requirements.map((item) => item.label)
    expect(labels).toContain('React')
    expect(labels).not.toContain('Kubernetes')
    expect(labels).not.toContain('CISSP')
    expect(labels.some((label) => label.includes('12+ years'))).toBe(false)
  })

  it('caps the decision when the advert location is a possible blocker', () => {
    const result = analyzeMatchIntelligence(
      makeJob({
        locationCountry: 'US',
        locationLabel: 'United States, Remote',
        eligibleCountries: ['US'],
        sponsorship: 'unavailable',
        description:
          'Requirements\nReact and TypeScript are required. Applicants must have the right to work in the United States.',
      }),
      CV,
      profile,
    )
    expect(result.eligibility.status).toBe('possible-blocker')
    expect(result.fitScore).toBeLessThanOrEqual(35)
    expect(result.verdict).toBe('check-location-first')
  })

  it('does not pretend there is enough evidence when neither CV nor profile has signal', () => {
    const result = analyzeMatchIntelligence(makeJob(), '', {
      skills: [],
      targetRoleFamilies: [],
      targetSeniority: [],
      preferredWorkModes: [],
      workCountry: '',
      opportunityTypes: [],
    })
    expect(result.basis).toBe('profile')
    expect(result.verdict).toBe('not-enough-evidence')
    expect(result.limitations.join(' ')).toContain('Add your CV text')
  })
})
