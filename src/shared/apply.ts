/** Shared Fast Apply quota policy. Server enforces it; the interface reports it. */

export const FREE_FAST_APPLY_PER_DAY = 5
export const FREE_FAST_APPLY_PER_WEEK = 15

/** Africa/Lagos is UTC+1 all year; a fixed offset is exact here. */
const LAGOS_OFFSET_MS = 3600_000
const DAY_MS = 86_400_000

/** The Lagos calendar date (YYYY-MM-DD) for a moment. */
export function lagosDayKey(now: number = Date.now()): string {
  return new Date(now + LAGOS_OFFSET_MS).toISOString().slice(0, 10)
}

/** Epoch ms of the Lagos midnight that starts the day after `dayKey`. */
export function nextLagosMidnight(dayKey: string, now: number = Date.now()): number {
  const start = Date.parse(`${dayKey}T00:00:00.000Z`) + DAY_MS - LAGOS_OFFSET_MS
  return start > now ? start : nextLagosMidnight(lagosDayKey(start), start)
}

/** The seven Lagos day keys that make up the rolling week, oldest first. */
export function lagosWeekKeys(now: number = Date.now()): string[] {
  const keys: string[] = []
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    keys.push(lagosDayKey(now - daysAgo * DAY_MS))
  }
  return keys
}

export interface ApplyQuotaState {
  /** True for users whose plan removes the Fast Apply cap. */
  unlimited: boolean
  limit: number
  used: number
  remaining: number
  resetsAt: number
  weekLimit: number
  weekUsed: number
}
