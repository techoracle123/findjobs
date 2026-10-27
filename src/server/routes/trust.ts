import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { recordAudit } from '../auth/accounts'
import { publishedPublicJobs } from '../public-feed'
import { scamScore } from '../trust'
import { type AppContext, badRequest, notFound, readJson, requireUser, unauthorized } from '../http'
import { enforceRateLimit } from '../ratelimit'

export const trustRoutes = new Hono<AppEnv>()

const REASONS = new Set([
  'scam',
  'asked-me-for-money',
  'role-closed',
  'wrong-category',
  'discriminatory',
  'other',
])

/**
 * Reports are open to everyone — being able to warn others must not depend
 * on having an account. The reporter is recorded only as a salted hash, and
 * two independent reports hide the listing pending review.
 */
trustRoutes.post('/jobs/:id/report', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'report', limit: 5, windowSeconds: 3600 })
  if (limited) return limited
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const reason = typeof body.reason === 'string' ? body.reason : ''
  if (!REASONS.has(reason)) return badRequest(c, 'Choose one of the listed report reasons.')
  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : null
  const jobId = c.req.param('id')

  const reporterHash = await hashReporter(
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown',
    c.req.header('user-agent') ?? '',
  )

  await c.env.DB.prepare(
    "INSERT INTO job_reports (id, job_id, reason, comment, reporter_hash, created_at, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open')",
  )
    .bind(
      `rep_${crypto.randomUUID()}`,
      jobId,
      reason,
      comment,
      reporterHash,
      new Date().toISOString(),
    )
    .run()

  const distinct = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT reporter_hash) AS n FROM job_reports WHERE job_id = ?1',
  )
    .bind(jobId)
    .first<{ n: number }>()

  if ((distinct?.n ?? 0) >= 2 && c.env.PUBLIC_JOBS) {
    const hidden =
      (await c.env.PUBLIC_JOBS.get<Record<string, number>>('moderation:hidden', 'json')) ?? {}
    if (!hidden[jobId]) {
      hidden[jobId] = Date.now()
      await c.env.PUBLIC_JOBS.put('moderation:hidden', JSON.stringify(hidden))
      await recordAudit(c.env.DB, null, 'job_auto_hidden', { jobId, reports: distinct?.n })
    }
    return c.json({ ok: true, hiddenPendingReview: true })
  }
  return c.json({ ok: true, hiddenPendingReview: false }, 201)
})

async function hashReporter(ip: string, userAgent: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`fj-report:${ip}:${userAgent}`),
  )
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function requireAdmin(c: AppContext) {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const allow = (c.env?.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (!allow.length) return c.json({ error: 'admin_not_configured' }, 503)
  if (!allow.includes(user.email.toLowerCase())) return c.json({ error: 'forbidden' }, 403)
  return null
}

/** The moderation queue: open reports with the score breakdown beside them. */
trustRoutes.get('/admin/moderation', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const reports = await c
    .env!.DB!.prepare(
      `SELECT id, job_id, reason, comment, created_at, state FROM job_reports
     WHERE state = 'open' ORDER BY created_at DESC LIMIT 200`,
    )
    .all()
  const published = await publishedPublicJobs(c.env?.PUBLIC_JOBS)
  const scoreOf = (jobId: string) => {
    const job = published?.jobs.find((item) => item.id === jobId)
    return job
      ? {
          scamScore: job.scamScore ?? 0,
          scamSignals: job.scamSignals ?? [],
          title: job.title,
          company: job.company,
        }
      : null
  }
  return c.json({
    queue: (reports.results ?? []).map((row) => ({
      ...(row as Record<string, unknown> as {
        id: string
        job_id: string
        reason: string
        comment: string | null
        created_at: string
      }),
      job: scoreOf((row as { job_id: string }).job_id),
    })),
  })
})

/** One-click resolution; every action lands in the audit log. */
trustRoutes.post('/admin/moderation/:jobId', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const user = (await requireUser(c))!
  const limited = await enforceRateLimit(c, { bucket: 'admin', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const body = await readJson(c)
  const action = typeof body.action === 'string' ? body.action : ''
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null
  if (!['publish', 'hide', 'reject', 'request-verification'].includes(action))
    return badRequest(c, 'Unknown moderation action.')
  const jobId = c.req.param('jobId')
  await c
    .env!.DB!.prepare(
      'INSERT INTO moderation_actions (id, job_id, action, actor, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
    .bind(`mod_${crypto.randomUUID()}`, jobId, action, user.email, note, new Date().toISOString())
    .run()
  await recordAudit(c.env!.DB!, user.id, `moderation_${action}`, { jobId, note })

  if (c.env?.PUBLIC_JOBS) {
    const hidden =
      (await c.env.PUBLIC_JOBS.get<Record<string, number>>('moderation:hidden', 'json')) ?? {}
    if (action === 'hide' || action === 'reject') hidden[jobId] = Date.now()
    if (action === 'publish') delete hidden[jobId]
    await c.env.PUBLIC_JOBS.put('moderation:hidden', JSON.stringify(hidden))
  }
  await c
    .env!.DB!.prepare('UPDATE job_reports SET state = ?2 WHERE job_id = ?1')
    .bind(jobId, action === 'request-verification' ? 'open' : 'resolved')
    .run()
  return c.json({ ok: true, action })
})

/** Score breakdown for one listing, used by the moderation screen. */
trustRoutes.get('/admin/moderation/:jobId/score', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const published = await publishedPublicJobs(c.env?.PUBLIC_JOBS)
  const job = published?.jobs.find((item) => item.id === c.req.param('jobId'))
  if (!job) return notFound(c)
  return c.json({ score: scamScore(job), scamScore: job.scamScore, signals: job.scamSignals })
})
