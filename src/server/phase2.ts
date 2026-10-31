import type {
  GraduateEligibilityInput,
  GraduateEligibilityState,
  MasterCv,
  ProTrialState,
  Profile,
} from '../shared/types'

export const TRIAL_DAYS = 3
export const TRIAL_CV_ANALYSIS_LIMIT = 1
export const TRIAL_APPLICATION_PACK_LIMIT = 3

const DAY_MS = 86_400_000

function trialCounts(kindRows: { kind: string; n: number }[], kind: string): number {
  return kindRows.find((row) => row.kind === kind)?.n ?? 0
}

export async function getTrialState(
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<ProTrialState> {
  const fallback: ProTrialState = {
    status: 'not_started',
    startedAt: null,
    endsAt: null,
    cvAnalysesUsed: 0,
    applicationPacksUsed: 0,
    limits: {
      days: TRIAL_DAYS,
      cvAnalyses: TRIAL_CV_ANALYSIS_LIMIT,
      applicationPacks: TRIAL_APPLICATION_PACK_LIMIT,
    },
  }
  try {
    const trial = await db
      .prepare('SELECT started_at, ends_at FROM pro_trials WHERE user_id = ?1')
      .bind(userId)
      .first<{ started_at: string; ends_at: string }>()
    if (!trial) return fallback
    const usage = await db
      .prepare('SELECT kind, COUNT(*) AS n FROM pro_trial_usage WHERE user_id = ?1 GROUP BY kind')
      .bind(userId)
      .all<{ kind: string; n: number }>()
    const rows = usage.results ?? []
    return {
      status: Date.parse(trial.ends_at) > now ? 'active' : 'expired',
      startedAt: trial.started_at,
      endsAt: trial.ends_at,
      cvAnalysesUsed: trialCounts(rows, 'cv_analysis'),
      applicationPacksUsed: trialCounts(rows, 'application_pack'),
      limits: fallback.limits,
    }
  } catch {
    return fallback
  }
}

export async function startTrial(
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<ProTrialState> {
  const current = await getTrialState(db, userId, now)
  if (current.status !== 'not_started') return current
  const startedAt = new Date(now).toISOString()
  const endsAt = new Date(now + TRIAL_DAYS * DAY_MS).toISOString()
  await db
    .prepare('INSERT OR IGNORE INTO pro_trials (user_id, started_at, ends_at) VALUES (?1, ?2, ?3)')
    .bind(userId, startedAt, endsAt)
    .run()
  return getTrialState(db, userId, now)
}

async function trialUsageExists(
  db: D1Database,
  userId: string,
  kind: string,
  referenceId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 AS found FROM pro_trial_usage WHERE user_id = ?1 AND kind = ?2 AND reference_id = ?3',
    )
    .bind(userId, kind, referenceId)
    .first<{ found: number }>()
    .catch(() => null)
  return Boolean(row)
}

export async function canUseTrialPack(
  db: D1Database,
  userId: string,
  jobId: string,
): Promise<boolean> {
  if (await trialUsageExists(db, userId, 'application_pack', jobId)) return true
  const state = await getTrialState(db, userId)
  return state.status === 'active' && state.applicationPacksUsed < TRIAL_APPLICATION_PACK_LIMIT
}

export async function recordTrialPack(
  db: D1Database,
  userId: string,
  jobId: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO pro_trial_usage (user_id, kind, reference_id) VALUES (?1, ?2, ?3)',
    )
    .bind(userId, 'application_pack', jobId)
    .run()
    .catch(() => undefined)
}

export async function canUseTrialCvAnalysis(
  db: D1Database,
  userId: string,
  textHash: string,
): Promise<boolean> {
  if (await trialUsageExists(db, userId, 'cv_analysis', textHash)) return true
  const state = await getTrialState(db, userId)
  return state.status === 'active' && state.cvAnalysesUsed < TRIAL_CV_ANALYSIS_LIMIT
}

