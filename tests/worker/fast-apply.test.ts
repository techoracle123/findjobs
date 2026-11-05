import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
import './setup'

const base = 'http://localhost:8787'
const headers = {
  'x-dev-user-email': 'retired-fast-apply@example.com',
  'content-type': 'application/json',
}

const fastApply = (id: string, who: Record<string, string> = headers) =>
  SELF.fetch(`${base}/api/jobs/${id}/fast-apply`, {
    method: 'POST',
    headers: who,
    body: JSON.stringify({ useProfile: true }),
  })

it('keeps external apply clicks free, unlimited and never blocked by analytics', async () => {
  for (let i = 0; i < 12; i += 1) {
    const response = await SELF.fetch(`${base}/api/jobs/demo-0001/apply-click`, {
      method: 'POST',
      headers: { 'x-dev-user-email': 'external-clicker@example.com' },
    })
    expect(response.status).toBe(204)
  }
})

it('retires Fast Apply instead of pretending FJ submitted an application', async () => {
  const response = await fastApply('demo-0001')
  expect(response.status).toBe(410)
  const body = (await response.json()) as { error: string; message: string }
  expect(body.error).toBe('fast_apply_unavailable')
  expect(body.message).toContain('does not submit')
  expect(body.message).toContain('always free')

  const account = (await (await SELF.fetch(base + '/api/account', { headers })).json()) as {
    saved: { jobId: string }[]
  }
  expect(account.saved.some((entry) => entry.jobId === 'demo-0001')).toBe(false)
})

it('does not resurrect Fast Apply for Pro or unknown jobs', async () => {
  const proHeaders = { ...headers, 'x-dev-user-email': 'retired-pro@example.com' }
  expect((await fastApply('demo-0001', proHeaders)).status).toBe(410)
  expect((await fastApply('does-not-exist', proHeaders)).status).toBe(410)
})

it('retires the quota endpoint so no daily application meter remains', async () => {
  const response = await SELF.fetch(`${base}/api/apply/quota`, { headers })
  expect(response.status).toBe(410)
  const body = (await response.json()) as Record<string, unknown>
  expect(body.error).toBe('quota_retired')
  expect(body).not.toHaveProperty('remaining')
  expect(body).not.toHaveProperty('limit')
  expect(String(body.message)).toContain('free and unlimited')
})
