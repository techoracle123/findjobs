import type { AppConfig } from '../config'
import { planCatalogue, type PlanDefinition } from './pricing'

export const FOUNDING_LIMIT = 500
const FOUNDING_RESERVATION_MS = 24 * 60 * 60 * 1000
const REUSABLE_CHECKOUT_MS = 55 * 60 * 1000

export type PricingTier = 'founding' | 'standard' | 'graduate'

export interface CheckoutAttempt {
  id: string
  userId: string
  plan: string
  provider: string
  pricingTier: PricingTier
  amountKobo: number
  currency: string
  reference: string
  idempotencyKey: string
  providerCheckoutId: string | null
  checkoutUrl: string | null
  providerCustomerId: string | null
  providerChargeId: string | null
  status: string
  periodStart: string | null
  periodEnd: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FoundingClaim {
  slotNo: number
  userId: string
  attemptId: string | null
  status: 'reserved' | 'confirmed'
  reservedUntil: string | null
  firstPaidAt: string | null
  lockUntil: string | null
  firstPlan: string | null
}

interface AttemptRow {
  id: string
  user_id: string
  plan: string
  provider: string
  pricing_tier: string
  amount_kobo: number
  currency: string
  reference: string
  idempotency_key: string
  provider_checkout_id: string | null
  checkout_url: string | null
  provider_customer_id: string | null
  provider_charge_id: string | null
  status: string
  period_start: string | null
  period_end: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

interface ClaimRow {
  slot_no: number
  user_id: string
  attempt_id: string | null
  status: string
  reserved_until: string | null
  first_paid_at: string | null
  lock_until: string | null
  first_plan: string | null
}

function attemptFromRow(row: AttemptRow): CheckoutAttempt {
  return {
    id: row.id,
    userId: row.user_id,
    plan: row.plan,
    provider: row.provider,
    pricingTier:
      row.pricing_tier === 'founding' || row.pricing_tier === 'graduate'
        ? row.pricing_tier
        : 'standard',
    amountKobo: Number(row.amount_kobo),
    currency: row.currency,
    reference: row.reference,
    idempotencyKey: row.idempotency_key,
    providerCheckoutId: row.provider_checkout_id,
    checkoutUrl: row.checkout_url,
    providerCustomerId: row.provider_customer_id,
    providerChargeId: row.provider_charge_id,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function claimFromRow(row: ClaimRow): FoundingClaim {
  return {
    slotNo: Number(row.slot_no),
    userId: row.user_id,
    attemptId: row.attempt_id,
    status: row.status === 'confirmed' ? 'confirmed' : 'reserved',
    reservedUntil: row.reserved_until,
    firstPaidAt: row.first_paid_at,
    lockUntil: row.lock_until,
    firstPlan: row.first_plan,
  }
}

export function amountToKobo(amountMajor: number): number {
  return Math.round(amountMajor * 100)
}

/** Adds calendar months in UTC, clamping the day at the end of shorter months. */
export function addCalendarMonths(value: string | Date, months: number): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString()
}

export function periodMonthsForPlan(plan: string): number {
  if (plan === 'pro_annual') return 12
  if (plan === 'pro' || plan === 'pro_graduate') return 1
  return 0
}

export async function getFoundingClaim(
  db: D1Database,
  userId: string,
): Promise<FoundingClaim | null> {
  const row = await db
    .prepare(
      `SELECT slot_no, user_id, attempt_id, status, reserved_until, first_paid_at, lock_until,
        first_plan FROM billing_founding_claims WHERE user_id = ?1`,
    )
    .bind(userId)
    .first<ClaimRow>()
  return row ? claimFromRow(row) : null
}

function claimIsActive(claim: FoundingClaim | null, nowIso: string): boolean {
  if (!claim) return false
  if (claim.status === 'confirmed') return Boolean(claim.lockUntil && claim.lockUntil > nowIso)
  return Boolean(claim.reservedUntil && claim.reservedUntil > nowIso)
}

export async function foundingSlotsAvailable(db: D1Database, now = new Date()): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM billing_founding_claims
       WHERE status = 'confirmed'
          OR (status = 'reserved' AND reserved_until > ?1)`,
    )
    .bind(now.toISOString())
    .first<{ n: number }>()
  return Number(row?.n ?? 0) < FOUNDING_LIMIT
}

/**
 * The prices this person should see now. A founding member inside the
 * 12-month lock keeps the founding price; a new buyer sees it only while a
 * founding slot is still available.
 */
export async function effectivePlanCatalogue(
  db: D1Database | null | undefined,
  config: AppConfig,
  userId?: string | null,
  now = new Date(),
): Promise<PlanDefinition[]> {
  const catalogue = planCatalogue(config)
  if (!db) return catalogue
  const nowIso = now.toISOString()
  const claim = userId ? await getFoundingClaim(db, userId) : null
  const userHasFoundingPrice = claimIsActive(claim, nowIso)
  const slotsAvailable =
    userHasFoundingPrice || claim?.status === 'confirmed'
      ? false
      : await foundingSlotsAvailable(db, now)
  const foundingOnOffer = userHasFoundingPrice || slotsAvailable

  return catalogue.map((plan) => {
    if (!plan.founding) return plan
    if (foundingOnOffer) return plan
    const amount = plan.standardAmount
    return {
      ...plan,
      price: { amount, currency: plan.price.currency },
      monthlyEquivalent: plan.interval === 'year' ? Math.round(amount / 12) : amount,
      founding: false,
    }
  })
}

async function deleteExpiredFoundingClaims(db: D1Database, nowIso: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM billing_founding_claims
       WHERE status = 'reserved' AND reserved_until IS NOT NULL AND reserved_until <= ?1`,
    )
    .bind(nowIso)
    .run()
}

async function reserveFoundingSlot(
  db: D1Database,
  userId: string,
  attemptId: string,
  now: Date,
): Promise<FoundingClaim | null> {
  const nowIso = now.toISOString()
  const reservedUntil = new Date(now.getTime() + FOUNDING_RESERVATION_MS).toISOString()
  await deleteExpiredFoundingClaims(db, nowIso)
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      const result = await db
        .prepare(
          `WITH RECURSIVE slots(n) AS (
             SELECT 1 UNION ALL SELECT n + 1 FROM slots WHERE n < ${FOUNDING_LIMIT}
           )
           INSERT INTO billing_founding_claims (
             slot_no, user_id, attempt_id, status, reserved_until,
             first_paid_at, lock_until, first_plan, created_at, updated_at
           )
           SELECT n, ?1, ?2, 'reserved', ?3, NULL, NULL, NULL, ?4, ?4
           FROM slots
           WHERE NOT EXISTS (
             SELECT 1 FROM billing_founding_claims WHERE slot_no = slots.n
           )
           ORDER BY n LIMIT 1`,
        )
        .bind(userId, attemptId, reservedUntil, nowIso)
        .run()
      if ((result.meta?.changes ?? 0) > 0) return getFoundingClaim(db, userId)
      return null
    } catch {
      const existing = await getFoundingClaim(db, userId)
      if (existing) return existing
      if (tries === 2) return null
    }
  }
  return null
}

