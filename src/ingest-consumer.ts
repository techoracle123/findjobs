/**
 * The ingestion queue consumer.
 *
 * One message is one source to refresh. Because the messages are handled
 * independently and concurrently, the number of sources is limited by the
 * queue rather than by how long a single Worker invocation may run.
 */
import { runIngestion } from './server/ingest'
import { deliverNewAlerts } from './server/alerts'
import { logger } from './server/logging'
import type { Env } from './server/env'

export interface IngestMessage {
  sourceId: string
}

export default {
  async fetch(): Promise<Response> {
    return new Response('this worker is a queue consumer', { status: 404 })
  },

  async queue(batch: MessageBatch<IngestMessage>, env: Env): Promise<void> {
    let sawNewPosting = false

    for (const message of batch.messages) {
      const sourceId = message.body?.sourceId
      if (!sourceId) {
        message.ack()
        continue
      }

      try {
        if (!env.DB) {
          message.retry()
          return
        }

        const result = await runIngestion(env.DB, sourceId)
        if (result.status === 'failed') {
          // A failing source is recorded, not retried forever: the failure
          // is already visible against the source row.
          logger.warn('source ingestion failed', { sourceId, error: result.error })
        } else if (result.inserted > 0) {
          sawNewPosting = true
        }
        message.ack()
      } catch (error) {
        logger.error('source ingestion threw', {
          sourceId,
          error: error instanceof Error ? error.message : String(error),
        })
        message.retry()
      }
    }

    // Roles that have just appeared are announced once the batch is done,
    // so one batch does not produce a flood of separate deliveries.
    if (sawNewPosting) {
      try {
        await deliverNewAlerts(env)
      } catch (error) {
        logger.error('alert delivery failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  },
}
