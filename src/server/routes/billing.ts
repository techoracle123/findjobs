import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig } from '../config'
import { hasRealProvider, providerFor } from '../billing/provider'
import { planCatalogue } from '../billing/pricing'
import {
  addCalendarMonths,
  claimAttemptPaid,
  confirmFoundingClaim,
  createCheckoutAttempt,
  effectivePlanCatalogue,
  findAttemptForPayment,
  findReusableAttempt,
  hasLaterPaidAttempt,
  listRecentAttemptsForUser,
  markAttemptStatus,
  periodMonthsForPlan,
  priceForCheckout,
  recordSubscriptionEventState,
  releaseFoundingClaimAfterRefund,
  subscriptionEventIsFresh,
  updateAttemptSession,
  type CheckoutAttempt,
} from '../billing/checkouts'
import {
  BillingProviderError,
  planEntitlements,
  type BillingProviderFailure,
  type ProviderPayment,
  type ProviderSubscription,
  type WebhookEvent,
} from '../billing/types'
import { enforceRateLimit } from '../ratelimit'
import {
  findUserIdByProviderSubscription,
  getEntitlements,
  getSubscription,
  getUserByEmail,
  getUserById,
  recordAudit,
  setEntitlements,
  upsertSubscription,
} from '../auth/accounts'
import { badRequest, readJson, requireUser, unauthorized } from '../http'
import { getGraduateEligibility, getTrialState } from '../phase2'
import { logger } from '../logging'
import { PAYMENTS_PAUSED, PRO_FREE_FOR_ALL } from '../../shared/access'

export const billingRoutes = new Hono<AppEnv>()

function validIso(value: string | null | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

interface SafeBillingError {
  failure: BillingProviderFailure | 'unknown'
  httpStatus: number | null
  providerCode: string | null
  providerRequestId: string | null
  fieldNames: string[]
  outcomeUnknown: boolean
  errorName: string
}

function safeBillingError(error: unknown): SafeBillingError {
  if (error instanceof BillingProviderError) {
    return {
      failure: error.failure,
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
      providerRequestId: error.providerRequestId,
      fieldNames: error.fieldNames,
      outcomeUnknown: error.failure === 'outcome_unknown',
      errorName: error.name,
    }
  }
  const source = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >
  return {
    failure: 'unknown',
    httpStatus: null,
    providerCode: null,
    providerRequestId: null,
    fieldNames: [],
    outcomeUnknown: source.outcomeUnknown === true,
    errorName: error instanceof Error ? error.name : 'unknown',
  }
}

function checkoutFailureBody(failure: SafeBillingError['failure'], supportReference?: string) {
  const suffix = supportReference ? ` Please quote reference ${supportReference}.` : ''
  switch (failure) {
    case 'provider_account_attention':
      return {
        error: 'payments_account_attention',
        failure,
        supportReference,
        message: `Payments need attention on the FJ payment account before checkout can open. No charge was made.${suffix}`,
      }
    case 'provider_validation':
      return {
        error: 'checkout_details_rejected',
        failure,
        supportReference,
        message: `The payment page could not be opened with the checkout details. No charge was made.${suffix}`,
      }
    case 'provider_unavailable':
      return {
        error: 'payments_temporarily_unavailable',
        failure,
        supportReference,
        message: `Payments are temporarily unavailable. No charge was made. Please wait a short time and try again.${suffix}`,
      }
    case 'network':
      return {
        error: 'payment_network_error',
        failure,
        supportReference,
        message: `FJ could not reach the payment service. No charge was made. Check your connection and try again.${suffix}`,
      }
    case 'outcome_unknown':
      return {
        error: 'checkout_outcome_unknown',
        failure,
        supportReference,
        message: `FJ could not confirm whether a payment page was created. Do not pay again yet. Use Check payment on your plan page first.${suffix}`,
      }
    default:
      return {
        error: 'checkout_failed',
        failure,
        supportReference,
        message: `The payment page could not be opened. No charge was made. Please try again.${suffix}`,
      }
  }
}

billingRoutes.get('/billing/plans', async (c) => {
  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  let plans = planCatalogue(config)
  if (c.env?.DB) {
    try {
      const user = await requireUser(c)
      plans = await effectivePlanCatalogue(c.env.DB, config, user?.id)
    } catch {
      // A price list must still load if the optional founding lookup fails.
      // Checkout repeats the server-side price check before any money moves.
      plans = planCatalogue(config)
    }
  }
  return c.json({
    plans: plans.map((plan) => ({
      id: plan.id,
      label: plan.label,
      displayLabel: plan.displayLabel,
      entitlements: [...plan.entitlements],
      price: plan.price,
      interval: plan.interval,
      audience: plan.audience,
      monthlyEquivalent: plan.monthlyEquivalent,
      founding: plan.founding,
      standardAmount: plan.standardAmount,
      trialDays: plan.trialDays,
    })),
    provider: provider.id,
    currency: config.billing.currency,
    billingEnabled: hasRealProvider(config) && !PAYMENTS_PAUSED,
    paymentsPaused: PAYMENTS_PAUSED,
    freeAccess: PRO_FREE_FOR_ALL,
  })
})

billingRoutes.get('/billing/subscription', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const [subscription, entitlements] = await Promise.all([
    getSubscription(c.env.DB, user.id),
    getEntitlements(c.env.DB, user.id),
  ])

  return c.json({ subscription, entitlements })
})

