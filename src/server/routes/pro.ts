import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from '../env'
import type {
  ApplicationAnswers,
  Job,
  PreparedApplication,
  SalaryPeriod,
  Seniority,
  WorkMode,
} from '../../shared/types'
import { ROLE_FAMILIES, SENIORITIES, WORK_MODES } from '../../shared/taxonomy'
import { getEntitlements, getProfile, getSubscription, type AccountUser } from '../auth/accounts'
import { planEntitlements, subscriptionHasFeature } from '../billing/types'
import { readJson, requireUser, unauthorized, type AppContext } from '../http'
import { enforceRateLimit } from '../ratelimit'
import { publishedPublicJobs, findPublishedJob } from '../public-feed'
import { findJob, listOpenJobs } from '../jobs'
import { livePublicEnabled, livePublicJobs } from '../live-public'
import { readConfig } from '../config'
import {
  EMPTY_APPLICATION_ANSWERS,
  buildCvCheck,
  buildInterviewPrep,
  buildPreparedApplication,
  buildSalaryGuide,
  normaliseApplicationAnswers,
  type SalaryGuideFilters,
} from '../pro-tools'

export const proRoutes = new Hono<AppEnv>()

proRoutes.use(
  '/jobs/:id/*',
  bodyLimit({ maxSize: 40_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
)
proRoutes.use(
  '/pro/*',
  bodyLimit({ maxSize: 16_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
)

const privateResponse = async (c: AppContext, next: () => Promise<void>) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
}
proRoutes.use('/pro/*', privateResponse)
proRoutes.use('/salary-guide', privateResponse)

async function jobForRequest(c: AppContext): Promise<Job | null> {
  const id = c.req.param('id') || ''
  const published = await findPublishedJob(c.env?.PUBLIC_JOBS, id)
  if (published) return published
  const config = readConfig(c.env ?? {})
  try {
    const job = await findJob(c.env?.DB, id, Date.now(), config.isLocal || config.isTest)
    if (job) return job
  } catch (error) {
    if (!livePublicEnabled(c.env?.APP_MODE)) throw error
  }
  return livePublicEnabled(c.env?.APP_MODE)
    ? (await livePublicJobs(new URL(c.req.url).origin)).find((job) => job.id === id) || null
    : null
}

type FeatureGate =
  { ok: true; user: AccountUser; db: D1Database } | { ok: false; response: Response }

async function requireFeature(c: AppContext, feature: string): Promise<FeatureGate> {
  const user = await requireUser(c)
  if (!user) return { ok: false, response: unauthorized(c) }
  const db = c.env?.DB
  if (!db) return { ok: false, response: c.json({ error: 'storage_unavailable' }, 503) }
  const [entitlements, subscription] = await Promise.all([
    getEntitlements(db, user.id),
    getSubscription(db, user.id),
  ])
  const allowed =
    entitlements.includes(feature) ||
    subscriptionHasFeature(
      subscription,
      subscription ? planEntitlements(subscription.plan) : [],
      feature,
    )
  if (!allowed) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'pro_required',
          feature,
          message: 'This tool is part of Pro. Applying on the employer site stays free.',
          upgradeUrl: '/pricing',
        },
        403,
      ),
    }
  }
  return { ok: true, user, db }
}

async function getApplicationAnswers(db: D1Database, userId: string): Promise<ApplicationAnswers> {
  const row = await db
    .prepare('SELECT answers FROM application_answers WHERE user_id = ?1')
    .bind(userId)
    .first<{ answers: string }>()
    .catch(() => null)
  if (!row) return { ...EMPTY_APPLICATION_ANSWERS }
  try {
    return normaliseApplicationAnswers(JSON.parse(row.answers))
  } catch {
    return { ...EMPTY_APPLICATION_ANSWERS }
  }
}

