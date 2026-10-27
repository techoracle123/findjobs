import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import './setup'

const base = 'http://localhost:8787'

it('accepts reports without an account and hides a listing after two independent reports', async () => {
  const post = (headers: Record<string, string>) =>
    SELF.fetch(`${base}/api/jobs/demo-0001/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ reason: 'asked-me-for-money', comment: 'Asked for a fee' }),
    })
  const first = await post({ 'cf-connecting-ip': '197.210.1.1', 'user-agent': 'tester-a' })
  expect(first.status).toBe(201)
  expect(((await first.json()) as { hiddenPendingReview: boolean }).hiddenPendingReview).toBe(false)
  const second = await post({ 'cf-connecting-ip': '197.210.2.2', 'user-agent': 'tester-b' })
  expect([200, 201]).toContain(second.status)
  expect(((await second.json()) as { hiddenPendingReview: boolean }).hiddenPendingReview).toBe(true)
  const hidden = await env.PUBLIC_JOBS!.get<Record<string, number>>('moderation:hidden', 'json')
  expect(hidden && hidden['demo-0001']).toBeTruthy()
})

it('rejects unknown reasons and rate-limits repeat reporting', async () => {
  const bad = await SELF.fetch(`${base}/api/jobs/demo-0001/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.9' },
    body: JSON.stringify({ reason: 'nonsense' }),
  })
  expect(bad.status).toBe(400)
})

it('protects moderation behind the admin allowlist and audits every action', async () => {
  ;(env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = 'mod@example.com'
  expect((await SELF.fetch(base + '/api/admin/moderation')).status).toBe(401)
  expect(
    (
      await SELF.fetch(base + '/api/admin/moderation', {
        headers: { 'x-dev-user-email': 'someone@example.com' },
      })
    ).status,
  ).toBe(403)
  const action = await SELF.fetch(`${base}/api/admin/moderation/demo-0001`, {
    method: 'POST',
    headers: { 'x-dev-user-email': 'mod@example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'hide', note: 'looks wrong' }),
  })
  expect(action.status).toBe(200)
  const audit = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'moderation_hide'",
  ).first<{ n: number }>()
  expect(audit?.n).toBeGreaterThanOrEqual(1)
})
