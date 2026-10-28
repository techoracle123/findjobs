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

async function makeOrg(headers: Record<string, string>, name: string): Promise<string> {
  const response = await post(
    '/api/orgs',
    { name, domain: `${name.toLowerCase()}.example.com` },
    headers,
  )
  const body = (await response.json()) as { org: { id: string } }
  return body.org.id
}

beforeAll(async () => {
  expect((await get('/api/jobs')).status).toBe(200)
})

describe('employer organisations (Prompt 9)', () => {
  it('creates an org with the caller as owner', async () => {
    const response = await post('/api/orgs', { name: 'Acme NG' }, ALICE)
    expect(response.status).toBe(201)
    const body = (await response.json()) as { org: { status: string; role?: string } }
    expect(body.org.status).toBe('pending')
    const detail = await get(
      `/api/orgs/${((await (await post('/api/orgs', { name: 'Acme 2' }, ALICE)).json()) as { org: { id: string } }).org.id}`,
      ALICE,
    )
    expect(((await detail.json()) as { org: { role: string } }).org.role).toBe('owner')
  })

  it('isolates orgs: another account gets 404, never a peek (cross-org isolation)', async () => {
    const orgA = await makeOrg(ALICE, 'Alpha')
    const orgB = await makeOrg(BOB, 'Beta')
    // Bob cannot read Alpha's org, jobs, or post into it.
    expect((await get(`/api/orgs/${orgA}`, BOB)).status).toBe(404)
    expect((await get(`/api/orgs/${orgA}/jobs`, BOB)).status).toBe(404)
    expect(
      (await post(`/api/orgs/${orgA}/jobs`, { title: 'x', description: 'y' }, BOB)).status,
    ).toBe(404)
    expect(
      (await post(`/api/orgs/${orgA}/members`, { email: 'bob-employer@example.com' }, BOB)).status,
    ).toBe(404)
    // And his own org stays intact.
    expect((await get(`/api/orgs/${orgB}`, BOB)).status).toBe(200)
  })

  it('posts jobs with trust scoring; scammy copy never goes live', async () => {
    const org = await makeOrg(ALICE, 'Gamma')
    const clean = await post(
      `/api/orgs/${org}/jobs`,
      {
        title: 'Backend Engineer',
        description: 'Build and maintain APIs in Lagos.',
        location: 'Lagos, NG',
      },
      ALICE,
    )
    expect(clean.status).toBe(201)
    expect(((await clean.json()) as { job: { status: string } }).job.status).toBe('live')
    const scammy = await post(
      `/api/orgs/${org}/jobs`,
      {
        title: 'Make money fast',
        description: 'Pay a fee now to guarantee your job. Send money to apply.',
      },
      ALICE,
    )
    expect(scammy.status).toBe(201)
    const body = (await scammy.json()) as { job: { status: string; scamScore: number } }
    expect(['pending', 'hidden']).toContain(body.job.status)
    expect(body.job.scamScore).toBeGreaterThan(0)
  })

  it('verifies domain ownership only for the owner and only with the right TXT token', async () => {
    const org = await makeOrg(ALICE, 'Delta')
    const detail = await get(`/api/orgs/${org}`, ALICE)
    expect(((await detail.json()) as { org: { domainVerified: boolean } }).org.domainVerified).toBe(
      false,
    )
    // DNS is unreachable from the test network; the check must fail closed.
    const verify = await post(`/api/orgs/${org}/verify-domain`, {}, ALICE)
    expect([422, 502]).toContain(verify.status)
    // A non-owner member cannot run verification at all.
    expect((await post(`/api/orgs/${org}/verify-domain`, {}, BOB)).status).toBe(404)
  })
})

describe('DoH domain verification unit', () => {
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
