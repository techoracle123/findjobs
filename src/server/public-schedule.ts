import type { Env } from './env'
import { PUBLIC_SOURCES } from './public-feed'

/** Hourly runs refresh ATS boards; feed boards are due every six hours. */
export function dueForRun(
  sources: typeof PUBLIC_SOURCES,
  hourUtc: number,
  disabled: Set<string> = new Set(),
): typeof PUBLIC_SOURCES {
  return sources.filter((source) => {
    if (disabled.has(source.id)) return false
    if (source.tier === 'hourly') return true
    if (source.tier === 'six_hourly') return hourUtc % 6 === 0
    return hourUtc % 24 === 0
  })
}

export async function enqueuePublicRefresh(
  env: Env,
  run = String(Date.now()),
  sources: typeof PUBLIC_SOURCES = PUBLIC_SOURCES,
): Promise<number> {
  if (!env.PUBLIC_JOBS || !env.INGEST_QUEUE) throw new Error('Public refresh bindings unavailable')
  const messages = sources.map((source) => ({
    body: { operation: 'public-refresh', sourceId: source.id, run },
  }))
  for (let i = 0; i < messages.length; i += 100)
    await env.INGEST_QUEUE.sendBatch(messages.slice(i, i + 100))
  // Let independently retried publisher requests complete before publishing.
  if (messages.length)
    await env.INGEST_QUEUE.send({ operation: 'public-publish', run }, { delaySeconds: 1200 })
  return messages.length
}
