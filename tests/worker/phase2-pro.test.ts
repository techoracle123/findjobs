import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const suffix = crypto.randomUUID().slice(0, 8)
const user = (name: string) => ({ 'x-dev-user-email': `phase2-${name}-${suffix}@example.com` })

const FREE = user('free')
const TRIAL_CV = user('trial-cv')
const PACK = user('pack')
const EXPIRED = user('expired')
const PAID = user('paid')
const CV_ONLY = user('cv-only')
const GRADUATE = user('graduate')
const CONFLICT = user('graduate-conflict')
const WORKER = user('graduate-worker')
const ADMIN = { 'x-dev-user-email': 'admin@example.com' }

const JOB_IDS = [1, 2, 3, 4].map((n) => `phase2-job-${suffix}-${n}`)

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

async function insertJob(id: string): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT OR REPLACE INTO jobs (id, title, company, role_family, seniority, work_mode,
      location_country, location_label, salary_min, salary_max, salary_currency, salary_period,
      description, required_skills, useful_skills, eligible_countries, sponsorship, source_name,
      source_url, posted_at, is_demo, verification, job_status, first_seen_at, last_seen_at,
      apply_url, apply_mode)
     VALUES (?1, 'Frontend Engineer', 'Phase Two Health', 'frontend', 'mid', 'remote', 'NG',
      'Nigeria · Remote', 250000, 350000, 'NGN', 'month',
      'Build accessible TypeScript and React dashboards for users in Nigeria. Salary is NGN 250000 monthly. Apply by 30 November 2026 at https://example.com/apply. Send questions to hiring@example.com.',
      '["TypeScript","React","CSS","GraphQL"]', '["Testing"]', '["NG"]', 'unknown', 'test',
      'https://example.com/jobs/phase2', ?2, 0, 'verified', 'open', ?2, ?2,
      'https://example.com/jobs/phase2/apply', 'external')`,
  )
    .bind(id, now)
    .run()
}

async function setProfile(headers: Record<string, string>): Promise<void> {
  const response = await request('/api/account/profile', 'PUT', headers, {
    profile: {
      skills: ['TypeScript', 'React'],
      targetRoleFamilies: ['frontend'],
      targetSeniority: ['mid'],
      preferredWorkModes: ['remote'],
      workCountry: 'NG',
    },
  })
  expect(response.status).toBe(200)
}

async function startTrial(headers: Record<string, string>) {
  const response = await request('/api/pro/trial/start', 'POST', headers, {})
  expect(response.status).toBe(200)
  return (await response.json()) as {
    trial: {
      status: string
      endsAt: string
      cvAnalysesUsed: number
      applicationPacksUsed: number
      limits: { days: number; cvAnalyses: number; applicationPacks: number }
    }
    paid: boolean
    alreadyUsed: boolean
  }
}

const CV_TEXT = `Ada Lovelace
ada@example.com | +234 801 234 5678 | Lagos, Nigeria
https://example.com/ada

Professional Summary
Frontend engineer who builds accessible health dashboards with TypeScript, React, CSS and GraphQL.

Skills
TypeScript, React, CSS, GraphQL, accessibility, testing

Experience
Frontend Engineer, Example Health, 2024 - Present
- Phase2EvidenceMarker built a GraphQL patient dashboard used by clinic staff every week.
- Responsible for fixing dashboards and helping the team.

Projects
Built a public appointment checker with React forms and clear error messages.