/** Starts a checkout for a paid plan. */
billingRoutes.post('/billing/checkout', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  if (PAYMENTS_PAUSED) {
    return c.json(
      {
        error: 'payments_paused',
        message:
          'Payments are paused. Every current FJ tool is free for now, so no checkout or card is needed.',
      },
      503,
    )
  }

  const limited = await enforceRateLimit(c, {
    bucket: 'billing-checkout',
    limit: 12,
    windowSeconds: 3600,
  })
  if (limited) return limited

  const config = readConfig(c.env ?? {})
  const body = await readJson(c)
  const plan = typeof body.plan === 'string' ? body.plan : 'pro'

  const catalogue = planCatalogue(config)
  const entry = catalogue.find((candidate) => candidate.id === plan)
  if (!entry) return badRequest(c, `Unknown plan: ${plan}`)
  if (entry.audience !== 'seeker' || entry.price.amount <= 0) {
    return c.json(
      {
        error: 'plan_not_purchasable',
        message:
          'This plan cannot be bought. Free job search and employer-site applications remain available.',
      },
      400,
    )
  }
  if (entry.id === 'pro_graduate') {
    const graduate = await getGraduateEligibility(db, user.id)
    const eligible =
      graduate?.result === 'eligible' &&
      (!graduate.eligibleUntil || Date.parse(graduate.eligibleUntil) > Date.now())
    if (!eligible) {
      return c.json(
        {
          error: 'graduate_eligibility_required',
          message:
            'Complete the graduate-price check first. Flagged checks must be reviewed before the discounted price can be used.',
        },
        403,
      )
    }
  }

  const provider = providerFor(config)
  if (!hasRealProvider(config)) {
    return c.json(
      { error: 'billing_not_configured', message: 'No payment provider is configured.' },
      503,
    )
  }

  const existingSubscription = await getSubscription(db, user.id)
  const hasAutoRenewingSubscription = Boolean(
    existingSubscription &&
    existingSubscription.provider === provider.id &&
    (existingSubscription.status === 'active' || existingSubscription.status === 'trialing') &&
    existingSubscription.providerSubscriptionId?.startsWith('sub_') &&
    (!existingSubscription.currentPeriodEnd ||
      Date.parse(existingSubscription.currentPeriodEnd) > Date.now()),
  )
  if (hasAutoRenewingSubscription) {
    return c.json(
      {
        error: 'subscription_active',
        message: 'This account already has an active paid plan. Use Manage billing to change it.',
      },
      409,
    )
  }

  const origin = new URL(c.req.url).origin
  let attempt: CheckoutAttempt | null = null
  try {
    attempt = await findReusableAttempt(db, user.id, entry.id, provider.id)
    if (attempt?.checkoutUrl && attempt.providerCheckoutId) {
      return c.json({ session: { id: attempt.providerCheckoutId, url: attempt.checkoutUrl } })
    }

    if (!attempt) {
      const attemptId = `att_${crypto.randomUUID()}`
      const price = await priceForCheckout(db, config, user.id, entry.id, attemptId)
      attempt = await createCheckoutAttempt(db, {
        id: attemptId,
        userId: user.id,
        plan: entry.id,
        provider: provider.id,
        pricingTier: price.tier,
        amountKobo: price.amountKobo,
        currency: price.currency,
        reference: `fj_${attemptId}`,
        idempotencyKey: `fj-checkout-${attemptId}`,
      })
    }

    const session = await provider.createCheckoutSession({
      userId: user.id,
      email: user.email,
      name: user.displayName,
      plan: attempt.plan,
      priceId: config.billing.stripe.pricePro ?? '',
      amount: attempt.amountKobo / 100,
      currency: attempt.currency,
      returnUrl: `${origin}/dashboard?tab=plan&billing=checking`,
      successUrl: `${origin}/dashboard?tab=plan&billing=checking`,
      cancelUrl: `${origin}/pricing?billing=cancelled`,
      reference: attempt.reference,
      idempotencyKey: attempt.idempotencyKey,
      metadata: {
        user_id: user.id,
        plan: attempt.plan,
        attempt_id: attempt.id,
        pricing_tier: attempt.pricingTier,
      },
    })

    await updateAttemptSession(db, attempt.id, session.id, session.url)
    await recordAudit(db, user.id, 'billing.checkout.started', {
      plan: attempt.plan,
      provider: provider.id,
      attemptId: attempt.id,
      amountKobo: attempt.amountKobo,
      currency: attempt.currency,
      pricingTier: attempt.pricingTier,
    })
    return c.json({ session })
  } catch (error) {
    const safe = safeBillingError(error)
    if (attempt) {
      await markAttemptStatus(db, attempt.id, safe.outcomeUnknown ? 'uncertain' : 'failed', [
        'created',
        'open',
        'uncertain',
      ]).catch(() => false)
      await recordAudit(db, user.id, 'billing.checkout.failed', {
        attemptId: attempt.id,
        plan: attempt.plan,
        provider: provider.id,
        failure: safe.failure,
        providerCode: safe.providerCode,
        fieldNames: safe.fieldNames,
      }).catch(() => undefined)
    }
    logger.error('billing checkout failed', {
      provider: provider.id,
      userId: user.id,
      attemptId: attempt?.id,
      error: safe.errorName,
      failure: safe.failure,
      httpStatus: safe.httpStatus,
      providerCode: safe.providerCode,
      providerRequestId: safe.providerRequestId,
      fieldNames: safe.fieldNames,
    })
    return c.json(checkoutFailureBody(safe.failure, attempt?.id), 502)
  }
})

