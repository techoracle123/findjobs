/**
 * Employer organisations are paused. FJ is not ready for employers to create
 * accounts or post jobs directly, so every write below is refused before it
 * can touch the database. Existing rows, if any, stay readable by their
 * members so nothing is silently lost while posting is closed.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { badRequest, readJson, requireUser, unauthorized, type AppContext } from '../http'
import { enforceRateLimit } from '../ratelimit'
import { verifyDomainToken } from '../employers/dns'
import { scamScore } from '../trust'

export const employerRoutes = new Hono<AppEnv>()

export const EMPLOYER_POSTING_PAUSED = true

const employerPostingPaused = async (c: AppContext, next: () => Promise<void>) => {
  if (EMPLOYER_POSTING_PAUSED && c.req.method !== 'GET') {
    return c.json(
      {
        error: 'employer_posting_paused',
        message: 'Employer accounts and direct job posting are not open on FJ.',
      },
      410,
    )
  }
  await next()
}
employerRoutes.use('/orgs', employerPostingPaused)
employerRoutes.use('/orgs/*', employerPostingPaused)

type Role = 'owner' | 'member'

interface OrgRow {
  id: string
  name: string
  domain: string | null
  domain_token: string | null
  domain_verified_at: number | null
  status: string
}

/** Returns the caller's role in this org, or null when they are not a member. */
async function memberRole(db: D1Database, orgId: string, userId: string): Promise<Role | null> {
  const row = await db
    .prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .first<{ role: Role }>()
  return row?.role ?? null
}

async function loadOrg(db: D1Database, orgId: string): Promise<OrgRow | null> {
  return (
    (await db
      .prepare(
        'SELECT id, name, domain, domain_token, domain_verified_at, status FROM orgs WHERE id = ?',
      )
      .bind(orgId)
      .first<OrgRow>()) ?? null
  )
}

employerRoutes.post('/orgs', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const limited = await enforceRateLimit(c, { bucket: 'orgs', limit: 10, windowSeconds: 3600 })
  if (limited) return limited
  const body = await readJson(c)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
  if (!name || name.length > 120) return badRequest(c, 'name')
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return badRequest(c, 'domain')
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const now = Date.now()
  const orgId = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await db
    .prepare(
      'INSERT INTO orgs (id, name, domain, domain_token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(orgId, name, domain || null, domain ? token : null, user.id, now)
    .run()
  await db
    .prepare('INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
    .bind(orgId, user.id, 'owner', now)
    .run()
  return c.json(
    {
      org: {
        id: orgId,
        name,
        domain: domain || null,
        domainToken: domain ? token : null,
        status: 'pending',
      },
    },
    201,
  )
})

employerRoutes.get('/orgs/:id', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const role = await memberRole(db, c.req.param('id'), user.id)
  if (!role) return c.json({ error: 'not_found' }, 404) // never confirm another org's existence
  const org = await loadOrg(db, c.req.param('id'))
  return c.json({
    org: org && {
      id: org.id,
      name: org.name,
      domain: org.domain,
      domainVerified: Boolean(org.domain_verified_at),
      status: org.status,
      role,
    },
  })
})

employerRoutes.post('/orgs/:id/verify-domain', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const limited = await enforceRateLimit(c, { bucket: 'org-verify', limit: 5, windowSeconds: 3600 })
  if (limited) return limited
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const orgId = c.req.param('id')
  const role = await memberRole(db, orgId, user.id)
  if (role !== 'owner') return c.json({ error: 'not_found' }, 404)
  const org = await loadOrg(db, orgId)
  if (!org?.domain || !org.domain_token) return badRequest(c, 'domain')
  const verified = await verifyDomainToken(org.domain, org.domain_token).catch(() => false)
  if (!verified) return c.json({ ok: false, error: 'token_not_found' }, 422)
  await db
    .prepare('UPDATE orgs SET domain_verified_at = ? WHERE id = ?')
    .bind(Date.now(), orgId)
    .run()
  return c.json({ ok: true })
})

employerRoutes.post('/orgs/:id/jobs', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const limited = await enforceRateLimit(c, { bucket: 'org-jobs', limit: 20, windowSeconds: 3600 })
  if (limited) return limited
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const orgId = c.req.param('id')
  const role = await memberRole(db, orgId, user.id)
  if (!role) return c.json({ error: 'not_found' }, 404)
  const body = await readJson(c)
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 8000) : ''
  if (!title || !description) return badRequest(c, 'title')
  const result = scamScore({
    title,
    company: (await loadOrg(db, orgId))?.name ?? '',
    description,
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: '',
    salaryPeriod: 'year',
  })
  // Scammy content never reaches the live board: hold waits for moderation,
  // reject is hidden outright.
  const status =
    result.moderationState === 'reject'
      ? 'hidden'
      : result.moderationState === 'hold'
        ? 'pending'
        : 'live'
  const jobId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO org_jobs (id, org_id, title, description, location, remote, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      jobId,
      orgId,
      title,
      description,
      typeof body.location === 'string' ? body.location.slice(0, 160) : null,
      body.remote ? 1 : 0,
      status,
      user.id,
      Date.now(),
    )
    .run()
  return c.json({ job: { id: jobId, status, scamScore: result.score } }, 201)
})

employerRoutes.get('/orgs/:id/jobs', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const orgId = c.req.param('id')
  const role = await memberRole(db, orgId, user.id)
  if (!role) return c.json({ error: 'not_found' }, 404)
  const rows = await db
    .prepare(
      'SELECT id, title, status, created_at FROM org_jobs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100',
    )
    .bind(orgId)
    .all<{ id: string; title: string; status: string; created_at: number }>()
  return c.json({ jobs: rows.results })
})

employerRoutes.post('/orgs/:id/members', async (c) => {
  const user = await requireUser(c as AppContext)
  if (!user) return unauthorized(c)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'storage_unavailable' }, 503)
  const orgId = c.req.param('id')
  const role = await memberRole(db, orgId, user.id)
  if (role !== 'owner') return c.json({ error: 'not_found' }, 404)
  const body = await readJson(c)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest(c, 'email')
  const target = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!target) return c.json({ ok: false, error: 'no_account' }, 422)
  await db
    .prepare(
      'INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(orgId, target.id, 'member', Date.now())
    .run()
  return c.json({ ok: true })
})
