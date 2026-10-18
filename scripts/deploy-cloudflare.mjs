import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import ts from 'typescript'
import {
  annotation,
  provisionAccess,
  reservePageNames,
  telegramSetup,
  pageSecrets,
  workerSecrets,
} from './cloudflare-integrations.mjs'

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
  return async (path, { method = 'GET', body, optional = false, diagnostic = false } = {}) => {
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
      const detail =
        diagnostic && method === 'GET' && /^\/access\//.test(path)
          ? (data.errors ?? [])
              .map((error) =>
                String(error.message ?? '')
                  .replaceAll(token, '[REDACTED]')
                  .slice(0, 300),
              )
              .join('; ')
          : ''
      throw new Error(
        `Cloudflare ${method} ${path} failed (HTTP ${response.status}; codes: ${codes || 'unknown'}). ${detail || 'Check token permissions and account access.'}`,
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

export function deploymentConfig(text, filename, databaseId, vars = {}) {
  const parsed = ts.parseConfigFileTextToJson(filename, text)
  if (parsed.error) throw new Error(`Cannot parse ${filename}`)
  const config = parsed.config
  if (!config.d1_databases?.some((db) => db.binding === 'DB'))
    throw new Error(`Missing DB binding in ${filename}`)
  config.d1_databases = config.d1_databases.map((db) =>
    db.binding === 'DB' ? { ...db, database_id: databaseId } : db,
  )
  config.vars = { ...config.vars, ...vars, APP_MODE: 'production', BILLING_PROVIDER: 'fake' }
  return `${JSON.stringify(config, null, 2)}\n`
}

function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  const output = stripVTControlCharacters(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  const token = process.env.CLOUDFLARE_API_TOKEN
  const safeOutput = token ? output.replaceAll(token, '[REDACTED]') : output
  console.log(safeOutput)
  if (result.error || result.status !== 0)
    throw new Error(`Wrangler ${args[0]} failed; deployment stopped. ${safeOutput.slice(-5000)}`)
}

async function publicJson(url, attempts = 1) {
  let status = 'unknown'
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(30_000),
      })
      status = `${response.status} ${response.headers.get('content-type') ?? ''}`
      if (response.ok && response.headers.get('content-type')?.includes('application/json'))
        return await response.json()
    } catch {
      status = 'network error'
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`Public API check failed at ${url} (${status}).`)
}

