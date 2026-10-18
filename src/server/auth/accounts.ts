import type { AlertPreference, Profile, SavedApplication } from '../../shared/types'

export interface AccountUser {
  id: string
  email: string
  displayName: string | null
  createdAt: string
}

export interface Subscription {
  id: string
  userId: string
  provider: string
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  plan: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface AccountSnapshot {
  user: AccountUser
  profile: Profile
  saved: SavedApplication[]
  alerts: AlertPreference[]
  subscription: Subscription | null
  entitlements: string[]
}

const encoder = new TextEncoder()

/**
 * A stable, opaque id for an account. Derived from the email so the same
 * person keeps the same id across Access applications and deployments.
 */
export async function userIdFor(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(email.toLowerCase()))
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `usr_${hex}`
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    return list(JSON.parse(raw))
  } catch {
    return []
  }
}

export async function upsertUser(
  db: D1Database,
  email: string,
  displayName?: string,
): Promise<AccountUser> {
  const id = await userIdFor(email)
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?4, ?4)
       ON CONFLICT(id) DO UPDATE SET email = ?2, display_name = COALESCE(?3, users.display_name),
         updated_at = ?4, last_seen_at = ?4`,
    )
    .bind(id, email.toLowerCase(), displayName ?? null, now)
    .run()

  const row = await db
    .prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ?1')
    .bind(id)
    .first<{ id: string; email: string; display_name: string | null; created_at: string }>()

  if (!row) throw new Error('user row disappeared immediately after upsert')

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  }
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile> {
  const row = await db
    .prepare(
      `SELECT skills, target_role_families, target_seniority, preferred_work_modes, work_country
       FROM profiles WHERE user_id = ?1`,
    )
    .bind(userId)
    .first<{
      skills: string
      target_role_families: string
      target_seniority: string
      preferred_work_modes: string
      work_country: string | null
    }>()

  if (!row) {
    return {
      skills: [],
      targetRoleFamilies: [],
      targetSeniority: [],
      preferredWorkModes: [],
      workCountry: '',
    }
  }

  return {
    skills: parseList(row.skills),
    targetRoleFamilies: parseList(row.target_role_families),
    targetSeniority: parseList(row.target_seniority) as Profile['targetSeniority'],
    preferredWorkModes: parseList(row.preferred_work_modes) as Profile['preferredWorkModes'],
    workCountry: row.work_country ?? '',
  }
}

export async function saveProfile(db: D1Database, userId: string, profile: Profile): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profiles (user_id, skills, target_role_families, target_seniority,
        preferred_work_modes, work_country, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id) DO UPDATE SET skills = ?2, target_role_families = ?3,
         target_seniority = ?4, preferred_work_modes = ?5, work_country = ?6, updated_at = ?7`,
    )
    .bind(
      userId,
      JSON.stringify(profile.skills),
      JSON.stringify(profile.targetRoleFamilies),
      JSON.stringify(profile.targetSeniority),
      JSON.stringify(profile.preferredWorkModes),
      profile.workCountry || null,
      new Date().toISOString(),
    )
    .run()
}

export async function listSaved(db: D1Database, userId: string): Promise<SavedApplication[]> {
  const result = await db
    .prepare(
      `SELECT job_id, status, note, created_at FROM saved_jobs
       WHERE user_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<{ job_id: string; status: string; note: string | null; created_at: string }>()

  return (result.results ?? []).map((row) => ({
    jobId: row.job_id,
    savedAt: row.created_at,
    status: row.status === 'applied' ? 'applied' : 'saved',
    note: row.note ?? undefined,
  }))
}

export async function setSaved(
  db: D1Database,
  userId: string,
  jobId: string,
  status: 'saved' | 'applied',
  note?: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO saved_jobs (user_id, job_id, status, note, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(user_id, job_id) DO UPDATE SET status = ?3,
         note = COALESCE(?4, saved_jobs.note), updated_at = ?5`,
    )
    .bind(userId, jobId, status, note ?? null, now)
    .run()
}

export async function removeSaved(db: D1Database, userId: string, jobId: string): Promise<void> {
  await db
    .prepare('DELETE FROM saved_jobs WHERE user_id = ?1 AND job_id = ?2')
    .bind(userId, jobId)
    .run()
}

