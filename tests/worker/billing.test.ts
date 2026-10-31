import { describe, expect, it } from 'vitest'
import { hmacHex, timingSafeEqual } from '../../src/server/billing/crypto'
import { StripeProvider } from '../../src/server/billing/stripe'
import { PaystackProvider } from '../../src/server/billing/paystack'
import { FlutterwaveProvider } from '../../src/server/billing/flutterwave'
import { FakeProvider } from '../../src/server/billing/fake'
import {
  planEntitlements,
  subscriptionHasFeature,
  type PlanPriceMap,
} from '../../src/server/billing/types'
import { providerFor } from '../../src/server/billing/provider'
import { formatPrice, planForAmount } from '../../src/server/billing/pricing'
import { readConfig } from '../../src/server/config'

const PLANS: PlanPriceMap = { pro: { amount: 5000, currency: 'NGN' } }

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

/* -------------------------------------------------------------------------- */
/* stripe                                                                     */
/* -------------------------------------------------------------------------- */

const STRIPE_SECRET = 'whsec_test_secret'
const STRIPE_EVENT = {
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      customer_email: 'person@example.com',
      customer: 'cus_123',
      subscription: 'sub_123',
      status: 'active',
      current_period_end: 1_800_000_000,
      cancel_at_period_end: false,
      metadata: { plan: 'pro' },
    },
  },
}

async function stripeHeader(payload: string, timestamp: number): Promise<string> {
  const signature = await hmacHex(STRIPE_SECRET, `${timestamp}.${payload}`)
  return `t=${timestamp},v1=${signature}`
}

