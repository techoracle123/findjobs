/**
 * Password hashing for email + password accounts.
 *
 * PBKDF2 with SHA-256 at the highest iteration count the Workers runtime
 * allows (100,000), a fresh 16-byte random salt per password, and a
 * constant-time compare on verification. The stored string carries its own
 * parameters (`pbkdf2$<iterations>$<salt>$<hash>`) so the cost can rise
 * later without invalidating existing passwords.
 */

const ITERATIONS = 100_000
const KEY_BITS = 256
const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false
  try {
    const expected = fromBase64(parts[3])
    const actual = await derive(password, fromBase64(parts[2]), iterations)
    return sameBytes(actual, expected)
  } catch {
    return false
  }
}

/**
 * Throws away about the same time as a real check. Login runs this when the
 * account does not exist so "no such account" and "wrong password" stay
 * hard to tell apart from the outside.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await derive(password, new Uint8Array(16), ITERATIONS)
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200

/** Returns a plain reason when the password is not acceptable, else null. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH)
    return `Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password.length > PASSWORD_MAX_LENGTH) return 'That password is too long.'
  return null
}
