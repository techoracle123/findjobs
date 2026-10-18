import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

import m0001 from '../../migrations/0001_init.sql?raw'
import m0002 from '../../migrations/0002_seed_demo_jobs.sql?raw'
import m0003 from '../../migrations/0003_accounts.sql?raw'
import m0004 from '../../migrations/0004_sources.sql?raw'
import m0005 from '../../migrations/0005_job_source_columns.sql?raw'
import m0006 from '../../migrations/0006_telegram.sql?raw'
import m0007 from '../../migrations/0007_rate_limits.sql?raw'
import m0008 from '../../migrations/0008_source_scale.sql?raw'
import m0009 from '../../migrations/0009_alert_deliveries.sql?raw'
import m0010 from '../../migrations/0010_billing_events_and_ai_budget.sql?raw'

/**
 * The real migration files, applied to the test database.
 *
 * They are imported as raw text so the schema under test is exactly the
 * schema production runs, without pulling a Node-only migration reader into
 * the Workers runtime.
 */
const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009, m0010]

/**
 * Splits a migration file into individual statements, dropping the comment
 * lines so a comment-only fragment is never sent to the database.
 */
function splitStatements(migration: string): string[] {
  return migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

beforeAll(async () => {
  // Keep the test output readable: only failures are worth printing.
  ;(globalThis as { __LOG_LEVEL__?: string }).__LOG_LEVEL__ = 'error'

  for (const migration of MIGRATIONS) {
    for (const sql of splitStatements(migration)) {
      try {
        await env.DB.prepare(sql).run()
      } catch (error) {
        // "duplicate column" means a migration ran before; anything else is
        // a real failure and must not be swallowed.
        const message = error instanceof Error ? error.message : String(error)
        if (!/duplicate column name/i.test(message)) throw error
      }
    }
  }
})
