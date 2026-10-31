import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { monthPeriod } from '../../shared/activity'
import type { AlertPreference, ApplicationStage, Profile } from '../../shared/types'
import { WORK_MODES } from '../../shared/taxonomy'
import {
  createAlert,
  deleteAccount,
  deleteAlert,
  exportAccount,
  getEntitlements,
  getProfile,
  getSubscription,
  listAlerts,
  listSaved,
  loadAccount,
  recordAudit,
  removeSaved,
  saveProfile,
  setSaved,
  updateAlert,
} from '../auth/accounts'
import {
  type AppContext,
  badRequest,
  readJson,
  requireUser,
  stringList,
  unauthorized,
} from '../http'
import { logger } from '../logging'
import { getTrialState } from '../phase2'
import { planEntitlements, subscriptionHasFeature } from '../billing/types'

export const accountRoutes = new Hono<AppEnv>()

async function hasPhase2Access(db: D1Database, userId: string, feature: string): Promise<boolean> {
  const [entitlements, subscription, trial] = await Promise.all([
    getEntitlements(db, userId),
    getSubscription(db, userId),
    getTrialState(db, userId),
  ])
  return (
    trial.status === 'active' ||
    entitlements.includes(feature) ||
    subscriptionHasFeature(
      subscription,
      subscription ? planEntitlements(subscription.plan) : [],
      feature,
    )
  )
}

function normaliseAlertSettings(
  body: Record<string, unknown>,
  smartAllowed: boolean,
): Partial<AlertPreference> {
  if (body.kind !== 'smart' || !smartAllowed) return { kind: 'keyword' }
  const minScoreRaw = Number(body.minScore)
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : ''
  return {
    kind: 'smart',
    ...(Number.isFinite(minScoreRaw)
      ? { minScore: Math.max(0, Math.min(100, Math.round(minScoreRaw))) }
      : {}),
    countries: stringList(body.countries, 10)
      .map((code) => code.toUpperCase())
      .filter((code) => /^[A-Z]{2}$/.test(code)),
    workModes: stringList(body.workModes, 4).filter((mode) =>
      (WORK_MODES as readonly string[]).includes(mode),
    ) as AlertPreference['workModes'],
    salaryOnly: body.salaryOnly === true,
    ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(typeof body.exclude === 'string' && body.exclude.trim()
      ? { exclude: body.exclude.trim().slice(0, 200) }
      : {}),
    companies: stringList(body.companies, 10).map((company) => company.slice(0, 80)),
  }
}

const APPLICATION_STAGES: ApplicationStage[] = [
  'saved',
  'preparing',
  'applied',
  'interview',
  'offer',
  'closed',
]

function normaliseProfile(input: unknown): Profile {
  const raw = (input ?? {}) as Partial<Profile>
  return {
    skills: stringList(raw.skills),
    targetRoleFamilies: stringList(raw.targetRoleFamilies),
    targetSeniority: stringList(raw.targetSeniority) as Profile['targetSeniority'],
    preferredWorkModes: stringList(raw.preferredWorkModes) as Profile['preferredWorkModes'],
    workCountry:
      typeof raw.workCountry === 'string' ? raw.workCountry.trim().toUpperCase().slice(0, 2) : '',
  }
}

const privateResponse = async (c: AppContext, next: () => Promise<void>) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
}
accountRoutes.use('/account', privateResponse)
accountRoutes.use('/account/*', privateResponse)

