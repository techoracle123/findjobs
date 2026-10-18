import type { Job } from '../shared/types'
import { getAdapter, listAdapters } from './sources/registry'
import type { RawPosting, SourceAdapter } from './sources/types'
import { normalizePosting } from './sources/normalize'
import { logger } from './logging'

export interface IngestionResult {
  sourceId: string
  status: 'ok' | 'failed'
  fetched: number
  inserted: number
  updated: number
  expired: number
  skipped: number
  error: string | null
}

export interface IngestionOptions {
  fetchImpl?: typeof fetch
  /** Mark postings that were not seen in this run as expired. */
  expireMissing?: boolean
  now?: number
}

const encoder = new TextEncoder()

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function jobIdFor(sourceId: string, externalId: string): Promise<string> {
  return `job_${(await sha256(`${sourceId}:${externalId}`)).slice(0, 24)}`
}

export function contentHashOf(raw: RawPosting): string {
  return [
    raw.title,
    raw.company,
    raw.description,
    raw.location,
    raw.remote ? 'remote' : 'onsite',
    raw.tags.join(','),
    raw.salary ? `${raw.salary.min}-${raw.salary.max}-${raw.salary.currency}` : '',
  ].join('\u0001')
}

/**
 * Makes sure every adapter the build knows about is present in the sources
 * table, so an operator can enable or disable them without a migration.
 */
export async function ensureSources(db: D1Database): Promise<void> {
  for (const adapter of listAdapters()) {
    await db
      .prepare(
        `INSERT INTO sources (id, name, adapter, enabled, homepage, config)
         VALUES (?1, ?2, ?3, 1, ?4, '{}')
         ON CONFLICT(id) DO UPDATE SET name = ?2, adapter = ?3, homepage = ?4`,
      )
      .bind(adapter.id, adapter.name, adapter.id, adapter.homepage)
      .run()
  }
}

/**
 * Makes sure a single source has a row. The run log points at the source, so
 * the row has to exist before a run can be recorded against it.
 */
