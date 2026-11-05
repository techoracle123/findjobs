import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'

import { app } from '../../src/server/app'
import { upsertSubscription, upsertUser, userIdFor } from '../../src/server/auth/accounts'
import {
  createCheckoutAttempt,
  getFoundingClaim,
  priceForCheckout,
  updateAttemptSession,
} from '../../src/server/billing/checkouts'
import { hmacHex } from '../../src/server/billing/crypto'
import { readConfig } from '../../src/server/config'

const BASE = 'http://localhost:8787'
const SECRET = 'whsec_bachs_route_test'

function bachsEnv() {
  return {
    ...env,
    APP_MODE: 'test',
    BILLING_PROVIDER: 'bachs',
    BACHS_SECRET_KEY: 'sk_sandbox_test',
    BACHS_WEBHOOK_SECRET: SECRET,
  }
}

async function signedWebhook(event: Record<string, unknown>): Promise<Response> {
  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await hmacHex(SECRET, `${timestamp}.${payload}`)
  return app.fetch(
    new Request(`${BASE}/api/billing/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bachs-signature-v2': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    }),
    bachsEnv(),
  )
}

async function subscriptionFor(email: string) {
  const response = await SELF.fetch(`${BASE}/api/billing/subscription`, {
    headers: { 'x-dev-user-email': email },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    subscription: {
      plan: string
      status: string
      currentPeriodEnd: string | null
      cancelAtPeriodEnd: boolean
    } | null
    entitlements: string[]
  }
}

describe('Bachs fixed-time payments', () => {
  it('grants one month once, locks the founding price, and revokes after a full refund', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `bachs-${suffix}@example.com`
    await subscriptionFor(email) // creates the FJ user row
    const userId = await userIdFor(email)
    const attemptId = `att_${suffix}`
    const checkoutId = `chk_${suffix}`
    const chargeId = `ch_${suffix}`
    const reference = `fj_${attemptId}`

    const price = await priceForCheckout(
      env.DB,
      readConfig({ APP_MODE: 'test' }),
      userId,
      'pro',
      attemptId,
    )
    expect(price).toMatchObject({ amountMajor: 5000, amountKobo: 500_000, tier: 'founding' })
    const attempt = await createCheckoutAttempt(env.DB, {
      id: attemptId,
      userId,
      plan: 'pro',
      provider: 'bachs',
      pricingTier: price.tier,
      amountKobo: price.amountKobo,
      currency: 'NGN',
      reference,
      idempotencyKey: `fj-checkout-${attemptId}`,
    })
    await updateAttemptSession(env.DB, attempt.id, checkoutId, 'https://checkout.example.test')

    const paidEvent = {
      id: `evt_${suffix}_paid`,
      type: 'collection.succeeded',
      created_at: new Date().toISOString(),
      organization_id: 'acct_test',
      data: {
        charge_id: chargeId,
        checkout_id: checkoutId,
        reference,
        status: 'SUCCEEDED',
        amount: '5000.00',
        currency: 'NGN',
        customer: { id: `cust_${suffix}`, email },
        metadata: { user_id: userId, plan: 'pro', attempt_id: attemptId },
      },
    }
    expect((await signedWebhook(paidEvent)).status).toBe(200)

    const afterPayment = await subscriptionFor(email)
    expect(afterPayment.subscription?.plan).toBe('pro')
    expect(afterPayment.subscription?.status).toBe('active')
    expect(afterPayment.subscription?.cancelAtPeriodEnd).toBe(true)
    expect(afterPayment.entitlements).toContain('cv_analysis')
    const periodEnd = afterPayment.subscription?.currentPeriodEnd
    expect(periodEnd).toBeTruthy()
    expect(Date.parse(periodEnd!)).toBeGreaterThan(Date.now() + 27 * 86_400_000)
    expect(Date.parse(periodEnd!)).toBeLessThan(Date.now() + 32 * 86_400_000)

    const claim = await getFoundingClaim(env.DB, userId)
    expect(claim?.status).toBe('confirmed')
    expect(Date.parse(claim!.lockUntil!)).toBeGreaterThan(Date.now() + 360 * 86_400_000)

    const duplicate = await signedWebhook(paidEvent)
    expect(((await duplicate.json()) as { duplicate?: boolean }).duplicate).toBe(true)
    expect((await subscriptionFor(email)).subscription?.currentPeriodEnd).toBe(periodEnd)

    // A second Bachs event for the same charge must not add a second month.
    const completedEvent = {
      id: `evt_${suffix}_completed`,
      type: 'checkout.completed',
      created_at: new Date().toISOString(),
      organization_id: 'acct_test',
      data: {
        checkout_id: checkoutId,
        status: 'completed',
        mode: 'payment',
        payment_status: 'paid',
        amount: '5000.00',
        currency: 'NGN',
        reference,
        customer: { customer_id: `cust_${suffix}`, email },
        charge: {
          id: chargeId,
          customer_id: `cust_${suffix}`,
          amount: '5000.00',
          currency: 'NGN',
          status: 'succeeded',
        },
        metadata: { user_id: userId, plan: 'pro', attempt_id: attemptId },
      },
    }
    expect((await signedWebhook(completedEvent)).status).toBe(200)
    expect((await subscriptionFor(email)).subscription?.currentPeriodEnd).toBe(periodEnd)

    const refundEvent = {
      id: `evt_${suffix}_refund`,
      type: 'refund.paid',
      created_at: new Date().toISOString(),
      organization_id: 'acct_test',
      data: {
        refund_id: `ref_${suffix}`,
        charge_id: chargeId,
        reference: `refund_${suffix}`,
        status: 'paid',
        requested_amount: '5000.00',
        refunded_amount: '5000.00',
        refund_fee_amount: '0.00',
        fee_bearer: 'merchant',
      },
    }
    expect((await signedWebhook(refundEvent)).status).toBe(200)
    const afterRefund = await subscriptionFor(email)
    expect(afterRefund.subscription?.status).toBe('canceled')
    // The paid subscription is canceled, but the separate free-access policy
    // still makes current Pro tools available without recreating paid time.
    expect(afterRefund.entitlements).toContain('cv_analysis')
    expect(await getFoundingClaim(env.DB, userId)).toBeNull()
  })

  it('does not send a subscription from another provider to the Bachs portal', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `bachs-portal-${suffix}@example.com`
    const user = await upsertUser(env.DB, email, 'Portal Test')
    await upsertSubscription(env.DB, {
      id: `sub_fake_${suffix}`,
      userId: user.id,
      provider: 'fake',
      providerCustomerId: `cus_fake_${suffix}`,
      providerSubscriptionId: `sub_fake_${suffix}`,
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
    })

    const response = await app.fetch(
      new Request(`${BASE}/api/billing/portal`, {
        method: 'POST',
        headers: { 'x-dev-user-email': email },
      }),
      bachsEnv(),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: 'billing_record_not_manageable',
    })
  })

  it('does not grant Pro when the signed Bachs amount is not the checkout amount', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `bachs-wrong-${suffix}@example.com`
    await subscriptionFor(email)
    const userId = await userIdFor(email)
    const attemptId = `att_wrong_${suffix}`
    const checkoutId = `chk_wrong_${suffix}`
    const attempt = await createCheckoutAttempt(env.DB, {
      id: attemptId,
      userId,
      plan: 'pro',
      provider: 'bachs',
      pricingTier: 'founding',
      amountKobo: 500_000,
      currency: 'NGN',
      reference: `fj_${attemptId}`,
      idempotencyKey: `fj-checkout-${attemptId}`,
    })
    await updateAttemptSession(env.DB, attempt.id, checkoutId, 'https://checkout.example.test')

    const response = await signedWebhook({
      id: `evt_wrong_${suffix}`,
      type: 'collection.succeeded',
      created_at: new Date().toISOString(),
      organization_id: 'acct_test',
      data: {
        charge_id: `ch_wrong_${suffix}`,
        checkout_id: checkoutId,
        reference: attempt.reference,
        status: 'SUCCEEDED',
        amount: '100.00',
        currency: 'NGN',
        customer: { id: `cust_wrong_${suffix}`, email },
        metadata: { user_id: userId, plan: 'pro', attempt_id: attemptId },
      },
    })
    expect(response.status).toBe(200)
    expect((await subscriptionFor(email)).subscription).toBeNull()
  })
})
