import { describe, expect, it } from 'vitest'
import { hmacHex, StripeProvider, timingSafeEqual } from '../../src/server/billing/stripe'
import { FakeProvider } from '../../src/server/billing/fake'
import { planEntitlements, subscriptionHasFeature } from '../../src/server/billing/types'
import { providerFor } from '../../src/server/billing/provider'
import { readConfig } from '../../src/server/config'

const SECRET = 'whsec_test_secret'
const EVENT = {
  type: 'checkout.session.completed',
  data: {
    object: {
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

async function signedHeader(payload: string, timestamp: number): Promise<string> {
  const signature = await hmacHex(SECRET, `${timestamp}.${payload}`)
  return `t=${timestamp},v1=${signature}`
}

describe('stripe webhook signatures', () => {
  const provider = new StripeProvider('sk_test', SECRET)

  it('accepts a correctly signed event', async () => {
    const payload = JSON.stringify(EVENT)
    const header = await signedHeader(payload, Math.floor(Date.now() / 1000))

    const event = await provider.parseWebhook(payload, header)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('checkout.session.completed')
    expect(event?.customerEmail).toBe('person@example.com')
    expect(event?.providerSubscription?.plan).toBe('pro')
    expect(event?.providerSubscription?.status).toBe('active')
  })

  it('rejects an event signed with the wrong secret', async () => {
    const payload = JSON.stringify(EVENT)
    const signature = await hmacHex('whsec_wrong', `${Math.floor(Date.now() / 1000)}.${payload}`)
    const header = `t=${Math.floor(Date.now() / 1000)},v1=${signature}`

    expect(await provider.parseWebhook(payload, header)).toBeNull()
  })

  it('rejects a missing signature', async () => {
    const payload = JSON.stringify(EVENT)
    expect(await provider.parseWebhook(payload, null)).toBeNull()
  })

  it('rejects a replayed event outside the tolerance window', async () => {
    const payload = JSON.stringify(EVENT)
    const old = Math.floor(Date.now() / 1000) - 3600
    const header = await signedHeader(payload, old)

    expect(await provider.parseWebhook(payload, header)).toBeNull()
  })

  it('rejects a payload that was changed after signing', async () => {
    const original = JSON.stringify(EVENT)
    const header = await signedHeader(original, Math.floor(Date.now() / 1000))
    const tampered = JSON.stringify({
      ...EVENT,
      data: { object: { customer_email: 'root@x.com' } },
    })

    expect(await provider.parseWebhook(tampered, header)).toBeNull()
  })
})

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
    expect(planEntitlements('free')).toEqual([])
    expect(planEntitlements('pro')).toContain('alerts')
    expect(planEntitlements('unknown-plan')).toEqual([])
  })

  it('grants a feature only for an active, not-cancelled subscription', () => {
    const base = {
      id: 'sub_1',
      userId: 'usr_1',
      provider: 'stripe',
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
    expect(subscriptionHasFeature({ ...base, cancelAtPeriodEnd: true }, ['alerts'], 'alerts')).toBe(
      false,
    )
    expect(subscriptionHasFeature(null, ['alerts'], 'alerts')).toBe(false)
    expect(subscriptionHasFeature(base, [], 'alerts')).toBe(false)
  })
})

describe('provider selection', () => {
  it('uses the fake provider when nothing is configured', () => {
    const provider = providerFor(readConfig({ APP_MODE: 'test' }))
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
      priceId: 'price_123',
      returnUrl: 'https://example.com/',
    })
    expect(session.url).toContain('checkout=confirm')
  })
})
