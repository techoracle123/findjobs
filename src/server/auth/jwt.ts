/**
 * A small RS256 JWT verifier built on WebCrypto.
 *
 * Cloudflare Access signs its identity tokens with RS256 and publishes the
 * public keys at a well-known URL. Verifying the signature is what makes an
 * identity trustworthy: without it, anyone able to reach the Worker could
 * send a `Cf-Access-Authenticated-User-Email` header and become whoever
 * they liked.
 */

export interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}

export interface JwtClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  sub?: string
  email?: string
  groups?: string[]
  [key: string]: unknown
}

/** A signing key as published by Cloudflare Access, with its key id. */
export interface SigningKey extends JsonWebKey {
  kid?: string
}

export function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(withPadding)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function decodeJsonSegment(segment: string): unknown {
  const text = new TextDecoder().decode(decodeBase64Url(segment))
  return JSON.parse(text)
}

export async function importRsaJwk(jwk: SigningKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

export interface VerifyOptions {
  issuer?: string
  audience?: string
  now?: number
  /** Tolerance for clock skew, in seconds. */
  leewaySeconds?: number
}

export function audienceMatches(claim: string | string[] | undefined, expected: string): boolean {
  if (!claim) return false
  const list = Array.isArray(claim) ? claim : [claim]
  return list.includes(expected)
}

/**
 * Verifies the signature and the standard claims. Returns the claims when the
 * token is good and null when it is not — callers treat both the same way, so
 * an invalid token never gets a half-trusted identity.
 */
export async function verifyJwt(
  token: string,
  keys: SigningKey[],
  options: VerifyOptions = {},
): Promise<JwtClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerSegment, payloadSegment, signatureSegment] = parts

  let header: JwtHeader
  let claims: JwtClaims
  try {
    header = decodeJsonSegment(headerSegment) as JwtHeader
    claims = decodeJsonSegment(payloadSegment) as JwtClaims
  } catch {
    return null
  }

  if (header.alg !== 'RS256') return null

  const candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys
  if (candidates.length === 0) return null

  const signature = decodeBase64Url(signatureSegment)
  const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)

  let verified = false
  for (const jwk of candidates) {
    try {
      const key = await importRsaJwk(jwk)
      verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
      if (verified) break
    } catch {
      // Try the next candidate key.
    }
  }
  if (!verified) return null

  const now = options.now ?? Date.now()
  const leeway = options.leewaySeconds ?? 60
  const nowSeconds = Math.floor(now / 1000)

  if (typeof claims.exp === 'number' && nowSeconds > claims.exp + leeway) return null
  if (typeof claims.nbf === 'number' && nowSeconds + leeway < claims.nbf) return null

  if (options.issuer && claims.iss !== options.issuer) return null
  if (options.audience && !audienceMatches(claims.aud, options.audience)) return null

  return claims
}
