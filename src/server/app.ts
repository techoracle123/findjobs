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

export const app = new Hono<AppEnv>()

app.use('*', requestContext)

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
  return c.redirect('/')
})

app.get('/api/health', async (c) => {
  const env = c.env ?? {}
  const config = readConfig(env)
  const count = env.DB
    ? await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE is_demo = 0 AND job_status = 'open' AND expired_at IS NULL AND datetime(last_seen_at) >= datetime('now', '-3 days')",
      ).first<{ n: number }>()
    : null
  const rates = await getRates(config.appMode !== 'test')
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
    dataSource: 'd1',
    jobCount: count?.n ?? 0,
    ratesDate: rates.date,
    ratesSource: rates.source,
  })
})

app.get('/api/jobs', async (c) => {
  const env = c.env ?? {}
  const url = new URL(c.req.url)
  const query = url.searchParams.get('q')?.trim() || undefined
  const status = url.searchParams.get('status')
  const limit = numberParam(url, 'limit')
  const offset = numberParam(url, 'offset')

  // Without any paging or filtering the whole feed is returned, which is
  // what the interface wants while the corpus is small. Once it is not
  // small, the caller asks for a page.
  if (!query && !status && limit === undefined && offset === undefined) {
    const { jobs, source, warning } = await listOpenJobs(env.DB)
    return c.json({
      jobs,
      dataSource: source,
      ...(warning ? { warning } : {}),
    })
  }

  const result = await searchJobs(env.DB, {
    query,
    status: status === 'all' || status === 'closed' ? status : 'open',
    limit,
    offset,
  })

  return c.json({
    jobs: result.jobs,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    dataSource: 'd1',
  })
})

app.get('/api/jobs/:id', async (c) => {
  const env = c.env ?? {}
  const job = await findJob(env.DB, c.req.param('id'))
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
  if (env.AI && env.DB) {
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

  const suggestion = await suggest(env.AI, text)
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
  return c.json(await getRates(readConfig(c.env ?? {}).appMode !== 'test'))
})

app.route('/api', accountRoutes)
app.route('/api', sourceRoutes)
app.route('/api', billingRoutes)
app.route('/api', telegramRoutes)

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((error, c) => {
  console.error('api error', error)
  return c.json({ error: 'internal_error' }, 500)
})

export default app
