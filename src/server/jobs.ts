import type {
  Job,
  JobStatus,
  SalaryPeriod,
  Seniority,
  Sponsorship,
  VerificationLevel,
  WorkMode,
} from '../shared/types'
import { cleanJobText, stripHtml } from './sources/html'

interface JobRow {
  id: string
  title: string
  company: string
  role_family: string
  seniority: string
  work_mode: string
  location_country: string
  location_label: string
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: string
  description: string
  required_skills: string
  useful_skills: string
  eligible_countries: string
  sponsorship: string
  source_name: string
  source_url: string
  posted_days_ago: number
  posted_at: string | null
  is_demo: number
  verification: string | null
  verification_reason: string | null
  verified_at: string | null
  job_status: string | null
  closed_at: string | null
  closed_reason: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  apply_url: string | null
  company_url: string | null
  source_kind: string | null
  source_platform: string | null
  language: string | null
  language_required: string | null
  normalizer_version: string | null
  quality: string | null
}

const DAY_MS = 86_400_000

/**
 * A posting that has not been confirmed alive for this long is shown as
 * stale rather than as current. The threshold is generous because a source
 * on a daily tier is not expected to be checked every hour.
 */
const STALE_AFTER_MS = 3 * DAY_MS

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function mapRow(row: JobRow, now: number): Job {
  const postedAt = row.posted_at ?? ''

  const status = (row.job_status || 'open') as JobStatus
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : null

  let verification = (row.verification || 'unverified') as VerificationLevel
  if (status === 'open' && lastSeen !== null && !Number.isNaN(lastSeen)) {
    if (now - lastSeen > STALE_AFTER_MS) verification = 'stale'
  }

  return {
    id: row.id,
    title: stripHtml(row.title),
    company: stripHtml(row.company),
    roleFamily: row.role_family,
    seniority: row.seniority as Seniority,
    workMode: row.work_mode as WorkMode,
    locationCountry: row.location_country,
    locationLabel: row.location_label,
    salaryMin: row.salary_min ?? 0,
    salaryMax: row.salary_max ?? 0,
    salaryCurrency: row.salary_currency ?? 'USD',
    salaryPeriod: (row.salary_period || 'year') as SalaryPeriod,
    description: cleanJobText(row.description ?? ''),
    requiredSkills: parseList(row.required_skills),
    usefulSkills: parseList(row.useful_skills),
    eligibleCountries: parseList(row.eligible_countries),
    sponsorship: (row.sponsorship || 'unknown') as Sponsorship,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    postedAt,
    isDemo: Boolean(row.is_demo),
    verification,
    verificationReason: row.verification_reason ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    jobStatus: status,
    closedAt: row.closed_at ?? undefined,
    closedReason: row.closed_reason ?? undefined,
    firstSeenAt: row.first_seen_at ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    applyUrl: row.apply_url ?? row.source_url ?? undefined,
    companyUrl: row.company_url ?? undefined,
    sourceKind: row.source_kind ?? undefined,
    sourcePlatform: row.source_platform ?? undefined,
    language: row.language ?? undefined,
    languageRequired: row.language_required ?? undefined,
    normalizerVersion: row.normalizer_version ?? undefined,
    quality: parseQuality(row.quality),
  }
}

function parseQuality(raw: string | null): Job['quality'] {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Job['quality']
  } catch {
    return undefined
  }
}

const COLUMNS = `j.id, j.title, j.company, j.role_family, j.seniority, j.work_mode,
  j.location_country, j.location_label, j.salary_min, j.salary_max, j.salary_currency,
  j.salary_period, j.description, j.required_skills, j.useful_skills, j.eligible_countries,
  j.sponsorship, j.source_name, j.source_url, j.posted_days_ago, j.posted_at, j.is_demo,
  j.verification, j.verification_reason, j.verified_at, j.job_status, j.closed_at,
  j.closed_reason, j.first_seen_at, j.last_seen_at, j.apply_url, j.company_url, j.source_kind,
  j.source_platform`

const SELECT = `SELECT ${COLUMNS} FROM jobs j WHERE j.expired_at IS NULL`

export interface JobListResult {
  jobs: Job[]
  source: 'd1' | 'fixture'
  warning?: string
}

