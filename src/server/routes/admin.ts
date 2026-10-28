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

/**
 * Source health (Prompt 16): one row per source with a 0–100 health score
 * (yield, freshness and failure streak combined) and the projected KV write
 * cost of its cadence, so the bill is visible before it is spent.
 */
adminRoutes.get('/admin/sources', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const { cadenceHours, CADENCE_HOURS } = await import('../public-schedule')
  const rows = await db
    .prepare(
      `SELECT s.id, s.name, s.refresh_tier, s.enabled, s.last_run_at, s.last_status,
              s.consecutive_failures,
              (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id) AS live_jobs
       FROM sources s ORDER BY s.id`,
    )
    .all<{
      id: string
      name: string
      refresh_tier: string
      enabled: number
      last_run_at: string | null
      last_status: string | null
      consecutive_failures: number
      live_jobs: number
    }>()
  const now = Date.now()
  const sources = rows.results.map((row) => {
    const ageHours = row.last_run_at ? (now - Date.parse(row.last_run_at)) / 3_600_000 : 48
    const freshness = Math.max(0, 100 - ageHours * 2)
    const yieldScore = Math.min(100, row.live_jobs * 2)
    const failureScore = Math.max(0, 100 - row.consecutive_failures * 25)
    const health = Math.round(freshness * 0.4 + yieldScore * 0.3 + failureScore * 0.3)
    const runsPerDay = 24 / cadenceHours(row.refresh_tier)
    return {
      id: row.id,
      name: row.name,
      tier: row.refresh_tier,
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      consecutiveFailures: row.consecutive_failures,
      liveJobs: row.live_jobs,
      health,
      // Each run rewrites changed listings; budget at 2 KV writes per live job
      // per run worst-case (skip-unchanged keeps the real number far lower).
      projectedKvWritesPerDay: Math.round(runsPerDay * row.live_jobs * 2),
    }
  })
  const totalWrites = sources.reduce((sum, source) => sum + source.projectedKvWritesPerDay, 0)
  return c.json({
    sources,
    cadences: CADENCE_HOURS,
    projected: {
      kvWritesPerDay: totalWrites,
      freeTierWritesPerDay: 1000,
      withinFreeTier: totalWrites <= 1000,
      note: 'Projection is the worst case without skip-unchanged. Real writes are far lower because unchanged listings are not rewritten.',
    },
  })
})

/**
 * Billing admin (Prompt 7). Prompts 4/5/6 never ship without this surface:
 * promos, affiliate conversions under 14-day hold, and the global payout
 * kill switch are all operated from here.
 */
adminRoutes.get('/admin/billing', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const { payoutsBlocked } = await import('../billing/promo-affiliates')
  const promos = await db
    .prepare(
      'SELECT code, percent_off, max_redemptions, redeemed_count, expires_at, active FROM promo_codes',
    )
    .all()
  const conversions = await db
    .prepare(
      'SELECT id, affiliate_id, amount_kobo, status, release_at, created_at FROM affiliate_conversions ORDER BY created_at DESC LIMIT 200',
    )
    .all()
  const held = await db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount_kobo), 0) AS kobo FROM affiliate_conversions WHERE status IN ('held','approved')",
    )
    .first<{ n: number; kobo: number }>()
  return c.json({
    promos: promos.results,
    conversions: conversions.results,
    totals: { openConversions: held?.n ?? 0, openAmountKobo: held?.kobo ?? 0 },
    payoutKillSwitch: await payoutsBlocked(db),
  })
})

adminRoutes.post('/admin/billing/kill-switch', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => null)
  const on = body?.on === true
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const { setPayoutKillSwitch } = await import('../billing/promo-affiliates')
  await setPayoutKillSwitch(c.env.DB, on)
  return c.json({ ok: true, payoutKillSwitch: on })
})

adminRoutes.post('/admin/billing/conversions/:id/resolve', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const body = await c.req.json().catch(() => null)
  const status = body?.status
  if (!['approved', 'cancelled'].includes(status)) return c.json({ error: 'bad_request' }, 400)
  await c.env.DB.prepare('UPDATE affiliate_conversions SET status = ? WHERE id = ?')
    .bind(status, c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

adminRoutes.post('/admin/billing/payouts/run', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const { runPayouts } = await import('../billing/promo-affiliates')
  const result = await runPayouts(c.env.DB)
  return c.json(result)
})

adminRoutes.post('/admin/billing/promos', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const body = await c.req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  const percent = Number(body?.percentOff)
  if (
    !/^[A-Z0-9_-]{3,32}$/.test(code) ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 100
  )
    return c.json({ error: 'bad_request' }, 400)
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO promo_codes (code, percent_off, max_redemptions, expires_at, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  )
    .bind(code, percent, body?.maxRedemptions ?? null, body?.expiresAt ?? null, Date.now())
    .run()
  return c.json({ ok: true })
})
