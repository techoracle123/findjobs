import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const suffix = crypto.randomUUID().slice(0, 8)
const FREE = { 'x-dev-user-email': `pro-free-${suffix}@example.com` }
const PRO = { 'x-dev-user-email': `pro-paid-${suffix}@example.com` }

async function request(
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function insertJob(id: string, salaryMin: number, salaryMax: number): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO jobs (id, title, company, role_family, seniority, work_mode,
      location_country, location_label, salary_min, salary_max, salary_currency, salary_period,
      description, required_skills, useful_skills, eligible_countries, sponsorship, source_name,
      source_url, posted_at, is_demo, verification, job_status, first_seen_at, last_seen_at,
      apply_url, apply_mode)
     VALUES (?1, 'Frontend Engineer', 'Pro Test Health', 'frontend', 'mid', 'remote', 'NG',
      'Nigeria · Remote', ?2, ?3, 'NGN', 'month',
      'Build accessible dashboards with TypeScript and React. Send your CV to hiring@example.com.',
      '["TypeScript","React","CSS"]', '["GraphQL"]', '["NG"]', 'unknown', 'test',
      'https://example.com/jobs/pro', '2026-10-30T00:00:00Z', 0, 'verified', 'open',
      '2026-10-30T00:00:00Z', '2026-10-30T00:00:00Z', 'https://example.com/jobs/pro/apply', 'external')`,
  )
    .bind(id, salaryMin, salaryMax)
    .run()
}

beforeAll(async () => {
  await insertJob('pro-tools-job', 290_000, 310_000)
  await insertJob('pro-tools-salary-2', 190_000, 210_000)
  await insertJob('pro-tools-salary-3', 390_000, 410_000)
  await insertJob('pro-tools-salary-4', 90_000, 110_000)
  expect((await request('/api/account', 'GET', FREE)).status).toBe(200)
  expect((await request('/api/account', 'GET', PRO)).status).toBe(200)
  expect((await request('/api/billing/confirm', 'POST', PRO, { plan: 'pro' })).status).toBe(200)
  expect(
    (
      await request('/api/account/profile', 'PUT', PRO, {
        profile: {
          skills: ['TypeScript', 'React'],
          targetRoleFamilies: ['frontend'],
          targetSeniority: ['mid'],
          preferredWorkModes: ['remote'],
          workCountry: 'NG',
        },
      })
    ).status,
  ).toBe(200)
})

describe('Pro tool gates', () => {
  it('refuses every Pro tool to a free account while leaving the job readable', async () => {
    expect((await request('/api/jobs/pro-tools-job', 'GET', FREE)).status).toBe(200)
    const checks = [
      await request('/api/pro/application-answers', 'GET', FREE),
      await request('/api/jobs/pro-tools-job/prepared-application', 'POST', FREE, {}),
      await request('/api/jobs/pro-tools-job/cv-check', 'POST', FREE, { cvText: '' }),
      await request('/api/jobs/pro-tools-job/interview-prep', 'POST', FREE, {}),
      await request('/api/salary-guide', 'GET', FREE),
    ]
    for (const response of checks) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'pro_required' })
    }
  })
})

describe('Pro tools for a paid account', () => {
  it('saves answers, prepares an application and stores it for the job', async () => {
    const saved = await request('/api/pro/application-answers', 'PUT', PRO, {
      answers: {
        fullName: 'Pro Test User',
        summary: 'Frontend engineer with health dashboard experience.',
        achievement: 'I improved a clinic dashboard used every day.',
        availability: 'Two weeks',
        workPermission: 'I live in Nigeria and can work remotely.',
      },
    })
    expect(saved.status).toBe(200)

    const created = await request('/api/jobs/pro-tools-job/prepared-application', 'POST', PRO, {})
    expect(created.status).toBe(200)
    const body = (await created.json()) as {
      prepared: { recipientEmail: string; mailtoUrl: string; coverLetter: string }
    }
    expect(body.prepared.recipientEmail).toBe('hiring@example.com')
    expect(body.prepared.mailtoUrl).toContain('mailto:hiring@example.com')
    expect(body.prepared.coverLetter).toContain('clinic dashboard')

    const stored = await request('/api/jobs/pro-tools-job/prepared-application', 'GET', PRO)
    expect(stored.status).toBe(200)
    expect(await stored.json()).toMatchObject({
      prepared: { jobId: 'pro-tools-job', recipientEmail: 'hiring@example.com' },
    })
  })

  it('checks a CV and builds interview preparation for the same job', async () => {
    const checkResponse = await request('/api/jobs/pro-tools-job/cv-check', 'POST', PRO, {
      cvText:
        'Frontend engineer using React, TypeScript and GraphQL to build accessible dashboards.',
    })
    expect(checkResponse.status).toBe(200)
    const checkBody = (await checkResponse.json()) as {
      check: { requiredMissing: string[]; overallPercent: number }
    }
    expect(checkBody.check.requiredMissing).toEqual(['CSS'])
    expect(checkBody.check.overallPercent).toBeGreaterThan(50)

    const prepResponse = await request('/api/jobs/pro-tools-job/interview-prep', 'POST', PRO, {})
    expect(prepResponse.status).toBe(200)
    const prepBody = (await prepResponse.json()) as {
      prep: { questions: unknown[]; intro: string }
    }
    expect(prepBody.prep.questions).toHaveLength(8)
    expect(prepBody.prep.intro).toContain('health dashboard')
  })

  it('exports and deletes the saved Pro answers with the account', async () => {
    const who = { 'x-dev-user-email': `pro-delete-${suffix}@example.com` }
    const account = (await (await request('/api/account', 'GET', who)).json()) as {
      user: { id: string }
    }
    expect((await request('/api/billing/confirm', 'POST', who, { plan: 'pro' })).status).toBe(200)
    await request('/api/pro/application-answers', 'PUT', who, {
      answers: { fullName: 'Delete Me', summary: 'Export this summary.' },
    })
    await request('/api/jobs/pro-tools-job/prepared-application', 'POST', who, {})

    const exported = (await (await request('/api/account/export', 'GET', who)).json()) as {
      applicationAnswers: { summary: string }
      preparedApplications: { jobId: string }[]
    }
    expect(exported.applicationAnswers.summary).toBe('Export this summary.')
    expect(exported.preparedApplications.map((item) => item.jobId)).toContain('pro-tools-job')

    expect((await request('/api/account', 'DELETE', who)).status).toBe(200)
    const answers = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM application_answers WHERE user_id = ?1',
    )
      .bind(account.user.id)
      .first<{ n: number }>()
    const prepared = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM prepared_applications WHERE user_id = ?1',
    )
      .bind(account.user.id)
      .first<{ n: number }>()
    expect(answers?.n).toBe(0)
    expect(prepared?.n).toBe(0)
  })

  it('returns a salary guide with the sample count from inserted paid adverts', async () => {
    const response = await request(
      '/api/salary-guide?role=frontend&country=NG&workMode=remote&seniority=mid&currency=NGN&period=month',
      'GET',
      PRO,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      guide: { available: boolean; sampleCount: number; medianMidpoint: number }
    }
    expect(body.guide.available).toBe(true)
    expect(body.guide.sampleCount).toBeGreaterThanOrEqual(4)
    expect(body.guide.medianMidpoint).toBeGreaterThan(0)
  })
})
