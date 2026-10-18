import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'
import { readConfig } from './config'
import { resolveIdentity } from './auth/identity'
import { upsertUser, type AccountUser } from './auth/accounts'
import { log } from './logging'

export type AppContext = Context<AppEnv>

/**
 * Assigns a request id and logs the outcome of every request in a structured
 * form, so a slow or failing request can be traced without guesswork.
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  const started = Date.now()

  try {
    await next()
  } finally {
    const durationMs = Date.now() - started
    const status = c.res.status
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    log(level, 'request', {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      durationMs,
    })
  }
}

export function requestId(c: AppContext): string {
  return c.get('requestId') ?? 'unknown'
}

/**
 * Resolves the account for a request, creating the user row on first sight.
 * Returns null for an anonymous request.
 */
export async function requireUser(c: AppContext): Promise<AccountUser | null> {
  const config = readConfig(c.env ?? {})
  const identity = await resolveIdentity(c.req.raw, config)
  if (!identity || !c.env?.DB) return null

  const user = await upsertUser(c.env.DB, identity.email, identity.subject)
  c.set('userId', user.id)
  return user
}

export function unauthorized(c: AppContext): Response {
  return c.json({ error: 'unauthorized' }, 401)
}

export function badRequest(c: AppContext, message: string): Response {
  return c.json({ error: 'bad_request', message }, 400)
}

export function notFound(c: AppContext): Response {
  return c.json({ error: 'not_found' }, 404)
}

/** Reads a JSON body without throwing on malformed input. */
export async function readJson(c: AppContext): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function stringList(value: unknown, limit = 60): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}