/** Opens the provider's customer portal so a subscriber can manage or cancel. */
billingRoutes.post('/billing/portal', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const subscription = await getSubscription(c.env.DB, user.id)
  if (!subscription?.providerCustomerId) {
    return c.json(
      {
        error: 'no_billing_history',
        message: 'This account has no completed payment to manage yet.',
      },
      409,
    )
  }

  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  if (!hasRealProvider(config)) {
    return c.json({ error: 'billing_not_configured' }, 503)
  }
  if (subscription.provider !== provider.id) {
    return c.json(
      {
        error: 'billing_record_not_manageable',
        message:
          'This plan does not have an online billing portal to open. Your paid time ends on the date shown.',
      },
      409,
    )
  }
  const origin = new URL(c.req.url).origin
  try {
    const session = await provider.createPortalSession(subscription.providerCustomerId, origin)
    return c.json({ session })
  } catch (error) {
    const safe = safeBillingError(error)
    logger.error('billing portal failed', {
      provider: provider.id,
      userId: user.id,
      error: safe.errorName,
      failure: safe.failure,
      httpStatus: safe.httpStatus,
      providerCode: safe.providerCode,
      providerRequestId: safe.providerRequestId,
      fieldNames: safe.fieldNames,
    })
    return c.json(
      {
        error: 'portal_failed',
        failure: safe.failure,
        message: 'The billing portal could not be opened. Please try again.',
      },
      502,
    )
  }
})

