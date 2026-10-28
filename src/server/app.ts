import { Hono } from 'hono'
import type { AppEnv } from './env'
import { DEFAULT_APP_MODE } from './env'
import { emailConfigured, readConfig, telegramConfigured } from './config'
import { hasRealProvider } from './billing/provider'
import { listOpenJobs, findJob, searchJobs } from './jobs'
import { getRates } from './rates'
import { suggest } from './cv'
import { scoreJob } from '../shared/scoring'
import type { Profile, ScoredJob } from '../shared/types'
import { requestContext, requireUser, stringList, unauthorized, type AppContext } from './http'
import { enforceRateLimit } from './ratelimit'
import { takeAiBudget } from './aiquota'
import { buildReadiness } from './readiness'
import { resolveIdentity } from './auth/identity'
import { accountRoutes } from './routes/account'
import { sourceRoutes } from './routes/sources'
import { billingRoutes } from './routes/billing'
import { telegramRoutes } from './routes/telegram'
import { insightRoutes } from './routes/insights'
import { applyRoutes } from './routes/apply'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { employerRoutes } from './routes/employers'
import { trustRoutes } from './routes/trust'
import { jobFacets } from './job-stats'
import { withTimeout } from './timeouts'
import { log } from './logging'
import { publicDataCache } from './public-cache'
import { livePublicEnabled, livePublicJobs, searchLivePublic } from './live-public'
import { publishedPublicJobs, findPublishedJob } from './public-feed'
import type { JobSearch } from './jobs'

export const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  c.header('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'")
})
app.use('*', requestContext)
app.use('*', publicDataCache())
// Cookie-authenticated writes are same-origin. Signed provider webhooks are
// verified separately and must remain callable by Telegram/payment servers.
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.path.endsWith('/webhook')) {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json({ error: 'invalid_origin' }, 403)
  }
  await next()
})

/**
 * Reads a numeric query parameter. An empty or unparseable value is absent,
 * not zero: `Number('')` is 0, which would otherwise turn a request with no
 * paging into a request for the first row.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function numberParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function normaliseProfile(input: unknown): Profile {
  const raw = (input ?? {}) as Partial<Profile>
  return {
    skills: stringList(raw.skills),
    targetRoleFamilies: stringList(raw.targetRoleFamilies),
    targetSeniority: stringList(raw.targetSeniority) as Profile['targetSeniority'],
    preferredWorkModes: stringList(raw.preferredWorkModes) as Profile['preferredWorkModes'],
    workCountry: typeof raw.workCountry === 'string' ? raw.workCountry.trim().toUpperCase() : '',
  }
}

app.get('/api/auth/status', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  const identity = await resolveIdentity(c.req.raw, readConfig(c.env || {}), Date.now(), c.env?.DB)
  return c.json({
    authenticated: !!identity,
    email: identity?.email || null,
    configured: emailConfigured(readConfig(c.env || {})),
    emailConfigured: emailConfigured(readConfig(c.env || {})),
  })
})

// Sign-in is FJ's own email-code flow. This legacy path simply forwards to
// the sign-in page; Cloudflare Access plays no part anywhere.
app.get('/api/auth/login', async (c) => {
  const returnTo = c.req.query('returnTo') || '/dashboard'
  const safe = /^\/(?:dashboard|jobs\/[A-Za-z0-9_-]+)?$/.test(returnTo) ? returnTo : '/dashboard'
  return c.redirect(`/auth/login?returnTo=${encodeURIComponent(safe)}`)
})

/**
 * Records that a copy id actually rendered in a browser so the audit page can
 * show real usage. Anonymous, rate limited and counter writes are bounded.
 */
app.post('/api/copy-render', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'copy-render', limit: 30, windowSeconds: 60 })
  if (limited) return limited
  const body = await c.req.json().catch(() => null)
  const id = typeof body?.id === 'string' && /^[a-z][a-z0-9.]{0,63}$/.test(body.id) ? body.id : null
  if (!id) return c.json({ error: 'bad_request' }, 400)
  const kv = c.env?.PUBLIC_JOBS
  if (kv) {
    const key = `copyrender:${id}`
    const current = Number((await kv.get(key)) ?? '0')
    await kv.put(key, String(current + 1))
  }
  return c.json({ ok: true })
})