async function ensureSource(db: D1Database, adapter: SourceAdapter): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sources (id, name, adapter, enabled, homepage, config)
       VALUES (?1, ?2, ?3, 1, ?4, '{}')
       ON CONFLICT(id) DO UPDATE SET name = ?2, adapter = ?3, homepage = ?4`,
    )
    .bind(adapter.id, adapter.name, adapter.id, adapter.homepage)
    .run()
}

type UpsertOutcome = 'inserted' | 'updated' | 'unchanged'

async function upsertJob(
  db: D1Database,
  job: Job,
  sourceId: string,
  externalId: string,
  contentHash: string,
): Promise<UpsertOutcome> {
  const existing = await db
    .prepare('SELECT content_hash FROM jobs WHERE id = ?1')
    .bind(job.id)
    .first<{ content_hash: string | null }>()

  if (!existing) {
    await writeJob(db, job, sourceId, externalId, contentHash)
    return 'inserted'
  }

  if (existing.content_hash === contentHash) {
    // Unchanged: refresh the expiry and leave the canonical row alone.
    await db
      .prepare(
        'UPDATE jobs SET expired_at = NULL, posted_at = COALESCE(?2, posted_at) WHERE id = ?1',
      )
      .bind(job.id, job.postedAt)
      .run()
    return 'unchanged'
  }

  await writeJob(db, job, sourceId, externalId, contentHash)
  return 'updated'
}

async function writeJob(
  db: D1Database,
  job: Job,
  sourceId: string,
  externalId: string,
  contentHash: string,
): Promise<void> {
  const skills = JSON.stringify([...job.requiredSkills, ...job.usefulSkills])

  await db
    .prepare(
      `INSERT INTO jobs (id, title, company, role_family, seniority, work_mode, location_country,
        location_label, salary_min, salary_max, salary_currency, salary_period, description,
        required_skills, useful_skills, eligible_countries, sponsorship, source_name, source_url,
        posted_days_ago, posted_at, is_demo, source_id, external_id, content_hash, expired_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 0,
        ?20, 0, ?21, ?22, ?23, NULL)
       ON CONFLICT(id) DO UPDATE SET title = ?2, company = ?3, role_family = ?4, seniority = ?5,
         work_mode = ?6, location_country = ?7, location_label = ?8, salary_min = ?9,
         salary_max = ?10, salary_currency = ?11, salary_period = ?12, description = ?13,
         required_skills = ?14, useful_skills = ?15, eligible_countries = ?16, sponsorship = ?17,
         source_name = ?18, source_url = ?19, posted_at = ?20, source_id = ?21, external_id = ?22,
         content_hash = ?23, expired_at = NULL`,
    )
    .bind(
      job.id,
      job.title,
      job.company,
      job.roleFamily,
      job.seniority,
      job.workMode,
      job.locationCountry,
      job.locationLabel,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.salaryPeriod,
      job.description,
      JSON.stringify(job.requiredSkills),
      JSON.stringify(job.usefulSkills),
      JSON.stringify(job.eligibleCountries),
      job.sponsorship,
      job.sourceName,
      job.sourceUrl,
      job.postedAt,
      sourceId,
      externalId,
      contentHash,
    )
    .run()

  // Keep the search index in step with the canonical row.
  await db.prepare('DELETE FROM jobs_fts WHERE job_id = ?1').bind(job.id).run()
  await db
    .prepare(
      'INSERT INTO jobs_fts (job_id, title, company, description, skills) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(job.id, job.title, job.company, job.description, skills)
    .run()
}

/**
 * Runs one source end to end: fetch, normalise, upsert, and retire the
 * postings that are no longer offered. A failing source never stops the
 * others — the error is recorded against the source so it is visible.
 */
export async function runIngestion(
  db: D1Database,
  sourceId: string,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const adapter = getAdapter(sourceId)
  const now = options.now ?? Date.now()

  const result: IngestionResult = {
    sourceId,
    status: 'failed',
    fetched: 0,
    inserted: 0,
    updated: 0,
    expired: 0,
    skipped: 0,
    error: null,
  }

  const runId = `run_${crypto.randomUUID()}`
  const startedAt = new Date(now).toISOString()

  if (!adapter) {
    result.error = `Unknown source adapter: ${sourceId}`
    return result
  }

  // The run log points at the source, so the source row has to exist first.
  await ensureSource(db, adapter)

  await db
    .prepare(
      `INSERT INTO ingestion_runs (id, source_id, started_at, status) VALUES (?1, ?2, ?3, 'running')`,
    )
    .bind(runId, sourceId, startedAt)
    .run()

  try {
    const postings = await adapter.fetchPostings(options.fetchImpl)
    result.fetched = postings.length
    const seen = new Set<string>()

    for (const raw of postings) {
      if (!raw.externalId || !raw.title) {
        result.skipped += 1
        continue
      }
      seen.add(raw.externalId)

      const jobId = await jobIdFor(sourceId, raw.externalId)
      const contentHash = await sha256(contentHashOf(raw))
      const normalised = normalizePosting(raw)

      const job: Job = {
        ...normalised,
        id: jobId,
        sourceName: adapter.name,
        sourceUrl: raw.url || adapter.homepage,
        postedAt: normalised.postedAt ?? new Date(now).toISOString(),
      }

      await db
        .prepare(
          `INSERT INTO source_postings (source_id, external_id, job_id, payload, content_hash, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(source_id, external_id) DO UPDATE SET job_id = ?3, payload = ?4,
             content_hash = ?5, last_seen_at = ?6, expired_at = NULL`,
        )
        .bind(
          sourceId,
          raw.externalId,
          jobId,
          JSON.stringify(raw),
          contentHash,
          new Date(now).toISOString(),
        )
        .run()

      const outcome = await upsertJob(db, job, sourceId, raw.externalId, contentHash)
      if (outcome === 'inserted') result.inserted += 1
      else if (outcome === 'updated') result.updated += 1
    }

    if (options.expireMissing !== false) {
      const stale = await db
        .prepare(
          `SELECT external_id, job_id FROM source_postings
           WHERE source_id = ?1 AND expired_at IS NULL`,
        )
        .bind(sourceId)
        .all<{ external_id: string; job_id: string | null }>()

      for (const row of stale.results ?? []) {
        if (seen.has(row.external_id)) continue
        const expiredAt = new Date(now).toISOString()
        await db
          .prepare(
            'UPDATE source_postings SET expired_at = ?3 WHERE source_id = ?1 AND external_id = ?2',
          )
          .bind(sourceId, row.external_id, expiredAt)
          .run()
        if (row.job_id) {
          await db
            .prepare('UPDATE jobs SET expired_at = ?2 WHERE id = ?1')
            .bind(row.job_id, expiredAt)
            .run()
        }
        result.expired += 1
      }
    }

    result.status = 'ok'
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.error('ingestion failed', { sourceId, error: result.error })
  }

  await finishRun(db, runId, result)
  return result
}

async function finishRun(db: D1Database, runId: string, result: IngestionResult): Promise<void> {
  const finishedAt = new Date().toISOString()
  await db
    .prepare(
      `UPDATE ingestion_runs SET finished_at = ?2, status = ?3, fetched = ?4, inserted = ?5,
        updated = ?6, expired = ?7, skipped = ?8, error = ?9 WHERE id = ?1`,
    )
    .bind(
      runId,
      finishedAt,
      result.status,
      result.fetched,
      result.inserted,
      result.updated,
      result.expired,
      result.skipped,
      result.error,
    )
    .run()

  await db
    .prepare(`UPDATE sources SET last_run_at = ?2, last_status = ?3, last_error = ?4 WHERE id = ?1`)
    .bind(result.sourceId, finishedAt, result.status, result.error)
    .run()
}

/** Runs every enabled source. One failing source does not stop the rest. */
export async function runAllSources(
  db: D1Database,
  options: IngestionOptions = {},
): Promise<IngestionResult[]> {
  await ensureSources(db)
  const rows = await db
    .prepare('SELECT id FROM sources WHERE enabled = 1 ORDER BY id')
    .all<{ id: string }>()

  const results: IngestionResult[] = []
  for (const row of rows.results ?? []) {
    results.push(await runIngestion(db, row.id, options))
  }
  return results
}