accountRoutes.get('/account/activity', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env.DB) return c.json({ error: 'storage_unavailable' }, 503)
  const defaults = monthPeriod()
  const from = c.req.query('from') || defaults.from,
    to = c.req.query('to') || defaults.to
  const start = Date.parse(from),
    end = Date.parse(to)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 32 * 86400000
  )
    return badRequest(c, 'A valid monthly date range is required')
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS totalApplied, SUM(CASE WHEN applied_at>=?2 AND applied_at<?3 THEN 1 ELSE 0 END) AS thisMonth, SUM(CASE WHEN applied_at IS NULL THEN 1 ELSE 0 END) AS undated FROM application_history WHERE user_id=?1`,
  )
    .bind(user.id, new Date(start).toISOString(), new Date(end).toISOString())
    .first<{ totalApplied: number; thisMonth: number | null; undated: number | null }>()
  const saved = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM saved_jobs WHERE user_id=?1 AND status='saved'",
  )
    .bind(user.id)
    .first<{ n: number }>()
  return c.json({
    thisMonth: row?.thisMonth || 0,
    totalApplied: row?.totalApplied || 0,
    undated: row?.undated || 0,
    saved: saved?.n || 0,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  })
})

/** Everything about the signed-in account. */
accountRoutes.get('/account', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const snapshot = await loadAccount(c.env.DB, user.id)
  return c.json({ ...snapshot, entitlements: [...new Set([...snapshot.entitlements, 'alerts'])] })
})

/** The signed-in account's profile. */
accountRoutes.put('/account/profile', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const profile = normaliseProfile(body.profile ?? body)
  await saveProfile(c.env.DB, user.id, profile)
  return c.json({ profile })
})

accountRoutes.get('/account/profile', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  return c.json({ profile: await getProfile(c.env.DB, user.id) })
})

accountRoutes.get('/account/saved', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  return c.json({ saved: await listSaved(c.env.DB, user.id) })
})

accountRoutes.post('/account/saved', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  if (!jobId) return badRequest(c, 'jobId is required')

  const requestedStage = APPLICATION_STAGES.includes(body.stage as ApplicationStage)
    ? (body.stage as ApplicationStage)
    : undefined
  const advanced = Boolean(
    (requestedStage && !['saved', 'applied'].includes(requestedStage)) ||
    (body.followUpAt !== undefined && body.followUpAt !== null),
  )
  const pipelineAllowed = advanced
    ? await hasPhase2Access(c.env.DB, user.id, 'application_pipeline')
    : false
  const stage = advanced && !pipelineAllowed ? undefined : requestedStage
  const status =
    stage && ['applied', 'interview', 'offer', 'closed'].includes(stage)
      ? 'applied'
      : stage
        ? 'saved'
        : body.status === 'applied'
          ? 'applied'
          : 'saved'
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined
  const followUpAt =
    advanced && !pipelineAllowed
      ? undefined
      : typeof body.followUpAt === 'string' && Number.isFinite(Date.parse(body.followUpAt))
        ? new Date(body.followUpAt).toISOString()
        : body.followUpAt === null
          ? null
          : undefined
  await setSaved(c.env.DB, user.id, jobId, status, note, undefined, {
    ...(stage ? { stage } : {}),
    ...(followUpAt !== undefined ? { followUpAt } : {}),
  })
  return c.json({ ok: true, ...(advanced && !pipelineAllowed ? { proRequired: true } : {}) })
})

accountRoutes.delete('/account/saved/:jobId', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  await removeSaved(c.env.DB, user.id, c.req.param('jobId'))
  return c.json({ ok: true })
})

accountRoutes.get('/account/alerts', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)
  return c.json({ alerts: await listAlerts(c.env.DB, user.id) })
})

accountRoutes.post('/account/alerts', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
  if (!label) return badRequest(c, 'label is required')

  const alert = {
    // The client may supply the id so the two sides stay in step; otherwise
    // one is minted here.
    id:
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim().slice(0, 64)
        : `alt_${crypto.randomUUID()}`,
    label,
    query: typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '',
    channels: stringList(body.channels, 5),
    enabled: false,
    ...normaliseAlertSettings(body, await hasPhase2Access(c.env.DB, user.id, 'smart_alerts')),
  }
  await createAlert(c.env.DB, user.id, alert)
  return c.json({ alert })
})

accountRoutes.patch('/account/alerts/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const patch: Record<string, unknown> = {}
  if (typeof body.label === 'string') patch.label = body.label.trim().slice(0, 120)
  if (typeof body.query === 'string') patch.query = body.query.trim().slice(0, 200)
  if (Array.isArray(body.channels)) patch.channels = stringList(body.channels, 5)
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (
    [
      'kind',
      'minScore',
      'countries',
      'workModes',
      'salaryOnly',
      'currency',
      'exclude',
      'companies',
    ].some((key) => key in body)
  ) {
    // Preserve an existing smart alert's stored settings after trial/Pro ends.
    // Delivery falls back to basic keywords while access is inactive; a
    // routine enable/pause patch must not silently erase the settings.
    if (await hasPhase2Access(c.env.DB, user.id, 'smart_alerts')) {
      Object.assign(patch, normaliseAlertSettings(body, true))
    }
  }

  await updateAlert(c.env.DB, user.id, c.req.param('id'), patch)
  return c.json({ ok: true })
})

accountRoutes.delete('/account/alerts/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  await deleteAlert(c.env.DB, user.id, c.req.param('id'))
  return c.json({ ok: true })
})

/**
 * Imports data the browser was keeping locally before the person signed in, so
 * signing up does not silently discard their profile.
 */
accountRoutes.post('/account/import', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const body = await readJson(c)
  const imported = { profile: false, saved: 0, alerts: 0 }

  if (body.profile) {
    await saveProfile(c.env.DB, user.id, normaliseProfile(body.profile))
    imported.profile = true
  }

  const saved = Array.isArray(body.saved) ? body.saved : []
  for (const entry of saved.slice(0, 500)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as {
      jobId?: unknown
      status?: unknown
      note?: unknown
      appliedAt?: unknown
    }
    if (typeof record.jobId !== 'string' || !record.jobId) continue
    await setSaved(
      c.env.DB,
      user.id,
      record.jobId,
      record.status === 'applied' ? 'applied' : 'saved',
      typeof record.note === 'string' ? record.note.slice(0, 500) : undefined,
      typeof record.appliedAt === 'string' &&
        Number.isFinite(Date.parse(record.appliedAt)) &&
        Date.parse(record.appliedAt) <= Date.now()
        ? new Date(record.appliedAt).toISOString()
        : null,
    )
    imported.saved += 1
  }

  const alerts = Array.isArray(body.alerts) ? body.alerts : []
  for (const entry of alerts.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { label?: unknown; query?: unknown; channels?: unknown }
    if (typeof record.label !== 'string' || !record.label.trim()) continue
    await createAlert(c.env.DB, user.id, {
      id: `alt_${crypto.randomUUID()}`,
      label: record.label.trim().slice(0, 120),
      query: typeof record.query === 'string' ? record.query.slice(0, 200) : '',
      channels: stringList(record.channels, 5),
      enabled: false,
    })
    imported.alerts += 1
  }

  await recordAudit(c.env.DB, user.id, 'account.import', imported)
  return c.json({ imported })
})

/**
 * Everything the service holds about the signed-in account, as one document.
 * A person who asks what is known about them gets the whole thing.
 */
accountRoutes.get('/account/export', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  return c.json(await exportAccount(c.env.DB, user.id))
})

/** Deletes the account and everything attached to it. */
accountRoutes.delete('/account', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  await recordAudit(c.env.DB, user.id, 'account.delete', {})
  await deleteAccount(c.env.DB, user.id)
  logger.info('account deleted', { userId: user.id })
  return c.json({ ok: true })
})
