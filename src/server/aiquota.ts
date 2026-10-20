import type { AppConfig } from './config'

/**
 * The AI budget.
 *
 * Every call to the Workers AI binding costs money, so the number of calls
 * is counted against the account that made them and against the deployment
 * as a whole. The counter is written with a conditional upsert so the limit
 * is enforced by the database rather than by a read followed by a write,
 * which two concurrent requests could both pass.
 */

const GLOBAL_SCOPE = 'global'

export type QuotaScope = 'global' | 'user'

export interface QuotaDecision {
  allowed: boolean
  scope: QuotaScope | null
  limit: number
  message: string | null
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Counts one call against a scope, refusing to go past the limit.
 * Returns false when the scope is already at its limit.
 */
export async function consumeAiQuota(
  db: D1Database,
  scope: string,
  limit: number,
  day = utcDay(),
): Promise<boolean> {
  if (limit <= 0) return false
  const result = await db
    .prepare(
      `INSERT INTO ai_usage (scope, day, calls, updated_at) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(scope, day) DO UPDATE SET calls = calls + 1, updated_at = ?3
       WHERE calls < ?4`,
    )
    .bind(scope, day, new Date().toISOString(), limit)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

/** Gives a call back, used when a later step in the same request fails. */
export async function releaseAiQuota(db: D1Database, scope: string, day = utcDay()): Promise<void> {
  await db
    .prepare('UPDATE ai_usage SET calls = MAX(calls - 1, 0) WHERE scope = ?1 AND day = ?2')
    .bind(scope, day)
    .run()
}

/** How many calls a scope has made today. */
export async function aiUsage(db: D1Database, scope: string, day = utcDay()): Promise<number> {
  const row = await db
    .prepare('SELECT calls FROM ai_usage WHERE scope = ?1 AND day = ?2')
    .bind(scope, day)
    .first<{ calls: number }>()
  return row?.calls ?? 0
}

/**
 * Takes one call from both the account's budget and the deployment's.
 *
 * The deployment budget is taken first so that a burst of accounts cannot
 * spend the whole day's allowance; if the account then has nothing left the
 * deployment's call is given back.
 */
export async function takeAiBudget(
  db: D1Database,
  accountScope: string,
  config: AppConfig,
): Promise<QuotaDecision> {
  const day = utcDay()

  const globalOk = await consumeAiQuota(db, GLOBAL_SCOPE, config.aiGlobalDailyLimit, day)
  if (!globalOk) {
    return {
      allowed: false,
      scope: 'global',
      limit: config.aiGlobalDailyLimit,
      message: 'The daily AI allowance for the service has been used up. Try again tomorrow.',
    }
  }

  const accountOk = await consumeAiQuota(db, accountScope, config.aiDailyLimit, day)
  if (!accountOk) {
    await releaseAiQuota(db, GLOBAL_SCOPE, day)
    return {
      allowed: false,
      scope: 'user',
      limit: config.aiDailyLimit,
      message: `You have used all ${config.aiDailyLimit} CV analyses for today.`,
    }
  }

  return { allowed: true, scope: null, limit: 0, message: null }
}