export interface CheckoutPrice {
  amountMajor: number
  amountKobo: number
  currency: string
  tier: PricingTier
}

/** Works out the server-side price for one checkout and reserves a founding slot when needed. */
export async function priceForCheckout(
  db: D1Database,
  config: AppConfig,
  userId: string,
  planId: string,
  attemptId: string,
  now = new Date(),
): Promise<CheckoutPrice> {
  const plan = planCatalogue(config).find((candidate) => candidate.id === planId)
  if (!plan) throw new Error(`unknown plan ${planId}`)
  const currency = plan.price.currency
  if (planId === 'pro_graduate') {
    return {
      amountMajor: plan.price.amount,
      amountKobo: amountToKobo(plan.price.amount),
      currency,
      tier: 'graduate',
    }
  }
  if (!plan.founding) {
    return {
      amountMajor: plan.price.amount,
      amountKobo: amountToKobo(plan.price.amount),
      currency,
      tier: 'standard',
    }
  }

  const nowIso = now.toISOString()
  let claim = await getFoundingClaim(db, userId)
  if (claim?.status === 'confirmed') {
    const locked = Boolean(claim.lockUntil && claim.lockUntil > nowIso)
    const amountMajor = locked ? plan.price.amount : plan.standardAmount
    return {
      amountMajor,
      amountKobo: amountToKobo(amountMajor),
      currency,
      tier: locked ? 'founding' : 'standard',
    }
  }
  if (claim?.status === 'reserved' && claim.reservedUntil && claim.reservedUntil > nowIso) {
    // Do not renew the 24-hour hold on every click. That would let an unpaid
    // checkout keep one of the 500 founding places away from other buyers.
    await db
      .prepare(
        `UPDATE billing_founding_claims
         SET attempt_id = ?1, updated_at = ?2 WHERE user_id = ?3`,
      )
      .bind(attemptId, nowIso, userId)
      .run()
    return {
      amountMajor: plan.price.amount,
      amountKobo: amountToKobo(plan.price.amount),
      currency,
      tier: 'founding',
    }
  }
  if (claim?.status === 'reserved') {
    await db.prepare('DELETE FROM billing_founding_claims WHERE user_id = ?1').bind(userId).run()
    claim = null
  }

  const reserved = await reserveFoundingSlot(db, userId, attemptId, now)
  const amountMajor = reserved ? plan.price.amount : plan.standardAmount
  return {
    amountMajor,
    amountKobo: amountToKobo(amountMajor),
    currency,
    tier: reserved ? 'founding' : 'standard',
  }
}

