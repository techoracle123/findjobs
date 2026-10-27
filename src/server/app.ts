import { Hono } from 'hono'
import type { AppEnv } from './env'
import { DEFAULT_APP_MODE } from './env'
import { accessConfigured, readConfig, telegramConfigured } from './config'
import { hasRealProvider } from './billing/provider'
import { listOpenJobs, findJob, searchJobs } from './jobs'
import { getRates } from './rates'
import { suggest } from './cv'
import { scoreJob } from '../shared/scoring'
import type { Profile, ScoredJob } from '../shared/types'
import { requestContext, stringList } from './http'
import { enforceRateLimit } from './ratelimit'
import { takeAiBudget } from './aiquota'
import { buildReadiness } from './readiness'
import { resolveIdentity } from './auth/identity'
import { userIdFor } from './auth/accounts'
import { accountRoutes } from './routes/account'
import { sourceRoutes } from './routes/sources'
import { billingRoutes } from './routes/billing'
import { telegramRoutes } from './routes/telegram'
import { insightRoutes } from './routes/insights'
import { applyRoutes } from './routes/apply'
import { adminRoutes } from './routes/admin'
import { jobFacets } from './job-stats'
import { publicDataCache } from './public-cache'
import { livePublicEnabled, livePublicJobs, searchLivePublic } from './live-public'
import { publishedPublicJobs, findPublishedJob } from './public-feed'
import type { JobSearch } from './jobs'

export const app = new Hono<AppEnv>()

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
  const identity = await resolveIdentity(c.req.raw, readConfig(c.env || {}))
  return c.json({
    authenticated: !!identity,
    email: identity?.email || null,
    configured: accessConfigured(readConfig(c.env || {})),
  })
})

app.get('/api/auth/login', async (c) => {
  const identity = await resolveIdentity(c.req.raw, readConfig(c.env ?? {}))
  if (!identity)
    return c.json(
      {
        error: 'sign_in_unavailable',
        message: 'Sign-in is not available yet. You can still browse and save jobs on this device.',
      },
      503,
    )
  const returnTo = c.req.query('returnTo') || '/'
  return c.redirect(/^\/(?:dashboard|jobs\/[A-Za-z0-9_-]+)?$/.test(returnTo) ? returnTo : '/')
})

app.get('/api/health', async (c) => {
  const env = c.env ?? {}
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
  const accessLoginUrl = accessConfigured(config) ? '/api/auth/login' : null
  return c.json({
    ok: true,
    appMode: config.appMode || DEFAULT_APP_MODE,
    aiBinding: config.aiEnabled,
    telegramConfigured: telegramConfigured(config),
    accessConfigured: accessConfigured(config),
    billingConfigured: hasRealProvider(config),
    authenticationRequired: config.isProduction,
    accessLoginUrl,
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
  return c.json({
    available: true,
    total: snapshot.jobs.length,
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
      ...(published.olderSources
        ? {
            warning:
              'Some publishers could not be refreshed this cycle. Check the original listing before applying.',
          }
        : {}),
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
    const { jobs, source, warning } = await listOpenJobs(env.DB)
    if (warning && livePublicEnabled(env.APP_MODE)) {
      const current = await livePublicJobs(url.origin)
      return c.json({
        jobs: current,
        total: current.length,
        dataSource: 'live-public',
        facets: { ...jobFacets(current, {}), total: current.length },
        warning:
          'Showing current public listings while account syncing is temporarily unavailable.',
      })
    }
    return c.json({
      jobs,
      dataSource: source,
      facets: { ...jobFacets(jobs, {}), total: jobs.length },
      ...(warning ? { warning } : {}),
    })
  }

  let result
  let dataSource: 'd1' | 'live-public' = 'd1'
  try {
    if (!env.DB) throw new Error('Database unavailable')
    result = await searchJobs(env.DB, search)
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
    facets: { ...jobFacets(result.jobs, {}), total: result.total },
    ...(dataSource === 'live-public'
      ? {
          warning:
            'Showing current public listings while account syncing is temporarily unavailable. Always verify the original listing.',
        }
      : {}),
  })
})

app.get('/api/jobs/:id', async (c) => {
  const env = c.env ?? {}
  let job = await findPublishedJob(env.PUBLIC_JOBS, c.req.param('id'))
  if (job) return c.json({ job })
  try {
    job = await findJob(env.DB, c.req.param('id'))
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
  const body = await c.req.json().catch(() => ({}))
  const text =
    typeof (body as { text?: unknown }).text === 'string'
      ? String((body as { text: string }).text).slice(0, 40_000)
      : ''
  if (!text.trim()) {
    return c.json({ error: 'text_required' }, 400)
  }
  const env = c.env ?? {}
  const config = readConfig(env)

  // The keyword fallback costs nothing, so only a real model call is
  // counted against the budget.
  if ((env.AI || env.OPENROUTER_API_KEY) && env.DB) {
    const identity = await resolveIdentity(c.req.raw, config)
    const scope = identity
      ? `user:${await userIdFor(identity.email)}`
      : `ip:${c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'}`

    const decision = await takeAiBudget(env.DB, scope, config)
    if (!decision.allowed) {
      return c.json(
        { error: 'ai_quota_exceeded', message: decision.message, scope: decision.scope },
        429,
      )
    }
  }

  const suggestion = await suggest(env.AI, text, env)
  return c.json(suggestion)
})

/**
 * What is working and what is not, in one place. The `doctor` command prints
 * this, and it is the first thing to look at when a deployment misbehaves.
 */
app.get('/api/readiness', async (c) => {
  return c.json(await buildReadiness(c.env ?? {}))
})

app.get('/api/rates', async (c) => {
  return c.json(await getRates(readConfig(c.env ?? {}).appMode !== 'test', c.env?.DB))
})

app.route('/api', insightRoutes)
app.route('/api', applyRoutes)
app.route('/api', adminRoutes)
app.route('/api', accountRoutes)
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
