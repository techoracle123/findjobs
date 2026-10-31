import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const PASSWORD = 'correct horse battery'
let counter = 0

function freshEmail(): string {
  counter += 1
  return `password-tester-${Date.now()}-${counter}@example.com`
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

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers })
}

function cookieOf(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0]
}

async function signUp(email: string, password: string = PASSWORD): Promise<Response> {
  return post('/api/auth/signup', { name: 'Password Tester', email, password })
}

describe('email and password accounts', () => {
  it('signs up, sets a session cookie, and the session resolves', async () => {
    const email = freshEmail()
    const response = await signUp(email)
    expect(response.status).toBe(200)
    const cookie = cookieOf(response)
    expect(cookie).toContain('fj_session=')
    const session = await get('/api/auth/session', { Cookie: cookie })
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(email)
  })

  it('refuses a second account for the same email', async () => {
    const email = freshEmail()
    expect((await signUp(email)).status).toBe(200)
    const response = await signUp(email)
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toBe('account_exists')
  })

  it('refuses short passwords with a plain reason', async () => {
    const response = await post('/api/auth/signup', {
      email: freshEmail(),
      password: 'short',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; message: string }
    expect(body.error).toBe('weak_password')
    expect(body.message).toContain('at least')
  })

  it('gives one identical answer for wrong password and unknown email', async () => {
    const email = freshEmail()
    expect((await signUp(email)).status).toBe(200)
    const wrong = await post('/api/auth/login', { email, password: 'not the password' })
    const unknown = await post('/api/auth/login', {
      email: freshEmail(),
      password: 'not the password',
    })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_credentials')
    expect(((await unknown.json()) as { error: string }).error).toBe('invalid_credentials')
  })

  it('signs in with the right password', async () => {
    const email = freshEmail()
    expect((await signUp(email)).status).toBe(200)
    const response = await post('/api/auth/login', { email, password: PASSWORD })
    expect(response.status).toBe(200)
    expect(cookieOf(response)).toContain('fj_session=')
  })

  it('resets a forgotten password once, ends old sessions, and kills the old password', async () => {
    const email = freshEmail()
    expect((await signUp(email)).status).toBe(200)
    const before = await post('/api/auth/login', { email, password: PASSWORD })
    const oldCookie = cookieOf(before)
    const forgot = await post('/api/auth/password/forgot', { email })
    expect(forgot.status).toBe(200)
    const { devToken } = (await forgot.json()) as { devToken?: string }
    if (!devToken) throw new Error('no dev token in test mode')
    const reset = await post('/api/auth/password/reset', {
      token: devToken,
      password: 'a brand new password',
    })
    expect(reset.status).toBe(200)
    // The token works once.
    const replay = await post('/api/auth/password/reset', {
      token: devToken,
      password: 'another new password',
    })
    expect(replay.status).toBe(400)
    // Old password dead, new password alive.
    expect((await post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401)
    expect(
      (await post('/api/auth/login', { email, password: 'a brand new password' })).status,
    ).toBe(200)
    // The session from before the reset no longer resolves.
    const stale = await get('/api/auth/session', { Cookie: oldCookie })
    expect(((await stale.json()) as { user: unknown }).user).toBeNull()
  })

  it('forgot-password never reveals whether an account exists', async () => {
    const response = await post('/api/auth/password/forgot', { email: freshEmail() })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; devToken?: string }
    expect(body.ok).toBe(true)
    expect(body.devToken).toBeUndefined()
  })
})

describe('jobs sit behind a free account', () => {
  it('refuses the job list, a job page and scoring without sign-in', async () => {
    expect((await get('/api/jobs')).status).toBe(401)
    expect((await get('/api/jobs/some-job-id')).status).toBe(401)
    expect((await post('/api/score', { profile: {} })).status).toBe(401)
  })

  it('serves jobs to a signed-in account and never shared-caches them', async () => {
    const email = freshEmail()
    const signup = await signUp(email)
    expect(signup.status).toBe(200)
    const response = await get('/api/jobs', { Cookie: cookieOf(signup) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('private')
  })

  it('keeps only plain totals public for the homepage', async () => {
    const response = await get('/api/public-stats')
    // 200 when a snapshot exists in this test env, 503 when it does not;
    // either way it must never carry a job.
    expect([200, 503]).toContain(response.status)
    if (response.status === 200) {
      const body = (await response.json()) as Record<string, unknown>
      expect(body.jobs).toBeUndefined()
      expect(typeof body.total).toBe('number')
    }
  })
})
