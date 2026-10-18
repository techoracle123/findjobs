import { Hono } from 'hono'
import type { AppEnv } from './env'
import { DEFAULT_APP_MODE } from './env'
import { accessConfigured, readConfig, stripeConfigured, telegramConfigured } from './config'
import { listJobs, findJob, searchJobs } from './jobs'
import { getRates } from './rates'
import { suggest } from './cv'
import { scoreJob } from '../shared/scoring'
import type { Profile, ScoredJob } from '../shared/types'
import { requestContext, stringList } from './http'
import { enforceRateLimit } from './ratelimit'
import { accountRoutes } from './routes/account'
import { sourceRoutes } from './routes/sources'
import { billingRoutes } from './routes/billing'
import { telegramRoutes } from './routes/telegram'

export const app = new Hono<AppEnv>()

app.use('*', requestContext)

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

app.get('/api/health', async (c) => {
  const env = c.env ?? {}
  const config = readConfig(env)
  const { jobs, source } = await listJobs(env.DB)
  const rates = await getRates(config.appMode !== 'test')
  const accessLoginUrl = config.access.aud
    ? `https://${config.access.teamDomain}/cdn-cgi/access/login?app_id=${encodeURIComponent(config.access.aud)}&aud=${encodeURIComponent(config.access.aud)}`
    : null
  return c.json({
    ok: true,
    appMode: config.appMode || DEFAULT_APP_MODE,
    aiBinding: config.aiEnabled,
    telegramConfigured: telegramConfigured(config),
    accessConfigured: accessConfigured(config),
    billingConfigured: stripeConfigured(config),
    authenticationRequired: config.isProduction,
    accessLoginUrl,
    dataSource: source,
    jobCount: jobs.length,
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
    const { jobs, source, warning } = await listJobs(env.DB)
    return c.json({
      jobs,
      dataSource: source,
      ...(warning ? { warning } : {}),
    })
  }

  const result = await searchJobs(env.DB, {
    query,
    status: status === 'open' || status === 'closed' ? status : 'all',
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
  const { jobs } = await listJobs(env.DB)
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
  const suggestion = await suggest(env.AI, text)
  return c.json(suggestion)
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
