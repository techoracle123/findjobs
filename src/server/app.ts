import { Hono } from 'hono'
import type { Env } from './env'
import { DEFAULT_APP_MODE } from './env'
import { listJobs, findJob } from './jobs'
import { getRates } from './rates'
import { suggest } from './cv'
import { scoreJob } from '../shared/scoring'
import type { Profile, ScoredJob } from '../shared/types'

export const app = new Hono<{ Bindings: Env }>()

const MAX_STRING_LIST = 40

function stringList(value: unknown, limit = MAX_STRING_LIST): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
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
  const { jobs, source } = await listJobs(env.DB)
  const rates = await getRates()
  return c.json({
    ok: true,
    appMode: env.APP_MODE || DEFAULT_APP_MODE,
    aiBinding: Boolean(env.AI),
    telegramConfigured: Boolean(env.TELEGRAM_BOT_USERNAME),
    dataSource: source,
    jobCount: jobs.length,
    ratesDate: rates.date,
    ratesSource: rates.source,
  })
})

app.get('/api/jobs', async (c) => {
  const env = c.env ?? {}
  const { jobs, source, warning } = await listJobs(env.DB)
  return c.json({
    jobs,
    dataSource: source,
    ...(warning ? { warning } : {}),
  })
})

app.get('/api/jobs/:id', async (c) => {
  const env = c.env ?? {}
  const job = await findJob(env.DB, c.req.param('id'))
  if (!job) return c.json({ error: 'not_found' }, 404)
  return c.json({ job })
})

app.post('/api/score', async (c) => {
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
  const text = typeof (body as { text?: unknown }).text === 'string'
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
  return c.json(await getRates())
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((error, c) => {
  console.error('api error', error)
  return c.json({ error: 'internal_error' }, 500)
})

export default app
