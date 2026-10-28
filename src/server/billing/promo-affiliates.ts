/**
 * Promo codes (Prompt 5) and affiliates (Prompt 6).
 *
 * FJ2026 is the launch code: percent off, capped redemptions, optional
 * expiry. Affiliate conversions sit in a 14-day hold before they can be
 * approved, and a global kill switch stops every payout regardless of state.
 */
export const AFFILIATE_HOLD_MS = 14 * 24 * 60 * 60 * 1000

export interface PromoRow {
  code: string
  percent_off: number
  max_redemptions: number | null
  redeemed_count: number
  expires_at: number | null
  active: number
}

/** Validates a code and returns the discount percent, or null when unusable. */
export async function redeemablePercent(
  db: D1Database,
  code: string,
  now = Date.now(),
): Promise<number | null> {
  const row = await db
    .prepare(
      'SELECT code, percent_off, max_redemptions, redeemed_count, expires_at, active FROM promo_codes WHERE code = ?',
    )
    .bind(code.trim().toUpperCase())
    .first<PromoRow>()
  if (!row || row.active !== 1) return null
  if (row.expires_at !== null && now > row.expires_at) return null
  if (row.max_redemptions !== null && row.redeemed_count >= row.max_redemptions) return null
  return row.percent_off
}

/** Records a redemption atomically so caps cannot be raced past. */
export async function recordRedemption(
  db: D1Database,
  code: string,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const applied = await db
    .prepare(
      `UPDATE promo_codes SET redeemed_count = redeemed_count + 1
       WHERE code = ? AND active = 1
         AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
         AND (expires_at IS NULL OR ? <= expires_at)`,
    )
    .bind(code.trim().toUpperCase(), now)
    .run()
  if (!applied.meta.changes) return false
  await db
    .prepare('INSERT OR IGNORE INTO promo_redemptions (code, user_id, created_at) VALUES (?, ?, ?)')
    .bind(code.trim().toUpperCase(), userId, now)
    .run()
  return true
}

/** Applies a percent discount to a kobo amount. Never goes below zero. */
export function discountedKobo(amountKobo: number, percentOff: number): number {
  return Math.max(0, Math.round((amountKobo * (100 - Math.min(100, percentOff))) / 100))
}

/** Records an affiliate conversion under the 14-day hold. */
export async function recordConversion(
  db: D1Database,
  affiliateId: string,
  userId: string,
  amountKobo: number,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO affiliate_conversions (id, affiliate_id, user_id, amount_kobo, status, release_at, created_at)
       VALUES (?, ?, ?, ?, 'held', ?, ?)`,
    )
    .bind(crypto.randomUUID(), affiliateId, userId, amountKobo, now + AFFILIATE_HOLD_MS, now)
    .run()
}

/** The global payout kill switch: payouts refuse to run while it is on. */
export async function payoutsBlocked(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT kill_switch FROM payout_settings WHERE id = ?')
    .bind('global')
    .first<{ kill_switch: number }>()
  return row ? row.kill_switch === 1 : true // missing row = fail closed
}

export async function setPayoutKillSwitch(
  db: D1Database,
  on: boolean,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare('UPDATE payout_settings SET kill_switch = ?, updated_at = ? WHERE id = ?')
    .bind(on ? 1 : 0, now, 'global')
    .run()
}

/**
 * Marks due, approved conversions as paid. Refuses to run while the kill
 * switch is on — the one hard gate before money moves.
 */
export async function runPayouts(
  db: D1Database,
  now = Date.now(),
): Promise<{ paid: number; blocked: boolean }> {
  if (await payoutsBlocked(db)) return { paid: 0, blocked: true }
  const due = await db
    .prepare(
      `UPDATE affiliate_conversions SET status = 'paid'
       WHERE status = 'approved' AND release_at <= ?`,
    )
    .bind(now)
    .run()
  return { paid: due.meta.changes ?? 0, blocked: false }
}
