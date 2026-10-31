import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const DEV = { 'x-dev-user-email': 'tester@example.com' }
const EMAIL = 'otp-tester@example.com'

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

async function requestCode(email: string): Promise<string> {
  const response = await post('/api/auth/otp/request', { email })
  const body = (await response.json()) as { devCode?: string }
  if (!body.devCode) throw new Error('no dev code in test mode')
  return body.devCode
}

beforeAll(async () => {
  const response = await get('/api/jobs', DEV)
  expect(response.status).toBe(200)
})

describe('own sign-in (Prompt 18)', () => {
  it('issues a code and signs in with it, setting a session cookie', async () => {
    const code = await requestCode(EMAIL)
    expect(code).toMatch(/^\d{6}$/)
    const response = await post('/api/auth/otp/verify', { email: EMAIL, code })
    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('fj_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    const session = await get('/api/auth/session', { Cookie: setCookie.split(';')[0] })
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(EMAIL)
  })

  it('rejects the wrong code and expends the attempt', async () => {
    const code = await requestCode(EMAIL)
    const wrong = code === '000000' ? '111111' : '000000'
    const response = await post('/api/auth/otp/verify', { email: EMAIL, code: wrong })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('code_invalid')
  })

  it('consumes a code once — replay is refused', async () => {
    const code = await requestCode(EMAIL)
    expect((await post('/api/auth/otp/verify', { email: EMAIL, code })).status).toBe(200)
    const replay = await post('/api/auth/otp/verify', { email: EMAIL, code })
    expect(replay.status).toBe(400)
  })

  it('lists and revokes devices', async () => {
    const code = await requestCode(EMAIL)
    const verify = await post('/api/auth/otp/verify', { email: EMAIL, code })
    const cookie = (verify.headers.get('set-cookie') ?? '').split(';')[0]
    const devices = await get('/api/auth/devices', { Cookie: cookie, ...DEV })
    expect(devices.status).toBe(200)
    const list = (await devices.json()) as { devices: Array<{ id: string }> }
    expect(list.devices.length).toBeGreaterThan(0)
    const revoke = await post(
      '/api/auth/devices/revoke',
      { id: list.devices[0].id },
      { Cookie: cookie, ...DEV },
    )
    expect(revoke.status).toBe(200)
  })

  it('logs out by revoking the session cookie', async () => {
    const code = await requestCode(EMAIL)
    const verify = await post('/api/auth/otp/verify', { email: EMAIL, code })
    const cookie = (verify.headers.get('set-cookie') ?? '').split(';')[0]
    expect((await post('/api/auth/logout', {}, { Cookie: cookie })).status).toBe(200)
    const after = await get('/api/auth/session', { Cookie: cookie })
    expect(((await after.json()) as { user: unknown }).user).toBeNull()
  })

  it('keeps Access identities working in parallel (§E)', async () => {
    const response = await get('/api/auth/session', DEV)
    const body = (await response.json()) as { user: { email: string } | null; via?: string }
    expect(body.user?.email).toBe('tester@example.com')
  })
})

describe('pricing page plumbing (Prompt 17)', () => {
  it('serves plans from config with a billingEnabled flag, never a dead checkout', async () => {
    const response = await get('/api/billing/plans')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      plans: Array<{ id: string; price: { amount: number } }>
      billingEnabled: boolean
    }
    // free, graduate, pro monthly, pro annual, employer waitlist.
    expect(body.plans.length).toBe(5)
    expect(body.plans[0].price.amount).toBe(0)
    expect(body.plans.find((plan) => plan.id === 'pro')?.price.amount).toBe(10000)
    expect(typeof body.billingEnabled).toBe('boolean')
  })

  it('accepts waitlist signups without storing anything else', async () => {
    const response = await post('/api/billing/waitlist', { email: 'wait@example.com' })
    expect(response.status).toBe(200)
    const bad = await post('/api/billing/waitlist', { email: 'not-an-email' })
    expect(bad.status).toBe(400)
  })
})