describe('stripe webhook signatures', () => {
  const provider = new StripeProvider('sk_test', STRIPE_SECRET, PLANS)

  it('accepts a correctly signed event', async () => {
    const payload = JSON.stringify(STRIPE_EVENT)
    const header = await stripeHeader(payload, Math.floor(Date.now() / 1000))

    const event = await provider.parseWebhook(payload, headers({ 'stripe-signature': header }))
    expect(event).not.toBeNull()
    expect(event?.type).toBe('checkout.session.completed')
    expect(event?.eventId).toBe('cs_1')
    expect(event?.customerEmail).toBe('person@example.com')
    expect(event?.providerSubscription?.plan).toBe('pro')
    expect(event?.providerSubscription?.status).toBe('active')
  })

  it('rejects an event signed with the wrong secret', async () => {
    const payload = JSON.stringify(STRIPE_EVENT)
    const signature = await hmacHex('whsec_wrong', `${Math.floor(Date.now() / 1000)}.${payload}`)
    const header = `t=${Math.floor(Date.now() / 1000)},v1=${signature}`

    expect(await provider.parseWebhook(payload, headers({ 'stripe-signature': header }))).toBeNull()
  })

  it('rejects a missing signature', async () => {
    const payload = JSON.stringify(STRIPE_EVENT)
    expect(await provider.parseWebhook(payload, headers({}))).toBeNull()
  })

  it('rejects a replayed event outside the tolerance window', async () => {
    const payload = JSON.stringify(STRIPE_EVENT)
    const old = Math.floor(Date.now() / 1000) - 3600
    const header = await stripeHeader(payload, old)

    expect(await provider.parseWebhook(payload, headers({ 'stripe-signature': header }))).toBeNull()
  })

  it('rejects a payload that was changed after signing', async () => {
    const original = JSON.stringify(STRIPE_EVENT)
    const header = await stripeHeader(original, Math.floor(Date.now() / 1000))
    const tampered = JSON.stringify({
      ...STRIPE_EVENT,
      data: { object: { customer_email: 'root@x.com' } },
    })

    expect(
      await provider.parseWebhook(tampered, headers({ 'stripe-signature': header })),
    ).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* paystack                                                                   */
/* -------------------------------------------------------------------------- */

const PAYSTACK_SECRET = 'sk_test_abc123'

function paystackCharge(reference: string, amountKobo: number) {
  return {
    event: 'charge.success',
    data: {
      id: 1001,
      reference,
      amount: amountKobo,
      currency: 'NGN',
      status: 'success',
      customer: { id: 12, customer_code: 'CUS_1', email: 'person@example.com' },
      paid_at: '2026-10-18T10:00:00Z',
    },
  }
}

function paystackFetch(verifyData: Record<string, unknown>) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    if (url.includes('/transaction/verify/')) {
      return new Response(JSON.stringify({ status: true, data: verifyData }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected request: ${url}`)
  }
}

describe('paystack webhooks', () => {
  const verified = {
    id: 1001,
    reference: 'rs_usr_1_abc',
    amount: 500_000,
    currency: 'NGN',
    status: 'success',
    customer: { id: 12, customer_code: 'CUS_1', email: 'person@example.com' },
    paid_at: '2026-10-18T10:00:00Z',
  }

  it('accepts a correctly signed charge and confirms it with the API', async () => {
    const provider = new PaystackProvider(PAYSTACK_SECRET, PLANS, paystackFetch(verified))
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 500_000))
    const signature = await hmacHex(PAYSTACK_SECRET, payload, 'SHA-512')

    const event = await provider.parseWebhook(
      payload,
      headers({ 'x-paystack-signature': signature }),
    )

    expect(event).not.toBeNull()
    expect(event?.type).toBe('charge.success')
    expect(event?.customerEmail).toBe('person@example.com')
    expect(event?.providerSubscription?.plan).toBe('pro')
    expect(event?.providerSubscription?.status).toBe('active')
    expect(event?.providerSubscription?.subscriptionId).toBe('rs_usr_1_abc')
  })

  it('rejects a charge signed with the wrong secret', async () => {
    const provider = new PaystackProvider(PAYSTACK_SECRET, PLANS, paystackFetch(verified))
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 500_000))
    const signature = await hmacHex('sk_test_wrong', payload, 'SHA-512')

    expect(
      await provider.parseWebhook(payload, headers({ 'x-paystack-signature': signature })),
    ).toBeNull()
  })

  it('rejects a charge with no signature header', async () => {
    const provider = new PaystackProvider(PAYSTACK_SECRET, PLANS, paystackFetch(verified))
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 500_000))

    expect(await provider.parseWebhook(payload, headers({}))).toBeNull()
  })

  it('takes the plan from the confirmed amount, not from the body', async () => {
    // The body is signed by Paystack, but the amount that decides the plan
    // is the one Paystack confirms over the API.
    const provider = new PaystackProvider(PAYSTACK_SECRET, PLANS, paystackFetch(verified))
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 100))
    const signature = await hmacHex(PAYSTACK_SECRET, payload, 'SHA-512')

    const event = await provider.parseWebhook(
      payload,
      headers({ 'x-paystack-signature': signature }),
    )
    expect(event?.providerSubscription?.plan).toBe('pro')
  })

  it('rejects a confirmed charge that is not the price of a plan', async () => {
    const provider = new PaystackProvider(
      PAYSTACK_SECRET,
      PLANS,
      paystackFetch({ ...verified, amount: 100 }),
    )
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 100))
    const signature = await hmacHex(PAYSTACK_SECRET, payload, 'SHA-512')

    await expect(
      provider.parseWebhook(payload, headers({ 'x-paystack-signature': signature })),
    ).rejects.toThrow(/does not match any plan price/)
  })

  it('rejects a charge that Paystack says did not settle', async () => {
    const provider = new PaystackProvider(
      PAYSTACK_SECRET,
      PLANS,
      paystackFetch({ ...verified, status: 'failed' }),
    )
    const payload = JSON.stringify(paystackCharge('rs_usr_1_abc', 500_000))
    const signature = await hmacHex(PAYSTACK_SECRET, payload, 'SHA-512')

    expect(
      await provider.parseWebhook(payload, headers({ 'x-paystack-signature': signature })),
    ).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* flutterwave                                                                */
/* -------------------------------------------------------------------------- */

const FLW_SECRET = 'FLWSECK_TEST-abc'
const FLW_HASH = 'dashboard-secret-hash'

function flwCharge(amount: number) {
  return {
    event: 'charge.completed',
    data: {
      id: 4_975_364,
      tx_ref: 'rs_usr_1_pro_abc',
      amount,
      currency: 'NGN',
      status: 'successful',
      customer: { id: 9, email: 'person@example.com' },
      created_at: '2026-10-18T10:00:00Z',
    },
  }
}

function flwFetch(verifyData: Record<string, unknown>) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    if (url.includes('/transactions/') && url.includes('/verify')) {
      return new Response(JSON.stringify({ status: 'success', data: verifyData }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected request: ${url}`)
  }
}

describe('flutterwave webhooks', () => {
  const verified = {
    id: 4_975_364,
    tx_ref: 'rs_usr_1_pro_abc',
    amount: 5000,
    currency: 'NGN',
    status: 'successful',
    customer: { id: 9, email: 'person@example.com' },
    created_at: '2026-10-18T10:00:00Z',
  }

  it('accepts a charge with the right verif-hash and confirms it with the API', async () => {
    const provider = new FlutterwaveProvider(FLW_SECRET, FLW_HASH, PLANS, flwFetch(verified))
    const payload = JSON.stringify(flwCharge(5000))

    const event = await provider.parseWebhook(payload, headers({ 'verif-hash': FLW_HASH }))

    expect(event).not.toBeNull()
    expect(event?.type).toBe('charge.completed')
    expect(event?.customerEmail).toBe('person@example.com')
    expect(event?.providerSubscription?.plan).toBe('pro')
  })

  it('rejects a charge with the wrong verif-hash', async () => {
    const provider = new FlutterwaveProvider(FLW_SECRET, FLW_HASH, PLANS, flwFetch(verified))
    const payload = JSON.stringify(flwCharge(5000))

    expect(
      await provider.parseWebhook(payload, headers({ 'verif-hash': 'not-the-hash' })),
    ).toBeNull()
  })

  it('rejects a charge with no signature at all', async () => {
    const provider = new FlutterwaveProvider(FLW_SECRET, FLW_HASH, PLANS, flwFetch(verified))
    const payload = JSON.stringify(flwCharge(5000))

    expect(await provider.parseWebhook(payload, headers({}))).toBeNull()
  })

  it('takes the plan from the confirmed amount, not from the body', async () => {
    // The verif-hash is a static secret, so the body can say anything. The
    // price that decides the plan is the one the provider confirms.
    const provider = new FlutterwaveProvider(FLW_SECRET, FLW_HASH, PLANS, flwFetch(verified))
    const payload = JSON.stringify(flwCharge(1))

    const event = await provider.parseWebhook(payload, headers({ 'verif-hash': FLW_HASH }))
    expect(event?.providerSubscription?.plan).toBe('pro')
  })

  it('rejects a confirmed charge that is not the price of a plan', async () => {
    const provider = new FlutterwaveProvider(
      FLW_SECRET,
      FLW_HASH,
      PLANS,
      flwFetch({ ...verified, amount: 1 }),
    )
    const payload = JSON.stringify(flwCharge(1))

    await expect(
      provider.parseWebhook(payload, headers({ 'verif-hash': FLW_HASH })),
    ).rejects.toThrow(/does not match any plan price/)
  })

  it('rejects a charge that Flutterwave says did not settle', async () => {
    const provider = new FlutterwaveProvider(
      FLW_SECRET,
      FLW_HASH,
      PLANS,
      flwFetch({ ...verified, status: 'failed' }),
    )
    const payload = JSON.stringify(flwCharge(5000))

    expect(await provider.parseWebhook(payload, headers({ 'verif-hash': FLW_HASH }))).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* provider selection                                                         */
/* -------------------------------------------------------------------------- */

describe('timing safe comparison', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })
})

describe('entitlements', () => {
  it('maps plans to their entitlements', () => {
    // Alerts are free for everyone (they were never charged for).
    expect(planEntitlements('free')).toEqual(['alerts'])
    expect(planEntitlements('pro')).toContain('alerts')
    expect(planEntitlements('pro_graduate')).toContain('cv_analysis')
    expect(planEntitlements('pro_graduate')).toEqual(planEntitlements('pro'))
    expect(planEntitlements('pro')).not.toContain('weekly_digest')
    expect(planEntitlements('pro')).not.toContain('unlimited_fast_apply')
    expect(planEntitlements('pro')).not.toContain('verified_source_badges')
    expect(planEntitlements('unknown-plan')).toEqual([])
  })

  it('grants a feature only for an active subscription', () => {
    const base = {
      id: 'sub_1',
      userId: 'usr_1',
      provider: 'paystack',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }

    expect(subscriptionHasFeature(base, ['alerts'], 'alerts')).toBe(true)
    expect(subscriptionHasFeature({ ...base, status: 'past_due' }, ['alerts'], 'alerts')).toBe(
      false,
    )
    expect(subscriptionHasFeature(null, ['alerts'], 'alerts')).toBe(false)
    expect(subscriptionHasFeature(base, [], 'alerts')).toBe(false)
  })

  it('keeps a feature until the paid period has actually ended', () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString()
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const base = {
      id: 'sub_1',
      userId: 'usr_1',
      provider: 'paystack',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: soon,
      cancelAtPeriodEnd: false,
    }

    expect(subscriptionHasFeature(base, ['alerts'], 'alerts')).toBe(true)
    expect(subscriptionHasFeature({ ...base, cancelAtPeriodEnd: true }, ['alerts'], 'alerts')).toBe(
      true,
    )
    expect(
      subscriptionHasFeature(
        { ...base, cancelAtPeriodEnd: true, currentPeriodEnd: past },
        ['alerts'],
        'alerts',
      ),
    ).toBe(false)
  })
})

describe('plan prices', () => {
  it('finds the plan a payment buys from the amount charged', () => {
    expect(planForAmount(PLANS, 5000, 'NGN')).toBe('pro')
    expect(planForAmount(PLANS, 1, 'NGN')).toBeNull()
    expect(planForAmount(PLANS, 5000, 'USD')).toBeNull()
  })

  it('formats a price for people to read', () => {
    expect(formatPrice({ amount: 0, currency: 'NGN' })).toBe('Free')
    expect(formatPrice({ amount: 5000, currency: 'NGN' })).toContain('5,000')
    expect(formatPrice({ amount: 9, currency: 'USD' })).toBe('$9')
  })
})

describe('provider selection', () => {
  it('uses the fake provider when nothing is configured', () => {
    const provider = providerFor(readConfig({ APP_MODE: 'test' }))
    expect(provider.id).toBe('fake')
  })

  it('infers paystack from the key that is present', () => {
    const provider = providerFor(
      readConfig({ APP_MODE: 'production', PAYSTACK_SECRET_KEY: 'sk_live' }),
    )
    expect(provider.id).toBe('paystack')
  })

  it('infers flutterwave from the key that is present', () => {
    const provider = providerFor(
      readConfig({
        APP_MODE: 'production',
        FLUTTERWAVE_SECRET_KEY: 'FLWSECK',
        FLUTTERWAVE_WEBHOOK_SECRET: 'hash',
      }),
    )
    expect(provider.id).toBe('flutterwave')
  })

  it('falls back when the chosen provider is not fully configured', () => {
    const provider = providerFor(
      readConfig({
        APP_MODE: 'production',
        BILLING_PROVIDER: 'flutterwave',
        FLUTTERWAVE_SECRET_KEY: 'FLWSECK',
      }),
    )
    expect(provider.id).toBe('fake')
  })

  it('uses Stripe only when it is fully configured', () => {
    const provider = providerFor(
      readConfig({
        APP_MODE: 'production',
        STRIPE_SECRET_KEY: 'sk_live',
        STRIPE_WEBHOOK_SECRET: 'whsec_live',
        STRIPE_PRICE_PRO: 'price_123',
      }),
    )
    expect(provider.id).toBe('stripe')
  })

  it('falls back when the price is missing', () => {
    const provider = providerFor(
      readConfig({
        APP_MODE: 'production',
        STRIPE_SECRET_KEY: 'sk_live',
        STRIPE_WEBHOOK_SECRET: 'whsec_live',
      }),
    )
    expect(provider.id).toBe('fake')
  })

  it('never charges anything through the fake provider', async () => {
    const provider = new FakeProvider()
    const session = await provider.createCheckoutSession({
      userId: 'usr_1',
      email: 'person@example.com',
      plan: 'pro',
      priceId: '',
      amount: 5000,
      currency: 'NGN',
      returnUrl: 'https://example.com/',
    })
    expect(session.url).toContain('checkout=confirm')
  })
})