/** Admin gate: verified identity plus the operator allowlist. */
async function requireAdmin(c: AppContext): Promise<Response | null> {
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

/**
 * Product analytics (Prompt 14). Five events, zero PII: counts and content
 * refs only. Aggregates live in KV so no per-user rows exist anywhere.
 */
app.post('/api/analytics/events', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'analytics', limit: 60, windowSeconds: 60 })
  if (limited) return limited
  const body = await c.req.json().catch(() => null)
  const events = Array.isArray(body?.events) ? body.events.slice(0, 10) : []
  const allowed = new Set(['search', 'job_view', 'save', 'apply_start', 'apply_complete'])
  const kv = c.env?.PUBLIC_JOBS
  const day = new Date().toISOString().slice(0, 10)
  const updates = new Map<string, number>()
  for (const entry of events) {
    const event = typeof entry?.event === 'string' && allowed.has(entry.event) ? entry.event : null
    if (!event) continue
    updates.set(`analytics:${day}:${event}`, (updates.get(`analytics:${day}:${event}`) ?? 0) + 1)
    if (event === 'search' && typeof entry.ref === 'string' && entry.ref.trim()) {
      const query = entry.ref.trim().toLowerCase().slice(0, 60)
      updates.set(
        `analytics:${day}:q:${query}`,
        (updates.get(`analytics:${day}:q:${query}`) ?? 0) + 1,
      )
    }
  }
  if (kv) {
    for (const [key, delta] of updates) {
      const current = Number((await kv.get(key)) ?? '0')
      await kv.put(key, String(current + delta))
    }
  }
  return c.json({ ok: true })
})

/**
 * The eight operator questions (Prompt 14): search volume, what people look
 * for, job views, saves, apply starts, completed applies, the two conversion
 * rates, and how busy the product is — all aggregates, never per person.
 */
app.get('/api/admin/analytics', async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const kv = c.env?.PUBLIC_JOBS
  if (!kv) return c.json({ error: 'storage_unavailable' }, 503)
  const days: Array<Record<string, number | string>> = []
  const totals: Record<string, number> = {}
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10)
    const row: Record<string, number | string> = { day }
    for (const event of ['search', 'job_view', 'save', 'apply_start', 'apply_complete']) {
      const count = Number((await kv.get(`analytics:${day}:${event}`)) ?? '0')
      row[event] = count
      totals[event] = (totals[event] ?? 0) + count
    }
    days.push(row)
  }
  const queries: Array<{ query: string; count: number }> = []
  const keys = await kv.list({ prefix: `analytics:${new Date().toISOString().slice(0, 10)}:q:` })
  for (const key of keys.keys) {
    queries.push({
      query: key.name.split(':q:')[1],
      count: Number((await kv.get(key.name)) ?? '0'),
    })
  }
  queries.sort((a, b) => b.count - a.count)
  const rate = (from: string, to: string) =>
    totals[from] ? Math.round(((totals[to] ?? 0) / totals[from]) * 1000) / 10 : 0
  return c.json({
    questions: {
      searchesThisWeek: totals.search ?? 0,
      topQueries: queries.slice(0, 10),
      jobViewsThisWeek: totals.job_view ?? 0,
      savesThisWeek: totals.save ?? 0,
      applyStartsThisWeek: totals.apply_start ?? 0,
      applyCompletesThisWeek: totals.apply_complete ?? 0,
      viewToSavePercent: rate('job_view', 'save'),
      applyStartToCompletePercent: rate('apply_start', 'apply_complete'),
    },
    days,
  })
})

app.get('/api/health', async (c) => {
  const env = c.env ?? {}
  // Anonymous callers get the liveness bit and nothing else: this endpoint
  // must not map the stack. Operators pass X-Health-Key; verified identities
  // see the full readiness report.
  const healthKey = env.HEALTH_CHECK_KEY
  const keyHeader = c.req.header('x-health-key') || ''
  const identity = await resolveIdentity(c.req.raw, readConfig(env))
  const authorised = Boolean((healthKey && keyHeader === healthKey) || identity)
  if (!authorised) return c.json({ ok: true })

  const config = readConfig(env)
  const published = await publishedPublicJobs(env.PUBLIC_JOBS)
  const count = env.DB
    ? await env.DB.prepare(
        published
          ? 'SELECT 1 AS n'
          : "SELECT COUNT(*) AS n FROM jobs WHERE is_demo=0 AND job_status='open' AND expired_at IS NULL",
      )
        .first<{ n: number }>()
        .catch(() => null)
    : null
  const rates = await getRates(config.appMode !== 'test', env.DB)
  const storageAvailable = Boolean(count)
  const signInUrl = '/auth/login'
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    ok: true,
    appMode: config.appMode || DEFAULT_APP_MODE,
    aiBinding: config.aiEnabled,
    telegramConfigured: telegramConfigured(config),
    emailConfigured: emailConfigured(config),
    billingConfigured: hasRealProvider(config),
    authenticationRequired: config.isProduction,
    signInUrl,
    dataSource: published ? 'public-snapshot' : 'd1',
    jobCount: published?.jobs.length ?? count?.n ?? 0,
    storageAvailable,
    ratesDate: rates.date,
    ratesSource: rates.source,
  })
})

