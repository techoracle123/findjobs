import { describe, expect, it } from 'vitest'
import { hmacHex, timingSafeEqual } from '../../src/server/billing/crypto'
import { StripeProvider } from '../../src/server/billing/stripe'
import { PaystackProvider } from '../../src/server/billing/paystack'
import { FlutterwaveProvider } from '../../src/server/billing/flutterwave'
import { FakeProvider } from '../../src/server/billing/fake'
import {
  bachsCustomerName,
  BachsProvider,
  parseDecimalToKobo,
  toBillingProviderError,
  toDecimalString,
  type BachsClientLike,
} from '../../src/server/billing/bachs'
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

  it('uses Bachs in production only with a live key and a webhook secret', () => {
    const live = providerFor(
      readConfig({
        APP_MODE: 'production',
        BILLING_PROVIDER: 'bachs',
        BACHS_SECRET_KEY: 'sk_live_test',
        BACHS_WEBHOOK_SECRET: 'whsec_live',
      }),
    )
    expect(live.id).toBe('bachs')

    const sandboxInProduction = providerFor(
      readConfig({
        APP_MODE: 'production',
        BILLING_PROVIDER: 'bachs',
        BACHS_SECRET_KEY: 'sk_sandbox_test',
        BACHS_WEBHOOK_SECRET: 'whsec_sandbox',
      }),
    )
    expect(sandboxInProduction.id).toBe('fake')

    const partial = providerFor(
      readConfig({
        APP_MODE: 'production',
        BILLING_PROVIDER: 'bachs',
        BACHS_SECRET_KEY: 'sk_live_test',
      }),
    )
    expect(partial.id).toBe('fake')
  })

  it('infers Bachs from both usable secrets and removes accidental key whitespace', () => {
    const config = readConfig({
      APP_MODE: 'production',
      BACHS_SECRET_KEY: ' sk_live_test\n',
      BACHS_WEBHOOK_SECRET: ' whsec_live ',
    })
    expect(config.billing.provider).toBe('bachs')
    expect(config.billing.bachs).toEqual({
      secretKey: 'sk_live_test',
      webhookSecret: 'whsec_live',
    })
    expect(providerFor(config).id).toBe('bachs')
  })
})

/* -------------------------------------------------------------------------- */
/* bachs                                                                      */
/* -------------------------------------------------------------------------- */

const BACHS_WEBHOOK_SECRET = 'whsec_bachs_test'

async function bachsHeaders(payload: string): Promise<Headers> {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await hmacHex(BACHS_WEBHOOK_SECRET, `${timestamp}.${payload}`)
  return headers({ 'x-bachs-signature-v2': `t=${timestamp},v1=${signature}` })
}

function fakeBachsClient(
  create: (input: unknown, options: unknown) => Promise<unknown>,
): BachsClientLike {
  return {
    checkoutSessions: {
      create,
      get: async () => {
        throw new Error('not used')
      },
    },
    customerPortal: {
      createSession: async () => ({ id: 'psn_test', url: 'https://portal.example.test' }),
    },
    subscriptions: {
      cancel: async () => ({ id: 'sub_test', status: 'active' }),
    },
    webhooks: {
      constructEvent: () => {
        throw new Error('not used')
      },
    },
  } as unknown as BachsClientLike
}