/**
 * Cancels a real auto-renewing plan at the end of the period already paid
 * for. Naira fixed-time payments do not renew by themselves, so for those
 * this only records that the paid time will end on its shown date.
 */
billingRoutes.post('/billing/cancel', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)

  const subscription = await getSubscription(db, user.id)
  if (!subscription) return badRequest(c, 'There is no subscription to cancel.')
  if (subscription.cancelAtPeriodEnd) {
    return c.json({ subscription })
  }

  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  if (
    subscription.provider === provider.id &&
    provider.cancelSubscription &&
    subscription.providerSubscriptionId?.startsWith('sub_')
  ) {
    try {
      await provider.cancelSubscription(subscription.providerSubscriptionId)
    } catch (error) {
      const safe = safeBillingError(error)
      logger.error('billing provider cancellation failed', {
        provider: provider.id,
        userId: user.id,
        error: safe.errorName,
        failure: safe.failure,
        httpStatus: safe.httpStatus,
        providerCode: safe.providerCode,
        providerRequestId: safe.providerRequestId,
        fieldNames: safe.fieldNames,
      })
      return c.json(
        {
          error: 'cancel_failed',
          failure: safe.failure,
          message: 'Your plan could not be cancelled. Please try again.',
        },
        502,
      )
    }
  }

  await upsertSubscription(db, { ...subscription, cancelAtPeriodEnd: true })
  await recordAudit(db, user.id, 'billing.cancel.requested', { plan: subscription.plan })
  logger.info('billing cancellation requested', { userId: user.id })

  return c.json({ subscription: await getSubscription(db, user.id) })
})

/**
 * Checks recent checkouts with the provider. This is the safety net for a
 * delayed or missed webhook; it still grants only a provider-confirmed,
 * exact-amount payment for this signed-in user.
 */
billingRoutes.post('/billing/reconcile', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)

  const limited = await enforceRateLimit(c, {
    bucket: 'billing-reconcile',
    limit: 30,
    windowSeconds: 3600,
  })
  if (limited) return limited

  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  if (!provider.fetchCheckout) {
    return c.json({ error: 'reconcile_not_supported' }, 400)
  }

  const attempts = await listRecentAttemptsForUser(db, user.id, provider.id)
  let applied = false
  let checked = 0
  let failedChecks = 0
  for (const attempt of attempts) {
    if (!attempt.providerCheckoutId) continue
    checked += 1
    try {
      const payment = await provider.fetchCheckout(attempt.providerCheckoutId)
      if (!payment) continue
      if (payment.status === 'succeeded') {
        applied = (await applySuccessfulPayment(db, provider.id, payment, null, user.id)) || applied
      } else if (payment.status === 'expired') {
        await markAttemptStatus(db, attempt.id, 'expired', ['created', 'open', 'uncertain'])
      }
    } catch (error) {
      failedChecks += 1
      const safe = safeBillingError(error)
      logger.error('billing reconcile failed', {
        provider: provider.id,
        userId: user.id,
        attemptId: attempt.id,
        error: safe.errorName,
        failure: safe.failure,
        httpStatus: safe.httpStatus,
        providerCode: safe.providerCode,
        providerRequestId: safe.providerRequestId,
        fieldNames: safe.fieldNames,
      })
    }
  }

  const [subscription, entitlements] = await Promise.all([
    getSubscription(db, user.id),
    getEntitlements(db, user.id),
  ])
  return c.json({ subscription, entitlements, checked, applied, failedChecks })
})

