/**
 * Provision isolated accounts for the authenticated deployment browser checks.
 *
 * The public signup endpoint is deliberately rate limited. A full suite with
 * retries must not exhaust that protection or require it to be weakened. These
 * reserved example.com accounts are inserted through the deployment credential,
 * then used through the real login endpoint. The dedicated signup UI test still
 * exercises public registration.
 */
import { spawnSync } from 'node:child_process'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { annotation } from './cloudflare-integrations.mjs'
import { client, credentials, findResource } from './deploy-cloudflare.mjs'

const run = process.env.FJ_BROWSER_TEST_RUN?.trim() ?? ''
if (!/^[A-Za-z0-9-]{1,80}$/.test(run)) {
  throw new Error('FJ_BROWSER_TEST_RUN must contain only letters, numbers and hyphens.')
}
const password = 'browser test password'
const listed = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  env: process.env,
})
if (listed.error || listed.status !== 0) {
  throw new Error(`Could not list browser tests: ${listed.stderr?.slice(-500) || listed.error}`)
}
const report = JSON.parse(listed.stdout)
const specs = (report.suites ?? []).flatMap((suite) =>
  suite.file === 'site.spec.ts' ? (suite.specs ?? []) : [],
)
if (specs.length < 30) throw new Error('The authenticated browser test list is unexpectedly small.')

const digest = (value) => createHash('sha256').update(value).digest('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const now = new Date().toISOString()
const rows = []
for (const spec of specs) {
  const key = digest(`site.spec.ts\0${spec.title}`).slice(0, 16)
  for (const retry of [0, 1]) {
    const email = `fj-browser-${run}-${key}-${retry}@example.com`
    const id = `usr_${digest(email).slice(0, 32)}`
    const salt = randomBytes(16)
    const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
    const passwordHash = `pbkdf2$100000$${salt.toString('base64')}$${derived.toString('base64')}`
    rows.push(`(${[id, email, 'Browser Test', passwordHash, now, now, now].map(quote).join(', ')})`)
  }
}

const api = client(credentials(process.env))
const database = await findResource(api, '/d1/database', (item) => item.name === 'rolesignal')
if (!database?.uuid) throw new Error('The rolesignal D1 database was not found.')
const query = (sql) => api(`/d1/database/${database.uuid}/query`, { method: 'POST', body: { sql } })

// A rerun of the same GitHub attempt gets clean accounts. The predicate is
// restricted to this run's reserved test prefix and cannot touch customer rows.
await query(`DELETE FROM users WHERE email LIKE ${quote(`fj-browser-${run}-%@example.com`)}`)
await query(
  `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at, last_seen_at)\nVALUES\n${rows.join(',\n')}`,
)

annotation(
  'notice',
  'Isolated browser accounts ready',
  `${rows.length} reserved test accounts provisioned for ${specs.length} tests and their retries. Public signup limits remain unchanged.`,
)
