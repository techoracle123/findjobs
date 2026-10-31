import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import './setup'

const BASE = 'http://localhost:8787'
const ALICE = { 'x-dev-user-email': 'alice-employer@example.com' }
const BOB = { 'x-dev-user-email': 'bob-employer@example.com' }

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
  expect((await get('/api/jobs', ALICE)).status).toBe(200)
})

describe('employer posting is paused', () => {
  it('refuses employer account creation', async () => {
    const response = await post('/api/orgs', { name: 'Acme NG' }, ALICE)
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ error: 'employer_posting_paused' })
  })

  it('refuses direct job posting and employer account writes', async () => {
    const job = await post(
      '/api/orgs/example-org/jobs',
      { title: 'Backend Engineer', description: 'Build and maintain APIs in Lagos.' },
      ALICE,
    )
    expect(job.status).toBe(410)
    expect(await job.json()).toMatchObject({ error: 'employer_posting_paused' })

    expect((await post('/api/orgs/example-org/verify-domain', {}, ALICE)).status).toBe(410)
    expect(
      (await post('/api/orgs/example-org/members', { email: 'bob-employer@example.com' }, ALICE))
        .status,
    ).toBe(410)
  })

  it('does not reveal an organisation to a signed-in non-member', async () => {
    expect((await get('/api/orgs/example-org', BOB)).status).toBe(404)
    expect((await get('/api/orgs/example-org/jobs', BOB)).status).toBe(404)
  })
})

describe('DoH domain verification unit (kept for a later careful launch)', () => {
  it('matches only the exact token in TXT answers', async () => {
    const { verifyDomainToken } = await import('../../src/server/employers/dns')
    const good = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          Answer: [{ type: 16, name: '_fjverify.example.com', data: '"fj-verify=abc123"' }],
        }),
        text: async () => '',
      }) as unknown as Response) as typeof fetch
    const bad = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          Answer: [{ type: 16, name: '_fjverify.example.com', data: '"fj-verify=other"' }],
        }),
        text: async () => '',
      }) as unknown as Response) as typeof fetch
    expect(await verifyDomainToken('example.com', 'abc123', good)).toBe(true)
    expect(await verifyDomainToken('example.com', 'abc123', bad)).toBe(false)
  })
})
