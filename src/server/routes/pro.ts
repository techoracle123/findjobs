import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from '../env'
import type {
  ApplicationAnswers,
  Job,
  MasterCv,
  PreparedApplication,
  Profile,
  SalaryPeriod,
  Seniority,
  WorkMode,
} from '../../shared/types'
import { ROLE_FAMILIES, SENIORITIES, WORK_MODES } from '../../shared/taxonomy'
import {
  getEntitlements,
  getProfile,
  getSubscription,
  listSaved,
  recordAudit,
  type AccountUser,
} from '../auth/accounts'
import { planEntitlements, subscriptionHasFeature } from '../billing/types'
import { readJson, requireUser, unauthorized, type AppContext } from '../http'
import { enforceRateLimit } from '../ratelimit'
import { publishedPublicJobs, findPublishedJob } from '../public-feed'
import { findJob, listOpenJobs } from '../jobs'
import { livePublicEnabled, livePublicJobs } from '../live-public'
import { readConfig } from '../config'
import {
  EMPTY_APPLICATION_ANSWERS,
  buildBestMatches,
  buildCvAnalysis,
  buildCvCheck,
  buildInterviewPrep,
  buildPreparedApplication,
  buildSalaryGuide,
  buildSkillPlan,
  normaliseApplicationAnswers,
  type SalaryGuideFilters,
} from '../pro-tools'
import {
  canUseTrialCvAnalysis,
  canUseTrialPack,
  deleteMasterCv,
  evaluateGraduateEligibility,
  getGraduateEligibility,
  getMasterCv,
  getMasterCvText,
  getTrialState,
  normaliseGraduateInput,
  recordTrialCvAnalysis,
  recordTrialPack,
  saveGraduateEligibility,
  saveMasterCv,
  sha256Hex,
  startTrial,
} from '../phase2'
import {
  buildAdvertCheck,
  buildAdvertCheckForJob,
  normaliseAdvertCheckInput,
} from '../advert-check'

export const proRoutes = new Hono<AppEnv>()

proRoutes.use(
  '/jobs/:id/*',
  bodyLimit({ maxSize: 40_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
)
proRoutes.use(
  '/pro/*',
  bodyLimit({ maxSize: 90_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
)

const privateResponse = async (c: AppContext, next: () => Promise<void>) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
}
proRoutes.use('/pro/*', privateResponse)
proRoutes.use('/salary-guide', privateResponse)

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Ranking uses the person's saved profile first, then fills genuine gaps from
 * the consented master-CV report. A CV analysis should improve Best matches
 * and the skill plan even when the person has not separately retyped the same
 * skills into the profile form.
 */
function profileWithMasterCv(profile: Profile, cv: MasterCv | null): Profile {
  if (!cv) return profile
  return {
    ...profile,
    skills: uniqueStrings([...profile.skills, ...cv.report.detectedSkills]),
    targetRoleFamilies: profile.targetRoleFamilies.length
      ? profile.targetRoleFamilies
      : cv.report.roleFamilies,
    targetSeniority: profile.targetSeniority.length ? profile.targetSeniority : cv.report.seniority,
  }
}

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
  | {
      ok: true
      user: AccountUser
      db: D1Database
      paid: boolean
      trial: Awaited<ReturnType<typeof getTrialState>>
    }
  | { ok: false; response: Response }

type SignedInGate =
  { ok: true; user: AccountUser; db: D1Database } | { ok: false; response: Response }

async function requireSignedIn(c: AppContext): Promise<SignedInGate> {
  const user = await requireUser(c)
  if (!user) return { ok: false, response: unauthorized(c) }
  const db = c.env?.DB
  if (!db) return { ok: false, response: c.json({ error: 'storage_unavailable' }, 503) }
  return { ok: true, user, db }
}

async function paidFeature(db: D1Database, userId: string, feature: string): Promise<boolean> {
  const [entitlements, subscription] = await Promise.all([
    getEntitlements(db, userId),
    getSubscription(db, userId),
  ])
  return (
    entitlements.includes(feature) ||
    subscriptionHasFeature(
      subscription,
      subscription ? planEntitlements(subscription.plan) : [],
      feature,
    )
  )
}

async function requireFeature(c: AppContext, feature: string): Promise<FeatureGate> {
  const signedIn = await requireSignedIn(c)
  if (!signedIn.ok) return signedIn
  const [paid, trial] = await Promise.all([
    paidFeature(signedIn.db, signedIn.user.id, feature),
    getTrialState(signedIn.db, signedIn.user.id),
  ])
  const allowed = paid || trial.status === 'active'
  if (!allowed) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'pro_required',
          feature,
          trial,
          message:
            trial.status === 'not_started'
              ? 'Start the free 3-day Pro trial to use this tool. Applying on the employer site stays free.'
              : 'Your free Pro trial has ended. Applying on the employer site stays free.',
          upgradeUrl: '/pricing',
        },
        403,
      ),
    }
  }
  return { ok: true, user: signedIn.user, db: signedIn.db, paid, trial }
}

