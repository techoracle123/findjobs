import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import './setup'
import { IDEA_EVIDENCE_KEY, clearIdeaEvidenceCache } from '../../src/server/ideas/evidence'
import { makeIdeaSnapshot } from '../fixtures/ideas'

const BASE = 'http://localhost:8787'

beforeEach(async () => {
  clearIdeaEvidenceCache()
  await env.PUBLIC_JOBS!.put(IDEA_EVIDENCE_KEY, JSON.stringify(makeIdeaSnapshot()))
})

describe('public Ideas API', () => {
  it('serves a real computed catalogue without an account', async () => {
    const response = await SELF.fetch(`${BASE}/api/ideas?country=NGA&limit=2`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      total: number
      catalogTotal: number
      ideas: { id: string; evidence: { value: number; year: number; sourceUrl: string } }[]
    }
    expect(body.total).toBe(180)
    expect(body.catalogTotal).toBeGreaterThan(15_000)
    expect(body.ideas).toHaveLength(2)
    expect(body.ideas[0].evidence.value).toBe(20)
    expect(body.ideas[0].evidence.year).toBe(2024)
    expect(body.ideas[0].evidence.sourceUrl).toContain('worldbank.org')
    expect(response.headers.get('cache-control')).toContain('public')
  })

  it('supports worldwide exploration, filtering and stable detail links', async () => {
    const response = await SELF.fetch(`${BASE}/api/ideas?country=ALL&format=software&limit=3`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      total: number
      ideas: { id: string; format: string }[]
    }
    expect(body.total).toBeGreaterThan(15_000 / 3)
    expect(body.ideas.every((idea) => idea.format === 'software')).toBe(true)
    const detail = await SELF.fetch(`${BASE}/api/ideas/${encodeURIComponent(body.ideas[0].id)}`)
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      idea: { id: string; validationSteps: string[] }
      related: unknown[]
    }
    expect(detailBody.idea.id).toBe(body.ideas[0].id)
    expect(detailBody.idea.validationSteps).toHaveLength(4)
    expect(detailBody.related.length).toBeGreaterThan(0)
  })

  it('rejects invalid filters and unknown ideas honestly', async () => {
    expect((await SELF.fetch(`${BASE}/api/ideas?country=N`)).status).toBe(400)
    expect((await SELF.fetch(`${BASE}/api/ideas?format=paid`)).status).toBe(400)
    expect((await SELF.fetch(`${BASE}/api/ideas?route=guaranteed`)).status).toBe(400)
    expect((await SELF.fetch(`${BASE}/api/ideas/not-real`)).status).toBe(404)
    expect((await SELF.fetch(`${BASE}/api/idea-trends?geo=bad`)).status).toBe(400)
  })
})

describe('temporary free access', () => {
  it('reports paused payments and blocks checkout before any provider work', async () => {
    const plans = await SELF.fetch(`${BASE}/api/billing/plans`)
    expect(plans.status).toBe(200)
    const planBody = (await plans.json()) as { billingEnabled: boolean; paymentsPaused: boolean }
    expect(planBody.billingEnabled).toBe(false)
    expect(planBody.paymentsPaused).toBe(true)
    const checkout = await SELF.fetch(`${BASE}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-user-email': 'tester@example.com' },
      body: JSON.stringify({ plan: 'pro' }),
    })
    expect(checkout.status).toBe(503)
    expect(((await checkout.json()) as { error: string }).error).toBe('payments_paused')
  })

  it('grants Pro entitlements without inventing a subscription', async () => {
    const response = await SELF.fetch(`${BASE}/api/billing/subscription`, {
      headers: { 'x-dev-user-email': 'tester@example.com' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { subscription: unknown; entitlements: string[] }
    expect(body.subscription).toBeNull()
    expect(body.entitlements).toContain('smart_shortlist')
    expect(body.entitlements).toContain('cv_check')
  })
})