export async function recordTrialCvAnalysis(
  db: D1Database,
  userId: string,
  textHash: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO pro_trial_usage (user_id, kind, reference_id) VALUES (?1, ?2, ?3)',
    )
    .bind(userId, 'cv_analysis', textHash)
    .run()
    .catch(() => undefined)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* ---------------------------- Graduate price ---------------------------- */

const GRADUATE_STATUSES = new Set([
  'final_year',
  'recent_graduate',
  'nysc_current',
  'nysc_recent',
  'worker',
])
const EXPERIENCE_BANDS = new Set(['none', 'under_1_year', '1_to_2_years', 'over_2_years'])

function cleanMonth(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const month = value.trim().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const year = Number(month.slice(0, 4))
  return year >= 1950 && year <= 2100 ? month : null
}

export function normaliseGraduateInput(input: unknown): GraduateEligibilityInput {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    status:
      typeof raw.status === 'string' && GRADUATE_STATUSES.has(raw.status)
        ? (raw.status as GraduateEligibilityInput['status'])
        : 'worker',
    educationMonth: cleanMonth(raw.educationMonth),
    nyscMonth: cleanMonth(raw.nyscMonth),
    fullTimeExperience:
      typeof raw.fullTimeExperience === 'string' && EXPERIENCE_BANDS.has(raw.fullTimeExperience)
        ? (raw.fullTimeExperience as GraduateEligibilityInput['fullTimeExperience'])
        : 'over_2_years',
    declared: raw.declared === true,
  }
}

function monthAge(month: string | null, now: Date): number | null {
  if (!month) return null
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - monthNumber)
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function addMonthsToMonth(month: string, months: number): Date {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  return addMonths(date, months)
}

export interface CvGraduateSignals {
  educationYears: number[]
  estimatedFullTimeMonths: number | null
  seniorRoleWords: boolean
}

export function cvGraduateSignals(cvText: string): CvGraduateSignals {
  const text = cvText.slice(0, 60_000)
  const lower = text.toLowerCase()
  const educationYears: number[] = []
  const educationBlocks =
    lower.match(
      /(?:education|university|polytechnic|college|b\.?sc|b\.?a\.?|hnd|ond|degree)[\s\S]{0,500}?(20\d{2}|19\d{2})/gi,
    ) ?? []
  for (const block of educationBlocks) {
    for (const match of block.matchAll(/\b(19\d{2}|20\d{2})\b/g))
      educationYears.push(Number(match[1]))
  }

  let estimatedFullTimeMonths: number | null = null
  const ranges = [
    ...text.matchAll(
      /\b(19\d{2}|20\d{2})\s*(?:-|–|—|to)\s*(19\d{2}|20\d{2}|present|current|now)\b/gi,
    ),
  ]
  if (ranges.length) {
    const currentYear = new Date().getUTCFullYear()
    estimatedFullTimeMonths = ranges.reduce((sum, match) => {
      const start = Number(match[1])
      const endRaw = match[2].toLowerCase()
      const end = /present|current|now/.test(endRaw) ? currentYear : Number(endRaw)
      return sum + Math.max(0, Math.min(50, end - start)) * 12
    }, 0)
  }

  return {
    educationYears: [...new Set(educationYears)].sort((a, b) => b - a),
    estimatedFullTimeMonths,
    seniorRoleWords:
      /\b(?:chief|director|head of|principal|staff|senior manager|engineering manager)\b/i.test(
        text,
      ),
  }
}

/**
 * Graduate-price decision. This is deliberately explainable: a recent
 * tertiary/NYSC status plus under two years of full-time work. Proof is only
 * requested when declaration, profile and optional CV signals conflict.
 */
