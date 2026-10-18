import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { Profile } from '../../shared/types'
import {
  createAlert,
  deleteAccount,
  deleteAlert,
  exportAccount,
  getProfile,
  listAlerts,
  listSaved,
  loadAccount,
  recordAudit,
  removeSaved,
  saveProfile,
  setSaved,
  updateAlert,
} from '../auth/accounts'
import { badRequest, readJson, requireUser, stringList, unauthorized } from '../http'
import { logger } from '../logging'

export const accountRoutes = new Hono<AppEnv>()

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

/** Everything about the signed-in account. */
accountRoutes.get('/account', async (c) => {
  const user = await requireUser(c)
  if (!user) return unauthorized(c)
  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const snapshot = await loadAccount(c.env.DB, user.id)
  return c.json(snapshot)
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

  const status = body.status === 'applied' ? 'applied' : 'saved'
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined
  await setSaved(c.env.DB, user.id, jobId, status, note)
  return c.json({ ok: true })
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
    const record = entry as { jobId?: unknown; status?: unknown; note?: unknown }
    if (typeof record.jobId !== 'string' || !record.jobId) continue
    await setSaved(
      c.env.DB,
      user.id,
      record.jobId,
      record.status === 'applied' ? 'applied' : 'saved',
      typeof record.note === 'string' ? record.note.slice(0, 500) : undefined,
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