async function saveApplicationAnswers(
  db: D1Database,
  userId: string,
  answers: ApplicationAnswers,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO application_answers (user_id, answers, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET answers = ?2, updated_at = ?3`,
    )
    .bind(userId, JSON.stringify(answers), new Date().toISOString())
    .run()
}

proRoutes.get('/pro/application-answers', async (c) => {
  const gate = await requireFeature(c, 'prepared_applications')
  if (!gate.ok) return gate.response
  return c.json({ answers: await getApplicationAnswers(gate.db, gate.user.id) })
})

proRoutes.put('/pro/application-answers', async (c) => {
  const gate = await requireFeature(c, 'prepared_applications')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'pro-answers',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const body = await readJson(c)
  const answers = normaliseApplicationAnswers(body.answers ?? body)
  await saveApplicationAnswers(gate.db, gate.user.id, answers)
  return c.json({ answers })
})

proRoutes.get('/jobs/:id/prepared-application', async (c) => {
  const gate = await requireFeature(c, 'prepared_applications')
  if (!gate.ok) return gate.response
  const row = await gate.db
    .prepare('SELECT content FROM prepared_applications WHERE user_id = ?1 AND job_id = ?2')
    .bind(gate.user.id, c.req.param('id'))
    .first<{ content: string }>()
    .catch(() => null)
  if (!row) return c.json({ prepared: null })
  try {
    return c.json({ prepared: JSON.parse(row.content) as PreparedApplication })
  } catch {
    return c.json({ prepared: null })
  }
})

proRoutes.post('/jobs/:id/prepared-application', async (c) => {
  const gate = await requireFeature(c, 'prepared_applications')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'prepared-application',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const job = await jobForRequest(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  const body = await readJson(c)
  let answers = await getApplicationAnswers(gate.db, gate.user.id)
  if (body.answers) {
    answers = normaliseApplicationAnswers(body.answers)
    await saveApplicationAnswers(gate.db, gate.user.id, answers)
  }
  const profile = await getProfile(gate.db, gate.user.id)
  const prepared = buildPreparedApplication(job, profile, answers, gate.user.email)
  await gate.db
    .prepare(
      `INSERT INTO prepared_applications (user_id, job_id, content, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, job_id) DO UPDATE SET content = ?3, updated_at = ?4`,
    )
    .bind(gate.user.id, job.id, JSON.stringify(prepared), prepared.generatedAt)
    .run()
  return c.json({ prepared })
})

proRoutes.post('/jobs/:id/cv-check', async (c) => {
  const gate = await requireFeature(c, 'cv_check')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'cv-check',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const job = await jobForRequest(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  const body = await readJson(c)
  const cvText = typeof body.cvText === 'string' ? body.cvText.slice(0, 30_000) : ''
  const profile = await getProfile(gate.db, gate.user.id)
  return c.json({ check: buildCvCheck(job, profile, cvText) })
})

proRoutes.post('/jobs/:id/interview-prep', async (c) => {
  const gate = await requireFeature(c, 'interview_prep')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'interview-prep',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const job = await jobForRequest(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  const [profile, answers] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    getApplicationAnswers(gate.db, gate.user.id),
  ])
  return c.json({ prep: buildInterviewPrep(job, profile, answers) })
})

async function salaryJobs(c: AppContext): Promise<{ jobs: Job[]; updatedAt: string | null }> {
  const published = await publishedPublicJobs(c.env?.PUBLIC_JOBS)
  if (published) return { jobs: published.jobs, updatedAt: published.refreshedAt }
  const listed = await listOpenJobs(c.env?.DB)
  return { jobs: listed.jobs, updatedAt: null }
}

proRoutes.get('/salary-guide', async (c) => {
  const gate = await requireFeature(c, 'salary_guide')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'salary-guide',
    limit: 60,
    windowSeconds: 60,
  })
  if (limited) return limited

  const profile = await getProfile(gate.db, gate.user.id)
  const role = c.req.query('role') || profile.targetRoleFamilies[0]
  const countryRaw = (c.req.query('country') || profile.workCountry || '').toUpperCase()
  const workModeRaw = c.req.query('workMode') || profile.preferredWorkModes[0]
  const seniorityRaw = c.req.query('seniority') || profile.targetSeniority[0]
  const currencyRaw = (c.req.query('currency') || '').toUpperCase()
  const periodRaw = c.req.query('period') || ''

  const filters: SalaryGuideFilters = {
    roleFamily: role && (ROLE_FAMILIES as readonly string[]).includes(role) ? role : undefined,
    country: /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : undefined,
    workMode: (WORK_MODES as readonly string[]).includes(workModeRaw ?? '')
      ? (workModeRaw as WorkMode)
      : undefined,
    seniority: (SENIORITIES as readonly string[]).includes(seniorityRaw ?? '')
      ? (seniorityRaw as Seniority)
      : undefined,
    currency: /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined,
    period: ['hour', 'month', 'year'].includes(periodRaw) ? (periodRaw as SalaryPeriod) : undefined,
    query: c.req.query('q')?.trim().slice(0, 80) || undefined,
  }

  const { jobs, updatedAt } = await salaryJobs(c)
  return c.json({ guide: buildSalaryGuide(jobs, filters, updatedAt) })
})