/**
 * The provider's webhook. The signature is verified before anything is
 * trusted, the event is ignored if it has already been seen, and checkout
 * payments are claimed once by attempt and charge.
 */
billingRoutes.post('/billing/webhook', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const payload = await c.req.text()
  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)

  let event: WebhookEvent | null
  try {
    event = await provider.parseWebhook(payload, c.req.raw.headers)
  } catch (error) {
    logger.error('billing webhook could not be confirmed', {
      provider: provider.id,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return c.json({ error: 'verification_failed' }, 503)
  }

  if (!event) {
    return c.json({ error: 'invalid_signature' }, 400)
  }

  const fresh = await recordBillingEvent(c.env.DB, provider.id, event.eventId, event.type)
  if (!fresh) {
    return c.json({ received: true, duplicate: true })
  }

  try {
    await applyWebhookEvent(c.env.DB, provider.id, provider.subscriptionFromEvent(event), event)
  } catch {
    await forgetBillingEvent(c.env.DB, provider.id, event.eventId)
    logger.error('billing webhook failed to apply', {
      provider: provider.id,
      type: event.type,
    })
    return c.json({ error: 'apply_failed' }, 503)
  }

  return c.json({ received: true })
})

async function applyWebhookEvent(
  db: D1Database,
  providerId: string,
  subscription: ProviderSubscription | null,
  event: WebhookEvent,
): Promise<void> {
  const payment = event.providerPayment
  if (payment) {
    if (payment.status === 'succeeded') {
      await applySuccessfulPayment(db, providerId, payment, event.createdAt)
      return
    }
    if (payment.status === 'refunded') {
      await applyRefund(db, providerId, payment, event)
      return
    }
    if (payment.status === 'disputed') {
      await applyDispute(db, providerId, payment, event)
      return
    }
    const attempt = await findAttemptForPayment(db, providerId, payment)
    if (attempt && payment.status === 'expired') {
      await markAttemptStatus(db, attempt.id, 'expired', ['created', 'open', 'uncertain'])
      await recordAudit(db, attempt.userId, 'billing.checkout.expired', {
        attemptId: attempt.id,
        plan: attempt.plan,
      })
    } else if (attempt && payment.status === 'failed') {
      // Bachs keeps the checkout open after a first failed try, so this is
      // recorded for support but does not close the checkout.
      await recordAudit(db, attempt.userId, 'billing.payment.failed', {
        attemptId: attempt.id,
        plan: attempt.plan,
      })
    }
    return
  }

  if (subscription) {
    await applySubscriptionEvent(db, providerId, subscription, event)
  }
}

