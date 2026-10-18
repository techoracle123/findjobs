import { describe, expect, it, vi } from 'vitest'
import { verifyJwt } from '../../src/server/auth/jwt'
import type { SigningKey } from '../../src/server/auth/jwt'
import { audienceMatches } from '../../src/server/auth/jwt'
import { resolveIdentity } from '../../src/server/auth/identity'
import { readConfig } from '../../src/server/config'

function base64url(input: Uint8Array): string {
  let binary = ''
  for (const byte of input) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeKeyPair(kid = 'test-key'): Promise<{
  publicKey: SigningKey
  privateKey: CryptoKey
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { publicKey: { ...jwk, kid } as SigningKey, privateKey: pair.privateKey }
}

async function signToken(
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
  kid = 'test-key',
): Promise<string> {
  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })),
  )
  const body = base64url(new TextEncoder().encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${base64url(new Uint8Array(signature))}`
}

const NOW = 1_760_000_000_000

describe('JWT verification', () => {
  it('accepts a correctly signed token', async () => {
    const { publicKey, privateKey } = await makeKeyPair()
    const token = await signToken(
      {
        iss: 'https://team.cloudflareaccess.com',
        aud: 'aud-tag',
        email: 'person@example.com',
        sub: 'user-1',
        exp: Math.floor(NOW / 1000) + 300,
      },
      privateKey,
    )

    const claims = await verifyJwt(token, [publicKey], {
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'aud-tag',
      now: NOW,
    })

    expect(claims).not.toBeNull()
    expect(claims?.email).toBe('person@example.com')
    expect(claims?.sub).toBe('user-1')
  })

  it('rejects a token whose payload was changed after signing', async () => {
    const { publicKey, privateKey } = await makeKeyPair()
    const token = await signToken(
      { iss: 'https://team.cloudflareaccess.com', aud: 'aud-tag', email: 'a@example.com' },
      privateKey,
    )
    const [header, , signature] = token.split('.')
    const forged = base64url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: 'https://team.cloudflareaccess.com',
          aud: 'aud-tag',
          email: 'root@example.com',
        }),
      ),
    )

    const claims = await verifyJwt(`${header}.${forged}.${signature}`, [publicKey], { now: NOW })
    expect(claims).toBeNull()
  })

  it('rejects a token signed by a different key', async () => {
    const { privateKey } = await makeKeyPair()
    const other = await makeKeyPair('other-key')
    const token = await signToken({ email: 'a@example.com' }, privateKey)

    const claims = await verifyJwt(token, [other.publicKey], { now: NOW })
    expect(claims).toBeNull()
  })

  it('rejects a token that has expired', async () => {
    const { publicKey, privateKey } = await makeKeyPair()
    const token = await signToken(
      { email: 'a@example.com', exp: Math.floor(NOW / 1000) - 3600 },
      privateKey,
    )

    const claims = await verifyJwt(token, [publicKey], { now: NOW })
    expect(claims).toBeNull()
  })

  it('rejects a token minted for another application', async () => {
    const { publicKey, privateKey } = await makeKeyPair()
    const token = await signToken({ aud: 'someone-elses-app', email: 'a@example.com' }, privateKey)

    const claims = await verifyJwt(token, [publicKey], { audience: 'aud-tag', now: NOW })
    expect(claims).toBeNull()
  })

  it('rejects a token from another issuer', async () => {
    const { publicKey, privateKey } = await makeKeyPair()
    const token = await signToken(
      { iss: 'https://evil.example', email: 'a@example.com' },
      privateKey,
    )

    const claims = await verifyJwt(token, [publicKey], {
      issuer: 'https://team.cloudflareaccess.com',
      now: NOW,
    })
    expect(claims).toBeNull()
  })

  it('rejects a token whose key id is unknown', async () => {
    const { privateKey } = await makeKeyPair('key-a')
    const other = await makeKeyPair('key-b')
    const token = await signToken({ email: 'a@example.com' }, privateKey, 'key-a')

    const claims = await verifyJwt(token, [other.publicKey], { now: NOW })
    expect(claims).toBeNull()
  })

  it('rejects something that is not a token at all', async () => {
    const { publicKey } = await makeKeyPair()
    expect(await verifyJwt('not-a-token', [publicKey], { now: NOW })).toBeNull()
    expect(await verifyJwt('a.b', [publicKey], { now: NOW })).toBeNull()
  })

  it('matches an audience against a list', () => {
    expect(audienceMatches(['one', 'two'], 'two')).toBe(true)
    expect(audienceMatches('one', 'one')).toBe(true)
    expect(audienceMatches('one', 'two')).toBe(false)
    expect(audienceMatches(undefined, 'one')).toBe(false)
  })
})

describe('identity resolution', () => {
  const request = (headers: Record<string, string>): Request =>
    new Request('https://example.com/api/account', { headers })

  it('uses the dev header outside production', async () => {
    const config = readConfig({ APP_MODE: 'local-preview' })
    const identity = await resolveIdentity(
      request({ 'x-dev-user-email': 'Dev@Example.com' }),
      config,
    )
    expect(identity?.email).toBe('dev@example.com')
  })

  it('ignores the dev header in production', async () => {
    const config = readConfig({ APP_MODE: 'production' })
    const identity = await resolveIdentity(
      request({ 'x-dev-user-email': 'dev@example.com' }),
      config,
    )
    expect(identity).toBeNull()
  })

  it.each(['staging', 'preview', 'unknown'])(
    'ignores dev identity in hosted %s mode',
    async (mode) => {
      expect(
        await resolveIdentity(
          request({ 'x-dev-user-email': 'dev@example.com' }),
          readConfig({ APP_MODE: mode }),
        ),
      ).toBeNull()
    },
  )

  it.each(['cookie', 'assertion'])(
    'verifies a signed Access %s token for browser sign-in',
    async (transport) => {
      const { publicKey, privateKey } = await makeKeyPair('browser-key')
      const domain = `${transport}-test.cloudflareaccess.com`
      const token = await signToken(
        {
          iss: `https://${domain}`,
          aud: 'browser-aud',
          email: 'browser@example.com',
          exp: Math.floor(NOW / 1000) + 300,
        },
        privateKey,
        'browser-key',
      )
      const mocked = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ keys: [publicKey] }))
      try {
        const headers: Record<string, string> =
          transport === 'cookie'
            ? { cookie: `other=value; CF_Authorization=${token}` }
            : { 'cf-access-jwt-assertion': token }
        const identity = await resolveIdentity(
          request(headers),
          readConfig({
            APP_MODE: 'production',
            ACCESS_TEAM_DOMAIN: domain,
            ACCESS_AUD: 'browser-aud',
          }),
          NOW,
        )
        expect(identity?.email).toBe('browser@example.com')
      } finally {
        mocked.mockRestore()
      }
    },
  )

  it('returns nothing for an anonymous request', async () => {
    const config = readConfig({ APP_MODE: 'local-preview' })
    expect(await resolveIdentity(request({}), config)).toBeNull()
  })
})
