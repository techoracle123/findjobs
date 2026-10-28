/**
 * Local preview seed (test-only). Loads tests/fixtures/demo-jobs.json into
 * the LOCAL wrangler D1 as is_demo=1 rows so the browser suite can run
 * offline. The live API filters is_demo rows out in every hosted mode, and
 * this script never touches a remote database.
 *
 * Usage: node scripts/seed-local-preview.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { jobs } = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'demo-jobs.json'), 'utf8'))

const q = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
const list = (values) => q(JSON.stringify(values))

const nowIso = new Date().toISOString()
const postedIso = (days) => new Date(Date.now() - days * 86400000).toISOString()

// 5 id-variants per fixture job so pagination has multiple 20-row pages.
const expanded = Array.from({ length: 5 }, (_, variant) =>
  jobs.map((job) =>
    variant === 0
      ? job
      : {
          ...job,
          id: `${job.id}-${variant}`,
          title: variant % 2 ? job.title : `${job.title} (${variant + 1})`,
        },
  ),
).flat()

const rows = expanded
  .map(
    (job) =>
      `(${[
        q(job.id),
        q(job.title),
        q(job.company),
        q(job.roleFamily ?? job.role_family),
        q(job.seniority),
        q(job.workMode ?? job.work_mode),
        q(job.locationCountry ?? job.location_country),
        q(job.locationLabel ?? job.location_label),
        q(job.salaryMin ?? job.salary_min),
        q(job.salaryMax ?? job.salary_max),
        q(job.salaryCurrency ?? job.salary_currency),
        q(job.salaryPeriod ?? job.salary_period),
        q(job.description),
        list(job.requiredSkills ?? job.required_skills ?? []),
        list(job.usefulSkills ?? job.useful_skills ?? []),
        list(job.eligibleCountries ?? job.eligible_countries ?? []),
        q(job.sponsorship ?? 'unknown'),
        q(job.sourceName ?? job.source_name),
        q(job.sourceUrl ?? job.source_url),
        q(job.postedDaysAgo ?? job.posted_days_ago ?? 0),
        '1',
        q(postedIso(job.postedDaysAgo ?? job.posted_days_ago ?? 0)),
        q(nowIso),
      ].join(',')})`,
  )
  .join(',\n')

const sql = `INSERT OR REPLACE INTO jobs (id, title, company, role_family, seniority, work_mode, location_country, location_label, salary_min, salary_max, salary_currency, salary_period, description, required_skills, useful_skills, eligible_countries, sponsorship, source_name, source_url, posted_days_ago, is_demo, posted_at, last_seen_at) VALUES\n${rows};`

const dir = mkdtempSync(join(tmpdir(), 'fj-seed-'))
const file = join(dir, 'seed.sql')
writeFileSync(file, sql)
try {
  execFileSync(
    join(root, 'node_modules', 'node', 'bin', 'node'),
    [
      join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'd1',
      'execute',
      'rolesignal',
      '--config',
      'wrangler.local.jsonc',
      '--local',
      '--file',
      file,
    ],
    { cwd: root, stdio: 'inherit' },
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`Seeded ${expanded.length} local preview rows (is_demo=1, test-only).`)