export async function confirmFoundingClaim(
  db: D1Database,
  attempt: CheckoutAttempt,
  paidAtIso: string,
): Promise<void> {
  if (attempt.pricingTier !== 'founding') return
  if (attempt.plan !== 'pro' && attempt.plan !== 'pro_annual') return
  const existing = await getFoundingClaim(db, attempt.userId)
  if (existing?.status === 'confirmed') return
  const lockUntil = addCalendarMonths(paidAtIso, 12)
  const nowIso = new Date().toISOString()
  if (existing) {
    await db
      .prepare(
        `UPDATE billing_founding_claims
         SET attempt_id = ?1, status = 'confirmed', reserved_until = NULL,
             first_paid_at = ?2, lock_until = ?3, first_plan = ?4, updated_at = ?5
         WHERE user_id = ?6`,
      )
      .bind(attempt.id, paidAtIso, lockUntil, attempt.plan, nowIso, attempt.userId)
      .run()
    return
  }

  // The reservation should normally still exist. If it expired before a late
  // bank transfer arrived, the customer still paid the founding amount FJ
  // asked Bachs to collect, so honour that payment and record the lock.
  const inserted = await db
    .prepare(
      `WITH RECURSIVE slots(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM slots WHERE n < ${FOUNDING_LIMIT}
       )
       INSERT INTO billing_founding_claims (
         slot_no, user_id, attempt_id, status, reserved_until,
         first_paid_at, lock_until, first_plan, created_at, updated_at
       )
       SELECT n, ?1, ?2, 'confirmed', NULL, ?3, ?4, ?5, ?6, ?6
       FROM slots
       WHERE NOT EXISTS (
         SELECT 1 FROM billing_founding_claims WHERE slot_no = slots.n
       )
       ORDER BY n LIMIT 1`,
    )
    .bind(attempt.userId, attempt.id, paidAtIso, lockUntil, attempt.plan, nowIso)
    .run()
  if ((inserted.meta?.changes ?? 0) > 0) return
  const max = await db
    .prepare('SELECT COALESCE(MAX(slot_no), 0) AS n FROM billing_founding_claims')
    .first<{ n: number }>()
  await db
    .prepare(
      `INSERT INTO billing_founding_claims (
         slot_no, user_id, attempt_id, status, reserved_until,
         first_paid_at, lock_until, first_plan, created_at, updated_at
       ) VALUES (?1, ?2, ?3, 'confirmed', NULL, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      Number(max?.n ?? FOUNDING_LIMIT) + 1,
      attempt.userId,
      attempt.id,
      paidAtIso,
      lockUntil,
      attempt.plan,
      nowIso,
    )
    .run()
}

export async function releaseFoundingClaimAfterRefund(
  db: D1Database,
  userId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM billing_checkout_attempts
       WHERE user_id = ?1 AND pricing_tier = 'founding' AND status = 'paid'`,
    )
    .bind(userId)
    .first<{ n: number }>()
  if (Number(row?.n ?? 0) > 0) return
  await db
    .prepare(`DELETE FROM billing_founding_claims WHERE user_id = ?1 AND status = 'confirmed'`)
    .bind(userId)
    .run()
}

