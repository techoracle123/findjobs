import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig } from '../config'
import { ensureSources, runAllSources, runIngestion } from '../ingest'
import { listAdapters } from '../sources/registry'
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
    `SELECT s.id, s.name, s.adapter, s.enabled, s.homepage, s.last_run_at, s.last_status, s.last_error,
        (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id AND j.expired_at IS NULL) AS live_jobs
       FROM sources s ORDER BY s.id`,
  ).all<{
    id: string
    name: string
    adapter: string
    enabled: number
    homepage: string
    last_run_at: string | null
    last_status: string | null
    last_error: string | null
    live_jobs: number
  }>()

  const adapters = listAdapters().map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    homepage: adapter.homepage,
    attribution: adapter.attribution,
  }))

  return c.json({
    sources: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      enabled: Boolean(row.enabled),
      homepage: row.homepage,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
      liveJobs: row.live_jobs ?? 0,
    })),
    adapters,
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

/** Runs every enabled source. */
sourceRoutes.post('/sources/ingest', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  if (!(await mayTrigger(c))) return unauthorized(c)

  const results = await runAllSources(c.env.DB)
  return c.json({ results })
})
