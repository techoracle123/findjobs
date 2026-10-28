import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import './setup'

const base = 'http://localhost:8787'
const headers = { 'x-dev-user-email': 'fast-apply@example.com', 'content-type': 'application/json' }

async function onsiteJob(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO jobs (id, title, company, role_family, seniority, work_mode,
      location_country, location_label, salary_min, salary_max, salary_currency, salary_period,
      description, required_skills, useful_skills, eligible_countries, sponsorship, source_name,
      source_url, posted_at, is_demo, job_status, first_seen_at, last_seen_at, apply_url, apply_mode)
     VALUES (?1, 'Onsite Test Role', 'Test Employer', 'backend', 'mid', 'onsite', 'NG', 'Lagos',
      0, 0, 'NGN', 'year', 'A genuine test listing.', '[]', '[]', '[]', 'unknown', 'test',
      'https://example.org/jobs/1', '2026-10-27T00:00:00Z', 0, 'open',
      '2026-10-27T00:00:00Z', '2026-10-27T00:00:00Z', 'https://example.org/apply/1', 'onsite')`,
  )
    .bind(id)
    .run()
}

const fastApply = (id: string, who: Record<string, string> = headers, cookie = '') =>
  SELF.fetch(`${base}/api/jobs/${id}/fast-apply`, {
    method: 'POST',
    headers: cookie ? { ...who, cookie } : who,
    body: JSON.stringify({ useProfile: true }),
  })

it('keeps external apply free and unlimited for everyone', async () => {
  for (let i = 0; i < 8; i += 1) {
    const response = await SELF.fetch(`${base}/api/jobs/demo-0001/apply-click`, {
      method: 'POST',
      headers: { 'x-dev-user-email': 'clicker@example.com' },
    })
    expect(response.status).toBe(204)
  }
  const quota = (await (await SELF.fetch(`${base}/api/apply/quota`, { headers })).json()) as {
    used: number
  }
  expect(quota.used).toBe(0)
})

it('caps Fast Apply at 5 per Lagos day and answers 402 with a helpful payload', async () => {
  await onsiteJob('onsite-day-cap')
  for (let i = 0; i < 5; i += 1) expect((await fastApply('onsite-day-cap')).status).toBe(201)
  const denied = await fastApply('onsite-day-cap')
  expect(denied.status).toBe(402)
  const body = (await denied.json()) as Record<string, unknown>
  expect(body.error).toBe('quota_exceeded')
  expect(body.limit).toBe(5)
  expect(body.used).toBe(5)
  expect(body.upgradeUrl).toBe('/dashboard?tab=plan')
  expect(String(body.message)).toContain('always free')
  const resetsAt = Date.parse(String(body.resetsAt))
  expect(resetsAt).toBeGreaterThan(Date.now())
})

it('caps Fast Apply at 15 per rolling week even across days', async () => {
  await onsiteJob('onsite-week-cap')
  const who = { ...headers, 'x-dev-user-email': 'week-cap@example.com' }
  const user = (await (await SELF.fetch(base + '/api/account', { headers: who })).json()) as {
    user: { id: string }
  }
  // 13 fast applies already recorded on previous Lagos days inside the week.
  await env.DB.prepare(
    "INSERT INTO apply_quotas (subject_type, subject_id, window_date, used) VALUES ('user', ?1, strftime('%Y-%m-%d','now','-1 day'), 13)",
  )
    .bind(user.user.id)
    .run()
  // Two more fit before the rolling 15 is reached; the third is refused even
  // though today's own 5-per-day allowance is not exhausted.
  expect((await fastApply('onsite-week-cap', who)).status).toBe(201)
  expect((await fastApply('onsite-week-cap', who)).status).toBe(201)
  const denied = await fastApply('onsite-week-cap', who)
  expect(denied.status).toBe(402)
  const body = (await denied.json()) as { weekUsed: number; weekLimit: number; used: number }
  expect(body.weekLimit).toBe(15)
  expect(body.weekUsed).toBeGreaterThanOrEqual(15)
  expect(body.used).toBeLessThan(5)
})

it('gives entitled users unlimited Fast Apply', async () => {
  await onsiteJob('onsite-pro')
  const who = { ...headers, 'x-dev-user-email': 'pro@example.com' }
  const user = (await (await SELF.fetch(base + '/api/account', { headers: who })).json()) as {
    user: { id: string }
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO entitlements (user_id, feature) VALUES (?1, 'unlimited_fast_apply')",
  )
    .bind(user.user.id)
    .run()
  for (let i = 0; i < 8; i += 1) expect((await fastApply('onsite-pro', who)).status).toBe(201)
  const quota = (await (await SELF.fetch(`${base}/api/apply/quota`, { headers: who })).json()) as {
    unlimited: boolean
  }
  expect(quota.unlimited).toBe(true)
})

it('merges the anonymous counter into the account with max, never a sum', async () => {
  await onsiteJob('onsite-merge')
  // Three anonymous Fast Applies under one browser cookie.
  let cookie = ''
  for (let i = 0; i < 3; i += 1) {
    const response = await fastApply('onsite-merge', { 'content-type': 'application/json' }, cookie)
    expect(response.status).toBe(201)
    const set = response.headers.get('set-cookie') || ''
    const match = set.match(/fj_anon=([^;]+)/)
    if (match && !cookie) cookie = `fj_anon=${match[1]}`
  }
  expect(cookie).not.toBe('')
  const who = { ...headers, 'x-dev-user-email': 'merge@example.com' }
  const user = (await (await SELF.fetch(base + '/api/account', { headers: who })).json()) as {
    user: { id: string }
  }
  // Two already done under this account.
  await env.DB.prepare(
    "INSERT INTO apply_quotas (subject_type, subject_id, window_date, used) VALUES ('user', ?1, strftime('%Y-%m-%d','now'), 2)",
  )
    .bind(user.user.id)
    .run()
  // Signing in merges 3 and 2 by taking max(3,2)=3 — not 5.
  const quota = (await (
    await SELF.fetch(`${base}/api/apply/quota`, { headers: { ...who, cookie } })
  ).json()) as { used: number }
  expect(quota.used).toBe(3)
})

it('refuses Fast Apply on aggregated roles and unknown jobs without burning quota', async () => {
  const who = { ...headers, 'x-dev-user-email': 'refused@example.com' }
  expect((await fastApply('demo-0001', who)).status).toBe(400) // external by default
  expect((await fastApply('does-not-exist', who)).status).toBe(404)
  const quota = (await (await SELF.fetch(`${base}/api/apply/quota`, { headers: who })).json()) as {
    used: number
  }
  expect(quota.used).toBe(0)
})

it('marks the role applied in the personal tracker on Fast Apply', async () => {
  await onsiteJob('onsite-tracker')
  const who = { ...headers, 'x-dev-user-email': 'tracker@example.com' }
  expect((await fastApply('onsite-tracker', who)).status).toBe(201)
  const saved = (await (
    await SELF.fetch(base + '/api/account/saved', { headers: who })
  ).json()) as {
    saved: { jobId: string; status: string; appliedAt?: string }[]
  }
  const entry = saved.saved.find((row) => row.jobId === 'onsite-tracker')
  expect(entry?.status).toBe('applied')
  expect(entry?.appliedAt).toBeTruthy()
})

it('never gates the quota meter behind payment and requires identity', async () => {
  expect((await SELF.fetch(base + '/api/apply/quota')).status).toBe(401)
})
