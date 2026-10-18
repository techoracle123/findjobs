import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.LIVE_SITE_URL
if (!base?.startsWith('https://'))
  throw new Error('LIVE_SITE_URL must be the deployed HTTPS origin.')
async function json(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Live check failed: ${path} returned ${response.status}`)
  return response.json()
}
const health = await json('/api/health')
const rates = await json('/api/rates')
const jobs = await json('/api/jobs?status=open&limit=200')
let nigeria = await json('/api/jobs?status=open&limit=200&country=NG')
// Source refreshes are queued, not instant. Wait boundedly for the first Nigerian ingestion.
for (let attempt = 0; !nigeria.total && attempt < 12; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 10000))
  nigeria = await json('/api/jobs?status=open&limit=200&country=NG')
}
const sources = await json('/api/sources')
for (const source of sources.sources || [])
  if (['myjobmag-ng', 'hotnigerianjobs', 'weworkremotely'].includes(source.id))
    console.log(
      `::notice title=Live source status::${JSON.stringify({ id: source.id, status: source.lastStatus || source.last_status, jobs: source.liveJobs ?? source.live_jobs, error: source.lastError || source.last_error })}`,
    )
console.log(
  JSON.stringify(
    {
      accessConfigured: health.accessConfigured,
      aiConfigured: health.aiBinding,
      telegramConfigured: health.telegramConfigured,
      jobs: jobs.total,
      nigeria: nigeria.total,
      ratesDate: rates.date,
      ratesSource: rates.source,
      ngnAvailable: typeof rates.rates?.NGN === 'number',
    },
    null,
    2,
  ),
)
if (!jobs.total || jobs.jobs.some((job) => job.isDemo))
  throw new Error('The live feed is empty or includes synthetic jobs.')
if (!health.accessConfigured)
  console.log(
    '::warning::Access provisioning is not configured. The browser sign-in check will identify the remaining blocker.',
  )
if (!nigeria.total)
  console.log(
    '::warning::No Nigerian jobs are currently open. Inspect source diagnostics in the artifact.',
  )
if (!rates.rates?.NGN)
  console.log(
    '::warning::NGN reference rates were not available. Original salary currencies are preserved.',
  )
await mkdir('test-results', { recursive: true })
await writeFile(
  'test-results/live-jobs.json',
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    origin: base,
    jobs: [...new Map([...jobs.jobs, ...nigeria.jobs].map((job) => [job.id, job])).values()],
  }),
)
await writeFile('test-results/live-sources.json', JSON.stringify(sources, null, 2))
