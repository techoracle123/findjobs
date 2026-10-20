import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import './setup'
import { monthPeriod } from '../../src/shared/activity'
import { userIdFor } from '../../src/server/auth/accounts'
const base = 'http://localhost:8787'
const headers = {
  'x-dev-user-email': 'activity-one@example.com',
  'content-type': 'application/json',
}
const other = { 'x-dev-user-email': 'activity-two@example.com' }
async function save(status = 'applied') {
  return SELF.fetch(base + '/api/account/saved', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jobId: 'genuine-public-id', status }),
  })
}
async function activity(who: Record<string, string> = headers) {
  return (
    await SELF.fetch(base + '/api/account/activity?' + new URLSearchParams(monthPeriod()), {
      headers: who,
    })
  ).json() as Promise<{ thisMonth: number; totalApplied: number; undated: number }>
}
it('keeps accurate application history, isolates accounts and survives bookmark deletion', async () => {
  expect((await save('saved')).status).toBe(200)
  expect((await activity()).thisMonth).toBe(0)
  expect((await save()).status).toBe(200)
  expect((await save()).status).toBe(200)
  expect(await activity()).toMatchObject({ thisMonth: 1, totalApplied: 1 })
  const saved = (await (await SELF.fetch(base + '/api/account/saved', { headers })).json()) as {
    saved: { appliedAt?: string }[]
  }
  expect(saved.saved[0].appliedAt).toBeTruthy()
  expect((await activity(other)).thisMonth).toBe(0)
  await SELF.fetch(base + '/api/account/saved/genuine-public-id', { method: 'DELETE', headers })
  expect((await activity()).thisMonth).toBe(1)
})
it('does not assign today to legacy undated applications', async () => {
  await SELF.fetch(base + '/api/account', { headers })
  await env.DB.prepare(
    'INSERT OR IGNORE INTO application_history(user_id,job_id,applied_at) VALUES (?1,?2,NULL)',
  )
    .bind(await userIdFor('activity-one@example.com'), 'legacy-unknown')
    .run()
  expect((await activity()).undated).toBeGreaterThanOrEqual(1)
})
it('requires a verified identity and valid bounded periods', async () => {
  expect((await SELF.fetch(base + '/api/account/activity')).status).toBe(401)
  expect(
    (await SELF.fetch(base + '/api/account/activity?from=bad&to=nope', { headers })).status,
  ).toBe(400)
  expect(
    (await SELF.fetch(base + '/api/account/activity?from=2000-01-01&to=2030-01-01', { headers }))
      .status,
  ).toBe(400)
  const response = await SELF.fetch(base + '/api/account/activity', { headers })
  expect(response.headers.get('cache-control')).toContain('no-store')
})

it('exports durable history, including removed bookmarks, and erases it with the account', async () => {
  const ownHeaders = {
    'x-dev-user-email': 'export-history@example.com',
    'content-type': 'application/json',
  }
  await SELF.fetch(base + '/api/account/saved', {
    method: 'POST',
    headers: ownHeaders,
    body: JSON.stringify({ jobId: 'exported-history', status: 'applied' }),
  })
  await SELF.fetch(base + '/api/account/saved/exported-history', {
    method: 'DELETE',
    headers: ownHeaders,
  })
  const exported = (await (
    await SELF.fetch(base + '/api/account/export', { headers: ownHeaders })
  ).json()) as { applicationHistory: { jobId: string }[] }
  expect(exported.applicationHistory.map((x) => x.jobId)).toContain('exported-history')
  await SELF.fetch(base + '/api/account', {
    method: 'DELETE',
    headers: ownHeaders,
    body: JSON.stringify({ confirm: true }),
  })
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM application_history WHERE user_id=?1',
  )
    .bind(await userIdFor('export-history@example.com'))
    .first<{ n: number }>()
  expect(count?.n).toBe(0)
})
