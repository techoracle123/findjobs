import { describe, expect, it } from 'vitest'
import { deviceActivity, monthPeriod } from '../../src/shared/activity'
import { inferRoleFamily } from '../../src/server/sources/normalize'
import { jobFacets } from '../../src/server/job-stats'
import type { Job } from '../../src/shared/types'

it.each([
  ['Cybersecurity Analyst', 'security'],
  ['SOC Analyst', 'security'],
  ['Cloud Security Engineer', 'security'],
  ['Information Security Specialist', 'security'],
  ['Penetration Tester', 'security'],
  ['Data Analyst', 'data'],
  ['Business Intelligence Developer', 'data'],
  ['Analytics Engineer', 'data'],
  ['Video Editor', 'video'],
  ['Motion Graphics Designer', 'video'],
  ['Videographer', 'video'],
])('classifies the actual specialist role %s', (title, family) => {
  expect(inferRoleFamily(title, [], '')).toBe(family)
})
it('does not disguise a physical security guard as a cybersecurity vacancy', () => {
  expect(inferRoleFamily('Security Guard', [], '')).not.toBe('security')
})
it('counts exact, deduplicated user-confirmed applications in the browser month', () => {
  const now = new Date(2026, 9, 20),
    { from } = monthPeriod(now)
  const saved = [
    { jobId: 'one', status: 'applied' as const, savedAt: from, appliedAt: from },
    { jobId: 'one', status: 'applied' as const, savedAt: from, appliedAt: from },
    {
      jobId: 'old',
      status: 'applied' as const,
      savedAt: from,
      appliedAt: '2025-01-01T00:00:00.000Z',
    },
    { jobId: 'unknown', status: 'applied' as const, savedAt: from },
    { jobId: 'saved', status: 'saved' as const, savedAt: from },
  ]
  expect(deviceActivity(saved, now)).toMatchObject({
    thisMonth: 1,
    totalApplied: 3,
    undated: 1,
    saved: 1,
  })
})
describe('whole-corpus contextual statistics', () => {
  const jobs = [
    {
      id: 'a',
      title: 'SOC Analyst',
      company: 'Employer',
      description: '',
      locationCountry: 'NG',
      locationLabel: 'Nigeria',
      roleFamily: 'security',
      workMode: 'remote',
      postedAt: '2026-10-20',
      requiredSkills: [],
      usefulSkills: [],
    },
    {
      id: 'b',
      title: 'Data Analyst',
      company: 'Employer',
      description: '',
      locationCountry: 'GB',
      locationLabel: 'United Kingdom',
      roleFamily: 'data',
      workMode: 'onsite',
      postedAt: '2026-10-20',
      requiredSkills: [],
      usefulSkills: [],
    },
    {
      id: 'c',
      title: 'Video Editor',
      company: 'Employer',
      description: '',
      locationCountry: 'NG',
      locationLabel: 'Nigeria',
      roleFamily: 'video',
      workMode: 'remote',
      postedAt: '2026-10-20',
      requiredSkills: [],
      usefulSkills: [],
    },
  ] as unknown as Job[]
  it('counts all matches before paging and gives truthful selector counts', () => {
    const facets = jobFacets(jobs, { country: 'NG', roleFamilies: ['security'] })
    expect(facets).toMatchObject({
      total: 1,
      globalTotal: 3,
      remote: 1,
      locations: 1,
      countries: { NG: 1 },
      professions: { security: 1, video: 1 },
    })
  })
  it('finds cybersecurity via the human-readable profession, not just a literal title', () => {
    expect(jobFacets(jobs, { query: 'cybersecurity' }).total).toBe(1)
  })
})

it('runs ATS boards every 2h, remote boards every 6h, and Nigerian boards every 12h (Prompt 16)', async () => {
  const { dueForRun } = await import('../../src/server/public-schedule')
  const sources = [
    { id: 'a', tier: 'hourly' },
    { id: 'b', tier: 'six_hourly' },
    { id: 'c', tier: 'daily' },
    { id: 'off', tier: 'hourly' },
  ] as never
  const off = new Set(['off'])
  expect(dueForRun(sources, 2, off).map((source) => source.id)).toEqual(['a'])
  expect(dueForRun(sources, 6, off).map((source) => source.id)).toEqual(['a', 'b'])
  expect(dueForRun(sources, 0, off).map((source) => source.id)).toEqual(['a', 'b', 'c'])
})
