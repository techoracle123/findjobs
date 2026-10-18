import type { Job, SalaryPeriod, Seniority, Sponsorship, WorkMode } from '../shared/types'
import { demoJobs } from './fixtures'

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
}

const DAY_MS = 86_400_000

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
  const postedAt =
    row.posted_at ?? new Date(now - (row.posted_days_ago ?? 0) * DAY_MS).toISOString()

  return {
    id: row.id,
    title: row.title,
    company: row.company,
    roleFamily: row.role_family,
    seniority: row.seniority as Seniority,
    workMode: row.work_mode as WorkMode,
    locationCountry: row.location_country,
    locationLabel: row.location_label,
    salaryMin: row.salary_min ?? 0,
    salaryMax: row.salary_max ?? 0,
    salaryCurrency: row.salary_currency ?? 'USD',
    salaryPeriod: (row.salary_period || 'year') as SalaryPeriod,
    description: row.description ?? '',
    requiredSkills: parseList(row.required_skills),
    usefulSkills: parseList(row.useful_skills),
    eligibleCountries: parseList(row.eligible_countries),
    sponsorship: (row.sponsorship || 'unknown') as Sponsorship,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    postedAt,
    isDemo: Boolean(row.is_demo),
  }
}

const SELECT = `SELECT id, title, company, role_family, seniority, work_mode, location_country,
  location_label, salary_min, salary_max, salary_currency, salary_period, description,
  required_skills, useful_skills, eligible_countries, sponsorship, source_name, source_url,
  posted_days_ago, posted_at, is_demo FROM jobs`

export interface JobListResult {
  jobs: Job[]
  source: 'd1' | 'fixture'
  warning?: string
}

/**
 * Reads postings from D1 when the binding exists and the schema has been
 * migrated. If the database is missing, unmigrated or empty, the bundled demo
 * dataset is served instead so the preview is never a blank page.
 */
export async function listJobs(db: D1Database | undefined, now: number = Date.now()): Promise<JobListResult> {
  if (!db) {
    return {
      jobs: demoJobs(now),
      source: 'fixture',
      warning: 'No D1 binding is configured; serving the bundled demo dataset.',
    }
  }

  try {
    const result = await db.prepare(SELECT).all<JobRow>()
    const rows = result.results ?? []
    if (rows.length === 0) {
      return {
        jobs: demoJobs(now),
        source: 'fixture',
        warning: 'D1 contains no postings; serving the bundled demo dataset.',
      }
    }
    return { jobs: rows.map((row) => mapRow(row, now)), source: 'd1' }
  } catch (error) {
    return {
      jobs: demoJobs(now),
      source: 'fixture',
      warning: `D1 could not be read (${describe(error)}); serving the bundled demo dataset.`,
    }
  }
}

export async function findJob(
  db: D1Database | undefined,
  id: string,
  now: number = Date.now(),
): Promise<Job | null> {
  const { jobs } = await listJobs(db, now)
  return jobs.find((job) => job.id === id) ?? null
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