async function applySuccessfulPayment(
  db: D1Database,
  providerId: string,
  payment: ProviderPayment,
  eventCreatedAt: string | null | undefined,
  expectedUserId?: string,
): Promise<boolean> {
  const attempt = await findAttemptForPayment(db, providerId, payment)
  if (!attempt) {
    logger.warn('billing payment had no matching checkout', { provider: providerId })
    return false
  }
  if (expectedUserId && attempt.userId !== expectedUserId) return false
  if (attempt.status === 'refunded') return false

  const paidAmountKobo = payment.amount === null ? null : Math.round(payment.amount * 100)
  const mismatch =
    !payment.chargeId ||
    paidAmountKobo === null ||
    payment.currency === null ||
    (payment.plan !== null && payment.plan !== attempt.plan) ||
    paidAmountKobo !== attempt.amountKobo ||
    payment.currency.toUpperCase() !== attempt.currency
  if (mismatch) {
    await recordAudit(db, attempt.userId, 'billing.payment.mismatch', {
      attemptId: attempt.id,
      plan: attempt.plan,
      expectedAmountKobo: attempt.amountKobo,
      expectedCurrency: attempt.currency,
    })
    logger.warn('billing payment did not match its checkout', {
      provider: providerId,
      attemptId: attempt.id,
    })
    return false
  }

  const months = periodMonthsForPlan(attempt.plan)
  if (months === 0) return false

  const paidAt = validIso(payment.paidAt) ?? validIso(eventCreatedAt) ?? new Date().toISOString()
  const paidAtMs = Date.parse(paidAt)
  const [existing, trial] = await Promise.all([
    getSubscription(db, attempt.userId),
    getTrialState(db, attempt.userId, paidAtMs),
  ])
  let periodStart = paidAt
  if (
    existing &&
    (existing.status === 'active' || existing.status === 'trialing') &&
    existing.currentPeriodEnd &&
    Date.parse(existing.currentPeriodEnd) > paidAtMs
  ) {
    periodStart = existing.currentPeriodEnd
  }
  if (
    trial.status === 'active' &&
    trial.endsAt &&
    Date.parse(trial.endsAt) > Date.parse(periodStart)
  ) {
    periodStart = trial.endsAt
  }
  const periodEnd = addCalendarMonths(periodStart, months)

  const claimed = await claimAttemptPaid(db, attempt, {
    chargeId: payment.chargeId,
    customerId: payment.customerId,
    periodStart,
    periodEnd,
    paidAt,
  })
  if (!claimed.claimed) return false

  await confirmFoundingClaim(db, claimed.attempt, paidAt)
  await upsertSubscription(db, {
    id: `sub_${claimed.attempt.id}`,
    userId: claimed.attempt.userId,
    provider: providerId,
    providerCustomerId: payment.customerId ?? claimed.attempt.providerCustomerId,
    providerSubscriptionId:
      payment.checkoutId ?? claimed.attempt.providerCheckoutId ?? payment.chargeId,
    plan: claimed.attempt.plan,
    status: 'active',
    currentPeriodEnd: periodEnd,
    // A fixed-time naira payment ends on this date and is not charged again
    // by itself. The paid time still runs in full.
    cancelAtPeriodEnd: true,
  })
  await setEntitlements(
    db,
    claimed.attempt.userId,
    planEntitlements(claimed.attempt.plan),
    periodEnd,
  )
  await recordAudit(db, claimed.attempt.userId, 'billing.payment.succeeded', {
    attemptId: claimed.attempt.id,
    plan: claimed.attempt.plan,
    amountKobo: claimed.attempt.amountKobo,
    currency: claimed.attempt.currency,
    pricingTier: claimed.attempt.pricingTier,
    periodEnd,
  })
  logger.info('billing payment applied', { userId: claimed.attempt.userId })
  return true
}

async function revokeAttemptAccess(
  db: D1Database,
  attempt: CheckoutAttempt,
  reason: string,
  nowIso: string,
): Promise<boolean> {
  if (await hasLaterPaidAttempt(db, attempt)) return false
  const existing = await getSubscription(db, attempt.userId)
  if (!existing) return true
  const providerMatches = Boolean(
    existing.providerSubscriptionId &&
    (existing.providerSubscriptionId === attempt.providerCheckoutId ||
      existing.providerSubscriptionId === attempt.providerChargeId),
  )
  const periodMatches = Boolean(
    attempt.periodEnd &&
    existing.currentPeriodEnd &&
    Date.parse(existing.currentPeriodEnd) <= Date.parse(attempt.periodEnd),
  )
  if (!providerMatches && !periodMatches) return false

  await upsertSubscription(db, {
    ...existing,
    status: 'canceled',
    currentPeriodEnd: nowIso,
    cancelAtPeriodEnd: true,
  })
  await setEntitlements(db, attempt.userId, [], nowIso)
  await recordAudit(db, attempt.userId, 'billing.access.revoked', {
    attemptId: attempt.id,
    reason,
  })
  return true
}