export function evaluateGraduateEligibility(
  input: GraduateEligibilityInput,
  profile?: Profile,
  cvText = '',
  now = new Date(),
): GraduateEligibilityState {
  const reasons: string[] = []
  const flags: string[] = []
  let statusPasses = false
  let statusKnown = true
  let statusExpiry: Date | null = null

  if (input.status === 'worker') {
    reasons.push('You selected the ordinary worker category.')
  } else if (input.status === 'final_year') {
    const age = monthAge(input.educationMonth, now)
    if (age === null) {
      statusKnown = false
      flags.push('Expected completion month is missing.')
    } else if (age <= 0 && age >= -24) {
      statusPasses = true
      reasons.push('You are in your final year of tertiary study.')
      statusExpiry = addMonthsToMonth(input.educationMonth!, 24)
    } else if (age > 0 && age <= 24) {
      statusPasses = true
      reasons.push('Your completion date is within the recent-graduate window.')
      statusExpiry = addMonthsToMonth(input.educationMonth!, 24)
    } else {
      reasons.push('The expected completion date is outside the graduate-price window.')
    }
  } else if (input.status === 'recent_graduate') {
    const age = monthAge(input.educationMonth, now)
    if (age === null) {
      statusKnown = false
      flags.push('Tertiary completion month is missing.')
    } else if (age >= 0 && age <= 24) {
      statusPasses = true
      reasons.push('You completed tertiary education within the last 24 months.')
      statusExpiry = addMonthsToMonth(input.educationMonth!, 24)
    } else {
      reasons.push('Tertiary completion was more than 24 months ago.')
    }
  } else if (input.status === 'nysc_current') {
    statusPasses = true
    reasons.push('You are currently serving in NYSC.')
    statusExpiry = addMonths(now, 12)
  } else if (input.status === 'nysc_recent') {
    const age = monthAge(input.nyscMonth, now)
    if (age === null) {
      statusKnown = false
      flags.push('NYSC completion month is missing.')
    } else if (age >= 0 && age <= 12) {
      statusPasses = true
      reasons.push('You completed NYSC within the last 12 months.')
      statusExpiry = addMonthsToMonth(input.nyscMonth!, 12)
    } else {
      reasons.push('NYSC was completed more than 12 months ago.')
    }
  }

  const experiencePasses = input.fullTimeExperience !== 'over_2_years'
  if (!experiencePasses)
    reasons.push('The graduate price is for people with under two years of full-time paid work.')
  if (!input.declared) flags.push('Eligibility declaration has not been confirmed.')

  if (profile?.targetSeniority.some((level) => ['staff', 'lead', 'principal'].includes(level))) {
    flags.push('Your profile targets a senior leadership level.')
  }

  if (cvText.trim().length >= 80) {
    const signals = cvGraduateSignals(cvText)
    if (signals.estimatedFullTimeMonths !== null && signals.estimatedFullTimeMonths > 30) {
      flags.push('The dates on the supplied CV suggest more than two years of work history.')
    }
    if (signals.seniorRoleWords)
      flags.push('The supplied CV contains senior leadership role wording.')
    const declaredYear = input.educationMonth ? Number(input.educationMonth.slice(0, 4)) : null
    const cvYear = signals.educationYears[0] ?? null
    if (declaredYear && cvYear && Math.abs(declaredYear - cvYear) > 1) {
      flags.push('The education year on the supplied CV differs from the date entered.')
    }
  }

  const passes = statusPasses && experiencePasses
  const result: GraduateEligibilityState['result'] = !passes
    ? statusKnown && experiencePasses
      ? 'not_eligible'
      : !experiencePasses
        ? 'not_eligible'
        : 'review'
    : flags.length
      ? 'review'
      : 'eligible'

  if (result === 'eligible') reasons.push('Your answers match the graduate-price rules.')
  if (result === 'review')
    reasons.push(
      'One or more answers need a quick evidence check before the discount can be confirmed.',
    )

  const approvalExpiry = addMonths(now, 12)
  const eligibleUntil =
    result === 'eligible'
      ? (statusExpiry && statusExpiry < approvalExpiry
          ? statusExpiry
          : approvalExpiry
        ).toISOString()
      : null

  return {
    ...input,
    result,
    reasons: [...new Set(reasons)],
    flags: [...new Set(flags)],
    eligibleUntil,
    checkedAt: now.toISOString(),
    proofStatus: result === 'review' ? 'requested' : 'not_requested',
  }
}

