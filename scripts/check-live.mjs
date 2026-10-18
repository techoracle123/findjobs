import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { franc } from 'franc-min'

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
console.log(
  `::notice title=Live source status::${JSON.stringify(
    (sources.sources || [])
      .filter((source) =>
        [
          'myjobmag-ng',
          'hotnigerianjobs',
          'weworkremotely',
          'greenhouse-oneacrefund',
          'greenhouse-givedirectly',
          'greenhouse-givewell',
          'greenhouse-acumen',
        ].includes(source.id),
      )
      .map((source) => ({
        id: source.id,
        status: source.lastStatus || source.last_status,
        jobs: source.liveJobs ?? source.live_jobs,
        error: source.lastError || source.last_error,
      })),
  )}`,
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
// Exercise the deployed integration, not only secret presence. Real public job
// text only; no CV, account profile, email address or credential is logged.
if (health.aiBinding) {
  const post = async (id, action) => {
    const response = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(35000),
    })
    if (!response.ok) throw new Error(`Live ${action} check returned ${response.status}`)
    return response.json()
  }
  const advice = await post(jobs.jobs[0].id, 'tips')
  const foreign = jobs.jobs.find(
    (job) => !['eng', 'und'].includes(franc(job.description.slice(0, 5000), { minLength: 80 })),
  )
  const translation = foreign ? await post(foreign.id, 'translation') : null
  console.log(
    `::${advice.provider === 'openrouter' && (!translation || translation.translated) ? 'notice' : 'warning'} title=Live AI check::${JSON.stringify({ adviceProvider: advice.provider, tips: advice.tips?.length, translated: translation?.translated, originalLanguage: translation?.originalLanguage, message: translation?.message || advice.message })}`,
  )
}
await mkdir('diagnostics', { recursive: true })
await writeFile(
  'diagnostics/live-jobs.json',
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    origin: base,
    jobs: [...new Map([...jobs.jobs, ...nigeria.jobs].map((job) => [job.id, job])).values()],
  }),
)
await writeFile('diagnostics/live-sources.json', JSON.stringify(sources, null, 2))

// A small public-only sample can be read through GitHub's checks API when this
// restricted workspace cannot download Azure-hosted artifacts. No credentials,
// account data or CVs are present; the full snapshot remains an ignored artifact.
if (process.env.GITHUB_ACTIONS === 'true' && process.env.FJ_CAPTURE_PUBLIC_SAMPLE === 'true') {
  const sample = {
    capturedAt: new Date().toISOString(),
    origin: base,
    rates,
    jobs: [
      ...new Map(
        [...jobs.jobs.slice(0, 4), ...nigeria.jobs.slice(0, 8)].map((job) => [job.id, job]),
      ).values(),
    ],
  }
  let compressed = gzipSync(JSON.stringify(sample)).toString('base64')
  while (compressed.length > 18000 && sample.jobs.length > 2) {
    sample.jobs.pop()
    compressed = gzipSync(JSON.stringify(sample)).toString('base64')
  }
  // GitHub truncates each annotation to 4,096 characters and caps notices per step.
  // Six chunks leave room for the source-status and AI notices. Opt-in only.
  const chunks = compressed.match(/.{1,3000}/g) || []
  for (let index = 0; index < chunks.length; index++)
    console.log(
      `::notice title=Public-feed sample ${index + 1} of ${chunks.length}::${chunks[index]}`,
    )
}