export async function createCheckoutAttempt(
  db: D1Database,
  input: {
    id: string
    userId: string
    plan: string
    provider: string
    pricingTier: PricingTier
    amountKobo: number
    currency: string
    reference: string
    idempotencyKey: string
  },
  now = new Date(),
): Promise<CheckoutAttempt> {
  const nowIso = now.toISOString()
  await db
    .prepare(
      `INSERT INTO billing_checkout_attempts (
         id, user_id, plan, provider, pricing_tier, amount_kobo, currency,
         reference, idempotency_key, status, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'created', ?10, ?10)`,
    )
    .bind(
      input.id,
      input.userId,
      input.plan,
      input.provider,
      input.pricingTier,
      input.amountKobo,
      input.currency.toUpperCase(),
      input.reference,
      input.idempotencyKey,
      nowIso,
    )
    .run()
  const attempt = await getCheckoutAttempt(db, input.id)
  if (!attempt) throw new Error('checkout attempt was not saved')
  return attempt
}

export async function getCheckoutAttempt(
  db: D1Database,
  id: string,
): Promise<CheckoutAttempt | null> {
  const row = await db
    .prepare('SELECT * FROM billing_checkout_attempts WHERE id = ?1')
    .bind(id)
    .first<AttemptRow>()
  return row ? attemptFromRow(row) : null
}

export async function findReusableAttempt(
  db: D1Database,
  userId: string,
  plan: string,
  provider: string,
  now = new Date(),
): Promise<CheckoutAttempt | null> {
  const cutoff = new Date(now.getTime() - REUSABLE_CHECKOUT_MS).toISOString()
  const row = await db
    .prepare(
      `SELECT * FROM billing_checkout_attempts
       WHERE user_id = ?1 AND plan = ?2 AND provider = ?3
         AND status IN ('created', 'open', 'uncertain')
         AND created_at >= ?4
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, plan, provider, cutoff)
    .first<AttemptRow>()
  return row ? attemptFromRow(row) : null
}

export async function listRecentAttemptsForUser(
  db: D1Database,
  userId: string,
  provider: string,
  now = new Date(),
): Promise<CheckoutAttempt[]> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const result = await db
    .prepare(
      `SELECT * FROM billing_checkout_attempts
       WHERE user_id = ?1 AND provider = ?2
         AND status IN ('created', 'open', 'uncertain', 'expired')
         AND provider_checkout_id IS NOT NULL
         AND created_at >= ?3
       ORDER BY created_at DESC LIMIT 5`,
    )
    .bind(userId, provider, cutoff)
    .all<AttemptRow>()
  return (result.results ?? []).map(attemptFromRow)
}

export async function updateAttemptSession(
  db: D1Database,
  attemptId: string,
  providerCheckoutId: string,
  checkoutUrl: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE billing_checkout_attempts
       SET provider_checkout_id = ?1, checkout_url = ?2, status = 'open', updated_at = ?3
       WHERE id = ?4 AND status <> 'paid'`,
    )
    .bind(providerCheckoutId, checkoutUrl, new Date().toISOString(), attemptId)
    .run()
}

