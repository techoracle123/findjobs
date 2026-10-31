import { describe, expect, it } from 'vitest'
import { buildAdvertCheck } from '../../src/server/advert-check'
import { jobMatchesSmartAlert } from '../../src/server/alerts'
import { buildCvAnalysis, buildSkillPlan } from '../../src/server/pro-analysis'
import type { AlertPreference, Job, Profile } from '../../src/shared/types'

const profile: Profile = {
  skills: ['TypeScript', 'React'],
  targetRoleFamilies: ['frontend'],
  targetSeniority: ['mid'],
  preferredWorkModes: ['remote'],
  workCountry: 'NG',
}

function job(patch: Partial<Job> = {}): Job {
  return {
    id: 'phase2-unit-job',
    title: 'Frontend Engineer',
    company: 'Example Health',
    roleFamily: 'frontend',
    seniority: 'mid',
    workMode: 'remote',
    locationCountry: 'NG',
    locationLabel: 'Nigeria · Remote',
    salaryMin: 250_000,
    salaryMax: 350_000,
    salaryCurrency: 'NGN',
    salaryPeriod: 'month',
    description:
      'Build accessible dashboards from Nigeria. Closing date is 30 November 2026. Apply at https://example.com/apply.',
    requiredSkills: ['TypeScript', 'React', 'CSS', 'GraphQL'],
    usefulSkills: ['Testing'],
    eligibleCountries: ['NG'],
    sponsorship: 'unknown',
    sourceName: 'Example',
    sourceUrl: 'https://example.com/jobs/1',
    postedAt: '2026-10-31T00:00:00.000Z',
    isDemo: false,
    jobStatus: 'open',
    applyUrl: 'https://example.com/jobs/1/apply',
    applyMode: 'external',
    ...patch,
  }
}

const fullCv = `Ada Lovelace
ada@example.com | +234 801 234 5678 | Lagos, Nigeria | https://example.com/ada

Professional Summary
Frontend engineer focused on accessible health products, TypeScript, React and clear evidence.

Skills
TypeScript, React, CSS, GraphQL, accessibility, testing

Experience
Frontend Engineer, Example Health, Jan 2024 - Present
Built a GraphQL dashboard used by 25 clinic staff each week.
Reduced repeated form errors by 18% with clearer validation messages.
Responsible for dashboards.

Projects
Built an appointment checker and documented how the forms work.

Education
BSc Computer Science, Example University, 2023
NYSC completed in 2024.`

describe('detailed CV analysis', () => {
  it('reports section evidence, weak bullets, skill gaps and honest role coverage', () => {
    const report = buildCvAnalysis(fullCv, profile, [job()], 'ada.pdf')
    expect(report.sections.map((section) => section.title)).toContain('Skills and evidence')
    expect(report.sections.find((section) => section.title === 'Contact details')?.rating).toBe(
      'strong',
    )
    expect(report.detectedSkills).toEqual(expect.arrayContaining(['TypeScript', 'React']))
    expect(report.weakBullets.map((item) => item.original).join(' ')).toContain(
      'Responsible for dashboards',
    )
    expect(report.strengths.join(' ')).toContain('measurable results')
    expect(report.missingEvidenceQuestions.join(' ')).toContain('NYSC')
    expect(report.targetRoles[0]).toMatchObject({
      roleFamily: 'frontend',
      matchedSkills: expect.arrayContaining(['TypeScript', 'React', 'CSS', 'GraphQL']),
      missingSkills: [],
    })
    expect(JSON.stringify(report)).not.toMatch(/guaranteed (job|interview)/i)
  })

  it('never invents a score or role estimate for a thin CV', () => {
    const report = buildCvAnalysis('Ada Lovelace\nHard worker seeking any job.', profile, [])
    expect(report.sections.find((section) => section.title === 'Contact details')?.rating).toBe(
      'missing',
    )
    expect(report.priorityFixes.join(' ')).toContain('email and phone')
    expect(report.targetRoles).toEqual([])
    expect(report.seniority).toEqual([])
  })
})