async function enforceTrialPack(
  c: AppContext,
  gate: Extract<FeatureGate, { ok: true }>,
  jobId: string,
): Promise<Response | null> {
  if (gate.paid) return null
  if (await canUseTrialPack(gate.db, gate.user.id, jobId)) return null
  return c.json(
    {
      error: 'trial_limit_reached',
      trial: await getTrialState(gate.db, gate.user.id),
      message:
        'You have used help for three jobs in your free trial. You can still apply free on the company website.',
      upgradeUrl: '/pricing',
    },
    403,
  )
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

proRoutes.get('/pro/access', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  const [trial, graduate, paid] = await Promise.all([
    getTrialState(gate.db, gate.user.id),
    getGraduateEligibility(gate.db, gate.user.id),
    paidFeature(gate.db, gate.user.id, 'cv_analysis'),
  ])
  return c.json({
    paid,
    trial,
    graduate,
    features: paid || trial.status === 'active' ? planEntitlements('pro') : ['alerts'],
  })
})

proRoutes.post('/pro/trial/start', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'pro-trial-start',
    limit: 5,
    windowSeconds: 3600,
  })
  if (limited) return limited
  const paid = await paidFeature(gate.db, gate.user.id, 'cv_analysis')
  const before = await getTrialState(gate.db, gate.user.id)
  const trial = paid ? before : await startTrial(gate.db, gate.user.id)
  if (!paid && before.status === 'not_started' && trial.status === 'active') {
    await recordAudit(gate.db, gate.user.id, 'pro.trial.started', { days: trial.limits.days })
  }
  return c.json({ trial, paid, alreadyUsed: before.status !== 'not_started' })
})

proRoutes.get('/pro/graduate-eligibility', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  return c.json({ graduate: await getGraduateEligibility(gate.db, gate.user.id) })
})

proRoutes.post('/pro/graduate-eligibility', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'graduate-eligibility',
    limit: 20,
    windowSeconds: 3600,
  })
  if (limited) return limited
  const body = await readJson(c)
  const input = normaliseGraduateInput(body.graduate ?? body)
  const suppliedCv = typeof body.cvText === 'string' ? body.cvText.slice(0, 60_000) : ''
  const [profile, masterCvText] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    suppliedCv ? Promise.resolve('') : getMasterCvText(gate.db, gate.user.id),
  ])
  const graduate = evaluateGraduateEligibility(input, profile, suppliedCv || masterCvText)
  await saveGraduateEligibility(gate.db, gate.user.id, graduate)
  await recordAudit(gate.db, gate.user.id, 'pro.graduate.checked', {
    status: graduate.status,
    result: graduate.result,
    flagCount: graduate.flags.length,
  })
  return c.json({ graduate })
})

proRoutes.get('/pro/cv', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  const includeText = c.req.query('includeText') === '1'
  const [cv, trial, paid] = await Promise.all([
    getMasterCv(gate.db, gate.user.id, includeText),
    getTrialState(gate.db, gate.user.id),
    paidFeature(gate.db, gate.user.id, 'cv_analysis'),
  ])
  return c.json({ cv, locked: !paid && trial.status !== 'active', trial, paid })
})

