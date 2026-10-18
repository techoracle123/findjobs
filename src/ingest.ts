/**
 * Scheduled ingestion worker.
 *
 * Cloudflare Pages does not support cron triggers, so this is deployed as a
 * separate Worker that writes to the same D1 database. The Pages app can also
 * trigger the same pipeline on demand through /api/sources/ingest.
 */
import { ensureSources, runAllSources } from './server/ingest'
import { logger } from './server/logging'
import type { Env } from './server/env'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/ingest' || request.method !== 'POST') {
      return new Response('not found', { status: 404 })
    }
    if (!env.DB) return new Response('no database binding', { status: 503 })

    const results = await runAllSources(env.DB)
    return Response.json({ results })
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = env.DB
    if (!db) {
      logger.error('scheduled ingestion skipped: no database binding')
      return
    }

    ctx.waitUntil(
      (async () => {
        await ensureSources(db)
        const results = await runAllSources(db)
        const failed = results.filter((result) => result.status === 'failed')
        logger.info('scheduled ingestion complete', {
          sources: results.length,
          failed: failed.length,
          inserted: results.reduce((sum, result) => sum + result.inserted, 0),
          updated: results.reduce((sum, result) => sum + result.updated, 0),
          expired: results.reduce((sum, result) => sum + result.expired, 0),
        })
      })(),
    )
  },
}
