import type { Job, VerificationLevel } from '../shared/types'
import { getParser } from './sources/registry'
import type { RawPosting, SourceRef } from './sources/types'
import { normalizePosting } from './sources/normalize'
import { createPoliteFetch } from './sources/polite'
import { SEED_SOURCES } from './sources/seed'
import { logger } from './logging'

export interface IngestionResult {
  sourceId: string
  status: 'ok' | 'failed'
  fetched: number
  inserted: number
  updated: number
  expired: number
  closed: number
  skipped: number
  error: string | null
}

export interface IngestionOptions {
  fetchImpl?: typeof fetch
  /** Mark postings that were not seen in this run as closed. */
  closeMissing?: boolean
  now?: number
  userAgent?: string
  /** How many sources may be fetched at once. */
  concurrency?: number
  /** Stop starting new sources after this many milliseconds. */
  deadlineMs?: number
  /** How long a single source may take before it is abandoned. */
  sourceTimeoutMs?: number
}

export const USER_AGENT =
  'FindJobsBot/1.0 (+https://fj-find-jobs.pages.dev; public job feed aggregator)'

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
    raw.closed ? 'closed' : 'open',
  ].join('')
}

export interface SourceRow {
  id: string
  name: string
  adapter: string
  listing_url: string | null
  config: string
  verification: string | null
  kind: string | null
  platform: string | null
  enabled: number
  consecutive_failures: number
}

/**
 * Puts the starting registry into the sources table. Existing rows are left
 * alone, so an operator's changes — a disabled source, a slower rate — are
 * not undone by a deploy.
 */
export async function ensureSources(db: D1Database): Promise<void> {
  const statements: D1PreparedStatement[] = []
  for (const source of SEED_SOURCES) {
    const config = JSON.stringify({
      company: source.company,
      companyLabel: source.companyLabel,
      country: source.country,
    })

    statements.push(
      db
        .prepare(
          `INSERT INTO sources (id, name, adapter, kind, platform, listing_url, homepage, enabled,
          verification, refresh_tier, rate_limit_per_hour, country, tags, config, last_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending')
         ON CONFLICT(id) DO UPDATE SET name = ?2, adapter = ?3, kind = ?4, platform = ?5,
           listing_url = ?6, verification = ?8, refresh_tier = ?9, rate_limit_per_hour = ?10,
           country = ?11, tags = ?12, config = ?13`,
        )
        .bind(
          source.id,
          source.name,
          source.parser,
          source.kind,
          source.parser === 'jsonld' || source.parser === 'rss' ? null : source.parser,
          source.listingUrl,
          source.enabled ? 1 : 0,
          // The parser knows whether what it reads can be trusted: a posting
          // read from the employer's own board can, a posting read from an
          // aggregator cannot.
          getParser(source.parser)?.verification ?? 'unverified',
          source.tier,
          source.rateLimitPerHour,
          source.country,
          JSON.stringify(source.tags),
          config,
        ),
    )
  }
  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50))
  }
}

function sourceRefFrom(row: SourceRow, parserVerification: VerificationLevel): SourceRef {
  let options: Record<string, unknown> = {}
  try {
    options = JSON.parse(row.config || '{}') as Record<string, unknown>
  } catch {
    options = {}
  }

  return {
    id: row.id,
    listingUrl: row.listing_url ?? '',
    options,
    verification: (row.verification as VerificationLevel | null) ?? parserVerification,
    verificationReason:
      (row.verification as VerificationLevel | null) === 'verified'
        ? "the employer's own board"
        : 'a public listing we could not confirm with the employer',
  }
}