proRoutes.put('/pro/cv', async (c) => {
  const gate = await requireFeature(c, 'cv_analysis')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'cv-analysis',
    limit: 10,
    windowSeconds: 3600,
  })
  if (limited) return limited
  const body = await readJson(c)
  if (body.consent !== true) {
    return c.json(
      {
        error: 'consent_required',
        message: 'Please confirm that FJ may save the readable CV text for your detailed analysis.',
      },
      400,
    )
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, 60_000) : ''
  const wordCount = (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu) ?? []).length
  if (text.trim().length < 200 || wordCount < 30) {
    return c.json(
      {
        error: 'cv_unreadable',
        message:
          'That CV text is too short to analyse. Use a text-readable PDF or DOCX, or paste the CV text.',
      },
      400,
    )
  }
  const fileName =
    typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim().slice(0, 160)
      : 'Pasted CV'
  const fileType =
    typeof body.fileType === 'string' && body.fileType.trim()
      ? body.fileType.trim().slice(0, 80)
      : 'text/plain'
  const textHash = await sha256Hex(text.trim().toLowerCase().replace(/\s+/g, ' '))
  const existing = await getMasterCv(gate.db, gate.user.id)
  if (existing?.textHash === textHash)
    return c.json({ cv: existing, trial: gate.trial, paid: gate.paid })

  if (!gate.paid && !(await canUseTrialCvAnalysis(gate.db, gate.user.id, textHash))) {
    return c.json(
      {
        error: 'trial_limit_reached',
        trial: await getTrialState(gate.db, gate.user.id),
        message: 'You have used the one CV check in your free trial.',
        upgradeUrl: '/pricing',
      },
      403,
    )
  }

  const [profile, { jobs }] = await Promise.all([getProfile(gate.db, gate.user.id), salaryJobs(c)])
  const now = new Date().toISOString()
  const report = buildCvAnalysis(text, profile, jobs, fileName, now)
  const cv = {
    fileName,
    fileType,
    text,
    textHash,
    report,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await saveMasterCv(gate.db, gate.user.id, cv)
  if (!gate.paid) await recordTrialCvAnalysis(gate.db, gate.user.id, textHash)
  await recordAudit(gate.db, gate.user.id, 'pro.cv.analysis', {
    fileType,
    wordCount: report.wordCount,
    detectedSkills: report.detectedSkills.length,
  })
  const { text: _savedText, ...publicCv } = cv
  return c.json({
    cv: publicCv,
    trial: await getTrialState(gate.db, gate.user.id),
    paid: gate.paid,
  })
})

proRoutes.delete('/pro/cv', async (c) => {
  const gate = await requireSignedIn(c)
  if (!gate.ok) return gate.response
  await deleteMasterCv(gate.db, gate.user.id)
  await recordAudit(gate.db, gate.user.id, 'pro.cv.deleted', {})
  return c.json({ ok: true })
})

proRoutes.post('/pro/advert-check', async (c) => {
  const gate = await requireFeature(c, 'advert_check')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'advert-check',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const input = normaliseAdvertCheckInput(await readJson(c))
  if (input.text.trim().length < 40) {
    return c.json(
      {
        error: 'advert_text_required',
        message:
          'Paste more of the advert so the check has duties, requirements and contact details to review.',
      },
      400,
    )
  }
  return c.json({ check: buildAdvertCheck(input) })
})

proRoutes.get('/pro/best-matches', async (c) => {
  const gate = await requireFeature(c, 'smart_shortlist')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'best-matches',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const [profile, cv] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    getMasterCv(gate.db, gate.user.id),
  ])
  const effectiveProfile = profileWithMasterCv(profile, cv)
  const hasProfile = Boolean(
    effectiveProfile.skills.length ||
    effectiveProfile.targetRoleFamilies.length ||
    effectiveProfile.targetSeniority.length ||
    effectiveProfile.preferredWorkModes.length ||
    effectiveProfile.workCountry,
  )
  const { jobs, updatedAt } = await salaryJobs(c)
  if (!hasProfile) {
    return c.json({
      available: false,
      message:
        'Add your skills and job preferences first, so the shortlist is genuinely based on you.',
      totalJobs: jobs.length,
      updatedAt,
      matches: [],
    })
  }
  const saved = await listSaved(gate.db, gate.user.id)
  const excluded = new Set(
    saved.filter((entry) => entry.status === 'applied').map((entry) => entry.jobId),
  )
  const limitRaw = Number(c.req.query('limit') ?? 12)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, Math.round(limitRaw))) : 12
  return c.json({
    available: true,
    message: cv
      ? 'We used your profile and saved CV. Jobs open to you come first.'
      : 'Ranked from your profile, with eligible roles kept ahead of restricted ones.',
    totalJobs: jobs.length,
    updatedAt,
    matches: buildBestMatches(jobs, effectiveProfile, limit, excluded),
  })
})

