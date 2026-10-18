import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const API = 'https://api.cloudflare.com/client/v4'
const BRANCH = 'arena/be298902-findjobs'

export function credentials(env) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim()
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || !account) {
    throw new Error(
      'Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID under GitHub Settings → Secrets and variables → Actions, then rerun this workflow. Do not put credentials in source code or workflow inputs.',
    )
  }
  if (!/^[a-f\d]{32}$/i.test(account))
    throw new Error('Cloudflare Account ID must be 32 hexadecimal characters.')
  return { token, account }
}

export function client({ token, account }, fetcher = fetch) {
  return async (path, { method = 'GET', body, optional = false } = {}) => {
    const response = await fetcher(`${API}/accounts/${account}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    })
    if (optional && response.status === 404) return null
    const data = await response.json()
    if (!response.ok || data.success !== true) {
      // Do not print raw responses: they may contain sensitive account details.
      const codes = (data.errors ?? []).map((error) => error.code).join(', ')
      throw new Error(
        `Cloudflare ${method} ${path} failed (HTTP ${response.status}; codes: ${codes || 'unknown'}). Check token permissions and account access.`,
      )
    }
    return data
  }
}

export async function findResource(api, path, matches) {
  for (let page = 1; ; page++) {
    const data = await api(`${path}?page=${page}&per_page=50`)
    if (!Array.isArray(data.result)) throw new Error(`Unexpected list response for ${path}`)
    const found = data.result.find(matches)
    if (found) return found
    if (data.result.length < 50 || page >= (data.result_info?.total_pages ?? Infinity)) return null
    if (page >= 1000) throw new Error(`Pagination limit reached for ${path}`)
  }
}

export async function provision(api, projectName) {
  let database = await findResource(api, '/d1/database', (db) => db.name === 'rolesignal')
  if (!database)
    database = (await api('/d1/database', { method: 'POST', body: { name: 'rolesignal' } })).result
  if (!database?.uuid) throw new Error('Cloudflare did not return a D1 database UUID.')

  const queue = await findResource(
    api,
    '/queues',
    (item) => item.queue_name === 'rolesignal-ingest',
  )
  if (!queue) await api('/queues', { method: 'POST', body: { queue_name: 'rolesignal-ingest' } })

  const path = `/pages/projects/${encodeURIComponent(projectName)}`
  let project = (await api(path, { optional: true }))?.result
  if (!project)
    project = (
      await api('/pages/projects', {
        method: 'POST',
        body: { name: projectName, production_branch: BRANCH },
      })
    ).result
  if (!project?.production_branch)
    throw new Error('Cloudflare did not return the Pages production branch.')
  return { databaseId: database.uuid, productionBranch: project.production_branch }
}

export function deploymentConfig(text, filename, databaseId) {
  const parsed = ts.parseConfigFileTextToJson(filename, text)
  if (parsed.error) throw new Error(`Cannot parse ${filename}`)
  const config = parsed.config
  if (!config.d1_databases?.some((db) => db.binding === 'DB'))
    throw new Error(`Missing DB binding in ${filename}`)
  config.d1_databases = config.d1_databases.map((db) =>
    db.binding === 'DB' ? { ...db, database_id: databaseId } : db,
  )
  // Payments and Telegram remain deferred. Staging never enables local identity
  // or fake purchase confirmation; protected endpoints still require Access.
  config.vars = { ...config.vars, APP_MODE: 'staging', BILLING_PROVIDER: 'fake' }
  return `${JSON.stringify(config, null, 2)}\n`
}

function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  if (result.error || result.status !== 0)
    throw new Error(`Wrangler ${args[0]} failed; deployment stopped.`)
}

export async function main() {
  const auth = credentials(process.env)
  const api = client(auth)
  const project = process.env.CLOUDFLARE_PAGES_PROJECT || 'role-signal'
  if (!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project))
    throw new Error('Invalid Pages project name.')
  const { databaseId, productionBranch } = await provision(api, project)
  const files = ['wrangler.jsonc', 'wrangler.ingest.jsonc']
  const originals = new Map()
  try {
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      originals.set(file, text)
      await writeFile(file, deploymentConfig(text, file, databaseId))
    }
    wrangler(['d1', 'migrations', 'apply', 'rolesignal', '--remote', '--config', 'wrangler.jsonc'])
    wrangler([
      'pages',
      'deploy',
      'dist',
      '--project-name',
      project,
      '--branch',
      productionBranch,
      '--commit-dirty=true',
    ])
    wrangler(['deploy', '--config', 'wrangler.ingest.jsonc'])

    const url = `https://${project}.pages.dev`
    const response = await fetch(`${url}/api/readiness`, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok)
      throw new Error(
        'Deployment uploaded, but the public readiness request failed. Inspect the deployment before retrying.',
      )
    const report = await response.json()
    if (!report.ready || report.appMode !== 'staging' || report.provider !== 'fake') {
      throw new Error(
        'Deployment uploaded, but staging readiness checks failed. Inspect /api/readiness.',
      )
    }
    console.log(
      `Staging deployed: ${url}. Payments are disabled; sign-in requires Cloudflare Access setup.`,
    )
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Staging deployed\n\n${url}\n\nDatabase migrations and ingestion worker deployed. Payments and Telegram are deferred. Sign-in still needs Cloudflare Access configuration.\n`,
        { flag: 'a' },
      )
    }
  } finally {
    for (const [file, text] of originals) await writeFile(file, text)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // Only our sanitised errors are safe to log. Unknown errors may contain credentials.
    const message = error instanceof Error ? error.message : 'Unknown deployment error'
    const token = process.env.CLOUDFLARE_API_TOKEN
    console.error(token ? message.replaceAll(token, '[REDACTED]') : message)
    process.exitCode = 1
  })
}
