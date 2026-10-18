import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig } from '../config'
import { ensureSources, runDueSources, runIngestion } from '../ingest'
import { listParsers } from '../sources/registry'
import { requireUser, unauthorized } from '../http'
import type { AppContext } from '../http'
import { logger } from '../logging'

export const sourceRoutes = new Hono<AppEnv>()

/**
 * Only an authenticated account may trigger ingestion. In local and test
 * modes the dev identity is enough, which keeps the pipeline exercisable
 * without an Access application.
 */
async function mayTrigger(c: AppContext): Promise<boolean> {
  const config = readConfig(c.env ?? {})
  if (!config.isProduction) return true
  const user = await requireUser(c)
  return Boolean(user)
}

sourceRoutes.get('/sources', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  await ensureSources(c.env.DB)

  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.adapter, s.kind, s.platform, s.enabled, s.homepage, s.listing_url,
        s.country, s.tags, s.verification, s.refresh_tier, s.rate_limit_per_hour,
        s.last_run_at, s.last_status, s.last_error, s.consecutive_failures, s.disabled_reason,
        (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id) AS live_jobs,
        (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id AND j.job_status = 'closed') AS closed_jobs
       FROM sources s ORDER BY s.id`,
  ).all<{
    id: string
    name: string
    adapter: string
    kind: string
    platform: string | null
    enabled: number
    homepage: string
    listing_url: string | null
    country: string | null
    tags: string
    verification: string
    refresh_tier: string
    rate_limit_per_hour: number
    last_run_at: string | null
    last_status: string | null
    last_error: string | null
    consecutive_failures: number
    disabled_reason: string | null
    live_jobs: number
    closed_jobs: number
  }>()

  const adapters = listParsers().map((parser) => ({
    id: parser.id,
    name: parser.name,
    kind: parser.kind,
    platform: parser.platform ?? null,
    homepage: parser.homepage,
    attribution: parser.attribution,
    verification: parser.verification,
  }))

  return c.json({
    sources: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      parser: row.adapter,
      kind: row.kind,
      platform: row.platform,
      enabled: Boolean(row.enabled),
      homepage: row.homepage,
      listingUrl: row.listing_url,
      country: row.country,
      tags: row.tags,
      verification: row.verification,
      refreshTier: row.refresh_tier,
      rateLimitPerHour: row.rate_limit_per_hour,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      disabledReason: row.disabled_reason,
      liveJobs: row.live_jobs ?? 0,
      closedJobs: row.closed_jobs ?? 0,
    })),
    parsers: adapters,
  })
})

sourceRoutes.get('/sources/runs', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const rows = await c.env.DB.prepare(
    `SELECT id, source_id, started_at, finished_at, status, fetched, inserted, updated, expired,
        skipped, error FROM ingestion_runs ORDER BY started_at DESC LIMIT 50`,
  ).all()

  return c.json({ runs: rows.results ?? [] })
})

/** Runs one source now. */
sourceRoutes.post('/sources/:id/ingest', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  if (!(await mayTrigger(c))) return unauthorized(c)

  const result = await runIngestion(c.env.DB, c.req.param('id'))
  logger.info('manual ingestion', { sourceId: result.sourceId, status: result.status })
  return c.json({ result })
})

/**
 * Runs the sources that are due.
 *
 * The run is bounded: a registry of thousands of sources cannot be refreshed
 * inside one request. In production the scheduled worker hands the work to a
 * queue, and this route is for a person who wants to push a refresh through
 * now.
 */
sourceRoutes.post('/sources/ingest', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  if (!(await mayTrigger(c))) return unauthorized(c)

  const url = new URL(c.req.url)
  const raw = url.searchParams.get('limit')
  const requested = raw === null || raw.trim() === '' ? 25 : Number(raw)
  const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, requested)) : 25

  // A bounded deadline, so a slow source cannot make the request hang.
  const results = await runDueSources(c.env.DB, limit, { concurrency: 5, deadlineMs: 25_000 })
  return c.json({ results })
})