describe('bachs adapter', () => {
  it('keeps Bachs money as decimal strings and FJ money as kobo', () => {
    expect(toDecimalString(500_000)).toBe('5000.00')
    expect(parseDecimalToKobo('40000.00')).toBe(4_000_000)
    expect(parseDecimalToKobo('3000')).toBe(300_000)
    expect(parseDecimalToKobo('12.345')).toBeNull()
  })

  it('creates an NGN card and bank transfer checkout with durable metadata', async () => {
    let seenInput: unknown
    let seenOptions: unknown
    const fakeClient = {
      checkoutSessions: {
        create: async (input: unknown, options: unknown) => {
          seenInput = input
          seenOptions = options
          return {
            checkout_id: 'chk_test',
            checkout_url: 'https://checkout.example.test/chk_test',
            status: 'open',
            expires_at: '2026-11-01T00:00:00Z',
            created_at: '2026-10-31T00:00:00Z',
            reference: 'fj_att_test',
          }
        },
        get: async () => {
          throw new Error('not used')
        },
      },
      customerPortal: {
        createSession: async () => ({ id: 'psn_test', url: 'https://portal.example.test' }),
      },
      subscriptions: {
        cancel: async () => ({ id: 'sub_test', status: 'active' }),
      },
      webhooks: {
        constructEvent: () => {
          throw new Error('not used')
        },
      },
    } as unknown as BachsClientLike
    const provider = new BachsProvider('sk_sandbox_test', BACHS_WEBHOOK_SECRET, PLANS, fakeClient)
    const session = await provider.createCheckoutSession({
      userId: 'usr_1',
      email: 'person@example.com',
      name: 'Test Person',
      plan: 'pro',
      priceId: '',
      amount: 5000,
      currency: 'NGN',
      returnUrl: 'https://example.com/dashboard?tab=plan&billing=checking',
      cancelUrl: 'https://example.com/pricing?billing=cancelled',
      reference: 'fj_att_test',
      idempotencyKey: 'fj-checkout-att_test',
      metadata: { attempt_id: 'att_test', pricing_tier: 'founding' },
    })
    expect(session).toEqual({ id: 'chk_test', url: 'https://checkout.example.test/chk_test' })
    const input = seenInput as {
      pricing: { amount: string; currency: string; price_type?: string }
      payment_method_types: string[]
      customer: { email: string; name: string }
      customer_creation?: string
      billing_currency?: string
      metadata: Record<string, string>
      reference: string
    }
    expect(input.pricing).toEqual({ currency: 'NGN', amount: '5000.00' })
    expect(input.customer).toEqual({ email: 'person@example.com', name: 'Test Person' })
    expect(input.customer_creation).toBeUndefined()
    expect(input.billing_currency).toBeUndefined()
    expect(input.payment_method_types).toEqual(['NGN_CARD', 'NGN_BANK_TRANSFER'])
    expect(input.reference).toBe('fj_att_test')
    expect(input.metadata).toMatchObject({
      user_id: 'usr_1',
      plan: 'pro',
      attempt_id: 'att_test',
      pricing_tier: 'founding',
    })
    expect(seenOptions).toEqual({ idempotencyKey: 'fj-checkout-att_test' })
  })

  it('falls back to guest checkout when the Bachs key cannot create a customer', async () => {
    const inputs: unknown[] = []
    const optionsSeen: unknown[] = []
    const provider = new BachsProvider(
      'sk_sandbox_test',
      BACHS_WEBHOOK_SECRET,
      PLANS,
      fakeBachsClient(async (input, options) => {
        inputs.push(input)
        optionsSeen.push(options)
        if (inputs.length === 1) {
          throw Object.assign(new Error('raw forbidden detail'), {
            name: 'BachsApiError',
            statusCode: 403,
            errorCode: 'FORBIDDEN',
          })
        }
        return {
          checkout_id: 'chk_guest',
          checkout_url: 'https://checkout.example.test/chk_guest',
          status: 'open',
          expires_at: '2026-11-01T00:00:00Z',
          created_at: '2026-10-31T00:00:00Z',
          reference: 'fj_att_guest',
        }
      }),
    )

    await expect(
      provider.createCheckoutSession({
        userId: 'usr_1',
        email: 'person@example.com',
        name: 'Test Person',
        plan: 'pro',
        priceId: '',
        amount: 5000,
        currency: 'NGN',
        returnUrl: 'https://example.com/dashboard',
        reference: 'fj_att_guest',
        idempotencyKey: 'fj-checkout-att_guest',
      }),
    ).resolves.toEqual({ id: 'chk_guest', url: 'https://checkout.example.test/chk_guest' })

    const seen = inputs as {
      customer?: { email: string; name: string }
      customer_creation?: string
      payment_method_types?: string[]
      reference: string
    }[]
    expect(seen).toHaveLength(2)
    expect(seen[0].customer).toEqual({ email: 'person@example.com', name: 'Test Person' })
    expect(seen[1].customer).toBeUndefined()
    expect(seen[1].customer_creation).toBe('if_required')
    expect(seen[1].payment_method_types).toEqual(['NGN_CARD', 'NGN_BANK_TRANSFER'])
    expect(seen.map((input) => input.reference)).toEqual(['fj_att_guest', 'fj_att_guest'])
    expect(optionsSeen).toEqual([
      { idempotencyKey: 'fj-checkout-att_guest' },
      { idempotencyKey: 'fj-checkout-att_guest-guest-ngn-methods' },
    ])
  })

  it('uses Bachs account methods when the NGN restriction leaves no method', async () => {
    const inputs: unknown[] = []
    const provider = new BachsProvider(
      'sk_sandbox_test',
      BACHS_WEBHOOK_SECRET,
      PLANS,
      fakeBachsClient(async (input) => {
        inputs.push(input)
        if (inputs.length === 1) {
          throw Object.assign(new Error('raw restriction detail'), {
            name: 'BachsApiError',
            statusCode: 400,
            errorCode: 'CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD',
          })
        }
        return {
          checkout_id: 'chk_defaults',
          checkout_url: 'https://checkout.example.test/chk_defaults',
          status: 'open',
          expires_at: '2026-11-01T00:00:00Z',
          created_at: '2026-10-31T00:00:00Z',
          reference: 'fj_att_defaults',
        }
      }),
    )

    await provider.createCheckoutSession({
      userId: 'usr_1',
      email: 'person@example.com',
      name: 'Test Person',
      plan: 'pro',
      priceId: '',
      amount: 5000,
      currency: 'NGN',
      returnUrl: 'https://example.com/dashboard',
      reference: 'fj_att_defaults',
      idempotencyKey: 'fj-checkout-att_defaults',
    })

    const seen = inputs as {
      customer?: { email: string; name: string }
      payment_method_types?: string[]
    }[]
    expect(seen).toHaveLength(2)
    expect(seen[0].payment_method_types).toEqual(['NGN_CARD', 'NGN_BANK_TRANSFER'])
    expect(seen[1].payment_method_types).toBeUndefined()
    expect(seen[1].customer).toEqual({ email: 'person@example.com', name: 'Test Person' })
  })

  it('lets Bachs collect buyer details when the stored account email is unusable', async () => {
    let seenInput: unknown
    const provider = new BachsProvider(
      'sk_sandbox_test',
      BACHS_WEBHOOK_SECRET,
      PLANS,
      fakeBachsClient(async (input) => {
        seenInput = input
        return {
          checkout_id: 'chk_collect_details',
          checkout_url: 'https://checkout.example.test/chk_collect_details',
          status: 'open',
          expires_at: '2026-11-01T00:00:00Z',
          created_at: '2026-10-31T00:00:00Z',
          reference: 'fj_att_collect_details',
        }
      }),
    )

    await provider.createCheckoutSession({
      userId: 'usr_1',
      email: 'not-an-email',
      plan: 'pro',
      priceId: '',
      amount: 5000,
      currency: 'NGN',
      returnUrl: 'https://example.com/dashboard',
      reference: 'fj_att_collect_details',
    })

    const input = seenInput as { customer?: unknown; customer_creation?: string }
    expect(input.customer).toBeUndefined()
    expect(input.customer_creation).toBe('if_required')
  })

  it('never sends an internal FJ id or email address as the Bachs customer name', () => {
    expect(bachsCustomerName('usr_0123456789abcdef0123456789abcdef')).toBe('FJ customer')
    expect(bachsCustomerName('dev:person@example.com')).toBe('FJ customer')
    expect(bachsCustomerName('person@example.com')).toBe('FJ customer')
    expect(bachsCustomerName('  Ada   Lovelace ')).toBe('Ada Lovelace')
  })

  it('keeps only safe fields from a Bachs SDK failure', () => {
    const raw = Object.assign(new Error('raw provider detail with a secret'), {
      name: 'BachsApiError',
      statusCode: 403,
      errorCode: 'ACCOUNT_NOT_ACTIVATED',
      requestId: 'req_safe_123',
      fieldErrors: [{ field: 'pricing.amount', message: 'raw provider detail' }],
      body: { detail: 'raw provider detail with a secret' },
    })
    const safe = toBillingProviderError(raw, 'Bachs could not create the checkout.')
    expect(safe).toMatchObject({
      failure: 'provider_account_attention',
      httpStatus: 403,
      providerCode: 'ACCOUNT_NOT_ACTIVATED',
      providerRequestId: 'req_safe_123',
      fieldNames: ['pricing.amount'],
      message: 'Bachs could not create the checkout.',
    })
    expect(JSON.stringify(safe)).not.toContain('raw provider detail')
    expect(safe.message).not.toContain('secret')

    const validation = Object.assign(new Error('raw validation'), {
      name: 'BachsApiError',
      statusCode: 422,
      errorCode: 'VALIDATION_ERROR',
      fieldErrors: [{ field: 'customer.email' }],
    })
    expect(toBillingProviderError(validation, 'safe').failure).toBe('provider_validation')

    const uncertain = Object.assign(new Error('network down'), {
      name: 'BachsNetworkError',
      outcomeUnknown: true,
    })
    expect(toBillingProviderError(uncertain, 'safe').failure).toBe('outcome_unknown')
  })

  it('reads accepted and overpaid Bachs checkouts back as paid', async () => {
    const fakeClient = {
      checkoutSessions: {
        create: async () => {
          throw new Error('not used')
        },
        get: async () => ({
          checkout_id: 'chk_fetch',
          status: 'completed',
          payment_status: 'succeeded',
          amount: '5000.00',
          currency: 'NGN',
          reference: 'fj_att_fetch',
          completed_at: '2026-10-31T12:00:00Z',
          customer: { id: 'cust_fetch', email: 'person@example.com' },
          charge: {
            id: 'ch_fetch',
            status: 'overpaid',
            amount: '5000.00',
            currency: 'NGN',
            reference: 'fj_att_fetch',
            completed_at: '2026-10-31T12:00:00Z',
          },
          metadata: { user_id: 'usr_1', plan: 'pro' },
        }),
      },
      customerPortal: {
        createSession: async () => ({ id: 'psn_test', url: 'https://portal.example.test' }),
      },
      subscriptions: {
        cancel: async () => ({ id: 'sub_test', status: 'active' }),
      },
      webhooks: {
        constructEvent: () => {
          throw new Error('not used')
        },
      },
    } as unknown as BachsClientLike
    const provider = new BachsProvider('sk_sandbox_test', BACHS_WEBHOOK_SECRET, PLANS, fakeClient)
    await expect(provider.fetchCheckout('chk_fetch')).resolves.toMatchObject({
      checkoutId: 'chk_fetch',
      chargeId: 'ch_fetch',
      status: 'succeeded',
      amount: 5000,
      currency: 'NGN',
      customerId: 'cust_fetch',
      plan: 'pro',
    })
  })

  it('verifies and parses a Bachs collection.succeeded event', async () => {
    const provider = new BachsProvider('sk_sandbox_test', BACHS_WEBHOOK_SECRET, PLANS)
    const payload = JSON.stringify({
      id: 'evt_bachs_1',
      type: 'collection.succeeded',
      created_at: '2026-10-31T12:00:00.000Z',
      organization_id: 'acct_test',
      data: {
        charge_id: 'ch_test',
        checkout_id: 'chk_test',
        reference: 'fj_att_test',
        status: 'SUCCEEDED',
        amount: '5000.00',
        currency: 'NGN',
        customer: { id: 'cust_test', email: 'person@example.com', name: 'Test Person' },
        metadata: { user_id: 'usr_1', plan: 'pro', attempt_id: 'att_test' },
      },
    })
    const event = await provider.parseWebhook(payload, await bachsHeaders(payload))
    expect(event?.userId).toBe('usr_1')
    expect(event?.providerPayment).toMatchObject({
      checkoutId: 'chk_test',
      chargeId: 'ch_test',
      reference: 'fj_att_test',
      status: 'succeeded',
      amount: 5000,
      currency: 'NGN',
      customerId: 'cust_test',
      plan: 'pro',
    })

    const tampered = payload.replace('5000.00', '100.00')
    expect(await provider.parseWebhook(tampered, await bachsHeaders(payload))).toBeNull()
  })

  it('treats ACCEPTED and OVERPAID Bachs collections as successful payments', async () => {
    const provider = new BachsProvider('sk_sandbox_test', BACHS_WEBHOOK_SECRET, PLANS)
    for (const status of ['ACCEPTED', 'OVERPAID']) {
      const payload = JSON.stringify({
        id: `evt_bachs_${status.toLowerCase()}`,
        type: 'collection.succeeded',
        created_at: '2026-10-31T12:00:00.000Z',
        organization_id: 'acct_test',
        data: {
          charge_id: `ch_${status.toLowerCase()}`,
          checkout_id: 'chk_test',
          reference: 'fj_att_test',
          status,
          amount: '5000.00',
          currency: 'NGN',
          customer: { customer_id: 'cust_test', email: 'person@example.com' },
          metadata: { user_id: 'usr_1', plan: 'pro', attempt_id: 'att_test' },
        },
      })
      const event = await provider.parseWebhook(payload, await bachsHeaders(payload))
      expect(event?.providerPayment).toMatchObject({
        status: 'succeeded',
        statusDetail: status,
        customerId: 'cust_test',
        amount: 5000,
      })
    }
  })

  it('parses a direct Bachs subscription event without trusting email for the plan', async () => {
    const provider = new BachsProvider('sk_sandbox_test', BACHS_WEBHOOK_SECRET, PLANS)
    const payload = JSON.stringify({
      id: 'evt_bachs_2',
      type: 'customer.subscription.created',
      created_at: '2026-10-31T12:00:00.000Z',
      organization_id: 'acct_test',
      data: {
        subscription_id: 'sub_test',
        customer: { customer_id: 'cust_test', email: 'person@example.com' },
        product_id: 'prod_test',
        status: 'active',
        currency: 'USD',
        amount: '5.00',
        billing_cycle: { interval: 'month', frequency: 1 },
        current_period_end: '2026-11-30T12:00:00Z',
        cancel_at_period_end: true,
        metadata: { user_id: 'usr_1', plan: 'pro' },
      },
    })
    const event = await provider.parseWebhook(payload, await bachsHeaders(payload))
    expect(event?.providerSubscription).toMatchObject({
      customerId: 'cust_test',
      subscriptionId: 'sub_test',
      plan: 'pro',
      status: 'active',
      cancelAtPeriodEnd: true,
    })
    expect(
      subscriptionHasFeature(
        {
          id: 'sub_1',
          userId: 'usr_1',
          provider: 'bachs',
          providerCustomerId: 'cust_test',
          providerSubscriptionId: 'sub_test',
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
          cancelAtPeriodEnd: true,
        },
        planEntitlements('pro'),
        'cv_analysis',
      ),
    ).toBe(true)
  })
})