app.get('/api/feed-status', async (c) => {
  const snapshot = await publishedPublicJobs(c.env?.PUBLIC_JOBS)
  if (!snapshot) return c.json({ available: false, refreshHours: 12 }, 503)
  const visible = snapshot.jobs.filter((job) => job.quality?.isEnglish !== false)
  return c.json({
    available: true,
    // The default feed is English-first; the full corpus is reported alongside.
    total: visible.length,
    totalAllLanguages: snapshot.jobs.length,
    sourceCount: snapshot.sourceCount,
    attemptedSources: snapshot.attemptedSources,
    olderSources: snapshot.olderSources,
    updatedAt: snapshot.refreshedAt,
    refreshHours: 12,
    added: snapshot.added,
  })
})

app.get('/api/jobs', async (c) => {
  const env = c.env ?? {}
  const url = new URL(c.req.url)
  const query = url.searchParams.get('q')?.trim() || undefined
  const status = url.searchParams.get('status')
  const limit = numberParam(url, 'limit')
  const offset = numberParam(url, 'offset')

  const search: JobSearch = {
    query,
    country: url.searchParams.get('country')?.trim().toUpperCase().slice(0, 2) || undefined,
    location: url.searchParams.get('loc')?.trim().slice(0, 80) || undefined,
    worldwide: url.searchParams.get('ww') === '1',
    roleFamilies: (url.searchParams.get('roles') || '').split(',').filter(Boolean).slice(0, 30),
    workModes: (url.searchParams.get('modes') || '').split(',').filter(Boolean).slice(0, 3),
    seniorities: (url.searchParams.get('levels') || '').split(',').filter(Boolean).slice(0, 8),
    status: status === 'all' || status === 'closed' ? status : 'open',
    limit,
    offset,
  }

  const published = await publishedPublicJobs(env.PUBLIC_JOBS)
  if (published) {
    const result = searchLivePublic(published.jobs, search)
    return c.json({
      ...result,
      jobs: result.jobs.map((job) => ({ ...job, detailKey: undefined, descriptionPreview: true })),
      dataSource: 'public-snapshot',
      facets: jobFacets(published.jobs, search),
      updatedAt: published.refreshedAt,
      refreshHours: published.refreshHours,
      sourceCount: published.sourceCount,
      ...(published.olderSources ? { warning: 'stale' } : {}),
    })
  }

  // Without any paging or filtering the whole feed is returned, which is
  // what the interface wants while the corpus is small. Once it is not
  // small, the caller asks for a page.
  if (
    !query &&
    !status &&
    limit === undefined &&
    offset === undefined &&
    !['country', 'roles', 'modes', 'levels'].some((key) => url.searchParams.has(key))
  ) {
    const { jobs, source, warning } = await withTimeout(listOpenJobs(env.DB), 3000)
    if (warning && livePublicEnabled(env.APP_MODE)) {
      const current = await livePublicJobs(url.origin)
      return c.json({
        jobs: current,
        total: current.length,
        dataSource: 'live-public',
        facets: { ...jobFacets(current, {}), total: current.length },
        warning: 'stale',
      })
    }
    return c.json({
      jobs,
      dataSource: source,
      facets: { ...jobFacets(jobs, {}), total: jobs.length },
      ...(warning ? { warning } : {}),
    })
  }

  // Local/test previews show the bundled test fixture so the UI can be
  // exercised offline; hosted modes never see demo rows.
  const config = readConfig(env)
  const allowDemo = config.isLocal || config.isTest
  let result
  let dataSource: 'd1' | 'live-public' = 'd1'
  try {
    if (!env.DB) throw new Error('Database unavailable')
    result = await withTimeout(
      searchJobs(env.DB, { ...search, includeDemo: allowDemo, withFacets: true }),
      3000,
    )
  } catch (error) {
    if (!livePublicEnabled(env.APP_MODE)) throw error
    result = searchLivePublic(await livePublicJobs(url.origin), search)
    dataSource = 'live-public'
  }

  return c.json({
    jobs: result.jobs,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    dataSource,
    facets: { ...jobFacets(result.facetJobs ?? result.jobs, search), total: result.total },
    ...(dataSource === 'live-public'
      ? {
          warning: 'stale',
        }
      : {}),
  })
})

