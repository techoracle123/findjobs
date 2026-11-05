import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'
import { findJob, searchJobs } from '../../src/server/jobs'
import { jobMatchesSmartAlert } from '../../src/server/alerts'
import type { AlertPreference, Profile } from '../../src/shared/types'

async function insertJob(options: {
  id: string
  title: string
  opportunityType?: string | null
  engagementType?: string | null
  engagementLabel?: string | null
  engagementBasis?: string | null
  projectDuration?: string | null
  salaryPeriod?: string
}): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT OR REPLACE INTO jobs (
       id, title, company, role_family, seniority, work_mode, location_country, location_label,
       salary_min, salary_max, salary_currency, salary_period, description, required_skills,
       useful_skills, eligible_countries, sponsorship, source_name, source_url, posted_days_ago,
       posted_at, is_demo, job_status, first_seen_at, last_seen_at, apply_url,
       opportunity_type, engagement_type, engagement_label, engagement_basis, project_duration
     ) VALUES (
       ?1, ?2, 'Opportunity Test Co', 'frontend', 'mid', 'remote', 'NG', 'Nigeria, Remote',
       50, 70, 'USD', ?3, 'Build a web application with React.', '["React"]', '[]', '["NG"]',
       'unknown', 'Test source', 'https://example.com/opportunity', 0, ?4, 0, 'open', ?4, ?4,
       'https://example.com/opportunity/apply', ?5, ?6, ?7, ?8, ?9
     )`,
  )
    .bind(
      options.id,
      options.title,
      options.salaryPeriod ?? 'hour',
      now,
      options.opportunityType ?? null,
      options.engagementType ?? null,
      options.engagementLabel ?? null,
      options.engagementBasis ?? null,
      options.projectDuration ?? null,
    )
    .run()
}

describe('D1 opportunity storage and search', () => {
  it('returns stored gig fields and derives older rows at read time', async () => {
    await insertJob({
      id: 'opportunity-stored-gig',
      title: 'React Developer',
      opportunityType: 'gig',
      engagementType: 'contract',
      engagementLabel: 'Contract',
      engagementBasis: 'source',
      projectDuration: '3 months',
    })
    await insertJob({
      id: 'opportunity-derived-gig',
      title: 'Freelance React Developer',
      salaryPeriod: 'week',
    })
    await insertJob({
      id: 'opportunity-job',
      title: 'Frontend Developer',
      opportunityType: 'job',
      engagementType: 'full-time',
      engagementLabel: 'Full-time job',
      engagementBasis: 'source',
      salaryPeriod: 'month',
    })

    const stored = await findJob(env.DB, 'opportunity-stored-gig')
    expect(stored).toMatchObject({
      opportunityType: 'gig',
      engagementType: 'contract',
      engagementLabel: 'Contract',
      engagementBasis: 'source',
      projectDuration: '3 months',
    })

    const derived = await findJob(env.DB, 'opportunity-derived-gig')
    expect(derived).toMatchObject({
      opportunityType: 'gig',
      engagementType: 'freelance',
      engagementBasis: 'title',
    })

    const gigs = await searchJobs(env.DB, {
      status: 'open',
      opportunityType: 'gig',
      limit: 500,
    })
    const gigIds = new Set(gigs.jobs.map((job) => job.id))
    expect(gigIds.has('opportunity-stored-gig')).toBe(true)
    expect(gigIds.has('opportunity-derived-gig')).toBe(true)
    expect(gigIds.has('opportunity-job')).toBe(false)

    const jobs = await searchJobs(env.DB, {
      status: 'open',
      opportunityType: 'job',
      limit: 500,
    })
    const jobIds = new Set(jobs.jobs.map((job) => job.id))
    expect(jobIds.has('opportunity-job')).toBe(true)
    expect(jobIds.has('opportunity-stored-gig')).toBe(false)
    expect(jobIds.has('opportunity-derived-gig')).toBe(false)

    const ordinary = await findJob(env.DB, 'opportunity-job')
    const gigAlert = {
      id: 'opportunity-alert',
      label: 'React gigs',
      query: 'React',
      channels: ['telegram'],
      enabled: true,
      kind: 'keyword',
      opportunityType: 'gig',
    } as AlertPreference
    expect(jobMatchesSmartAlert(stored!, gigAlert, {} as Profile)).toBe(true)
    expect(jobMatchesSmartAlert(ordinary!, gigAlert, {} as Profile)).toBe(false)
  })
})
