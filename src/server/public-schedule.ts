import type { Env } from './env'
import { PUBLIC_SOURCES } from './public-feed'

export async function enqueuePublicRefresh(env: Env, run = String(Date.now())): Promise<number> {
  if (!env.PUBLIC_JOBS || !env.INGEST_QUEUE) throw new Error('Public refresh bindings unavailable')
  const messages = PUBLIC_SOURCES.map((source) => ({
    body: { operation: 'public-refresh', sourceId: source.id, run },
  }))
  for (let i = 0; i < messages.length; i += 100)
    await env.INGEST_QUEUE.sendBatch(messages.slice(i, i + 100))
  // Let independently retried publisher requests complete before publishing.
  await env.INGEST_QUEUE.send({ operation: 'public-publish', run }, { delaySeconds: 1200 })
  return messages.length
}
