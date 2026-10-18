import type { AppConfig } from '../config'
import { extractBearer, verifyAccessToken } from './access'
import type { AccessIdentity } from './access'

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'
export const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email'
export const DEV_EMAIL_HEADER = 'x-dev-user-email'

/**
 * Resolves the identity of a request.
 *
 * In production this is always a verified Cloudflare Access token. In local
 * and test modes a header may stand in for Access, so the stack can be
 * exercised without an Access application — but only when the app is not
 * running in a hosted mode, and the bypass is never used to *upgrade* an
 * unverified request into a real one.
 */
export async function resolveIdentity(
  request: Request,
  config: AppConfig,
  now: number = Date.now(),
): Promise<AccessIdentity | null> {
  const token = extractBearer(request.headers.get('authorization'))

  if (token && config.access.teamDomain && config.access.aud) {
    return verifyAccessToken(token, config.access, now)
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

export function isDevIdentity(identity: AccessIdentity): boolean {
  return identity.subject.startsWith('dev:')
}
