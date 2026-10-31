import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, filterJobs } from '../../src/lib/ranking'
import {
  classifyOpportunity,
  isGig,
  matchesOpportunityFilter,
  opportunityBadge,
  opportunityOf,
  withOpportunity,
} from '../../src/shared/opportunities'
import { scoreJob } from '../../src/shared/scoring'
import type { Job, Profile } from '../../src/shared/types'
import { matchingPublicJobs } from '../../src/server/live-public'
import { jobFacets } from '../../src/server/job-stats'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Frontend Developer',
    company: 'Example Co',
    roleFamily: 'frontend',
    seniority: 'mid',
    workMode: 'remote',
    locationCountry: 'NG',
    locationLabel: 'Nigeria, Remote',
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: 'NGN',
    salaryPeriod: 'month',
    description: 'Build accessible web applications with React.',
    requiredSkills: ['React'],
    usefulSkills: [],
    eligibleCountries: ['NG'],
    sponsorship: 'unknown',
    sourceName: 'Test source',
    sourceUrl: 'https://example.com/job',
    postedAt: '2026-10-30T00:00:00.000Z',
    isDemo: false,
    jobStatus: 'open',
    ...overrides,
  }
}

const profile: Profile = {
  skills: ['React'],
  targetRoleFamilies: ['frontend'],
  targetSeniority: ['mid'],
  preferredWorkModes: ['remote'],
  workCountry: 'NG',
  opportunityTypes: [],
}

describe('classifyOpportunity', () => {
  it('trusts a source-declared contractor type and keeps its basis', () => {
    expect(
      classifyOpportunity({
        jobType: 'Contractor',
        title: 'Cybersecurity Analyst',
        description: 'Monitor threats and respond to incidents.',
      }),
    ).toMatchObject({
      opportunityType: 'gig',
      engagementType: 'contract',
      engagementBasis: 'source',
    })
  })

  it('uses a stated project salary period as project-work evidence', () => {
    expect(
      classifyOpportunity({
        title: 'Website redesign',
        description: 'Design and launch a company website.',
        salaryPeriod: 'project',
      }),
    ).toMatchObject({ opportunityType: 'gig', engagementType: 'project' })
  })

  it('reads explicit contract wording and duration from the advert', () => {
    const found = classifyOpportunity({
      title: 'Data Analyst',
      description: 'This is a 3-6 month contract role. You will clean data and build dashboards.',
    })
    expect(found).toMatchObject({
      opportunityType: 'gig',
      engagementType: 'contract',
      engagementBasis: 'description',
      projectDuration: '3-6 months',
    })
  })

  it('does not call contract-management occupations or duties gigs', () => {
    expect(
      classifyOpportunity({
        title: 'Contracts Manager',
        description: 'Manage customer contracts, renewals and contract records.',
      }).opportunityType,
    ).toBe('unknown')
    expect(
      classifyOpportunity({
        title: 'Legal Operations Lead',
        description: 'You will improve contract management across the company.',
      }).opportunityType,
    ).toBe('unknown')
    expect(
      classifyOpportunity({
        title: 'Smart Contract Security Engineer',
        description: 'Audit Solidity smart contracts for vulnerabilities.',
      }).opportunityType,
    ).toBe('unknown')
    expect(
      classifyOpportunity({
        title: 'Smart Contract Developer (Contract)',
        description: 'Build and test Solidity contracts.',
      }).opportunityType,
    ).toBe('gig')
  })

  it('does not invent a duration from unrelated experience wording', () => {
    const found = classifyOpportunity({
      jobType: 'Contract',
      title: 'Backend Developer',
      description: 'You need 6 months of experience with Node.js.',
    })
    expect(found.opportunityType).toBe('gig')
    expect(found.projectDuration).toBeUndefined()
  })
})

describe('opportunity filters and badges', () => {
  const ordinary = makeJob({ id: 'ordinary' })
  const gig = makeJob({
    id: 'gig',
    title: 'Freelance React Developer',
    description: 'This is a freelance engagement for 8 weeks.',
  })
  const explicitJob = makeJob({
    id: 'explicit-job',
    opportunityType: 'job',
    engagementType: 'full-time',
    engagementLabel: 'Full-time job',
  })

  it('includes unknown postings in Jobs, but only positive evidence in Gigs', () => {
    expect(matchesOpportunityFilter(ordinary, 'job')).toBe(true)
    expect(matchesOpportunityFilter(ordinary, 'gig')).toBe(false)
    expect(matchesOpportunityFilter(gig, 'job')).toBe(false)
    expect(matchesOpportunityFilter(gig, 'gig')).toBe(true)
    expect(isGig(gig)).toBe(true)
  })

  it('filters browser results and derives fields for older saved jobs', () => {
    const scored = [ordinary, gig, explicitJob].map((job) => scoreJob(job, profile))
    expect(
      filterJobs(scored, { ...DEFAULT_FILTERS, opportunityType: 'gig' }).map((x) => x.job.id),
    ).toEqual(['gig'])
    expect(withOpportunity(gig)).toMatchObject({
      opportunityType: 'gig',
      engagementType: 'freelance',
      projectDuration: '8 weeks',
    })
    expect(opportunityBadge(gig)).toBe('Freelance gig · 8 weeks')
    expect(opportunityOf(explicitJob).engagementLabel).toBe('Full-time job')
  })

  it('filters public results and reports disjunctive counts', () => {
    const jobs = [ordinary, gig, explicitJob]
    expect(matchingPublicJobs(jobs, { opportunityType: 'gig' }).map((job) => job.id)).toEqual([
      'gig',
    ])
    expect(matchingPublicJobs(jobs, { opportunityType: 'job' }).map((job) => job.id)).toEqual([
      'ordinary',
      'explicit-job',
    ])
    expect(jobFacets(jobs, { opportunityType: 'gig' }).opportunities).toEqual({
      all: 3,
      job: 2,
      gig: 1,
    })
  })
})

describe('opportunity preference scoring', () => {
  it('adds a transparent component only when one lane is selected', () => {
    const gig = makeJob({
      title: 'Contract React Developer',
      opportunityType: 'gig',
      engagementType: 'contract',
    })
    const wantsGigs = scoreJob(gig, { ...profile, opportunityTypes: ['gig'] })
    const wantsJobs = scoreJob(gig, { ...profile, opportunityTypes: ['job'] })
    const gigComponent = wantsGigs.components.find((item) => item.key === 'opportunityType')
    const jobComponent = wantsJobs.components.find((item) => item.key === 'opportunityType')
    expect(gigComponent).toMatchObject({ applicable: true, earned: 8 })
    expect(jobComponent).toMatchObject({ applicable: true, earned: 0 })
    expect(wantsGigs.score).toBeGreaterThan(wantsJobs.score)

    const both = scoreJob(gig, { ...profile, opportunityTypes: ['job', 'gig'] })
    expect(both.components.find((item) => item.key === 'opportunityType')?.applicable).toBe(false)
  })
})
