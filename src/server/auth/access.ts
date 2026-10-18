import type { AccessConfig } from '../config'
import { verifyJwt } from './jwt'
import type { SigningKey } from './jwt'
import { logger } from '../logging'

export interface AccessIdentity {
  email: string
  subject: string
  groups: string[]
}

const CERTS_TTL_MS = 5 * 60 * 1000
let certsCache: { domain: string; keys: JsonWebKey[]; fetchedAt: number } | null = null

/**
 * Cloudflare Access publishes the public keys used to sign identity tokens at
 * a well-known URL on the team domain.
 */
export async function fetchAccessCerts(teamDomain: string): Promise<JsonWebKey[]> {
  if (
    certsCache &&
    certsCache.domain === teamDomain &&
    Date.now() - certsCache.fetchedAt < CERTS_TTL_MS
  ) {
    return certsCache.keys
  }

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Access certs request failed with status ${response.status}`)
  }

  const body = (await response.json()) as { keys?: SigningKey[] }
  const keys = body.keys ?? []
  certsCache = { domain: teamDomain, keys, fetchedAt: Date.now() }
  return keys
}

export function extractBearer(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/**
 * Verifies an Access identity token and returns the identity it carries.
 * Returns null for any problem: a missing token, a bad signature, an expired
 * token or a token minted for a different application.
 */
export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  now: number = Date.now(),
): Promise<AccessIdentity | null> {
  if (!config.teamDomain || !config.aud) return null

  let keys: JsonWebKey[]
  try {
    keys = await fetchAccessCerts(config.teamDomain)
  } catch (error) {
    logger.error('access certs unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  const claims = await verifyJwt(token, keys, {
    issuer: `https://${config.teamDomain}`,
    audience: config.aud,
    now,
  })
  if (!claims) return null

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  if (!email) return null

  return {
    email,
    subject: typeof claims.sub === 'string' ? claims.sub : email,
    groups: Array.isArray(claims.groups) ? claims.groups.map(String) : [],
  }
}
