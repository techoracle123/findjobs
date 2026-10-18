import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'

import { aiUsage, consumeAiQuota, releaseAiQuota, takeAiBudget } from '../../src/server/aiquota'
import { readConfig } from '../../src/server/config'

const BASE = 'http://localhost:8787'
const DEV = { 'x-dev-user-email': 'ops@example.com' }

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers })
}

async function post(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('the readiness report', () => {
  it('says what is working and what is missing', async () => {
    const response = await get('/api/readiness')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      ready: boolean
      provider: string
      checks: { id: string; status: string; action: string | null; required: boolean }[]
    }

    expect(Array.isArray(body.checks)).toBe(true)
    expect(body.checks.length).toBeGreaterThan(4)

    const database = body.checks.find((check) => check.id === 'database')
    expect(database?.status).toBe('ok')

    // No payment provider is configured in the test environment, so the
    // report has to say so rather than implying that checkout works.
    const billing = body.checks.find((check) => check.id === 'billing')
    expect(billing?.status).not.toBe('ok')
    expect(billing?.action).toBeTruthy()
  })
})

describe('the plan catalogue', () => {
  it('publishes the price and the provider', async () => {
    const response = await get('/api/billing/plans')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      plans: { id: string; price: { amount: number; currency: string } }[]
      provider: string
      billingEnabled: boolean
    }

    const pro = body.plans.find((plan) => plan.id === 'pro')
    expect(pro?.price.amount).toBeGreaterThan(0)
    expect(pro?.price.currency).toBe('NGN')
    expect(body.billingEnabled).toBe(false)
  })

  it('refuses to start a checkout when no provider is configured', async () => {
    const response = await post('/api/billing/checkout', { plan: 'pro' }, DEV)
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('billing_not_configured')
  })

  it('refuses every webhook when no provider is configured', async () => {
    // A crafted body must never be able to grant a paid plan.
    const response = await post('/api/billing/webhook', {
      type: 'checkout.session.completed',
      customerEmail: 'attacker@example.com',
      providerSubscription: {
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        plan: 'pro',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_signature')
  })
})

describe('the local billing flow', () => {
  it('confirms a plan, then cancels it at the end of the paid period', async () => {
    const confirmed = await post('/api/billing/confirm', { plan: 'pro' }, DEV)
    expect(confirmed.status).toBe(200)

    const body = (await confirmed.json()) as {
      subscription: { plan: string; status: string; cancelAtPeriodEnd: boolean }
    }
    expect(body.subscription.plan).toBe('pro')
    expect(body.subscription.cancelAtPeriodEnd).toBe(false)

    const entitlements = (await (await get('/api/billing/subscription', DEV)).json()) as {
      entitlements: string[]
    }
    expect(entitlements.entitlements).toContain('alerts')

    const cancelled = await post('/api/billing/cancel', {}, DEV)
    expect(cancelled.status).toBe(200)
    const after = (await cancelled.json()) as { subscription: { cancelAtPeriodEnd: boolean } }
    expect(after.subscription.cancelAtPeriodEnd).toBe(true)

    // The time that has been paid for is still the customer's.
    const still = (await (await get('/api/billing/subscription', DEV)).json()) as {
      entitlements: string[]
    }
    expect(still.entitlements).toContain('alerts')
  })
})

describe('the account export', () => {
  it('returns everything held about the account', async () => {
    await post('/api/account/saved', { jobId: 'demo-0001' }, DEV)

    const response = await get('/api/account/export', DEV)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      user: { email: string }
      saved: { jobId: string }[]
      profile: unknown
      audit: unknown[]
      exportedAt: string
    }

    expect(body.user.email).toBe('ops@example.com')
    expect(body.saved.some((entry) => entry.jobId === 'demo-0001')).toBe(true)
    expect(Array.isArray(body.audit)).toBe(true)
    expect(typeof body.exportedAt).toBe('string')
  })
})

describe('the AI budget', () => {
  it('counts calls against a scope and stops at the limit', async () => {
    const scope = `test-scope-${Date.now()}`

    expect(await consumeAiQuota(env.DB, scope, 2)).toBe(true)
    expect(await consumeAiQuota(env.DB, scope, 2)).toBe(true)
    expect(await consumeAiQuota(env.DB, scope, 2)).toBe(false)
    expect(await aiUsage(env.DB, scope)).toBe(2)
  })

  it('gives a call back when it is released', async () => {
    const scope = `test-release-${Date.now()}`

    expect(await consumeAiQuota(env.DB, scope, 1)).toBe(true)
    expect(await consumeAiQuota(env.DB, scope, 1)).toBe(false)
    await releaseAiQuota(env.DB, scope)
    expect(await consumeAiQuota(env.DB, scope, 1)).toBe(true)
  })

  it('refuses everything when the limit is zero', async () => {
    const scope = `test-zero-${Date.now()}`
    expect(await consumeAiQuota(env.DB, scope, 0)).toBe(false)
  })

  it('takes the deployment budget and the account budget together', async () => {
    const config = readConfig({ APP_MODE: 'test' })
    // The deployment budget is generous here so that the account budget is
    // the one that runs out.
    const scoped = { ...config, aiDailyLimit: 1, aiGlobalDailyLimit: 1000 }
    const scope = `test-budget-${Date.now()}`

    const first = await takeAiBudget(env.DB, scope, scoped)
    expect(first.allowed).toBe(true)

    const second = await takeAiBudget(env.DB, scope, scoped)
    expect(second.allowed).toBe(false)
    expect(second.scope).toBe('user')
  })

  it('stops at the deployment budget before the account budget', async () => {
    const config = readConfig({ APP_MODE: 'test' })
    const scoped = { ...config, aiDailyLimit: 1000, aiGlobalDailyLimit: 0 }
    const scope = `test-global-${Date.now()}`

    const decision = await takeAiBudget(env.DB, scope, scoped)
    expect(decision.allowed).toBe(false)
    expect(decision.scope).toBe('global')
  })
})
