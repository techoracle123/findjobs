/**
 * The small amount of cryptography the payment providers need.
 *
 * Every provider signs its webhooks with an HMAC over the raw request body
 * and every one of them is verified in constant time, so a wrong signature
 * cannot be discovered by measuring how long the comparison took.
 */

export type HmacAlgorithm = 'SHA-256' | 'SHA-512'

export async function hmacBytes(
  secret: string,
  message: string,
  algorithm: HmacAlgorithm = 'SHA-256',
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(signature)
}

/** A lower-case hex HMAC, the form Stripe and Paystack send. */
export async function hmacHex(
  secret: string,
  message: string,
  algorithm: HmacAlgorithm = 'SHA-256',
): Promise<string> {
  const signature = await hmacBytes(secret, message, algorithm)
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A base64 HMAC, the form some providers use. */
export async function hmacBase64(
  secret: string,
  message: string,
  algorithm: HmacAlgorithm = 'SHA-256',
): Promise<string> {
  const signature = await hmacBytes(secret, message, algorithm)
  let binary = ''
  for (const byte of signature) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Compares two strings without leaking their length through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

/**
 * Compares a signature against a list of acceptable values, in constant
 * time for each. Used where a provider documents more than one accepted
 * encoding for the same header.
 */
export function matchesAny(candidate: string, expected: string[]): boolean {
  return expected.some((value) => timingSafeEqual(candidate, value))
}
