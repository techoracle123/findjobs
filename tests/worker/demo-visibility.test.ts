import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'
import { findJob, searchJobs } from '../../src/server/jobs'

/**
 * Hosted serving never exposes demo/test-fixture rows. Only local/test
 * previews opt in via includeDemo so the UI can be exercised offline.
 */
describe('demo row visibility', () => {
  it('hides is_demo rows by default and shows them only with includeDemo', async () => {
    const nowIso = new Date().toISOString()
    await env.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
         id, title, company, role_family, seniority, work_mode, location_country, location_label,
         salary_min, salary_max, salary_currency, salary_period, description, required_skills,
         useful_skills, eligible_countries, sponsorship, source_name, source_url, posted_days_ago,
         posted_at, is_demo, job_status, first_seen_at, last_seen_at, apply_url
       ) VALUES (
         'guard-demo-1', 'Fixture Guard Job', 'Guard Co', 'backend', 'mid', 'remote', 'NG', 'Lagos, NG',
         NULL, NULL, 'NGN', 'year', 'Guard fixture description.', '[]', '[]', '[]', 'unknown',
         'Test fixture', 'https://example.com/guard', 0, ?, 1, 'open', ?, ?, 'https://example.com/guard'
       )`,
    )
      .bind(nowIso, nowIso, nowIso)
      .run()

    const hosted = await searchJobs(env.DB, { status: 'open', limit: 200 })
    expect(hosted.jobs.some((job) => job.id === 'guard-demo-1')).toBe(false)
    expect(hosted.jobs.every((job) => !job.isDemo)).toBe(true)

    const preview = await searchJobs(env.DB, { status: 'open', limit: 200, includeDemo: true })
    expect(preview.jobs.some((job) => job.id === 'guard-demo-1')).toBe(true)

    expect(await findJob(env.DB, 'guard-demo-1')).toBeNull()
    expect((await findJob(env.DB, 'guard-demo-1', Date.now(), true))?.id).toBe('guard-demo-1')
  })
})
