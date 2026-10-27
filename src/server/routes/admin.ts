import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { buildQualitySnapshot, coverageOf } from '../quality'
import type { QualitySnapshot } from '../../shared/quality'
import { publishedPublicJobs } from '../public-feed'
import { type AppContext, badRequest, requireUser, unauthorized } from '../http'
import { enforceRateLimit } from '../ratelimit'

export const adminRoutes = new Hono<AppEnv>()

/**
 * Admin access is the verified Access identity plus an allowlist. There is no
 * admin password and no role table to forge.
 */
async function requireAdmin(c: AppContext): Promise<Response | null> {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const allow = (c.env?.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (!allow.length) return c.json({ error: 'admin_not_configured' }, 503)
  if (!allow.includes(user.email.toLowerCase())) return c.json({ error: 'forbidden' }, 403)
  return null
}

adminRoutes.get('/admin/quality', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited

  const kv = c.env?.PUBLIC_JOBS
  const snapshot = kv ? await kv.get<QualitySnapshot>('quality:latest', 'json') : null
  if (!snapshot) {
    const published = await publishedPublicJobs(kv)
    if (!published) return c.json({ error: 'quality_unavailable' }, 503)
    return c.json({
      quality: buildQualitySnapshot(published.jobs, published.duplicatesDropped ?? 0, null),
      source: 'computed',
    })
  }
  return c.json({ quality: snapshot, source: 'kv' })
})

/** Today's raw coverage for a specific field, used by the wallboard drill-down. */
adminRoutes.get('/admin/quality/:field', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const field = c.req.param('field')
  const published = await publishedPublicJobs(c.env?.PUBLIC_JOBS)
  if (!published) return c.json({ error: 'quality_unavailable' }, 503)
  const coverage = coverageOf(published.jobs)
  if (!(field in coverage)) return badRequest(c, 'Unknown quality field')
  return c.json({
    field,
    pct: (coverage as unknown as Record<string, number>)[field],
    total: published.jobs.length,
  })
})

/**
 * Copy audit (Prompt 19): every registry entry with its class and how often it
 * actually rendered in a browser. Raw message text never leaves this admin view.
 */
adminRoutes.get('/admin/copy', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const { COPY } = await import('../../shared/copy')
  const renders: Record<string, number> = {}
  const kv = c.env?.PUBLIC_JOBS
  if (kv) {
    const keys = await kv.list({ prefix: 'copyrender:' })
    for (const key of keys.keys) {
      const value = await kv.get(key.name)
      renders[key.name.replace('copyrender:', '')] = Number(value ?? '0')
    }
  }
  return c.json({
    entries: Object.entries(COPY).map(([id, entry]) => ({
      id,
      class: entry.className,
      legal: entry.legal === true,
      renders: renders[id] ?? 0,
    })),
  })
})