app.get('/api/jobs/:id', async (c) => {
  const env = c.env ?? {}
  let job = await findPublishedJob(env.PUBLIC_JOBS, c.req.param('id'))
  if (job) return c.json({ job })
  try {
    job = await findJob(
      env.DB,
      c.req.param('id'),
      Date.now(),
      readConfig(env).isLocal || readConfig(env).isTest,
    )
  } catch (error) {
    if (!livePublicEnabled(env.APP_MODE)) throw error
  }
  if (!job && livePublicEnabled(env.APP_MODE))
    job =
      (await livePublicJobs(new URL(c.req.url).origin)).find(
        (item) => item.id === c.req.param('id'),
      ) || null
  if (!job) return c.json({ error: 'not_found' }, 404)
  return c.json({ job })
})

app.post('/api/score', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'score', limit: 120, windowSeconds: 60 })
  if (limited) return limited

  const body = await c.req.json().catch(() => ({}))
  const profile = normaliseProfile((body as { profile?: unknown }).profile)
  const env = c.env ?? {}
  const { jobs } = await listOpenJobs(env.DB)
  const requested = stringList((body as { jobIds?: unknown }).jobIds, 200)
  const selected = requested.length > 0 ? jobs.filter((job) => requested.includes(job.id)) : jobs
  const scored: ScoredJob[] = selected.map((job) => scoreJob(job, profile))
  return c.json({ profile, scored })
})

app.post('/api/cv/suggest', async (c) => {
  const env = c.env ?? {}
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  const limited = await enforceRateLimit(c, {
    bucket: 'cv-user',
    limit: 10,
    windowSeconds: 3600,
    subject: user.id,
  })
  if (limited) return limited
  const ipLimited = await enforceRateLimit(c, {
    bucket: 'cv-ip',
    limit: 30,
    windowSeconds: 3600,
    subject: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown',
  })
  if (ipLimited) return ipLimited

  const body = await c.req.json().catch(() => ({}))
  const text =
    typeof (body as { text?: unknown }).text === 'string'
      ? String((body as { text: string }).text).slice(0, 40_000)
      : ''
  if (!text.trim()) {
    return c.json({ error: 'text_required' }, 400)
  }
  const config = readConfig(env)

  // Identical input returns byte-identical output: the model runs once and the
  // response is cached for seven days.
  const cacheKey = `cv:${await sha256Hex(text.trim().toLowerCase().replace(/\s+/g, ' '))}`
  if (env.PUBLIC_JOBS) {
    const cached = await env.PUBLIC_JOBS.get(cacheKey, 'text')
    if (cached) {
      c.header('Cache-Control', 'private, no-store')
      return c.body(cached, 200, { 'Content-Type': 'application/json', 'X-CV-Cache': 'hit' })
    }
  }

  // The keyword fallback costs nothing, so only a real model call is
  // counted against the budget.
  if ((env.AI || env.OPENROUTER_API_KEY) && env.DB) {
    const decision = await takeAiBudget(env.DB, `user:${user.id}`, config)
    if (!decision.allowed) {
      return c.json(
        { error: 'ai_quota_exceeded', message: decision.message, scope: decision.scope },
        429,
      )
    }
  }

  const started = Date.now()
  const suggestion = await suggest(env.AI, text, env)
  log('info', 'cv_suggest', {
    userId: user.id,
    durationMs: Date.now() - started,
    provider: suggestion.provider,
  })
  const serialised = JSON.stringify(suggestion)
  if (env.PUBLIC_JOBS)
    await env.PUBLIC_JOBS.put(cacheKey, serialised, { expirationTtl: 7 * 86_400 })
  c.header('Cache-Control', 'private, no-store')
  return c.body(serialised, 200, { 'Content-Type': 'application/json' })
})

app.get('/api/readiness', async (c) => {
  return c.json(await buildReadiness(c.env ?? {}))
})

app.get('/api/rates', async (c) => {
  return c.json(await getRates(readConfig(c.env ?? {}).appMode !== 'test', c.env?.DB))
})

app.route('/api', insightRoutes)
app.route('/api', applyRoutes)
app.route('/api', adminRoutes)
app.route('/api', trustRoutes)
app.route('/api', accountRoutes)
app.route('/api', authRoutes)
app.route('/api', employerRoutes)
app.route('/api', sourceRoutes)
app.route('/api', billingRoutes)
app.route('/api', telegramRoutes)

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((error, c) => {
  const quota = /daily row (?:read|write) limit|quota|7500/i.test(error.message)
  const sourcesDown = error.message === 'Live public sources are temporarily unavailable'
  console.error('api error', { type: quota ? 'storage_unavailable' : 'internal_error' })
  return quota || sourcesDown
    ? c.json(
        {
          error: 'temporarily_unavailable',
          message: 'Some services are temporarily unavailable. Please try again shortly.',
        },
        503,
      )
    : c.json({ error: 'internal_error' }, 500)
})

export default app
