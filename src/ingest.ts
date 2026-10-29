/**
 * The scheduled ingestion producer.
 *
 * Cloudflare Pages does not support cron triggers, so this is deployed as a
 * separate Worker that writes to the same D1 database. The Pages app can
 * also trigger the same pipeline on demand through /api/sources/ingest.
 *
 * The producer's job is only to decide what is due and hand each source to
 * the queue. The queue is what lets a registry of thousands of sources be
 * refreshed without one invocation having to fetch all of them.
 */
import { enqueuePublicRefresh, dueForRun } from './server/public-schedule'
import { PUBLIC_SOURCES, isSourceDisabled, noteSchedulerHeartbeat } from './server/public-feed'
import { ensureSources, runDueSources, runIngestion } from './server/ingest'
import { logger } from './server/logging'
import type { Env } from './server/env'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ingest' && request.method === 'POST') {
      if (!env.DB) return new Response('no database binding', { status: 503 })
      const results = await runDueSources(env.DB, 50)
      return Response.json({ results })
    }

    if (url.pathname === '/enqueue' && request.method === 'POST') {
      if (!env.DB || !env.INGEST_QUEUE) {
        return new Response('missing binding', { status: 503 })
      }
      const queued = await enqueueDue(env)
      return Response.json({ queued })
    }

    return new Response('not found', { status: 404 })
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.PUBLIC_FEED_ONLY === '1') {
      ctx.waitUntil(
        (async () => {
          const hourUtc = new Date(event.scheduledTime ?? Date.now()).getUTCHours()
          const disabled = new Set<string>()
          if (env.PUBLIC_JOBS)
            for (const source of PUBLIC_SOURCES)
              if (await isSourceDisabled(env.PUBLIC_JOBS, source.id)) disabled.add(source.id)
          const due = dueForRun(PUBLIC_SOURCES, hourUtc, disabled)
          const queued = await enqueuePublicRefresh(
            env,
            String(event.scheduledTime ?? Date.now()),
            due,
          )
          if (env.PUBLIC_JOBS)
            await noteSchedulerHeartbeat(
              env.PUBLIC_JOBS,
              `tick queued ${queued} sources (${disabled.size} disabled)`,
            )
          logger.info('tiered public refresh queued', { queued, hourUtc, disabled: disabled.size })
        })(),
      )
      return
    }
    const db = env.DB
    if (!db) {
      logger.error('scheduled ingestion skipped: no database binding')
      return
    }

    ctx.waitUntil(
      (async () => {
        await ensureSources(db)

        if (env.INGEST_QUEUE) {
          const queued = await enqueueDue(env)
          logger.info('scheduled ingestion queued', { queued })
          return
        }

        // Without a queue the sources are refreshed in this invocation, which
        // is fine for a small registry but will not scale.
        const results = await runDueSources(db, 50)
        const failed = results.filter((result) => result.status === 'failed')
        logger.info('scheduled ingestion complete', {
          sources: results.length,
          failed: failed.length,
          inserted: results.reduce((sum, result) => sum + result.inserted, 0),
          updated: results.reduce((sum, result) => sum + result.updated, 0),
          closed: results.reduce((sum, result) => sum + result.closed, 0),
        })
      })(),
    )
  },
}

/**
 * Hands every source that is due to the queue, one message each. The
 * consumer picks them up, so the work spreads out instead of happening in
 * one burst.
 */
export async function enqueueDue(env: Env): Promise<number> {
  const db = env.DB
  const queue = env.INGEST_QUEUE
  if (!db || !queue) return 0

  await ensureSources(db)

  const { dueSources } = await import('./server/ingest')
  const due = await dueSources(db, 500)
  if (due.length === 0) return 0

  const messages = due.map((source) => ({ body: { sourceId: source.id } }))
  // Cloudflare Queues accepts at most 100 messages in one sendBatch call.
  for (let offset = 0; offset < messages.length; offset += 100) {
    await queue.sendBatch(messages.slice(offset, offset + 100))
  }
  return messages.length
}

/** Refreshes one source directly. Used by the consumer and by tests. */
export async function refreshSource(env: Env, sourceId: string): Promise<unknown> {
  if (!env.DB) return null
  return runIngestion(env.DB, sourceId)
}
