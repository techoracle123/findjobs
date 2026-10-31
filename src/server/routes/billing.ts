import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig } from '../config'
import { hasRealProvider, providerFor } from '../billing/provider'
import { planCatalogue } from '../billing/pricing'
import { planEntitlements, type WebhookEvent } from '../billing/types'
import { enforceRateLimit } from '../ratelimit'
import {
  getEntitlements,
  getSubscription,
  recordAudit,
  setEntitlements,
  upsertSubscription,
  upsertUser,
} from '../auth/accounts'
import { userIdFor } from '../auth/accounts'
import { badRequest, readJson, requireUser, unauthorized } from '../http'
import { getGraduateEligibility } from '../phase2'
import { logger } from '../logging'

export const billingRoutes = new Hono<AppEnv>()

billingRoutes.get('/billing/plans', (c) => {
  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  return c.json({
    plans: planCatalogue(config).map((plan) => ({
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
    billingEnabled: hasRealProvider(config),
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

  const origin = new URL(c.req.url).origin
  try {
    const session = await provider.createCheckoutSession({
      userId: user.id,
      email: user.email,
      plan: entry.id,
      priceId: config.billing.stripe.pricePro ?? '',
      amount: entry.price.amount,
      currency: entry.price.currency,
      returnUrl: `${origin}/?billing=1`,
    })

    await recordAudit(db, user.id, 'billing.checkout.started', {
      plan: entry.id,
      provider: provider.id,
    })
    return c.json({ session })
  } catch (error) {
    logger.error('billing checkout failed', { provider: provider.id, userId: user.id })
    return c.json(
      {
        error: 'checkout_failed',
        message:
          error instanceof Error ? error.message : 'The payment provider refused the request.',
      },
      502,
    )
  }
})

/** Opens the provider's customer portal so a subscriber can manage or cancel. */
billingRoutes.post('/billing/portal', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const subscription = await getSubscription(c.env.DB, user.id)
  if (!subscription?.providerCustomerId) {
    return badRequest(c, 'This account has no billing history.')
  }

  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)
  const origin = new URL(c.req.url).origin
  const session = await provider.createPortalSession(subscription.providerCustomerId, origin)
  return c.json({ session })
})

/**
 * Cancels the plan at the end of the period already paid for. The
 * entitlements stay until then, because the customer has paid for that
 * time, and the plan is not renewed.
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

  await upsertSubscription(db, { ...subscription, cancelAtPeriodEnd: true })
  await recordAudit(db, user.id, 'billing.cancel.requested', { plan: subscription.plan })
  logger.info('billing cancellation requested', { userId: user.id })

  return c.json({ subscription: await getSubscription(db, user.id) })
})

/**
 * The provider's webhook. The signature is verified before anything is
 * trusted, the event is ignored if it has already been seen, and the
 * subscription is written idempotently.
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
    // The signature was genuine but the payment could not be confirmed, so
    // the answer is a retryable status rather than a rejection: the
    // provider will send the event again.
    logger.error('billing webhook could not be confirmed', {
      provider: provider.id,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return c.json({ error: 'verification_failed' }, 503)
  }

  if (!event) {
    // An unverifiable webhook is rejected without comment.
    return c.json({ error: 'invalid_signature' }, 400)
  }

  const subscription = provider.subscriptionFromEvent(event)
  if (!subscription) {
    return c.json({ received: true })
  }

  const email = event.customerEmail
  if (!email) return c.json({ received: true })

  // A provider that retries will send the same event again, so it is
  // recorded before it is applied and the row is removed if applying it
  // fails, which leaves the retry free to try again.
  const fresh = await recordBillingEvent(c.env.DB, provider.id, event.eventId, event.type)
  if (!fresh) {
    return c.json({ received: true, duplicate: true })
  }

  try {
    const userId = await userIdFor(email)
    const user = await upsertUser(c.env.DB, email)

    await upsertSubscription(c.env.DB, {
      id: `sub_${subscription.subscriptionId || userId}`,
      userId: user.id,
      provider: provider.id,
      providerCustomerId: subscription.customerId,
      providerSubscriptionId: subscription.subscriptionId,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    })

    const active = subscription.status === 'active' || subscription.status === 'trialing'
    const entitlements =
      active && !subscription.cancelAtPeriodEnd ? planEntitlements(subscription.plan) : []
    await setEntitlements(c.env.DB, user.id, entitlements, subscription.currentPeriodEnd)

    await recordAudit(c.env.DB, user.id, 'billing.webhook', {
      type: event.type,
      status: subscription.status,
    })
    logger.info('billing webhook applied', { type: event.type, userId: user.id })
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

  await upsertSubscription(c.env.DB, {
    id: `sub_fake_${user.id}`,
    userId: user.id,
    provider: 'fake',
    providerCustomerId: `cus_fake_${user.id}`,
    providerSubscriptionId: `sub_fake_${user.id}`,
    plan: entry.id,
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cancelAtPeriodEnd: false,
  })
  await setEntitlements(c.env.DB, user.id, planEntitlements(entry.id))

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
 * Pricing waitlist (Prompt 17). Anonymous and rate limited; stores only the
 * email and a timestamp. It is never a checkout.
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
  // Older deployments created the table without the company column.
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
