/**
 * Backfill: re-runs the current normalizer over every stored publisher row by
 * republishing the public snapshot, then prints before/after completeness.
 * Republishing IS the reprocessing path — the quality pass is idempotent and
 * runs on every publication.
 *
 * Usage: node scripts/backfill-quality.mjs   (needs CLOUDFLARE_API_TOKEN/ACCOUNT_ID)
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!account || !token)
  throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.')

async function api(path, init) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
  })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(`Cloudflare API failed: ${path}`)
  return body.result
}

const listed = await api('/storage/kv/namespaces?per_page=100')
const ns = listed.find((item) => item.title === 'fj-public-jobs')
if (!ns) throw new Error('KV namespace fj-public-jobs not found.')
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns.id}/values/`
const kv = {
  async get(key) {
    const response = await fetch(base + encodeURIComponent(key), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`KV read failed (${response.status})`)
    return response.json()
  },
  async put(key, value, options) {
    const response = await fetch(
      `${base}${encodeURIComponent(key)}?expiration_ttl=${options.expirationTtl}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: value,
        signal: AbortSignal.timeout(60000),
      },
    )
    if (!response.ok) throw new Error(`KV write failed (${response.status})`)
  },
}

await mkdir('diagnostics', { recursive: true })
const outfile = resolve('diagnostics/backfill-runtime.mjs')
await build({
  entryPoints: ['src/server/public-feed.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
const { publishPublicSnapshot } = await import(pathToFileURL(outfile).href)

const before = await kv.get('quality:latest')
console.log('Before:', before ? JSON.stringify(before.coverage) : 'no snapshot yet')

const snapshot = await publishPublicSnapshot(kv)
const after = await kv.get('quality:latest')
console.log(
  `::notice title=Quality backfill::${snapshot.jobs.length} listings reprocessed with normalizer ${after?.normalizerVersion}.`,
)

const rows = ['Field | Before | After', '--- | --- | ---']
for (const field of Object.keys(after.coverage)) {
  const pct = (value) => (value === undefined ? '—' : `${Math.round(value * 100)}%`)
  rows.push(`${field} | ${pct(before?.coverage?.[field])} | ${pct(after.coverage[field])}`)
}
const table = rows.join('\n')
console.log(table)
console.log(
  `::notice title=Before/after completeness::${after.total} listings; duplicates dropped ${after.duplicatesDropped}.`,
)
if (after.alerts?.length) {
  for (const alert of after.alerts) console.log(`::warning title=Quality alert::${alert}`)
}
