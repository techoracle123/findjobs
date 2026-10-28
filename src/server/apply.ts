import {
  FREE_FAST_APPLY_PER_DAY,
  FREE_FAST_APPLY_PER_WEEK,
  lagosDayKey,
  lagosWeekKeys,
  nextLagosMidnight,
  type ApplyQuotaState,
} from '../shared/apply'

export const ANON_COOKIE = 'fj_anon'
const ANON_COOKIE_MAX_AGE = 90 * 86_400

type SubjectKind = 'user' | 'anon'

export interface ApplySubject {
  kind: SubjectKind
  id: string
  userId: string | null
  anonId: string | null
}

/** The daily Fast Apply limits count fast_apply only; external clicks never do. */
export function readAnonCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === ANON_COOKIE && rest.length) return rest.join('=').trim().slice(0, 64)
  }
  return null
}

export function anonCookieHeader(anonId: string, secure: boolean): string {
  return [
    `${ANON_COOKIE}=${anonId}`,
    'Path=/',
    `Max-Age=${ANON_COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

/**
 * Signed-in people are keyed by account. Everyone else is keyed by a random
 * browser id in an httpOnly cookie, so one person cannot open a new quota by
 * reloading or by clearing a JS-visible id.
 */
export function applySubject(userId: string | null, anonId: string | null): ApplySubject {
  if (userId) return { kind: 'user', id: userId, userId, anonId }
  const id = anonId || `anon_${crypto.randomUUID()}`
  return { kind: 'anon', id, userId: null, anonId: id }
}

async function dayUsed(
  db: D1Database,
  kind: SubjectKind,
  id: string,
  dayKey: string,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT used FROM apply_quotas WHERE subject_type = ?1 AND subject_id = ?2 AND window_date = ?3',
    )
    .bind(kind, id, dayKey)
    .first<{ used: number }>()
  return row?.used ?? 0
}

/**
 * On sign-in the anonymous counter is merged into the account counter by
 * taking the maximum per day, never the sum: one person must not gain quota
 * by applying signed-out and then signing in.
 */
export async function mergeAnonQuota(
  db: D1Database,
  userId: string,
  anonId: string | null,
  now: number = Date.now(),
): Promise<void> {
  if (!anonId || anonId === userId) return
  for (const dayKey of lagosWeekKeys(now)) {
    const userUsed = await dayUsed(db, 'user', userId, dayKey)
    const anonUsed = await dayUsed(db, 'anon', anonId, dayKey)
    if (anonUsed > userUsed) {
      await db
        .prepare(
          `INSERT INTO apply_quotas (subject_type, subject_id, window_date, used) VALUES ('user', ?1, ?2, ?3)
           ON CONFLICT(subject_type, subject_id, window_date) DO UPDATE SET used = ?3`,
        )
        .bind(userId, dayKey, anonUsed)
        .run()
    }
  }
}

export async function fastApplyQuota(
  db: D1Database,
  subject: ApplySubject,
  entitled: boolean,
  now: number = Date.now(),
): Promise<ApplyQuotaState> {
  const today = lagosDayKey(now)
  const used = await dayUsed(db, subject.kind, subject.id, today)
  let weekUsed = 0
  for (const dayKey of lagosWeekKeys(now))
    weekUsed += await dayUsed(db, subject.kind, subject.id, dayKey)
  const remaining = entitled ? Infinity : Math.max(0, FREE_FAST_APPLY_PER_DAY - used)
  return {
    unlimited: entitled,
    limit: FREE_FAST_APPLY_PER_DAY,
    used,
    remaining: Number.isFinite(remaining) ? remaining : FREE_FAST_APPLY_PER_DAY,
    resetsAt: nextLagosMidnight(today, now),
    weekLimit: FREE_FAST_APPLY_PER_WEEK,
    weekUsed,
  }
}

/**
 * Attempts to consume one Fast Apply credit. Returns null when allowed, or
 * the current state when either cap is exhausted. Entitled users skip both
 * counters entirely.
 */
export async function consumeFastApply(
  db: D1Database,
  subject: ApplySubject,
  entitled: boolean,
  now: number = Date.now(),
): Promise<ApplyQuotaState | null> {
  if (entitled) return null
  const today = lagosDayKey(now)
  const before = await fastApplyQuota(db, subject, false, now)
  if (before.used >= FREE_FAST_APPLY_PER_DAY) return before
  if (before.weekUsed >= FREE_FAST_APPLY_PER_WEEK) return before

  await db
    .prepare(
      `INSERT INTO apply_quotas (subject_type, subject_id, window_date, used) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT(subject_type, subject_id, window_date) DO UPDATE SET used = used + 1`,
    )
    .bind(subject.kind, subject.id, today)
    .run()
  return null
}

export async function recordApplyEvent(
  db: D1Database,
  subject: ApplySubject,
  mode: 'fast_apply' | 'external_click',
  jobId: string,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO apply_events (id, user_id, anon_id, job_id, mode, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
    .bind(
      `app_${crypto.randomUUID()}`,
      subject.userId,
      subject.anonId,
      jobId.slice(0, 128),
      mode,
      new Date(now).toISOString(),
    )
    .run()
}
