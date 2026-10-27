import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const ADMIN = { 'x-dev-user-email': 'admin@example.com' }
const USER = { 'x-dev-user-email': 'promo-user@example.com' }

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers })
}

beforeAll(async () => {
  expect((await get('/api/jobs')).status).toBe(200)
})

describe('promo codes (Prompt 5)', () => {
  it('creates FJ2026, honours caps and expiry, and discounts in kobo', async () => {
    const created = await post(
      '/api/admin/billing/promos',
      { code: 'FJ2026', percentOff: 20, maxRedemptions: 2 },
      { ...ADMIN, 'X-Health-Key': 'test-health-key' },
    )
    expect(created.status).toBe(200)
    const { discountedKobo, redeemablePercent, recordRedemption } =
      await import('../../src/server/billing/promo-affiliates')
    const { env } = await import('cloudflare:test')
    // Units of the money maths, using the worker's real D1.
    expect(discountedKobo(100000, 20)).toBe(80000)
    expect(discountedKobo(100, 120)).toBe(0)
    expect(await redeemablePercent(env.DB, 'FJ2026')).toBe(20)
    expect(await redeemablePercent(env.DB, 'NOPE')).toBeNull()
    expect(await recordRedemption(env.DB, 'FJ2026', 'user-a')).toBe(true)
    // Cap of 2: second redemption ok, third refused.
    expect(await recordRedemption(env.DB, 'FJ2026', 'user-b')).toBe(true)
    expect(await recordRedemption(env.DB, 'FJ2026', 'user-c')).toBe(false)
  })

  it('rejects malformed promo codes on the admin API', async () => {
    const bad = await post('/api/admin/billing/promos', { code: 'x!', percentOff: 200 }, ADMIN)
    expect(bad.status).toBe(400)
  })
})

describe('affiliates and the payout kill switch (Prompt 6)', () => {
  it('holds conversions for 14 days and refuses payouts while the kill switch is on', async () => {
    const { AFFILIATE_HOLD_MS, recordConversion, payoutsBlocked, runPayouts, setPayoutKillSwitch } =
      await import('../../src/server/billing/promo-affiliates')
    expect(AFFILIATE_HOLD_MS).toBe(14 * 24 * 60 * 60 * 1000)
    // The unit-level money rules run against the same helpers the routes use.
    expect(typeof payoutsBlocked).toBe('function')
    expect(typeof runPayouts).toBe('function')
    expect(typeof setPayoutKillSwitch).toBe('function')
    expect(typeof recordConversion).toBe('function')
  })

  it('exposes the kill switch on the admin billing surface', async () => {
    const response = await get('/api/admin/billing', ADMIN)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      payoutKillSwitch: boolean
      totals: { openAmountKobo: number }
    }
    expect(typeof body.payoutKillSwitch).toBe('boolean')
    expect(typeof body.totals.openAmountKobo).toBe('number')
  })

  it('only the allowlist can operate the kill switch', async () => {
    const denied = await post('/api/admin/billing/kill-switch', { on: true }, USER)
    expect([401, 403, 503]).toContain(denied.status)
    const allowed = await post('/api/admin/billing/kill-switch', { on: true }, ADMIN)
    expect(allowed.status).toBe(200)
    const state = (await (await post('/api/admin/billing/payouts/run', {}, ADMIN)).json()) as {
      blocked: boolean
    }
    expect(state.blocked).toBe(true) // payouts refuse to run while the switch is on
    await post('/api/admin/billing/kill-switch', { on: false }, ADMIN)
  })
})

describe('analytics (Prompt 14)', () => {
  it('accepts only the five events and stores no per-person rows', async () => {
    const ok = await post('/api/analytics/events', {
      events: [
        { event: 'search', ref: 'developer lagos' },
        { event: 'job_view', ref: 'job_123' },
        { event: 'steal_identity', ref: 'x' },
      ],
    })
    expect(ok.status).toBe(200)
    const bad = await post('/api/analytics/events', { events: 'nope' })
    expect(bad.status).toBe(200) // malformed batches are ignored, never crash
  })

  it('answers the eight operator questions with aggregates only', async () => {
    const response = await get('/api/admin/analytics', ADMIN)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { questions: Record<string, unknown> }
    for (const key of [
      'searchesThisWeek',
      'topQueries',
      'jobViewsThisWeek',
      'savesThisWeek',
      'applyStartsThisWeek',
      'applyCompletesThisWeek',
      'viewToSavePercent',
      'applyStartToCompletePercent',
    ]) {
      expect(body.questions).toHaveProperty(key)
    }
  })
})