async function applyRefund(
  db: D1Database,
  providerId: string,
  payment: ProviderPayment,
  event: WebhookEvent,
): Promise<void> {
  const attempt = await findAttemptForPayment(db, providerId, {
    chargeId: payment.chargeId,
  })
  if (!attempt) return
  const refundedKobo = payment.amount === null ? null : Math.round(payment.amount * 100)
  if (refundedKobo !== null && refundedKobo < attempt.amountKobo) {
    await recordAudit(db, attempt.userId, 'billing.refund.partial', {
      attemptId: attempt.id,
      amountKobo: refundedKobo,
    })
    return
  }
  const marked =
    attempt.status === 'refunded' ||
    (await markAttemptStatus(db, attempt.id, 'refunded', [
      'paid',
      'disputed',
      'created',
      'open',
      'uncertain',
      'expired',
      'failed',
    ]))
  if (!marked) return
  const nowIso = validIso(event.createdAt) ?? new Date().toISOString()
  await revokeAttemptAccess(db, attempt, 'refund', nowIso)
  await releaseFoundingClaimAfterRefund(db, attempt.userId)
  await recordAudit(db, attempt.userId, 'billing.refund.paid', { attemptId: attempt.id })
}

async function applyDispute(
  db: D1Database,
  providerId: string,
  payment: ProviderPayment,
  event: WebhookEvent,
): Promise<void> {
  const attempt = await findAttemptForPayment(db, providerId, {
    chargeId: payment.chargeId,
  })
  if (!attempt) return
  const detail = payment.statusDetail?.toLowerCase() ?? ''
  const nowIso = validIso(event.createdAt) ?? new Date().toISOString()
  if (detail === 'won') {
    await markAttemptStatus(db, attempt.id, 'paid', ['disputed'])
    await recordAudit(db, attempt.userId, 'billing.dispute.won', { attemptId: attempt.id })
    return
  }
  if (detail === 'lost') {
    const marked =
      attempt.status === 'refunded' ||
      (await markAttemptStatus(db, attempt.id, 'refunded', [
        'paid',
        'disputed',
        'created',
        'open',
        'uncertain',
        'expired',
        'failed',
      ]))
    if (marked) {
      await revokeAttemptAccess(db, attempt, 'dispute_lost', nowIso)
      await releaseFoundingClaimAfterRefund(db, attempt.userId)
    }
    await recordAudit(db, attempt.userId, 'billing.dispute.lost', { attemptId: attempt.id })
    return
  }
  await markAttemptStatus(db, attempt.id, 'disputed', ['paid'])
  await recordAudit(db, attempt.userId, 'billing.dispute.opened', {
    attemptId: attempt.id,
    status: detail || 'unknown',
  })
}

async function applySubscriptionEvent(
  db: D1Database,
  providerId: string,
  subscription: ProviderSubscription,
  event: WebhookEvent,
): Promise<void> {
  let user = event.userId ? await getUserById(db, event.userId) : null
  if (!user) {
    const userId = await findUserIdByProviderSubscription(
      db,
      subscription.subscriptionId || null,
      subscription.customerId || null,
    )
    if (userId) user = await getUserById(db, userId)
  }
  if (!user && event.customerEmail) {
    user = await getUserByEmail(db, event.customerEmail)
  }
  if (!user) {
    logger.warn('billing subscription event had no matching FJ user', { provider: providerId })
    return
  }

  if (
    subscription.subscriptionId &&
    !(await subscriptionEventIsFresh(db, providerId, subscription.subscriptionId, event.createdAt))
  ) {
    return
  }

  await upsertSubscription(db, {
    id: `sub_${subscription.subscriptionId || user.id}`,
    userId: user.id,
    provider: providerId,
    providerCustomerId: subscription.customerId,
    providerSubscriptionId: subscription.subscriptionId,
    plan: subscription.plan,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  })

  const active = subscription.status === 'active' || subscription.status === 'trialing'
  await setEntitlements(
    db,
    user.id,
    active ? planEntitlements(subscription.plan) : [],
    subscription.currentPeriodEnd,
  )
  await recordSubscriptionEventState(
    db,
    providerId,
    subscription.subscriptionId,
    user.id,
    event.createdAt,
  )
  await recordAudit(db, user.id, 'billing.webhook', {
    type: event.type,
    status: subscription.status,
  })
  logger.info('billing webhook applied', { type: event.type, userId: user.id })
}