async function recordEvent(
  db: D1Database,
  jobId: string,
  type: string,
  detail: string | null,
  sourceId: string | null,
  writes: D1PreparedStatement[],
): Promise<void> {
  writes.push(
    db
      .prepare(
        'INSERT INTO job_events (id, job_id, type, detail, source_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(`evt_${crypto.randomUUID()}`, jobId, type, detail, sourceId, new Date().toISOString()),
  )
}

interface ExistingJob {
  content_hash: string | null
  job_status: string | null
  verification: string | null
  first_seen_at: string | null
}

type UpsertOutcome = 'inserted' | 'updated' | 'unchanged' | 'closed' | 'reopened'

async function upsertJob(
  db: D1Database,
  job: Job,
  sourceId: string,
  externalId: string,
  contentHash: string,
  now: number,
  existing: ExistingJob | null,
  writes: D1PreparedStatement[],
): Promise<UpsertOutcome> {
  const nowIso = new Date(now).toISOString()

  if (!existing) {
    await writeJob(db, job, sourceId, externalId, contentHash, nowIso, nowIso, writes)
    await recordEvent(db, job.id, 'opened', 'first seen', sourceId, writes)
    return 'inserted'
  }

  const wasClosed = existing.job_status === 'closed'
  const isClosed = job.jobStatus === 'closed'

  if (existing.content_hash === contentHash) {
    // Unchanged: refresh the times and the expiry, and leave the row alone.
    writes.push(
      db
        .prepare(
          `UPDATE jobs SET expired_at = NULL, last_seen_at = ?2,
          job_status = CASE WHEN job_status = 'closed' AND ?3 = 0 THEN 'open' ELSE job_status END,
          closed_at = CASE WHEN job_status = 'closed' AND ?3 = 0 THEN NULL ELSE closed_at END
         WHERE id = ?1`,
        )
        .bind(job.id, nowIso, isClosed ? 1 : 0),
    )

    if (wasClosed && !isClosed) {
      await recordEvent(db, job.id, 'reopened', 'it is being advertised again', sourceId, writes)
      return 'reopened'
    }
    return 'unchanged'
  }

  await writeJob(
    db,
    job,
    sourceId,
    externalId,
    contentHash,
    existing.first_seen_at ?? nowIso,
    nowIso,
    writes,
  )

  if (!wasClosed && isClosed) {
    await recordEvent(
      db,
      job.id,
      'closed',
      job.closedReason ?? 'the source closed it',
      sourceId,
      writes,
    )
    return 'closed'
  }
  if (wasClosed && !isClosed) {
    await recordEvent(db, job.id, 'reopened', 'it is being advertised again', sourceId, writes)
    return 'reopened'
  }

  return 'updated'
}

async function writeJob(
  db: D1Database,
  job: Job,
  sourceId: string,
  externalId: string,
  contentHash: string,
  firstSeenAt: string,
  lastSeenAt: string,
  writes: D1PreparedStatement[],
): Promise<void> {
  const skills = JSON.stringify([...job.requiredSkills, ...job.usefulSkills])

  writes.push(
    db
      .prepare(
        `INSERT INTO jobs (id, title, company, role_family, seniority, work_mode, location_country,
        location_label, salary_min, salary_max, salary_currency, salary_period, description,
        required_skills, useful_skills, eligible_countries, sponsorship, source_name, source_url,
        posted_days_ago, posted_at, is_demo, source_id, external_id, content_hash, expired_at,
        verification, verification_reason, verified_at, job_status, closed_at, closed_reason,
        first_seen_at, last_seen_at, apply_url, company_url, source_kind, source_platform)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 0,
        ?20, 0, ?21, ?22, ?23, NULL, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35)
       ON CONFLICT(id) DO UPDATE SET title = ?2, company = ?3, role_family = ?4, seniority = ?5,
         work_mode = ?6, location_country = ?7, location_label = ?8, salary_min = ?9,
         salary_max = ?10, salary_currency = ?11, salary_period = ?12, description = ?13,
         required_skills = ?14, useful_skills = ?15, eligible_countries = ?16, sponsorship = ?17,
         source_name = ?18, source_url = ?19, posted_at = ?20, source_id = ?21, external_id = ?22,
         content_hash = ?23, expired_at = NULL, verification = ?24, verification_reason = ?25,
         verified_at = ?26, job_status = ?27, closed_at = ?28, closed_reason = ?29,
         first_seen_at = ?30, last_seen_at = ?31, apply_url = ?32, company_url = ?33,
         source_kind = ?34, source_platform = ?35`,
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
        job.verification ?? 'unverified',
        job.verificationReason ?? null,
        job.verifiedAt ?? null,
        job.jobStatus ?? 'open',
        job.closedAt ?? null,
        job.closedReason ?? null,
        firstSeenAt,
        lastSeenAt,
        job.applyUrl ?? null,
        job.companyUrl ?? null,
        job.sourceKind ?? null,
        job.sourcePlatform ?? null,
      ),
  )

  // Keep the search index in step with the canonical row.
  writes.push(db.prepare('DELETE FROM jobs_fts WHERE job_id = ?1').bind(job.id))
  writes.push(
    db
      .prepare(
        'INSERT INTO jobs_fts (job_id, title, company, description, skills) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(job.id, job.title, job.company, job.description, skills),
  )
}

/**
 * Runs one source end to end: fetch, normalise, upsert, and close the
 * postings that are no longer offered. A failing source never stops the
 * others — the error is recorded against the source so it is visible.
 */
export async function runIngestion(
  db: D1Database,
  sourceId: string,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const now = options.now ?? Date.now()
  const nowIso = new Date(now).toISOString()

  const result: IngestionResult = {
    sourceId,
    status: 'failed',
    fetched: 0,
    inserted: 0,
    updated: 0,
    expired: 0,
    closed: 0,
    skipped: 0,
    error: null,
  }

  let row = await db
    .prepare(
      `SELECT id, name, adapter, listing_url, config, verification, kind, platform, enabled,
        consecutive_failures FROM sources WHERE id = ?1`,
    )
    .bind(sourceId)
    .first<SourceRow>()

  if (!row) {
    // A source that is in the registry but not yet in the database is
    // created from the registry, so adding a source does not also mean
    // writing a migration.
    const seeded = SEED_SOURCES.find((source) => source.id === sourceId)
    if (!seeded) {
      result.error = `Unknown source: ${sourceId}`
      return result
    }

    await ensureSources(db)
    const created = await db
      .prepare(
        `SELECT id, name, adapter, listing_url, config, verification, kind, platform, enabled,
          consecutive_failures FROM sources WHERE id = ?1`,
      )
      .bind(sourceId)
      .first<SourceRow>()

    if (!created) {
      result.error = `Unknown source: ${sourceId}`
      return result
    }
    row = created
  }

  const parser = getParser(row.adapter)
  if (!parser) {
    result.error = `Unknown parser: ${row.adapter}`
    return result
  }

  await ensureSourceRow(db, row)

  const runId = `run_${crypto.randomUUID()}`
  await db
    .prepare(
      `INSERT INTO ingestion_runs (id, source_id, started_at, status) VALUES (?1, ?2, ?3, 'running')`,
    )
    .bind(runId, sourceId, nowIso)
    .run()

  const politeFetch = createPoliteFetch(
    sourceId,
    options.userAgent ?? USER_AGENT,
    options.fetchImpl ?? fetch,
  )

  try {
    const sourceRef = sourceRefFrom(row, parser.verification)
    const postings = await parser.fetchPostings(sourceRef, politeFetch)
    result.fetched = postings.length
    const seen = new Set<string>()
    const previous = await db
      .prepare(
        'SELECT id, content_hash, job_status, verification, first_seen_at FROM jobs WHERE source_id = ?1',
      )
      .bind(sourceId)
      .all<ExistingJob & { id: string }>()
    const existingJobs = new Map((previous.results ?? []).map((job) => [job.id, job]))
    const writes: D1PreparedStatement[] = []

    for (const raw of postings) {
      if (
        !raw.externalId ||
        !raw.title ||
        seen.has(raw.externalId) ||
        !/^https?:\/\//i.test(raw.applyUrl || raw.url)
      ) {
        result.skipped += 1
        continue
      }
      seen.add(raw.externalId)

      const jobId = await jobIdFor(sourceId, raw.externalId)
      const contentHash = await sha256('live-v3:' + contentHashOf(raw))
      const normalised = normalizePosting(raw, {
        verification: sourceRef.verification,
        verificationReason: sourceRef.verificationReason,
        sourceKind: row.kind ?? parser.kind,
        sourcePlatform: row.platform ?? parser.platform,
        now,
      })

      const job: Job = {
        ...normalised,
        id: jobId,
        sourceName: row.name || parser.name,
        sourceUrl: raw.url || sourceRef.listingUrl || parser.homepage,
        postedAt: normalised.postedAt ?? '',
      }

      writes.push(
        db
          .prepare(
            `INSERT INTO source_postings (source_id, external_id, job_id, payload, content_hash, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(source_id, external_id) DO UPDATE SET job_id = ?3, payload = ?4,
             content_hash = ?5, last_seen_at = ?6, expired_at = NULL`,
          )
          .bind(sourceId, raw.externalId, jobId, JSON.stringify(raw), contentHash, nowIso),
      )

      const outcome = await upsertJob(
        db,
        job,
        sourceId,
        raw.externalId,
        contentHash,
        now,
        existingJobs.get(jobId) ?? null,
        writes,
      )
      if (outcome === 'inserted') result.inserted += 1
      else if (outcome === 'updated') result.updated += 1
      else if (outcome === 'closed') result.closed += 1
    }

    for (let offset = 0; offset < writes.length; offset += 100) {
      await db.batch(writes.slice(offset, offset + 100))
    }

    if (options.closeMissing !== false) {
      const stale = await db
        .prepare(
          `SELECT p.external_id, p.job_id, j.job_status FROM source_postings p LEFT JOIN jobs j ON j.id = p.job_id WHERE p.source_id = ?1 AND p.expired_at IS NULL`,
        )
        .bind(sourceId)
        .all<{ external_id: string; job_id: string | null; job_status: string | null }>()
      const closures: D1PreparedStatement[] = []
      for (const posting of stale.results ?? []) {
        if (seen.has(posting.external_id)) continue
        closures.push(
          db
            .prepare(
              'UPDATE source_postings SET expired_at = ?3 WHERE source_id = ?1 AND external_id = ?2',
            )
            .bind(sourceId, posting.external_id, nowIso),
        )
        if (posting.job_id && posting.job_status !== 'closed') {
          closures.push(
            db
              .prepare(
                "UPDATE jobs SET job_status = 'closed', closed_at = ?2, closed_reason = 'it is no longer advertised by the source' WHERE id = ?1",
              )
              .bind(posting.job_id, nowIso),
          )
          await recordEvent(
            db,
            posting.job_id,
            'closed',
            'it is no longer advertised by the source',
            sourceId,
            closures,
          )
          result.closed += 1
        }
        result.expired += 1
      }
      for (let offset = 0; offset < closures.length; offset += 100)
        await db.batch(closures.slice(offset, offset + 100))
    }

    result.status = 'ok'
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.error('ingestion failed', { sourceId, error: result.error })
  }

  await finishRun(db, runId, result)
  return result
}

async function ensureSourceRow(db: D1Database, row: SourceRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sources (id, name, adapter, kind, platform, listing_url, enabled, verification,
        refresh_tier, rate_limit_per_hour, config)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'daily', 30, ?9)
       ON CONFLICT(id) DO UPDATE SET name = ?2, adapter = ?3`,
    )
    .bind(
      row.id,
      row.name,
      row.adapter,
      row.kind ?? 'api',
      row.platform ?? null,
      row.listing_url ?? '',
      row.enabled,
      row.verification ?? 'unverified',
      row.config || '{}',
    )
    .run()
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
    .prepare(
      `UPDATE sources SET last_run_at = ?2, last_status = ?3, last_error = ?4,
        consecutive_failures = CASE WHEN ?3 = 'ok' THEN 0 ELSE consecutive_failures + 1 END,
        disabled_reason = CASE WHEN ?3 = 'ok' THEN NULL
          WHEN consecutive_failures + 1 >= 5 THEN 'disabled after 5 consecutive failures' END
        WHERE id = ?1`,
    )
    .bind(result.sourceId, finishedAt, result.status, result.error)
    .run()
}

/** How long a source should wait between runs, by its refresh tier. */
const TIER_INTERVAL_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  six_hourly: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

/**
 * The sources that are due to run, oldest first. This is what keeps a
 * registry of thousands of sources inside a bounded amount of work: each
 * source is refreshed on its own tier rather than all of them at once.
 */
export async function dueSources(db: D1Database, limit = 50): Promise<SourceRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, adapter, listing_url, config, verification, kind, platform, enabled,
        consecutive_failures, refresh_tier, last_run_at FROM sources
       WHERE enabled = 1 AND consecutive_failures < 5
       ORDER BY COALESCE(last_run_at, '') ASC LIMIT ?1`,
    )
    .bind(limit)
    .all<SourceRow & { refresh_tier: string | null; last_run_at: string | null }>()

  const now = Date.now()
  return (rows.results ?? []).filter((row) => {
    const interval = TIER_INTERVAL_MS[row.refresh_tier ?? 'daily'] ?? TIER_INTERVAL_MS.daily
    if (!row.last_run_at) return true
    const last = Date.parse(row.last_run_at)
    if (Number.isNaN(last)) return true
    return now - last >= interval
  })
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

/** Runs the sources that are due, up to a limit. */
export async function runDueSources(
  db: D1Database,
  limit = 50,
  options: IngestionOptions = {},
): Promise<IngestionResult[]> {
  await ensureSources(db)
  const due = await dueSources(db, limit)
  return runSourcesConcurrently(db, due, options)
}

/**
 * Runs several sources at once, with a ceiling on how many are in flight
 * and a deadline after which no new source is started.
 *
 * Fetching sources one after another does not scale: a source that is slow
 * to answer holds up every source behind it. A handful in parallel, with a
 * deadline, means one bad host costs a few seconds rather than the whole
 * run.
 */
export async function runSourcesConcurrently(
  db: D1Database,
  sources: SourceRow[],
  options: IngestionOptions = {},
): Promise<IngestionResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 5)
  const deadline = options.deadlineMs ? Date.now() + options.deadlineMs : null
  const perSourceMs = options.sourceTimeoutMs ?? 15_000
  const results: IngestionResult[] = []

  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    for (;;) {
      if (deadline !== null && Date.now() > deadline) return
      const index = cursor
      cursor += 1
      const source = sources[index]
      if (!source) return

      // A source that will not answer is abandoned rather than allowed to
      // hold up the run. The request underneath is left to finish on its own.
      results.push(await runWithTimeout(db, source.id, options, perSourceMs))
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Runs one source, giving up after a budget. The failure is recorded against
 * the source, so an unresponsive host is visible rather than invisible.
 */
export async function runWithTimeout(
  db: D1Database,
  sourceId: string,
  options: IngestionOptions,
  timeoutMs: number,
): Promise<IngestionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<IngestionResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        sourceId,
        status: 'failed',
        fetched: 0,
        inserted: 0,
        updated: 0,
        expired: 0,
        closed: 0,
        skipped: 0,
        error: `the source did not answer within ${Math.round(timeoutMs / 1000)}s`,
      })
    }, timeoutMs)
  })

  try {
    return await Promise.race([runIngestion(db, sourceId, options), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