Education
BSc Computer Science, Example University, 2023
NYSC completed in 2024.`

const CHANGED_CV = CV_TEXT.replace('patient dashboard', 'appointment dashboard')

function monthOffset(offset: number): string {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

beforeAll(async () => {
  for (const id of JOB_IDS) await insertJob(id)
  for (const headers of [
    FREE,
    TRIAL_CV,
    PACK,
    EXPIRED,
    PAID,
    CV_ONLY,
    GRADUATE,
    CONFLICT,
    WORKER,
  ]) {
    expect((await request('/api/account', 'GET', headers)).status).toBe(200)
  }
  await setProfile(PACK)
  await setProfile(PAID)
  await setProfile(EXPIRED)
  expect((await request('/api/billing/confirm', 'POST', PAID, { plan: 'pro' })).status).toBe(200)
  expect((await request('/api/billing/confirm', 'POST', CV_ONLY, { plan: 'pro' })).status).toBe(200)
})

describe('3-day trial and saved master CV', () => {
  it('keeps detailed CV analysis locked until the trial is started', async () => {
    const locked = await request('/api/pro/cv', 'PUT', TRIAL_CV, {
      fileName: 'ada.pdf',
      fileType: 'application/pdf',
      text: CV_TEXT,
      consent: true,
    })
    expect(locked.status).toBe(403)
    expect(await locked.json()).toMatchObject({ error: 'pro_required' })

    const started = await startTrial(TRIAL_CV)
    expect(started.trial.status).toBe('active')
    expect(started.trial.limits).toEqual({ days: 3, cvAnalyses: 1, applicationPacks: 3 })
    expect(Date.parse(started.trial.endsAt)).toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000)

    const again = await startTrial(TRIAL_CV)
    expect(again.trial.endsAt).toBe(started.trial.endsAt)
  })

  it('requires explicit consent, saves only readable text, and does not spend a second analysis on identical text', async () => {
    const refused = await request('/api/pro/cv', 'PUT', TRIAL_CV, {
      fileName: 'ada.pdf',
      fileType: 'application/pdf',
      text: CV_TEXT,
      consent: false,
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'consent_required' })

    const savedResponse = await request('/api/pro/cv', 'PUT', TRIAL_CV, {
      fileName: 'ada.pdf',
      fileType: 'application/pdf',
      text: CV_TEXT,
      consent: true,
    })
    expect(savedResponse.status).toBe(200)
    const saved = (await savedResponse.json()) as {
      cv: {
        fileName: string
        text?: string
        report: { sections: unknown[]; detectedSkills: string[]; earned?: unknown }
      }
      trial: { cvAnalysesUsed: number }
    }
    expect(saved.cv.fileName).toBe('ada.pdf')
    expect(saved.cv.text).toBeUndefined()
    expect(saved.cv.report.sections.length).toBeGreaterThanOrEqual(7)
    expect(saved.cv.report.detectedSkills).toContain('TypeScript')
    expect(saved.trial.cvAnalysesUsed).toBe(1)

    const same = await request('/api/pro/cv', 'PUT', TRIAL_CV, {
      fileName: 'ada.pdf',
      fileType: 'application/pdf',
      text: CV_TEXT,
      consent: true,
    })
    expect(same.status).toBe(200)
    const account = (await (await request('/api/account', 'GET', TRIAL_CV)).json()) as {
      proTrial: { cvAnalysesUsed: number }
    }
    expect(account.proTrial.cvAnalysesUsed).toBe(1)

    const changed = await request('/api/pro/cv', 'PUT', TRIAL_CV, {
      fileName: 'ada-v2.pdf',
      fileType: 'application/pdf',
      text: CHANGED_CV,
      consent: true,
    })
    expect(changed.status).toBe(403)
    expect(await changed.json()).toMatchObject({ error: 'trial_limit_reached' })

    const withText = (await (
      await request('/api/pro/cv?includeText=1', 'GET', TRIAL_CV)
    ).json()) as { cv: { text: string } }
    expect(withText.cv.text).toContain('Phase2EvidenceMarker')
  })

  it('counts distinct trial job packs once, including detailed CV checks', async () => {
    await startTrial(PACK)
    const cv = await request('/api/pro/cv', 'PUT', PACK, {
      fileName: 'pack-cv.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text: CV_TEXT,
      consent: true,
    })
    expect(cv.status).toBe(200)

    const checkResponse = await request(`/api/jobs/${JOB_IDS[0]}/cv-check`, 'POST', PACK, {
      cvText: '',
    })
    expect(checkResponse.status).toBe(200)
    const check = (await checkResponse.json()) as {
      check: {
        basis: string
        requiredMatched: string[]
        evidence?: { skill: string; line: string }[]
        tailoredSummary?: string
      }
      trial: { applicationPacksUsed: number }
    }
    expect(check.check.basis).toBe('cv-and-profile')
    expect(check.check.requiredMatched).toContain('GraphQL')
    expect(check.check.evidence?.some((item) => item.line.includes('Phase2EvidenceMarker'))).toBe(
      true,
    )
    expect(check.check.tailoredSummary).toContain('TypeScript')
    expect(check.trial.applicationPacksUsed).toBe(1)

    for (const path of [
      `/api/jobs/${JOB_IDS[0]}/prepared-application`,
      `/api/jobs/${JOB_IDS[0]}/prepared-application`,
      `/api/jobs/${JOB_IDS[1]}/cv-check`,
      `/api/jobs/${JOB_IDS[2]}/prepared-application`,
    ]) {
      const body = path.endsWith('cv-check') ? { cvText: '' } : {}
      expect((await request(path, 'POST', PACK, body)).status).toBe(200)
    }

    const denied = await request(`/api/jobs/${JOB_IDS[3]}/prepared-application`, 'POST', PACK, {})
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: 'trial_limit_reached' })

    const account = (await (await request('/api/account', 'GET', PACK)).json()) as {
      proTrial: { applicationPacksUsed: number }
    }
    expect(account.proTrial.applicationPacksUsed).toBe(3)
  })

  it('keeps generated CV reports and packs readable after trial expiry', async () => {
    await startTrial(EXPIRED)
    expect(
      (
        await request('/api/pro/cv', 'PUT', EXPIRED, {
          fileName: 'expired.txt',
          fileType: 'text/plain',
          text: CV_TEXT,
          consent: true,
        })
      ).status,
    ).toBe(200)
    expect(
      (await request(`/api/jobs/${JOB_IDS[0]}/prepared-application`, 'POST', EXPIRED, {})).status,
    ).toBe(200)

    const account = (await (await request('/api/account', 'GET', EXPIRED)).json()) as {
      user: { id: string }
    }
    await env.DB.prepare('UPDATE pro_trials SET ends_at = ?1 WHERE user_id = ?2')
      .bind(new Date(Date.now() - 60_000).toISOString(), account.user.id)
      .run()

    const cv = (await (await request('/api/pro/cv', 'GET', EXPIRED)).json()) as {
      cv: { report: { summary: string } } | null
      locked: boolean
    }
    expect(cv.locked).toBe(true)
    expect(cv.cv?.report.summary).toBeTruthy()

    const pack = await request(`/api/jobs/${JOB_IDS[0]}/prepared-application`, 'GET', EXPIRED)
    expect(pack.status).toBe(200)
    expect(await pack.json()).toMatchObject({ prepared: { jobId: JOB_IDS[0] } })

    expect(
      (await request(`/api/jobs/${JOB_IDS[1]}/prepared-application`, 'POST', EXPIRED, {})).status,
    ).toBe(403)
    expect(
      (
        await request('/api/pro/cv', 'PUT', EXPIRED, {
          fileName: 'new.txt',
          fileType: 'text/plain',
          text: CHANGED_CV,
          consent: true,
        })
      ).status,
    ).toBe(403)
  })
})

describe('graduate price separation', () => {
  it('approves a clear recent graduate and blocks checkout only because payments are not configured', async () => {
    const response = await request('/api/pro/graduate-eligibility', 'POST', GRADUATE, {
      graduate: {
        status: 'recent_graduate',
        educationMonth: monthOffset(-6),
        nyscMonth: null,
        fullTimeExperience: 'under_1_year',
        declared: true,
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      graduate: { result: string; proofStatus: string; eligibleUntil: string | null }
    }
    expect(body.graduate.result).toBe('eligible')
    expect(body.graduate.proofStatus).toBe('not_requested')
    expect(body.graduate.eligibleUntil).toBeTruthy()

    const checkout = await request('/api/billing/checkout', 'POST', GRADUATE, {
      plan: 'pro_graduate',
    })
    expect(checkout.status).toBe(503)
    expect(await checkout.json()).toMatchObject({ error: 'billing_not_configured' })
  })

  it('sends conflicting CV evidence to admin review and lets an admin approve it', async () => {
    const response = await request('/api/pro/graduate-eligibility', 'POST', CONFLICT, {
      graduate: {
        status: 'nysc_current',
        educationMonth: monthOffset(-3),
        nyscMonth: monthOffset(8),
        fullTimeExperience: 'none',
        declared: true,
      },
      cvText:
        'Senior Manager, Example Company, 2018 - Present. Led large teams for many years across several departments and budgets.',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      graduate: { result: string; proofStatus: string; flags: string[] }
    }
    expect(body.graduate.result).toBe('review')
    expect(body.graduate.proofStatus).toBe('requested')
    expect(body.graduate.flags.length).toBeGreaterThan(0)

    const checkout = await request('/api/billing/checkout', 'POST', CONFLICT, {
      plan: 'pro_graduate',
    })
    expect(checkout.status).toBe(403)

    expect((await request('/api/admin/graduate-reviews', 'GET', CONFLICT)).status).toBe(403)
    const list = (await (await request('/api/admin/graduate-reviews', 'GET', ADMIN)).json()) as {
      reviews: { user_id: string; email: string }[]
    }
    const review = list.reviews.find((row) => row.email.includes(`graduate-conflict-${suffix}`))
    expect(review).toBeTruthy()

    const resolved = await request(
      `/api/admin/graduate-reviews/${review!.user_id}/resolve`,
      'POST',
      ADMIN,
      { decision: 'approved' },
    )
    expect(resolved.status).toBe(200)
    const after = (await (
      await request('/api/pro/graduate-eligibility', 'GET', CONFLICT)
    ).json()) as { graduate: { result: string; proofStatus: string } }
    expect(after.graduate).toMatchObject({ result: 'eligible', proofStatus: 'approved' })
  })

  it('decides an ordinary worker clearly without asking for review', async () => {
    const response = await request('/api/pro/graduate-eligibility', 'POST', WORKER, {
      graduate: {
        status: 'worker',
        educationMonth: monthOffset(-80),
        nyscMonth: null,
        fullTimeExperience: 'over_2_years',
        declared: true,
      },
    })
    const body = (await response.json()) as { graduate: { result: string } }
    expect(body.graduate.result).toBe('not_eligible')
  })
})

describe('advert checks, best matches and skill gaps', () => {
  it('shows Nigeria evidence for a listed job without calling it verified', async () => {
    const response = await request(`/api/jobs/${JOB_IDS[0]}/before-you-apply`, 'POST', PAID, {})
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      check: {
        headline: string
        salaryStated: boolean
        deadlineText: string | null
        nigeria: { status: string; evidence: string[] }
      }
    }
    expect(body.check.nigeria.status).toBe('nigeria-named')
    expect(body.check.salaryStated).toBe(true)
    expect(body.check.deadlineText).toContain('Apply by')
    expect(body.check.headline).toContain('not employer verification')
  })

  it('checks pasted adverts for restrictions and visible danger signs', async () => {
    const restricted = (await (
      await request('/api/pro/advert-check', 'POST', PAID, {
        title: 'Remote Analyst',
        company: 'Example Inc',
        location: 'Remote, United States',
        text: 'Remote Analyst. Applicants must reside in the United States and be authorized to work in the United States. Duties include reporting and dashboards. Apply on our official website.',
      })
    ).json()) as { check: { nigeria: { status: string; countriesNamed: string[] } } }
    expect(restricted.check.nigeria.status).toBe('nigeria-not-named')
    expect(restricted.check.nigeria.countriesNamed).toContain('United States')

    const dangerous = (await (
      await request('/api/pro/advert-check', 'POST', PAID, {
        title: 'Urgent job',
        text: 'Guaranteed job with no interview needed. WhatsApp us now, pay a registration fee and send your BVN and bank account number today to start earning daily.',
      })
    ).json()) as {
      check: { riskLevel: string; signals: { label: string }[]; nigeria: { status: string } }
    }
    expect(dangerous.check.riskLevel).toBe('warning-signs-found')
    expect(dangerous.check.signals.map((signal) => signal.label)).toContain(
      'Guaranteed outcome wording',
    )
    expect(dangerous.check.nigeria.status).toBe('not-stated')
  })

  it('ranks best matches and repeats missing skills from live adverts', async () => {
    const best = (await (await request('/api/pro/best-matches?limit=12', 'GET', PAID)).json()) as {
      available: boolean
      matches: { job: { id: string }; reasons: string[]; matchedSkills: string[] }[]
    }
    expect(best.available).toBe(true)
    const match = best.matches.find((item) => JOB_IDS.includes(item.job.id))
    expect(match).toBeTruthy()
    expect(match!.matchedSkills).toContain('TypeScript')
    expect(match!.reasons.length).toBeGreaterThan(0)

    const plan = (await (await request('/api/pro/skill-plan', 'GET', PAID)).json()) as {
      plan: { available: boolean; items: { skill: string }[] }
    }
    expect(plan.plan.available).toBe(true)
    expect(plan.plan.items.map((item) => item.skill)).toEqual(
      expect.arrayContaining(['CSS', 'GraphQL']),
    )
  })

  it('uses the saved master CV for best matches before the profile form is filled', async () => {
    const account = (await (await request('/api/account', 'GET', CV_ONLY)).json()) as {
      profile: { skills: string[]; targetRoleFamilies: string[] }
    }
    expect(account.profile.skills).toEqual([])
    expect(account.profile.targetRoleFamilies).toEqual([])

    expect(
      (
        await request('/api/pro/cv', 'PUT', CV_ONLY, {
          fileName: 'cv-only.txt',
          fileType: 'text/plain',
          text: CV_TEXT,
          consent: true,
        })
      ).status,
    ).toBe(200)

    const best = (await (
      await request('/api/pro/best-matches?limit=12', 'GET', CV_ONLY)
    ).json()) as {
      available: boolean
      message: string
      matches: { job: { id: string }; matchedSkills: string[] }[]
    }
    expect(best.available).toBe(true)
    expect(best.message).toContain('saved master CV')
    const match = best.matches.find((item) => JOB_IDS.includes(item.job.id))
    expect(match).toBeTruthy()
    expect(match!.matchedSkills).toEqual(expect.arrayContaining(['CSS', 'GraphQL']))
  })
})

describe('pipeline and smart alert account gates', () => {
  it('downgrades free advanced stages and smart alerts without taking away the basic records', async () => {
    const savedResponse = await request('/api/account/saved', 'POST', FREE, {
      jobId: JOB_IDS[0],
      status: 'applied',
      stage: 'interview',
      followUpAt: new Date(Date.now() + 86400000).toISOString(),
    })
    expect(savedResponse.status).toBe(200)
    expect(await savedResponse.json()).toMatchObject({ ok: true, proRequired: true })
    const saved = (await (await request('/api/account/saved', 'GET', FREE)).json()) as {
      saved: { jobId: string; status: string; stage: string; followUpAt?: string }[]
    }
    expect(saved.saved.find((entry) => entry.jobId === JOB_IDS[0])).toMatchObject({
      status: 'applied',
      stage: 'applied',
    })
    expect(saved.saved.find((entry) => entry.jobId === JOB_IDS[0])?.followUpAt).toBeUndefined()

    const alertResponse = await request('/api/account/alerts', 'POST', FREE, {
      id: `free-smart-${suffix}`,
      label: 'Free attempted smart',
      query: 'frontend',
      channels: ['telegram'],
      kind: 'smart',
      minScore: 80,
      countries: ['NG'],
    })
    expect(alertResponse.status).toBe(200)
    expect(await alertResponse.json()).toMatchObject({ alert: { kind: 'keyword' } })
  })

  it('persists trial pipeline stages and smart settings, preserving settings after expiry', async () => {
    const follow = new Date(Date.now() + 3 * 86400000).toISOString()
    const savedResponse = await request('/api/account/saved', 'POST', PACK, {
      jobId: JOB_IDS[1],
      status: 'applied',
      stage: 'interview',
      followUpAt: follow,
    })
    expect(await savedResponse.json()).toEqual({ ok: true })

    const alertId = `trial-smart-${suffix}`
    const alertResponse = await request('/api/account/alerts', 'POST', PACK, {
      id: alertId,
      label: 'Smart frontend',
      query: 'frontend',
      channels: ['telegram'],
      kind: 'smart',
      minScore: 55,
      countries: ['ng'],
      workModes: ['remote'],
      salaryOnly: true,
      currency: 'ngn',
      exclude: 'unpaid',
      companies: ['Phase Two Health'],
    })
    expect(alertResponse.status).toBe(200)

    const before = (await (await request('/api/account', 'GET', PACK)).json()) as {
      user: { id: string }
      saved: { jobId: string; stage: string; followUpAt?: string }[]
      alerts: Record<string, unknown>[]
    }
    expect(before.saved.find((entry) => entry.jobId === JOB_IDS[1])).toMatchObject({
      stage: 'interview',
      followUpAt: follow,
    })
    expect(before.alerts.find((alert) => alert.id === alertId)).toMatchObject({
      kind: 'smart',
      minScore: 55,
      countries: ['NG'],
      workModes: ['remote'],
      salaryOnly: true,
      currency: 'NGN',
      exclude: 'unpaid',
      companies: ['Phase Two Health'],
    })

    await env.DB.prepare('UPDATE pro_trials SET ends_at = ?1 WHERE user_id = ?2')
      .bind(new Date(Date.now() - 60_000).toISOString(), before.user.id)
      .run()
    const currentAlert = before.alerts.find((alert) => alert.id === alertId)
    expect(
      (
        await request(`/api/account/alerts/${alertId}`, 'PATCH', PACK, {
          ...currentAlert,
          enabled: false,
        })
      ).status,
    ).toBe(200)
    const after = (await (await request('/api/account/alerts', 'GET', PACK)).json()) as {
      alerts: Record<string, unknown>[]
    }
    expect(after.alerts.find((alert) => alert.id === alertId)).toMatchObject({
      kind: 'smart',
      minScore: 55,
      currency: 'NGN',
    })
  })
})

describe('Phase 2 export and deletion', () => {
  it('exports trial, graduate and master CV data, then account deletion removes every Phase 2 row', async () => {
    await request('/api/pro/graduate-eligibility', 'POST', EXPIRED, {
      graduate: {
        status: 'recent_graduate',
        educationMonth: monthOffset(-4),
        nyscMonth: null,
        fullTimeExperience: 'none',
        declared: true,
      },
    })
    const exported = (await (await request('/api/account/export', 'GET', EXPIRED)).json()) as {
      user: { id: string }
      proTrial: { status: string }
      graduateEligibility: { result: string; flags: string[] }
      masterCv: { text: string; report: { sections: unknown[] } }
    }
    expect(exported.proTrial.status).toBe('expired')
    // The declared 2026 completion month conflicts with the saved CV's 2023
    // education year, so the export also proves CV consistency was checked.
    expect(exported.graduateEligibility.result).toBe('review')
    expect(exported.graduateEligibility.flags.length).toBeGreaterThan(0)
    expect(exported.masterCv.text).toContain('Phase2EvidenceMarker')
    expect(exported.masterCv.report.sections.length).toBeGreaterThan(0)

    expect((await request('/api/account', 'DELETE', EXPIRED)).status).toBe(200)
    for (const table of ['master_cvs', 'graduate_eligibility', 'pro_trial_usage', 'pro_trials']) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`)
        .bind(exported.user.id)
        .first<{ n: number }>()
      expect(row?.n).toBe(0)
    }
  })

  it('lets the owner delete the saved CV without deleting the account', async () => {
    expect((await request('/api/pro/cv', 'DELETE', TRIAL_CV)).status).toBe(200)
    const after = (await (await request('/api/pro/cv?includeText=1', 'GET', TRIAL_CV)).json()) as {
      cv: unknown
    }
    expect(after.cv).toBeNull()
    expect((await request('/api/account', 'GET', TRIAL_CV)).status).toBe(200)
  })
})
