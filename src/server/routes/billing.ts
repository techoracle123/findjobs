import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig } from '../config'
import { hasRealProvider, providerFor } from '../billing/provider'
import { PLANS, planEntitlements } from '../billing/types'
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
import { logger } from '../logging'

export const billingRoutes = new Hono<AppEnv>()

billingRoutes.get('/billing/plans', (c) => {
  const config = readConfig(c.env ?? {})
  return c.json({
    plans: Object.values(PLANS).map((plan) => ({
      id: plan.id,
      label: plan.label,
      entitlements: [...plan.entitlements],
    })),
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
  const entry = PLANS[plan as keyof typeof PLANS]
  if (!entry) return badRequest(c, `Unknown plan: ${plan}`)

  const priceId = config.stripe.pricePro
  if (!priceId) {
    return c.json(
      { error: 'billing_not_configured', message: 'No payment provider is configured.' },
      503,
    )
  }

  const origin = new URL(c.req.url).origin
  const provider = providerFor(config)
  const session = await provider.createCheckoutSession({
    userId: user.id,
    email: user.email,
    plan: entry.id,
    priceId,
    returnUrl: `${origin}/?billing=1`,
  })

  await recordAudit(db, user.id, 'billing.checkout.started', { plan: entry.id })
  return c.json({ session })
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
 * The provider's webhook. The signature is verified before anything is
 * trusted, and the event is processed idempotently by writing the resulting
 * subscription state.
 */
billingRoutes.post('/billing/webhook', async (c) => {
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const payload = await c.req.text()
  const config = readConfig(c.env ?? {})
  const provider = providerFor(config)

  const signature = c.req.header('stripe-signature')
  const event = await provider.parseWebhook(payload, signature ?? null)
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

  return c.json({ received: true })
})

/**
 * A stand-in for the provider's checkout completion, used by the local fake
 * provider. It is only available outside production.
 */
billingRoutes.post('/billing/confirm', async (c) => {
  const config = readConfig(c.env ?? {})
  if (config.isProduction) return c.json({ error: 'not_found' }, 404)

  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const plan = typeof body.plan === 'string' ? body.plan : 'pro'
  const entry = PLANS[plan as keyof typeof PLANS]
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