/** Read real postings only. An empty or unavailable database never becomes demo data. */
export async function listJobs(
  db: D1Database | undefined,
  now: number = Date.now(),
): Promise<JobListResult> {
  if (!db)
    return {
      jobs: [],
      source: 'd1',
      warning: 'Jobs are temporarily unavailable. Please try again shortly.',
    }
  try {
    const result = await db.prepare(`${SELECT} AND j.is_demo = 0`).all<JobRow>()
    return { jobs: (result.results ?? []).map((row) => mapRow(row, now)), source: 'd1' }
  } catch {
    return {
      jobs: [],
      source: 'd1',
      warning: 'We could not load jobs just now. Please try again shortly.',
    }
  }
}

/**
 * The same list, but with closed roles left out. This is what the feed and
 * the alerts use: a role that has closed should not be offered as something
 * to apply for.
 */
export async function listOpenJobs(
  db: D1Database | undefined,
  now: number = Date.now(),
): Promise<JobListResult> {
  const result = await listJobs(db, now)
  return {
    ...result,
    jobs: result.jobs.filter((job) => job.jobStatus !== 'closed' && job.verification !== 'stale'),
  }
}

export async function findJob(
  db: D1Database | undefined,
  id: string,
  now: number = Date.now(),
): Promise<Job | null> {
  if (!db) return null
  const row = await db.prepare(`${SELECT} AND j.is_demo = 0 AND j.id = ?1`).bind(id).first<JobRow>()
  return row ? mapRow(row, now) : null
}

export interface JobSearch {
  /** A free-text query, matched against the search index. */
  query?: string
  country?: string
  roleFamilies?: string[]
  workModes?: string[]
  seniorities?: string[]
  /** Which roles to include. */
  status?: 'all' | 'open' | 'closed'
  /** Which verification levels to include. */
  verification?: VerificationLevel[]
  limit?: number
  offset?: number
  now?: number
}

export interface JobSearchResult {
  jobs: Job[]
  total: number
  limit: number
  offset: number
}

/**
 * Searches postings in the database.
 *
 * A feed that grows to hundreds of thousands of rows cannot be shipped to
 * the browser in one response, so the query, the filters and the paging
 * happen in the database. The full-text index is used when there is a query;
 * without one, the canonical table is scanned in posting order.
 */
export async function searchJobs(
  db: D1Database | undefined,
  search: JobSearch = {},
): Promise<JobSearchResult> {
  const limit = Math.min(200, Math.max(1, search.limit ?? 50))
  const offset = Math.max(0, search.offset ?? 0)
  const now = search.now ?? Date.now()
  const status = search.status ?? 'open'
  const query = (search.query ?? '').trim()

  if (!db) {
    const { jobs } = await listJobs(db, now)
    return { jobs: jobs.slice(offset, offset + limit), total: jobs.length, limit, offset }
  }

  const conditions: string[] = ['j.expired_at IS NULL', 'j.is_demo = 0']
  const binds: unknown[] = []

  if (status === 'open') {
    conditions.push("j.job_status = 'open'", 'datetime(j.last_seen_at) >= datetime(?)')
    binds.push(new Date(now - STALE_AFTER_MS).toISOString())
  }
  if (status === 'closed') conditions.push("j.job_status = 'closed'")

  if (search.country) {
    conditions.push('j.location_country = ?')
    binds.push(search.country)
  }
  for (const [column, values] of [
    ['role_family', search.roleFamilies],
    ['work_mode', search.workModes],
    ['seniority', search.seniorities],
  ] as const) {
    if (values?.length) {
      conditions.push(`j.${column} IN (${values.map(() => '?').join(',')})`)
      binds.push(...values)
    }
  }

  if (search.verification && search.verification.length > 0) {
    const placeholders = search.verification.map(() => '?').join(',')
    conditions.push(`j.verification IN (${placeholders})`)
    binds.push(...search.verification)
  }

  if (query) {
    const match = buildMatchQuery(query)
    conditions.push('j.id IN (SELECT job_id FROM jobs_fts WHERE jobs_fts MATCH ?)')
    binds.push(match)
  }

  const where = conditions.join(' AND ')

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM jobs j WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>()

  const rows = await db
    .prepare(
      `SELECT ${COLUMNS} FROM jobs j WHERE ${where}
         ORDER BY j.posted_at DESC, j.id
         LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<JobRow>()

  return {
    jobs: (rows.results ?? []).map((row) => mapRow(row, now)),
    total: countRow?.n ?? 0,
    limit,
    offset,
  }
}

/**
 * Turns what somebody typed into a full-text query. Every term has to be
 * present, and a term with a wildcard at the end is treated as a prefix.
 */
export function buildMatchQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/["^*():]/g, ''))
    .filter(Boolean)
    .map((term) => `"${term}"*`)

  return terms.length > 0 ? terms.join(' AND ') : '""'
}