function parseJsonList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export async function getGraduateEligibility(
  db: D1Database,
  userId: string,
): Promise<GraduateEligibilityState | null> {
  try {
    const row = await db
      .prepare(
        `SELECT status, education_month, nysc_month, full_time_experience, declared, result,
          reasons, flags, eligible_until, proof_status, checked_at
         FROM graduate_eligibility WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<{
        status: string
        education_month: string | null
        nysc_month: string | null
        full_time_experience: string
        declared: number
        result: string
        reasons: string
        flags: string
        eligible_until: string | null
        proof_status: string
        checked_at: string
      }>()
    if (!row) return null
    return {
      status: row.status as GraduateEligibilityInput['status'],
      educationMonth: row.education_month,
      nyscMonth: row.nysc_month,
      fullTimeExperience:
        row.full_time_experience as GraduateEligibilityInput['fullTimeExperience'],
      declared: Boolean(row.declared),
      result: row.result as GraduateEligibilityState['result'],
      reasons: parseJsonList(row.reasons),
      flags: parseJsonList(row.flags),
      eligibleUntil: row.eligible_until,
      checkedAt: row.checked_at,
      proofStatus: row.proof_status as GraduateEligibilityState['proofStatus'],
    }
  } catch {
    return null
  }
}

export async function saveGraduateEligibility(
  db: D1Database,
  userId: string,
  state: GraduateEligibilityState,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO graduate_eligibility (
        user_id, status, education_month, nysc_month, full_time_experience, declared,
        result, reasons, flags, eligible_until, proof_status, checked_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
      ON CONFLICT(user_id) DO UPDATE SET status = ?2, education_month = ?3, nysc_month = ?4,
        full_time_experience = ?5, declared = ?6, result = ?7, reasons = ?8, flags = ?9,
        eligible_until = ?10, proof_status = ?11, checked_at = ?12, updated_at = ?12`,
    )
    .bind(
      userId,
      state.status,
      state.educationMonth,
      state.nyscMonth,
      state.fullTimeExperience,
      state.declared ? 1 : 0,
      state.result,
      JSON.stringify(state.reasons),
      JSON.stringify(state.flags),
      state.eligibleUntil,
      state.proofStatus,
      state.checkedAt,
    )
    .run()
}

/* ------------------------------ Master CV ------------------------------ */

export async function getMasterCv(
  db: D1Database,
  userId: string,
  includeText = false,
): Promise<MasterCv | null> {
  try {
    const row = await db
      .prepare(
        'SELECT file_name, file_type, cv_text, text_hash, report, created_at, updated_at FROM master_cvs WHERE user_id = ?1',
      )
      .bind(userId)
      .first<{
        file_name: string
        file_type: string
        cv_text: string
        text_hash: string
        report: string
        created_at: string
        updated_at: string
      }>()
    if (!row) return null
    return {
      fileName: row.file_name,
      fileType: row.file_type,
      textHash: row.text_hash,
      report: JSON.parse(row.report) as MasterCv['report'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(includeText ? { text: row.cv_text } : {}),
    }
  } catch {
    return null
  }
}

export async function getMasterCvText(db: D1Database, userId: string): Promise<string> {
  const cv = await getMasterCv(db, userId, true)
  return cv?.text ?? ''
}

export async function saveMasterCv(
  db: D1Database,
  userId: string,
  cv: MasterCv & { text: string },
): Promise<void> {
  const current = await getMasterCv(db, userId)
  const createdAt = current?.createdAt ?? cv.createdAt
  await db
    .prepare(
      `INSERT INTO master_cvs (user_id, file_name, file_type, cv_text, text_hash, report, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(user_id) DO UPDATE SET file_name = ?2, file_type = ?3, cv_text = ?4,
         text_hash = ?5, report = ?6, updated_at = ?8`,
    )
    .bind(
      userId,
      cv.fileName,
      cv.fileType,
      cv.text,
      cv.textHash,
      JSON.stringify(cv.report),
      createdAt,
      cv.updatedAt,
    )
    .run()
}

export async function deleteMasterCv(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare('DELETE FROM master_cvs WHERE user_id = ?1')
    .bind(userId)
    .run()
    .catch(() => undefined)
}
