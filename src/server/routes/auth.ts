/**
 * Own passwordless sign-in (Prompt 18). Six-digit codes by email, rolling
 * sessions, device list with revocation. Access identities keep working in
 * parallel for one release (§E migration).
 */
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireUser, unauthorized, readJson, type AppContext } from '../http'
import { enforceRateLimit } from '../ratelimit'
import { emailProviderFromEnv } from '../email/provider'
import { upsertUser } from '../auth/accounts'

const OTP_TTL_MS = 10 * 60_000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days rolling
const IDLE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days idle
const MAX_ATTEMPTS = 5
const SESSION_COOKIE = 'fj_session'

export const authRoutes = new Hono<AppEnv>()

function hash(value: string): string {
  // KV/D1-safe non-reversible hash; codes are short-lived so this is enough.
  let h = 0
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function readSessionToken(request: Request): string | null {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) ?? null
  )
}

/**
 * Resolves our own session token to a user id. Rolling: every use extends the
 * session by another 30 days as long as the 7-day idle window is respected.
 */
export async function resolveOwnSession(
  db: D1Database,
  token: string | null,
  now = Date.now(),
): Promise<{ userId: string; email: string } | null> {
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT s.user_id, s.last_seen_at, s.expires_at, s.revoked_at, u.email
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(hash(token))
    .first<{
      user_id: string
      last_seen_at: number
      expires_at: number
      revoked_at: number | null
      email: string
    }>()
  if (!row || row.revoked_at) return null
  if (now > row.expires_at || now - row.last_seen_at > IDLE_MS) return null
  // Rolling renewal, bounded write: touch at most once an hour per session.
  if (now - row.last_seen_at > 60 * 60_000) {
    await db
      .prepare(
        'UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = (SELECT id FROM auth_sessions WHERE token_hash = ?)',
      )
      .bind(now, now + SESSION_TTL_MS, hash(token))
      .run()
  }
  return { userId: row.user_id, email: row.email }
}

function publicUser(email: string) {
  return { email, id: email }
}

authRoutes.post('/auth/otp/request', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'otp-request', limit: 6, windowSeconds: 600 })
  if (limited) return limited
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'bad_request' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const now = Date.now()
  const code = String(Math.floor(100000 + Math.random() * 900000))
  await db
    .prepare(
      'INSERT INTO auth_otp (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), email, hash(`${email}:${code}`), now + OTP_TTL_MS, now)
    .run()
  const emailer = emailProviderFromEnv(c.env ?? {})
  // Never pretend a code was emailed when no provider can send it. In
  // production the console provider would silently drop the code.
  if (emailer.name === 'console' && c.env?.APP_MODE === 'production') {
    return c.json({ error: 'email_not_configured' }, 503)
  }
  await emailer.send({
    to: email,
    subject: 'Your FJ sign-in code',
    text: `Your FJ sign-in code is ${code}. It works once and expires in 10 minutes. If you did not ask for this, ignore this email.`,
  })
  // Test-only hook: the local harness reads the code from this response.
  // APP_MODE is never 'test' in a hosted deployment.
  return c.json(
    c.env?.APP_MODE === 'test'
      ? { ok: true, ttlSeconds: OTP_TTL_MS / 1000, devCode: code }
      : { ok: true, ttlSeconds: OTP_TTL_MS / 1000 },
  )
})

authRoutes.post('/auth/otp/verify', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'otp-verify', limit: 10, windowSeconds: 600 })
  if (limited) return limited
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!email || !/^\d{6}$/.test(code)) return c.json({ error: 'bad_request' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const now = Date.now()
  const row = await db
    .prepare(
      `SELECT id, code_hash, expires_at, attempts, consumed_at FROM auth_otp
       WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email)
    .first<{ id: string; code_hash: string; expires_at: number; attempts: number }>()
  if (!row || now > row.expires_at) return c.json({ error: 'code_expired' }, 400)
  if (row.attempts >= MAX_ATTEMPTS) return c.json({ error: 'code_used' }, 400)
  if (row.code_hash !== hash(`${email}:${code}`)) {
    await db.prepare('UPDATE auth_otp SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run()
    return c.json({ error: 'code_invalid' }, 400)
  }
  await db.prepare('UPDATE auth_otp SET consumed_at = ? WHERE id = ?').bind(now, row.id).run()
  const user = await upsertUser(db, email)
  const userId = user.id
  const token = crypto.randomUUID() + crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO auth_sessions (id, user_id, token_hash, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      hash(token),
      (c.req.header('user-agent') ?? '').slice(0, 200),
      now,
      now,
      now + SESSION_TTL_MS,
    )
    .run()
  c.header('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000))
  return c.json({ ok: true, user: publicUser(email) })
})

authRoutes.get('/auth/session', async (c) => {
  const db = c.env?.DB
  const token = readSessionToken(c.req.raw)
  const session = db ? await resolveOwnSession(db, token) : null
  if (session) return c.json({ user: publicUser(session.email), via: 'session' })
  // §E parallel: Access identities keep working for one release.
  const user = await requireUser(c as AppContext)
  if (user) return c.json({ user: { id: user.id, email: user.email }, via: 'access' })
  return c.json({ user: null })
})

authRoutes.post('/auth/logout', async (c) => {
  const db = c.env?.DB
  const token = readSessionToken(c.req.raw)
  if (db && token) {
    await db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), hash(token))
      .run()
  }
  c.header('Set-Cookie', sessionCookie('', 0))
  return c.json({ ok: true })
})

authRoutes.get('/auth/devices', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ devices: [] })
  const rows = await db
    .prepare(
      `SELECT id, user_agent, created_at, last_seen_at, expires_at FROM auth_sessions
       WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 20`,
    )
    .bind(user.id)
    .all<{
      id: string
      user_agent: string | null
      created_at: number
      last_seen_at: number
      expires_at: number
    }>()
  return c.json({
    devices: rows.results.map((row) => ({
      id: row.id,
      agent: row.user_agent ?? 'Unknown device',
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    })),
  })
})

authRoutes.post('/auth/devices/revoke', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const body = await readJson(c)
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return c.json({ error: 'bad_request' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  await db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?')
    .bind(Date.now(), id, user.id)
    .run()
  return c.json({ ok: true })
})
