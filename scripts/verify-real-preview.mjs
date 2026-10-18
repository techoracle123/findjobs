/** Isolated browser checks using the most recent real public-feed artifact.
 * No fictional runtime fallback; no production credential or account data. */
import { execFileSync, spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const node = process.execPath
const run = (file, args, options = {}) =>
  execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options })
const metadata = JSON.parse(
  execFileSync(
    'gh',
    [
      'api',
      'repos/techoracle123/findjobs/actions/workflows/deploy.yml/runs?branch=arena%2Fbe298902-findjobs&status=success&per_page=1',
    ],
    { encoding: 'utf8' },
  ),
)
const id = metadata.workflow_runs?.[0]?.id
if (!id)
  throw new Error(
    'No successful real-feed capture is available; synthetic data will not be substituted.',
  )
const dir = await mkdtemp(join(tmpdir(), 'fj-real-browser-'))
run('gh', [
  'run',
  'download',
  String(id),
  '--repo',
  'techoracle123/findjobs',
  '--name',
  'find-jobs-browser-report',
  '--dir',
  dir,
])
const snapshot = JSON.parse(await readFile(join(dir, 'live-jobs.json'), 'utf8'))
if (
  !snapshot.capturedAt ||
  Date.now() - Date.parse(snapshot.capturedAt) > 3 * 86400000 ||
  !snapshot.jobs?.length
)
  throw new Error('The public-feed capture is missing or stale. Refusing to invent test listings.')
const quote = (v) =>
  v == null
    ? 'NULL'
    : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`
const fields = {
  id: 'id',
  title: 'title',
  company: 'company',
  role_family: 'roleFamily',
  seniority: 'seniority',
  work_mode: 'workMode',
  location_country: 'locationCountry',
  location_label: 'locationLabel',
  salary_min: 'salaryMin',
  salary_max: 'salaryMax',
  salary_currency: 'salaryCurrency',
  salary_period: 'salaryPeriod',
  description: 'description',
  required_skills: 'requiredSkills',
  useful_skills: 'usefulSkills',
  eligible_countries: 'eligibleCountries',
  sponsorship: 'sponsorship',
  source_name: 'sourceName',
  source_url: 'sourceUrl',
  posted_at: 'postedAt',
  apply_url: 'applyUrl',
  verification: 'verification',
  verification_reason: 'verificationReason',
  job_status: 'jobStatus',
  first_seen_at: 'firstSeenAt',
  last_seen_at: 'lastSeenAt',
  source_kind: 'sourceKind',
  source_platform: 'sourcePlatform',
}
const sql = []
for (const job of snapshot.jobs) {
  if (
    job.isDemo !== false ||
    !job.lastSeenAt ||
    job.jobStatus !== 'open' ||
    !/^https:\/\//.test(job.applyUrl || job.sourceUrl)
  )
    throw new Error('Invalid public-feed capture')
  sql.push(
    `INSERT OR REPLACE INTO jobs (${Object.keys(fields).join(',')},is_demo) VALUES (${Object.values(
      fields,
    )
      .map((key) => quote(job[key]))
      .join(',')},0);`,
  )
  sql.push(
    `INSERT INTO jobs_fts (job_id,title,company,description,skills) VALUES (${[job.id, job.title, job.company, job.description, [...job.requiredSkills, ...job.usefulSkills].join(' ')].map(quote).join(',')});`,
  )
}
await writeFile(join(dir, 'jobs.sql'), sql.join('\n'))
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
run(node, [
  wrangler,
  'd1',
  'migrations',
  'apply',
  'rolesignal',
  '--config',
  'wrangler.local.jsonc',
  '--local',
])
run(node, [
  wrangler,
  'd1',
  'execute',
  'rolesignal',
  '--config',
  'wrangler.local.jsonc',
  '--local',
  '--file',
  join(dir, 'jobs.sql'),
])
await mkdir('test-results', { recursive: true })
const children = []
const env = { ...process.env }
delete env.GH_TOKEN
delete env.GITHUB_TOKEN
delete env.CLOUDFLARE_API_TOKEN
try {
  for (const args of [
    [
      wrangler,
      'dev',
      '--config',
      'wrangler.local.jsonc',
      '--ip',
      '0.0.0.0',
      '--port',
      '8787',
      '--var',
      'APP_MODE:staging',
    ],
    [join(root, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', '5173'],
  ]) {
    const child = spawn(node, args, { cwd: root, env, stdio: 'ignore' })
    children.push(child)
  }
  for (const path of [
    'http://127.0.0.1:8787/api/jobs?status=open&limit=1',
    'http://127.0.0.1:5173/',
  ]) {
    let ready = false
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(path, { signal: AbortSignal.timeout(1000) })
        if (r.ok) {
          ready = true
          break
        }
      } catch {
        /* Starting up. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error('Isolated preview did not become ready')
  }
  console.log(
    `Testing ${snapshot.jobs.length} real public listings captured ${snapshot.capturedAt}; this is an isolated preview, not a production-database test.`,
  )
  run(node, [join(root, 'node_modules/@playwright/test/cli.js'), 'test'], {
    env: { ...env, LIVE_SITE_URL: 'http://127.0.0.1:5173' },
  })
} finally {
  for (const child of children) child.kill('SIGTERM')
}
