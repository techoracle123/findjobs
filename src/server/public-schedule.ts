import type { Env } from './env'
import { PUBLIC_SOURCES } from './public-feed'

/**
 * Refresh cadence (Prompt 16): ATS boards every 2 hours, remote boards every
 * 6 hours, Nigerian boards every 12 hours. Legacy tier names map onto the
 * same cadence so existing source rows keep working.
 */
export const CADENCE_HOURS: Record<string, number> = {
  ats: 2,
  remote: 6,
  nigeria: 12,
  hourly: 2,
  six_hourly: 6,
  daily: 12,
  weekly: 12,
}

export function cadenceHours(tier: string): number {
  return CADENCE_HOURS[tier] ?? 12
}

export function dueForRun(
  sources: typeof PUBLIC_SOURCES,
  hourUtc: number,
  disabled: Set<string> = new Set(),
): typeof PUBLIC_SOURCES {
  return sources.filter((source) => {
    if (disabled.has(source.id)) return false
    return hourUtc % cadenceHours(source.tier) === 0
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