describe('Nigeria advert evidence', () => {
  const nigeriaFor = (text: string, location: string) =>
    buildAdvertCheck({ title: 'Example role', company: 'Example', location, text }).nigeria

  it('distinguishes accepted, restricted and unstated locations', () => {
    expect(nigeriaFor('Remote role. We are hiring in Nigeria and Kenya.', 'Remote')).toMatchObject({
      status: 'nigeria-named',
    })

    const restricted = nigeriaFor(
      'Remote role. Applicants must reside in the United States and have United States work authorization. No sponsorship is available.',
      'Remote, United States',
    )
    expect(restricted.status).toBe('nigeria-not-named')
    expect(restricted.workAuthorization.join(' ')).toContain('United States')
    expect(restricted.sponsorship.join(' ')).toContain('sponsorship is available')

    expect(nigeriaFor('We need a designer with Figma experience.', 'Remote')).toMatchObject({
      status: 'not-stated',
    })
  })

  it('shows observable danger signs without claiming to verify an employer', () => {
    const check = buildAdvertCheck({
      title: 'Urgent job',
      company: '',
      location: 'WhatsApp',
      text: 'Guaranteed job. No interview needed. Pay a training fee and send your BVN, NIN and bank PIN now.',
      url: '',
    })
    expect(check.riskLevel).toBe('warning-signs-found')
    expect(check.signals.map((signal) => signal.label)).toEqual(
      expect.arrayContaining([
        'Asks the applicant for money',
        'Requests bank or identity details',
        'Guaranteed outcome wording',
      ]),
    )
    expect(check.headline).toContain('not employer verification')
    expect(check.nextSteps.join(' ')).toContain('Never pay')
  })
})

describe('skill-gap plan', () => {
  it('counts repeated missing required skills and keeps demo/closed jobs out', () => {
    const plan = buildSkillPlan(
      [
        job({ id: 'one' }),
        job({ id: 'two', requiredSkills: ['GraphQL', 'TypeScript'] }),
        job({ id: 'demo', isDemo: true, requiredSkills: ['Rust'] }),
        job({ id: 'closed', jobStatus: 'closed', requiredSkills: ['Rust'] }),
      ],
      profile,
    )
    expect(plan).toMatchObject({ available: true, sampleJobs: 2 })
    expect(plan.items[0]).toMatchObject({ skill: 'GraphQL', advertsAsking: 2, week: 1 })
    expect(plan.items.map((item) => item.skill)).toContain('CSS')
    expect(plan.items.map((item) => item.skill)).not.toContain('Rust')
    expect(plan.items[0]?.proofToBuild).toContain('only when you can explain it')
  })

  it('does not borrow unrelated roles when the target area has no live adverts', () => {
    const plan = buildSkillPlan(
      [job({ roleFamily: 'sales', requiredSkills: ['Negotiation'] })],
      profile,
    )
    expect(plan).toMatchObject({ available: false, sampleJobs: 0, items: [] })
    expect(plan.message).toContain('No live adverts in your target area')
  })
})

describe('smart alert matching', () => {
  const alert: AlertPreference = {
    id: 'smart',
    label: 'Smart frontend',
    query: 'frontend',
    channels: ['telegram'],
    enabled: true,
    kind: 'smart',
    minScore: 20,
    countries: ['ng'],
    workModes: ['remote'],
    salaryOnly: true,
    currency: 'ngn',
    exclude: 'unpaid, commission only',
    companies: ['example'],
  }

  it('applies every visible smart filter', () => {
    expect(jobMatchesSmartAlert(job(), alert, profile)).toBe(true)
    expect(jobMatchesSmartAlert(job({ workMode: 'onsite' }), alert, profile)).toBe(false)
    expect(
      jobMatchesSmartAlert(
        job({ locationCountry: 'US', eligibleCountries: ['US'] }),
        alert,
        profile,
      ),
    ).toBe(false)
    expect(jobMatchesSmartAlert(job({ salaryMin: 0, salaryMax: 0 }), alert, profile)).toBe(false)
    expect(jobMatchesSmartAlert(job({ salaryCurrency: 'USD' }), alert, profile)).toBe(false)
    expect(jobMatchesSmartAlert(job({ description: 'This is unpaid work.' }), alert, profile)).toBe(
      false,
    )
    expect(jobMatchesSmartAlert(job({ company: 'Other Company' }), alert, profile)).toBe(false)
    expect(jobMatchesSmartAlert(job(), { ...alert, minScore: 100 }, profile)).toBe(false)
  })
})
