import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { getEntitlements, setSaved } from '../auth/accounts'
import {
  applySubject,
  anonCookieHeader,
  consumeFastApply,
  fastApplyQuota,
  mergeAnonQuota,
  readAnonCookie,
  recordApplyEvent,
  type ApplySubject,
} from '../apply'
import { type AppContext, badRequest, notFound, readJson, requireUser, unauthorized } from '../http'
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
 * Fast Apply: a one-tap application using the person's stored FJ profile.
 * Only direct-employer posts (applyMode 'onsite') support it. The free tier is
 * capped at 5 per Lagos day and 15 per rolling week; Pro is uncapped. External
 * applications are never counted here.
 */
applyRoutes.post('/jobs/:id/fast-apply', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'fast-apply', limit: 30, windowSeconds: 60 })
  if (limited) return limited
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const user = await requireUser(c)
  const subject = resolveSubject(c, user?.id ?? null)
  if (user) await mergeAnonQuota(c.env.DB, user.id, subject.anonId)

  const jobId = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, apply_mode FROM jobs WHERE id = ?1')
    .bind(jobId)
    .first<{ id: string; apply_mode: string | null }>()
  if (!row) return withAnonCookie(c, subject, notFound(c))
  if ((row.apply_mode || 'external') !== 'onsite')
    return withAnonCookie(
      c,
      subject,
      badRequest(c, 'This role applies on the employer’s own site, always free.'),
    )

  const entitled = user
    ? (await getEntitlements(c.env.DB, user.id)).includes('unlimited_fast_apply')
    : false

  const denied = await consumeFastApply(c.env.DB, subject, entitled)
  if (denied) {
    return withAnonCookie(
      c,
      subject,
      c.json(
        {
          error: 'quota_exceeded',
          message:
            'You’ve used all 5 free applications today. You can still apply directly on the employer’s site — that’s always free.',
          limit: denied.limit,
          used: denied.used,
          resetsAt: new Date(denied.resetsAt).toISOString(),
          weekLimit: denied.weekLimit,
          weekUsed: denied.weekUsed,
          upgradeUrl: '/dashboard?tab=plan',
        },
        402,
      ),
    )
  }

  const body = await readJson(c)
  const coverNote = typeof body.coverNote === 'string' ? body.coverNote.slice(0, 500) : undefined
  await recordApplyEvent(c.env.DB, subject, 'fast_apply', jobId)
  if (user) await setSaved(c.env.DB, user.id, jobId, 'applied', coverNote, new Date().toISOString())

  const state = await fastApplyQuota(c.env.DB, subject, entitled)
  return withAnonCookie(
    c,
    subject,
    c.json(
      {
        ok: true,
        remaining: entitled ? null : Math.max(0, state.remaining),
        resetsAt: new Date(state.resetsAt).toISOString(),
      },
      201,
    ),
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

/** The signed-in person's Fast Apply allowance for the header meter. */
applyRoutes.get('/apply/quota', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  await mergeAnonQuota(c.env.DB, user.id, readAnonCookie(c.req.header('cookie')))
  const entitled = (await getEntitlements(c.env.DB, user.id)).includes('unlimited_fast_apply')
  const state = await fastApplyQuota(c.env.DB, applySubject(user.id, null), entitled)
  return c.json({ ...state, resetsAt: new Date(state.resetsAt).toISOString() })
})