export async function listAlerts(db: D1Database, userId: string): Promise<AlertPreference[]> {
  const result = await db
    .prepare(
      `SELECT id, label, query, channels, enabled, created_at FROM alerts
       WHERE user_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string
      label: string
      query: string | null
      channels: string
      enabled: number
      created_at: string
    }>()

  return (result.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    query: row.query ?? '',
    channels: parseList(row.channels),
    enabled: Boolean(row.enabled),
  }))
}

export async function createAlert(
  db: D1Database,
  userId: string,
  alert: AlertPreference,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO alerts (id, user_id, label, query, channels, enabled, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      alert.id,
      userId,
      alert.label,
      alert.query || null,
      JSON.stringify(alert.channels),
      alert.enabled ? 1 : 0,
      new Date().toISOString(),
    )
    .run()
}

export async function updateAlert(
  db: D1Database,
  userId: string,
  id: string,
  patch: Partial<AlertPreference>,
): Promise<void> {
  const current = await db
    .prepare(
      'SELECT id, label, query, channels, enabled FROM alerts WHERE id = ?1 AND user_id = ?2',
    )
    .bind(id, userId)
    .first<{ id: string; label: string; query: string | null; channels: string; enabled: number }>()

  if (!current) return

  await db
    .prepare(
      `UPDATE alerts SET label = ?1, query = ?2, channels = ?3, enabled = ?4, updated_at = ?5
       WHERE id = ?6 AND user_id = ?7`,
    )
    .bind(
      patch.label ?? current.label,
      patch.query ?? current.query,
      JSON.stringify(patch.channels ?? parseList(current.channels)),
      (patch.enabled ?? Boolean(current.enabled)) ? 1 : 0,
      new Date().toISOString(),
      id,
      userId,
    )
    .run()
}

export async function deleteAlert(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM alerts WHERE id = ?1 AND user_id = ?2').bind(id, userId).run()
}

export async function getSubscription(
  db: D1Database,
  userId: string,
): Promise<Subscription | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, provider, provider_customer_id, provider_subscription_id, plan, status,
        current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ?1`,
    )
    .bind(userId)
    .first<{
      id: string
      user_id: string
      provider: string
      provider_customer_id: string | null
      provider_subscription_id: string | null
      plan: string
      status: string
      current_period_end: string | null
      cancel_at_period_end: number
    }>()

  if (!row) return null

  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  }
}

export async function upsertSubscription(
  db: D1Database,
  subscription: Subscription,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO subscriptions (id, user_id, provider, provider_customer_id, provider_subscription_id,
        plan, status, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
       ON CONFLICT(user_id) DO UPDATE SET provider = ?3, provider_customer_id = ?4,
         provider_subscription_id = ?5, plan = ?6, status = ?7, current_period_end = ?8,
         cancel_at_period_end = ?9, updated_at = ?10`,
    )
    .bind(
      subscription.id,
      subscription.userId,
      subscription.provider,
      subscription.providerCustomerId,
      subscription.providerSubscriptionId,
      subscription.plan,
      subscription.status,
      subscription.currentPeriodEnd,
      subscription.cancelAtPeriodEnd ? 1 : 0,
      now,
    )
    .run()
}

export async function getEntitlements(db: D1Database, userId: string): Promise<string[]> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `SELECT feature FROM entitlements WHERE user_id = ?1
         AND (expires_at IS NULL OR expires_at > ?2) ORDER BY feature`,
    )
    .bind(userId, now)
    .all<{ feature: string }>()
  return (result.results ?? []).map((row) => row.feature)
}

export async function setEntitlements(
  db: D1Database,
  userId: string,
  features: string[],
  expiresAt: string | null = null,
): Promise<void> {
  await db.prepare('DELETE FROM entitlements WHERE user_id = ?1').bind(userId).run()
  const now = new Date().toISOString()
  for (const feature of features) {
    await db
      .prepare(
        `INSERT INTO entitlements (user_id, feature, granted_at, expires_at)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, feature) DO UPDATE SET
         granted_at = ?3, expires_at = ?4`,
      )
      .bind(userId, feature, now, expiresAt)
      .run()
  }
}

export async function recordAudit(
  db: D1Database,
  userId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_log (id, user_id, action, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(
      `aud_${crypto.randomUUID()}`,
      userId,
      action,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run()
}

export async function loadAccount(db: D1Database, userId: string): Promise<AccountSnapshot> {
  const [userRow, profile, saved, alerts, subscription, entitlements] = await Promise.all([
    db
      .prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ?1')
      .bind(userId)
      .first<{ id: string; email: string; display_name: string | null; created_at: string }>(),
    getProfile(db, userId),
    listSaved(db, userId),
    listAlerts(db, userId),
    getSubscription(db, userId),
    getEntitlements(db, userId),
  ])

  if (!userRow) throw new Error('account not found')

  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      createdAt: userRow.created_at,
    },
    profile,
    saved,
    alerts,
    subscription,
    entitlements,
  }
}

/** Binds a Telegram chat to an account. */
export async function linkTelegram(db: D1Database, userId: string, chatId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET telegram_chat_id = ?2, telegram_linked_at = ?3, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(userId, String(chatId), new Date().toISOString())
    .run()
}

export async function getTelegramChatId(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT telegram_chat_id FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ telegram_chat_id: string | null }>()
  if (!row?.telegram_chat_id) return null
  const value = Number(row.telegram_chat_id)
  return Number.isFinite(value) ? value : null
}

export async function findUserByTelegramChatId(
  db: D1Database,
  chatId: number,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM users WHERE telegram_chat_id = ?1')
    .bind(String(chatId))
    .first<{ id: string }>()
  return row?.id ?? null
}

/** Every linked account, used when a matching role needs delivering. */
export async function listTelegramSubscribers(
  db: D1Database,
): Promise<{ userId: string; chatId: number }[]> {
  const result = await db
    .prepare('SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL')
    .all<{ id: string; telegram_chat_id: string }>()

  return (result.results ?? [])
    .map((row) => ({ userId: row.id, chatId: Number(row.telegram_chat_id) }))
    .filter((entry) => Number.isFinite(entry.chatId))
}