proRoutes.get('/pro/skill-plan', async (c) => {
  const gate = await requireFeature(c, 'skill_plan')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, { bucket: 'skill-plan', limit: 30, windowSeconds: 60 })
  if (limited) return limited
  const [profile, cv, { jobs }] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    getMasterCv(gate.db, gate.user.id),
    salaryJobs(c),
  ])
  return c.json({ plan: buildSkillPlan(jobs, profileWithMasterCv(profile, cv)) })
})

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
  // A pack already generated during a paid period or trial stays readable.
  // It is the owner's own saved work; generating a new one remains Pro.
  const gate = await requireSignedIn(c)
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
  const trialDenied = await enforceTrialPack(c, gate, job.id)
  if (trialDenied) return trialDenied
  const body = await readJson(c)
  let answers = await getApplicationAnswers(gate.db, gate.user.id)
  if (body.answers) {
    answers = normaliseApplicationAnswers(body.answers)
    await saveApplicationAnswers(gate.db, gate.user.id, answers)
  }
  const [profile, masterCvText] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    getMasterCvText(gate.db, gate.user.id),
  ])
  const prepared = buildPreparedApplication(
    job,
    profile,
    answers,
    gate.user.email,
    new Date().toISOString(),
    masterCvText,
  )
  await gate.db
    .prepare(
      `INSERT INTO prepared_applications (user_id, job_id, content, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, job_id) DO UPDATE SET content = ?3, updated_at = ?4`,
    )
    .bind(gate.user.id, job.id, JSON.stringify(prepared), prepared.generatedAt)
    .run()
  if (!gate.paid) await recordTrialPack(gate.db, gate.user.id, job.id)
  return c.json({ prepared, trial: await getTrialState(gate.db, gate.user.id), paid: gate.paid })
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
  const trialDenied = await enforceTrialPack(c, gate, job.id)
  if (trialDenied) return trialDenied
  const body = await readJson(c)
  const suppliedCvText = typeof body.cvText === 'string' ? body.cvText.slice(0, 30_000) : ''
  const [profile, masterCvText] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    suppliedCvText ? Promise.resolve('') : getMasterCvText(gate.db, gate.user.id),
  ])
  const check = buildCvCheck(job, profile, suppliedCvText || masterCvText)
  if (!gate.paid) await recordTrialPack(gate.db, gate.user.id, job.id)
  return c.json({ check, trial: await getTrialState(gate.db, gate.user.id), paid: gate.paid })
})

proRoutes.post('/jobs/:id/before-you-apply', async (c) => {
  const gate = await requireFeature(c, 'advert_check')
  if (!gate.ok) return gate.response
  const limited = await enforceRateLimit(c, {
    bucket: 'before-you-apply',
    limit: 30,
    windowSeconds: 60,
  })
  if (limited) return limited
  const job = await jobForRequest(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  return c.json({ check: buildAdvertCheckForJob(job) })
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
  const [profile, answers, cv] = await Promise.all([
    getProfile(gate.db, gate.user.id),
    getApplicationAnswers(gate.db, gate.user.id),
    getMasterCv(gate.db, gate.user.id),
  ])
  const effectiveProfile = cv
    ? { ...profile, skills: [...new Set([...profile.skills, ...cv.report.detectedSkills])] }
    : profile
  return c.json({ prep: buildInterviewPrep(job, effectiveProfile, answers) })
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