/**
 * A stand-in for the provider's checkout completion, used by the local fake
 * provider. It is only available in explicit local and test modes.
 */
billingRoutes.post('/billing/confirm', async (c) => {
  const config = readConfig(c.env ?? {})
  if (!config.isLocal && !config.isTest) return c.json({ error: 'not_found' }, 404)

  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const plan = typeof body.plan === 'string' ? body.plan : 'pro'
  const entry = planCatalogue(config).find((candidate) => candidate.id === plan)
  if (!entry) return badRequest(c, `Unknown plan: ${plan}`)

  const months = periodMonthsForPlan(entry.id) || 1
  const periodEnd = addCalendarMonths(new Date(), months)
  await upsertSubscription(c.env.DB, {
    id: `sub_fake_${user.id}`,
    userId: user.id,
    provider: 'fake',
    providerCustomerId: `cus_fake_${user.id}`,
    providerSubscriptionId: `sub_fake_${user.id}`,
    plan: entry.id,
    status: 'active',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
  })
  await setEntitlements(c.env.DB, user.id, planEntitlements(entry.id), periodEnd)

  await recordAudit(c.env.DB, user.id, 'billing.confirm', { plan: entry.id })
  return c.json({ subscription: await getSubscription(c.env.DB, user.id) })
})

/**
 * Records that a billing event has been seen. Returns false when the event
 * has already been applied, which is how a provider's retry is ignored.
 */
async function recordBillingEvent(
  db: D1Database,
  provider: string,
  eventId: string | null,
  type: string,
): Promise<boolean> {
  if (!eventId) return true
  const result = await db
    .prepare(
      `INSERT INTO billing_events (provider, event_id, event_type, received_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(provider, event_id) DO NOTHING`,
    )
    .bind(provider, eventId, type, new Date().toISOString())
    .run()
  return (result.meta?.changes ?? 0) > 0
}

/** Removes a recorded event so that a retry is processed rather than skipped. */
async function forgetBillingEvent(
  db: D1Database,
  provider: string,
  eventId: string | null,
): Promise<void> {
  if (!eventId) return
  await db
    .prepare('DELETE FROM billing_events WHERE provider = ?1 AND event_id = ?2')
    .bind(provider, eventId)
    .run()
}

/**
 * Pricing waitlist. Anonymous and rate limited; stores only the email and a
 * timestamp. It is never a checkout.
 */
billingRoutes.post('/billing/waitlist', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'waitlist', limit: 5, windowSeconds: 3600 })
  if (limited) return limited
  const body = await c.req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'bad_request' }, 400)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const company = typeof body?.company === 'string' ? body.company.trim().slice(0, 120) : ''
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS pricing_waitlist (
        email TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        company TEXT
      )`,
    )
    .run()
  try {
    await db.prepare('ALTER TABLE pricing_waitlist ADD COLUMN company TEXT').run()
  } catch {
    /* Column already present. */
  }
  await db
    .prepare('INSERT OR IGNORE INTO pricing_waitlist (email, created_at, company) VALUES (?, ?, ?)')
    .bind(email, Date.now(), company || null)
    .run()
  return c.json({ ok: true })
})
