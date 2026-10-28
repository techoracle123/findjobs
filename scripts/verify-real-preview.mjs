/** Fresh public-source ingestion + isolated browser checks, without production credentials. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

process.on('uncaughtException', (error) => {
  const message = String(error.message)
    .slice(-3500)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
  console.error(`::error title=Isolated real-feed preview::${message}`)
  process.exit(1)
})
const root = process.cwd(),
  node = process.execPath
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
const run = (args, options = {}) =>
  execFileSync(node, args, { cwd: root, stdio: 'inherit', ...options })
const children = []
const env = { ...process.env }
for (const key of [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'OPENROUTER_API_KEY',
  'TELEGRAM_BOT_TOKEN',
])
  delete env[key]
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return
    } catch {
      /* Starting up. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Isolated preview did not become ready at ${url}`)
}
function worker(port, mode, inspector) {
  const child = spawn(
    node,
    [
      wrangler,
      'dev',
      '--config',
      'wrangler.local.jsonc',
      '--ip',
      '0.0.0.0',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--var',
      `APP_MODE:${mode}`,
    ],
    { cwd: root, env, stdio: 'ignore' },
  )
  children.push(child)
}
try {
  run([
    wrangler,
    'd1',
    'migrations',
    'apply',
    'rolesignal',
    '--config',
    'wrangler.local.jsonc',
    '--local',
  ])
  // Local-only bootstrap port: this is NOT the production database or an auth
  // bypass in the app under test. The second worker uses hosted/staging rules.
  worker(8789, 'local-preview', 9230)
  await ready('http://127.0.0.1:8789/api/jobs?status=open&limit=1')
  let added = 0
  for (const id of ['greenhouse-oneacrefund', 'myjobmag-ng']) {
    const response = await fetch(`http://127.0.0.1:8789/api/sources/${id}/ingest`, {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
    })
    const body = await response.json()
    console.log(`Public-source check: ${id}, ${JSON.stringify(body.result)}`)
    if (response.ok && body.result?.status === 'ok')
      added += body.result.inserted + body.result.updated
  }
  if (!added)
    throw new Error('No real jobs could be retrieved. Synthetic data will not be substituted.')
  worker(8787, 'staging', 9231)
  await ready('http://127.0.0.1:8787/api/jobs?status=open&limit=1')
  const feed = await (await fetch('http://127.0.0.1:8787/api/jobs?status=open&limit=200')).json()
  if (!feed.total || feed.jobs.some((job) => job.isDemo))
    throw new Error('Real public-feed validation failed')
  await mkdir('diagnostics', { recursive: true })
  await writeFile(
    'diagnostics/isolated-real-jobs.json',
    JSON.stringify({ capturedAt: new Date().toISOString(), jobs: feed.jobs }),
  )
  const vite = spawn(
    node,
    [join(root, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', '5173'],
    { cwd: root, env, stdio: 'ignore' },
  )
  children.push(vite)
  await ready('http://127.0.0.1:5173/')
  console.log(
    `Testing ${feed.total} freshly ingested real public listings in an isolated staging preview—not a production/Access/email-delivery test.`,
  )
  run([join(root, 'node_modules/@playwright/test/cli.js'), 'test'], {
    env: { ...env, LIVE_SITE_URL: 'http://127.0.0.1:5173' },
  })
} finally {
  for (const child of children) child.kill('SIGTERM')
}