export async function main() {
  const auth = credentials(process.env)
  const api = client(auth)
  const project = process.env.CLOUDFLARE_PAGES_PROJECT || 'find-jobs'
  if (!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project))
    throw new Error('Invalid Pages project name.')
  const { databaseId, productionBranch } = await provision(api, project)
  const projectInfo = (await api(`/pages/projects/${project}`)).result
  const hostname = projectInfo.subdomain || `${project}.pages.dev`
  const url = `https://${hostname}`
  annotation('notice', 'Cloudflare assigned hostname', url)
  if (hostname !== `${project}.pages.dev`)
    annotation(
      'warning',
      'Requested hostname unavailable',
      `Cloudflare assigned ${hostname} instead of ${project}.pages.dev. The exact requested name may already belong to another project.`,
    )
  if (process.env.GITHUB_ENV)
    await writeFile(process.env.GITHUB_ENV, `LIVE_SITE_URL=${url}\n`, { flag: 'a' })
  try {
    const names = await reservePageNames(api)
    for (const result of names)
      annotation(
        'notice',
        'Alternative name reserved',
        `${result.assigned}${result.exact ? ' (exact name assigned)' : ` (requested ${result.requested} was not assigned)`}. The current live site is unchanged.`,
      )
    if (process.env.GITHUB_STEP_SUMMARY)
      await writeFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Reserved name alternatives\n\n${names.map((result) => `- ${result.assigned}${result.exact ? ' — exact name assigned' : ' — Cloudflare-assigned alternative'}`).join('\n')}\n\nThese projects reserve the names only; the app has not been moved.\n\n`,
        { flag: 'a' },
      )
  } catch (error) {
    annotation('warning', 'Alternative name check incomplete', error.message)
  }
  let access = {}
  try {
    access = await provisionAccess(api, project, hostname)
    annotation('notice', 'Sign-in configured', 'Cloudflare Access email sign-in is configured.')
  } catch (error) {
    annotation('warning', 'Sign-in provisioning blocked', error.message)
    for (const path of ['/access/apps', '/access/identity_providers']) {
      try {
        await api(path, { diagnostic: true })
        annotation('notice', 'Access permission diagnostic', `${path} is readable.`)
      } catch (failure) {
        annotation('warning', 'Access permission diagnostic', failure.message)
      }
    }
  }
  const telegram = await telegramSetup(
    process.env.TELEGRAM_BOT_TOKEN?.trim(),
    project,
    fetch,
    hostname,
  )
  if (!telegram)
    annotation(
      'warning',
      'Telegram secret missing',
      'Save a rotated TELEGRAM_BOT_TOKEN as a GitHub Actions repository secret. Never paste it in chat.',
    )
  const secrets = telegram
    ? {
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN.trim(),
        TELEGRAM_WEBHOOK_SECRET: telegram.secret,
      }
    : {}
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    secrets.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY.trim()
    annotation(
      'notice',
      'OpenRouter configured',
      'Server-side AI secret will be deployed securely.',
    )
  } else
    annotation(
      'warning',
      'OpenRouter secret missing',
      'Save a rotated OPENROUTER_API_KEY as an encrypted repository secret to enable English translation and AI advice.',
    )
  await pageSecrets(api, project, secrets)
  const vars = { ...access, ...(telegram ? { TELEGRAM_BOT_USERNAME: telegram.username } : {}) }
  const files = ['wrangler.jsonc', 'wrangler.ingest.jsonc', 'wrangler.ingest-consumer.jsonc']
  const originals = new Map()
  try {
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      originals.set(file, text)
      await writeFile(file, deploymentConfig(text, file, databaseId, vars))
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
    const report = await publicJson(`${url}/api/readiness`, 18)
    if (
      report.checks?.find((check) => check.id === 'database')?.status !== 'ok' ||
      report.appMode !== 'production' ||
      report.provider !== 'fake'
    ) {
      throw new Error(
        'Deployment uploaded, but database or safe-mode checks failed. Inspect /api/readiness.',
      )
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      annotation(
        'notice',
        'Pages app deployed',
        `Database check passed at ${url}; deploying ingestion workers next.`,
      )
    }
    wrangler(['deploy', '--config', 'wrangler.ingest-consumer.jsonc'])
    if (telegram)
      await workerSecrets(api, 'role-signal-ingest-consumer', {
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN.trim(),
      })
    wrangler(['deploy', '--config', 'wrangler.ingest.jsonc'])
    if (telegram) {
      await telegram.register()
      annotation(
        'notice',
        'Telegram connected',
        `@${telegram.username}: bot verified and webhook registered at ${url}/api/telegram/webhook`,
      )
    }
    const sourcesResponse = await fetch(`${url}/api/sources`, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!sourcesResponse.ok) throw new Error('Source registry check failed.')
    const sources = (await sourcesResponse.json()).sources ?? []
    const queue = await findResource(
      api,
      '/queues',
      (item) => item.queue_name === 'rolesignal-ingest',
    )
    if (!queue?.queue_id) throw new Error('Ingestion queue could not be found after deployment.')
    const due = sources.filter(
      (source) =>
        source.enabled &&
        source.consecutiveFailures < 5 &&
        (!source.lastRunAt || Date.now() - Date.parse(source.lastRunAt) > 3600_000),
    )
    for (let offset = 0; offset < due.length; offset += 100) {
      await api(`/queues/${queue.queue_id}/messages/batch`, {
        method: 'POST',
        body: {
          messages: due.slice(offset, offset + 100).map((source, index) => ({
            body: { sourceId: source.id },
            content_type: 'json',
            delay_seconds: Math.floor((offset + index) / 5),
          })),
        },
      })
    }
    let feed
    for (let attempt = 0; attempt < 18; attempt++) {
      const response = await fetch(`${url}/api/jobs?status=open&limit=20`, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error('Public job feed check failed.')
      feed = await response.json()
      if (feed.total > 0) break
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
    if (
      !feed?.total ||
      feed.jobs.some((job) => job.isDemo || !/^https?:\/\//i.test(job.applyUrl || job.sourceUrl))
    ) {
      const runs = await fetch(`${url}/api/sources/runs`).then((res) => res.json())
      annotation(
        'warning',
        'Ingestion diagnostics',
        JSON.stringify(
          (runs.runs ?? [])
            .slice(0, 5)
            .map((run) => ({ source: run.source_id, status: run.status, error: run.error })),
        ),
      )
      throw new Error(
        'Deployment exists, but no usable live job feed was confirmed yet. No fictional jobs will be served.',
      )
    }
    annotation(
      'notice',
      'Live jobs verified',
      `${feed.total} real open jobs available at ${url}. ${due.length} sources queued for refresh. No demo data is served.`,
    )
    if (!report.ready)
      annotation(
        'warning',
        'Production setup incomplete',
        report.checks
          .filter((check) => check.required && check.status !== 'ok')
          .map((check) => check.action)
          .join(' '),
      )
    console.log(`Find Jobs deployed: ${url}. Payments are disabled.`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Find Jobs deployed\n\n${url}\n\n${feed.total} live open jobs. Payments disabled.\nSign-in: ${Object.keys(access).length ? 'configured' : 'requires Access permissions'}. Telegram: ${telegram ? 'bot and webhook verified' : 'requires encrypted bot token'}.\n`,
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
    let safeMessage = message
    for (const token of [
      process.env.CLOUDFLARE_API_TOKEN,
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.OPENROUTER_API_KEY,
    ]) {
      if (token) safeMessage = safeMessage.replaceAll(token, '[REDACTED]')
    }
    console.error(safeMessage)
    if (process.env.GITHUB_ACTIONS === 'true') {
      const annotation = safeMessage
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A')
      console.error(`::error title=Cloudflare deployment failed::${annotation}`)
    }
    process.exitCode = 1
  })
}
