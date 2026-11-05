/**
 * FJ's own sign-in. Email and password is the main flow (sign up, sign in,
 * forgot password by emailed reset link). The older six-digit email code
 * endpoints stay available so nobody mid-journey is stranded. Sessions are
 * rolling, the device list supports revocation, and no external sign-in
 * service is involved anywhere.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireUser, unauthorized, readJson, type AppContext } from '../http'
import { enforceRateLimit } from '../ratelimit'
import { emailProviderFromEnv, otpEmail, passwordResetEmail } from '../email/provider'
import { logger } from '../logging'
import { upsertUser } from '../auth/accounts'
import { burnPasswordTime, hashPassword, passwordProblem, verifyPassword } from '../auth/passwords'

const OTP_TTL_MS = 10 * 60_000
const RESET_TTL_MS = 60 * 60_000
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

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Creates a session row and sets the cookie. Shared by every sign-in path. */
async function startSession(c: AppContext, db: D1Database, userId: string): Promise<void> {
  const now = Date.now()
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
}

interface UserRow {
  id: string
  email: string
  password_hash: string | null
}

async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>()
}

authRoutes.post('/auth/signup', async (c) => {
  const limited = await enforceRateLimit(c, {
    bucket: 'password-signup',
    limit: 60,
    windowSeconds: 3600,
  })
  if (limited) return limited
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!EMAIL_PATTERN.test(email)) return c.json({ error: 'bad_email' }, 400)
  const problem = passwordProblem(body.password)
  if (problem) return c.json({ error: 'weak_password', message: problem }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const existing = await findUserByEmail(db, email)
  if (existing) {
    // One plain answer for both cases: an account with a password signs in;
    // an older code-only account sets its first password via forgot-password,
    // which proves inbox ownership before anyone can claim it.
    return c.json({ error: 'account_exists' }, 409)
  }
  const user = await upsertUser(db, email, name || undefined)
  await db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body.password as string), user.id)
    .run()
  await startSession(c as AppContext, db, user.id)
  return c.json({ ok: true, user: publicUser(email) })
})

authRoutes.post('/auth/login', async (c) => {
  const ipLimited = await enforceRateLimit(c, {
    bucket: 'password-login',
    limit: 100,
    windowSeconds: 600,
  })
  if (ipLimited) return ipLimited
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return c.json({ error: 'bad_request' }, 400)
  const emailLimited = await enforceRateLimit(c, {
    bucket: 'password-login-email',
    limit: 50,
    windowSeconds: 3600,
    subject: `email:${email}`,
  })
  if (emailLimited) return emailLimited
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const user = await findUserByEmail(db, email)
  // One identical answer whether the account is missing, has no password yet,
  // or the password is wrong — the response never confirms which emails hold
  // accounts.
  if (!user?.password_hash) {
    await burnPasswordTime(password)
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  if (!(await verifyPassword(password, user.password_hash)))
    return c.json({ error: 'invalid_credentials' }, 401)
  await startSession(c as AppContext, db, user.id)
  return c.json({ ok: true, user: publicUser(email) })
})

authRoutes.post('/auth/password/forgot', async (c) => {
  const limited = await enforceRateLimit(c, {
    bucket: 'password-forgot',
    limit: 10,
    windowSeconds: 600,
  })
  if (limited) return limited
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_PATTERN.test(email)) return c.json({ error: 'bad_email' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const devMode =
    c.env?.APP_MODE === 'test' || c.env?.APP_MODE === 'local' || c.env?.APP_MODE === 'local-preview'
  const user = await findUserByEmail(db, email)
  let devToken: string | undefined
  if (user) {
    const now = Date.now()
    const token = crypto.randomUUID() + crypto.randomUUID()
    devToken = token
    await db
      .prepare(
        `INSERT INTO auth_password_resets (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), user.id, hash(token), now + RESET_TTL_MS, now)
      .run()
    const link = `${new URL(c.req.url).origin}/auth/reset?token=${token}`
    const emailer = emailProviderFromEnv(c.env ?? {})
    // In production with no email sending configured we still answer plainly;
    // the request is recorded and the same flow works the moment sending is
    // switched on. Never reveal whether the account exists either way.
    if (emailer.name !== 'console' || c.env?.APP_MODE !== 'production') {
      await emailer.send({ to: email, ...passwordResetEmail(link) }).catch((error: unknown) => {
        // The public answer stays identical whether the account exists or the
        // send fails, but operators need the safe provider reason. Never log
        // the recipient address or the reset link/token.
        logger.error('password reset email failed', {
          provider: emailer.name,
          error:
            error instanceof Error
              ? error.message
                  .replaceAll(email, '[redacted]')
                  .replaceAll(link, '[redacted]')
                  .slice(0, 300)
              : 'unknown_error',
        })
      })
    }
  }
  // Local and test harnesses read the token from this response so the flow
  // can be exercised without a mail provider. Hosted modes never see it.
  return c.json(devMode && devToken ? { ok: true, devToken } : { ok: true })
})

authRoutes.post('/auth/password/reset', async (c) => {
  const limited = await enforceRateLimit(c, {
    bucket: 'password-reset',
    limit: 20,
    windowSeconds: 600,
  })
  if (limited) return limited
  const body = await readJson(c)
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const problem = passwordProblem(body.password)
  if (problem) return c.json({ error: 'weak_password', message: problem }, 400)
  if (!token) return c.json({ error: 'reset_invalid' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'not_configured' }, 503)
  const now = Date.now()
  const row = await db
    .prepare(
      'SELECT id, user_id, expires_at, used_at FROM auth_password_resets WHERE token_hash = ?',
    )
    .bind(hash(token))
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>()
  if (!row || row.used_at || now > row.expires_at) return c.json({ error: 'reset_invalid' }, 400)
  await db
    .prepare('UPDATE auth_password_resets SET used_at = ? WHERE id = ?')
    .bind(now, row.id)
    .run()
  await db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body.password as string), row.user_id)
    .run()
  // A new password ends every older session, then signs this browser in.
  await db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(now, row.user_id)
    .run()
  const user = await db
    .prepare('SELECT email FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ email: string }>()
  await startSession(c as AppContext, db, row.user_id)
  return c.json({ ok: true, user: user ? publicUser(user.email) : null })
})

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
  await emailer.send({ to: email, ...otpEmail(code) })
  // Dev fallback: local and test harnesses read the code from this response
  // so development is never blocked on a mail provider. APP_MODE is never
  // 'test' or 'local' in a hosted deployment — production and preview can
  // never see a code in a response body.
  const devMode =
    c.env?.APP_MODE === 'test' || c.env?.APP_MODE === 'local' || c.env?.APP_MODE === 'local-preview'
  return c.json(
    devMode
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
  await startSession(c as AppContext, db, user.id)
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
