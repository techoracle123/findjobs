import type { AppConfig } from '../config'
import { resolveOwnSession } from '../routes/auth'

export const DEV_EMAIL_HEADER = 'x-dev-user-email'

/** A verified identity from FJ's own sign-in (email code + session cookie). */
export interface Identity {
  email: string
  subject: string
  groups: string[]
}

/** Back-compat alias for callers written against the old Access type. */
export type AccessIdentity = Identity

/**
 * Resolves the identity of a request from FJ's own session cookie.
 * Cloudflare Access is not used anywhere in the sign-in journey.
 * In local/test modes only, a dev header may stand in for a session.
 */
export async function resolveIdentity(
  request: Request,
  config: AppConfig,
  now: number = Date.now(),
  db?: D1Database,
): Promise<Identity | null> {
  const ownToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('fj_session='))
    ?.slice('fj_session='.length)
  if (db && ownToken) {
    const session = await resolveOwnSession(db, ownToken, now)
    if (session) return { email: session.email, subject: session.userId, groups: [] }
  }

  if (!config.isLocal && !config.isTest) {
    // Hosted staging, preview, production and unknown modes fail closed.
    return null
  }

  const devEmail = request.headers.get(DEV_EMAIL_HEADER)
  if (devEmail) {
    const email = devEmail.trim().toLowerCase()
    if (email) {
      return { email, subject: `dev:${email}`, groups: ['dev'] }
    }
  }

  return null
}

export function isDevIdentity(identity: Identity): boolean {
  return identity.subject.startsWith('dev:')
}