export async function markAttemptStatus(
  db: D1Database,
  attemptId: string,
  status: string,
  fromStatuses: string[],
): Promise<boolean> {
  if (fromStatuses.length === 0) return false
  const placeholders = fromStatuses.map((_, index) => `?${index + 4}`).join(', ')
  const result = await db
    .prepare(
      `UPDATE billing_checkout_attempts
       SET status = ?1, updated_at = ?2
       WHERE id = ?3 AND status IN (${placeholders})`,
    )
    .bind(status, new Date().toISOString(), attemptId, ...fromStatuses)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

export async function findAttemptForPayment(
  db: D1Database,
  provider: string,
  payment: { checkoutId?: string | null; reference?: string | null; chargeId?: string | null },
): Promise<CheckoutAttempt | null> {
  const lookups: Array<[string, string]> = []
  if (payment.checkoutId) lookups.push(['provider_checkout_id', payment.checkoutId])
  if (payment.reference) lookups.push(['reference', payment.reference])
  if (payment.chargeId) lookups.push(['provider_charge_id', payment.chargeId])
  for (const [column, value] of lookups) {
    const row = await db
      .prepare(
        `SELECT * FROM billing_checkout_attempts WHERE provider = ?1 AND ${column} = ?2 LIMIT 1`,
      )
      .bind(provider, value)
      .first<AttemptRow>()
    if (row) return attemptFromRow(row)
  }
  return null
}

/**
 * Claims one successful payment for one checkout. Two Bachs events can
 * describe the same charge; only the first claim may extend paid time.
 */
export async function claimAttemptPaid(
  db: D1Database,
  attempt: CheckoutAttempt,
  input: {
    chargeId: string | null
    customerId: string | null
    periodStart: string
    periodEnd: string
    paidAt: string
  },
): Promise<{ claimed: boolean; attempt: CheckoutAttempt }> {
  if (input.chargeId) {
    const byCharge = await findAttemptForPayment(db, attempt.provider, {
      chargeId: input.chargeId,
    })
    if (byCharge && byCharge.id !== attempt.id) {
      return { claimed: false, attempt: byCharge }
    }
  }
  const result = await db
    .prepare(
      `UPDATE billing_checkout_attempts
       SET status = 'paid',
           provider_charge_id = COALESCE(provider_charge_id, ?1),
           provider_customer_id = COALESCE(?2, provider_customer_id),
           period_start = ?3, period_end = ?4, paid_at = ?5, updated_at = ?6
       WHERE id = ?7 AND status NOT IN ('paid', 'refunded')`,
    )
    .bind(
      input.chargeId,
      input.customerId,
      input.periodStart,
      input.periodEnd,
      input.paidAt,
      new Date().toISOString(),
      attempt.id,
    )
    .run()
  const fresh = (await getCheckoutAttempt(db, attempt.id)) ?? attempt
  return { claimed: (result.meta?.changes ?? 0) > 0, attempt: fresh }
}

export async function hasLaterPaidAttempt(
  db: D1Database,
  attempt: CheckoutAttempt,
): Promise<boolean> {
  if (!attempt.periodEnd) return false
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM billing_checkout_attempts
       WHERE user_id = ?1 AND id <> ?2 AND status = 'paid'
         AND period_end IS NOT NULL AND period_end > ?3`,
    )
    .bind(attempt.userId, attempt.id, attempt.periodEnd)
    .first<{ n: number }>()
  return Number(row?.n ?? 0) > 0
}

export async function subscriptionEventIsFresh(
  db: D1Database,
  provider: string,
  providerSubscriptionId: string,
  createdAt: string | null | undefined,
): Promise<boolean> {
  if (!providerSubscriptionId || !createdAt) return true
  const row = await db
    .prepare(
      `SELECT last_event_at FROM billing_subscription_state
       WHERE provider = ?1 AND provider_subscription_id = ?2`,
    )
    .bind(provider, providerSubscriptionId)
    .first<{ last_event_at: string }>()
  return !row || createdAt >= row.last_event_at
}

export async function recordSubscriptionEventState(
  db: D1Database,
  provider: string,
  providerSubscriptionId: string,
  userId: string,
  createdAt: string | null | undefined,
): Promise<void> {
  if (!providerSubscriptionId || !createdAt) return
  const nowIso = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO billing_subscription_state (
         provider, provider_subscription_id, user_id, last_event_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
         user_id = ?3, last_event_at = ?4, updated_at = ?5`,
    )
    .bind(provider, providerSubscriptionId, userId, createdAt, nowIso)
    .run()
}
