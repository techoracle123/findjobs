import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const DEV = { 'x-dev-user-email': 'tester@example.com' }

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers })
}

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

beforeAll(async () => {
  // The demo seed lives in migration 0002; make sure it is present.
  const count = await SELF.fetch(`${BASE}/api/jobs`)
  expect(count.status).toBe(200)
})

describe('health and jobs', () => {
  it('gives anonymous callers only a liveness bit, never a stack map', async () => {
    const response = await get('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('reports full configuration only to operators or verified identities', async () => {
    const response = await get('/api/health', { 'X-Health-Key': 'test-health-key' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.dataSource).toBe('d1')
    expect(typeof body.jobCount).toBe('number')
    expect(body.authenticationRequired).toBe(false)
    expect((await get('/api/health', { 'X-Health-Key': 'wrong' })).status).toBe(200)
    expect(await (await get('/api/health', { 'X-Health-Key': 'wrong' })).json()).toEqual({
      ok: true,
    })
  })

  it('lists the seeded roles', async () => {
    const response = await get('/api/jobs')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { jobs: unknown[] }
    expect(body.jobs.length).toBeGreaterThan(0)
  })

  it('returns a single role', async () => {
    const response = await get('/api/jobs/demo-0001')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { job: { id: string } }
    expect(body.job.id).toBe('demo-0001')
  })

  it('404s an unknown role', async () => {
    const response = await get('/api/jobs/does-not-exist')
    expect(response.status).toBe(404)
  })

  it('scores a profile against the feed', async () => {
    const response = await post('/api/score', {
      profile: { skills: ['Go'], targetRoleFamilies: ['backend'] },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { scored: { score: number; job: { id: string } }[] }
    expect(body.scored.length).toBeGreaterThan(0)
    expect(body.scored.every((entry) => entry.score >= 0 && entry.score <= 100)).toBe(true)
  })
})

describe('account routes', () => {
  it('refuses an anonymous request', async () => {
    const response = await get('/api/account')
    expect(response.status).toBe(401)
  })

  it('creates the account on first sight', async () => {
    const response = await get('/api/account', DEV)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      user: { email: string }
      profile: { skills: string[] }
    }
    expect(body.user.email).toBe('tester@example.com')
    expect(body.profile.skills).toEqual([])
  })

  it('returns the same account on a second visit', async () => {
    const first = (await (await get('/api/account', DEV)).json()) as { user: { id: string } }
    const second = (await (await get('/api/account', DEV)).json()) as { user: { id: string } }
    expect(second.user.id).toBe(first.user.id)
  })

  it('stores and reads back a profile', async () => {
    const profile = {
      skills: ['Go', 'PostgreSQL'],
      targetRoleFamilies: ['backend'],
      targetSeniority: ['senior'],
      preferredWorkModes: ['remote'],
      workCountry: 'de',
    }
    const put = await SELF.fetch(`${BASE}/api/account/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...DEV },
      body: JSON.stringify({ profile }),
    })
    expect(put.status).toBe(200)

    const body = (await (await get('/api/account', DEV)).json()) as {
      profile: { skills: string[]; workCountry: string }
    }
    expect(body.profile.skills).toEqual(['Go', 'PostgreSQL'])
    // The country is normalised to an upper-case code.
    expect(body.profile.workCountry).toBe('DE')
  })

  it('saves, lists and removes a role', async () => {
    const saved = await post('/api/account/saved', { jobId: 'demo-0001' }, DEV)
    expect(saved.status).toBe(200)

    const listed = (await (await get('/api/account/saved', DEV)).json()) as {
      saved: { jobId: string; status: string }[]
    }
    expect(listed.saved.some((entry) => entry.jobId === 'demo-0001')).toBe(true)

    const removed = await SELF.fetch(`${BASE}/api/account/saved/demo-0001`, {
      method: 'DELETE',
      headers: DEV,
    })
    expect(removed.status).toBe(200)

    const after = (await (await get('/api/account/saved', DEV)).json()) as {
      saved: { jobId: string }[]
    }
    expect(after.saved.some((entry) => entry.jobId === 'demo-0001')).toBe(false)
  })

  it('requires a job id to save a role', async () => {
    const response = await post('/api/account/saved', {}, DEV)
    expect(response.status).toBe(400)
  })

  it('creates, updates and deletes an alert', async () => {
    const created = await post(
      '/api/account/alerts',
      { id: 'alert-test-1', label: 'Rust roles', query: 'rust', channels: ['telegram'] },
      DEV,
    )
    expect(created.status).toBe(200)

    const listed = (await (await get('/api/account/alerts', DEV)).json()) as {
      alerts: { id: string; label: string }[]
    }
    expect(listed.alerts.some((alert) => alert.id === 'alert-test-1')).toBe(true)

    const patched = await SELF.fetch(`${BASE}/api/account/alerts/alert-test-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...DEV },
      body: JSON.stringify({ label: 'Rust roles in Europe' }),
    })
    expect(patched.status).toBe(200)

    const afterPatch = (await (await get('/api/account/alerts', DEV)).json()) as {
      alerts: { id: string; label: string }[]
    }
    const updated = afterPatch.alerts.find((alert) => alert.id === 'alert-test-1')
    expect(updated?.label).toBe('Rust roles in Europe')

    const deleted = await SELF.fetch(`${BASE}/api/account/alerts/alert-test-1`, {
      method: 'DELETE',
      headers: DEV,
    })
    expect(deleted.status).toBe(200)
  })

  it('imports data held in the browser', async () => {
    const response = await post(
      '/api/account/import',
      {
        profile: { skills: ['Rust'], targetRoleFamilies: ['backend'] },
        saved: [{ jobId: 'demo-0002', status: 'saved' }],
        alerts: [{ label: 'Imported alert', query: 'rust', channels: [] }],
      },
      DEV,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      imported: { profile: boolean; saved: number; alerts: number }
    }
    expect(body.imported.profile).toBe(true)
    expect(body.imported.saved).toBe(1)
    expect(body.imported.alerts).toBe(1)
  })
})

describe('rate limiting', () => {
  it('answers 429 once the caller is over the limit', async () => {
    const headers = { 'x-dev-user-email': 'flooder@example.com' }
    let sawLimit = false

    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await post('/api/score', { profile: { skills: ['Go'] } }, headers)
      if (response.status === 429) {
        sawLimit = true
        expect(response.headers.get('Retry-After')).toBeTruthy()
        break
      }
    }

    expect(sawLimit).toBe(true)
  })
})
