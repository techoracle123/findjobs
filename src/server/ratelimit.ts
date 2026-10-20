import type { AppContext } from './http'
import { requestId } from './http'

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

export interface RateLimitOptions {
  /** Maximum number of requests allowed inside the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
  /** Distinguishes one bucket from another, e.g. "cv" or "score". */
  bucket: string
  /** Overrides the identity used to build the key. */
  subject?: string
}

/**
 * A fixed-window limiter backed by D1.
 *
 * The window is deliberately simple. It is enough to stop a single client
 * hammering an expensive endpoint, which is what the AI suggestion route
 * needs; it is not a defence against a distributed attacker, and should not
 * be described as one.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = new Date(now - options.windowSeconds * 1000).toISOString()

  const existing = await db
    .prepare('SELECT count, window_start FROM rate_limits WHERE key = ?1')
    .bind(key)
    .first<{ count: number; window_start: string }>()

  if (!existing || existing.window_start <= windowStart) {
    const resetAt = now + options.windowSeconds * 1000
    await db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = ?2`,
      )
      .bind(key, new Date(now).toISOString())
      .run()
    return { allowed: true, limit: options.limit, remaining: options.limit - 1, resetAt }
  }

  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?1').bind(key).run()

  const used = existing.count + 1
  const resetAt = Date.parse(existing.window_start) + options.windowSeconds * 1000

  return {
    allowed: used <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - used),
    resetAt,
  }
}

/**
 * The identity a rate limit is applied to. Signed-in users are limited per
 * account; anonymous callers are limited per address.
 */
export function rateLimitSubject(c: AppContext): string {
  const userId = c.get('userId')
  if (userId) return `user:${userId}`
  const address = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
  return `ip:${address.split(',')[0].trim()}`
}

export function rateLimitKey(bucket: string, subject: string): string {
  return `${bucket}:${subject}`
}

/** Applies a limit and returns a 429 response when the caller is over it. */
export async function enforceRateLimit(
  c: AppContext,
  options: RateLimitOptions,
): Promise<Response | null> {
  const db = c.env?.DB
  if (!db) return null

  const subject = options.subject ?? rateLimitSubject(c)
  const result = await checkRateLimit(db, rateLimitKey(options.bucket, subject), options)

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
    return c.json(
      {
        error: 'rate_limited',
        message: 'Too many requests. Please slow down.',
        retryAfterSeconds: retryAfter,
      },
      429,
      {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
      },
    )
  }

  c.header('X-RateLimit-Limit', String(result.limit))
  c.header('X-RateLimit-Remaining', String(result.remaining))
  c.header('X-Request-Id', requestId(c))
  return null
}
