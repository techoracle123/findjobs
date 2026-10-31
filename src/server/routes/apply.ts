import { Hono } from 'hono'
import type { AppEnv } from '../env'
import {
  applySubject,
  anonCookieHeader,
  readAnonCookie,
  recordApplyEvent,
  type ApplySubject,
} from '../apply'
import { type AppContext, requireUser } from '../http'
import { enforceRateLimit } from '../ratelimit'

export const applyRoutes = new Hono<AppEnv>()

/** One subject per request: the same anonymous id is recorded and cookied. */
function resolveSubject(c: AppContext, userId: string | null): ApplySubject {
  return applySubject(userId, readAnonCookie(c.req.header('cookie')))
}

function withAnonCookie(c: AppContext, subject: ApplySubject, response: Response): Response {
  if (subject.kind === 'anon' && subject.anonId) {
    const cameFromCookie = readAnonCookie(c.req.header('cookie')) === subject.anonId
    if (!cameFromCookie)
      response.headers.set(
        'Set-Cookie',
        anonCookieHeader(subject.anonId, new URL(c.req.url).protocol === 'https:'),
      )
  }
  return response
}

/**
 * Fast Apply is retired. FJ does not currently deliver applications to an
 * employer's own system, so presenting a one-tap submission or a daily
 * allowance would be misleading. External applications remain free.
 */
applyRoutes.post('/jobs/:id/fast-apply', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'fast-apply', limit: 30, windowSeconds: 60 })
  if (limited) return limited
  return c.json(
    {
      error: 'fast_apply_unavailable',
      message:
        'FJ does not submit this application for you. Use the employer’s own application page; applying there is always free.',
    },
    410,
  )
})

/**
 * Recording that someone left for the employer's own site. This is
 * fire-and-forget analytics: it is never gated and always answers 204 so the
 * outbound link can never be blocked by our systems.
 */
applyRoutes.post('/jobs/:id/apply-click', async (c) => {
  const subject = resolveSubject(c, null)
  try {
    if (c.env?.DB) {
      const user = await requireUser(c)
      const resolved = user ? applySubject(user.id, subject.anonId) : subject
      await recordApplyEvent(c.env.DB, resolved, 'external_click', c.req.param('id'))
    }
  } catch {
    /* The outbound link must still work when analytics cannot. */
  }
  return withAnonCookie(c, subject, c.body(null, 204))
})

/** The retired Fast Apply allowance endpoint. No application meter is used. */
applyRoutes.get('/apply/quota', (c) =>
  c.json(
    {
      error: 'quota_retired',
      message:
        'FJ no longer uses a daily Fast Apply allowance. Employer-site applications are free and unlimited.',
    },
    410,
  ),
)
