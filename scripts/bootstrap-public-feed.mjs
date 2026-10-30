/** Trusted deployment only. Publisher data + encrypted CF credential; no user data. */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export async function bootstrapPublicFeed(api, auth) {
  const listed = await api('/storage/kv/namespaces?per_page=100')
  let ns = listed.result.find((item) => item.title === 'fj-public-jobs')
  if (!ns)
    ns = (
      await api('/storage/kv/namespaces', { method: 'POST', body: { title: 'fj-public-jobs' } })
    ).result
  if (!ns?.id) throw new Error('Public storage provisioning failed')
  const base = `https://api.cloudflare.com/client/v4/accounts/${auth.account}/storage/kv/namespaces/${ns.id}/values/`
  const kv = {
    async get(key) {
      const response = await fetch(base + encodeURIComponent(key), {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(60000),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Public snapshot read failed (HTTP ${response.status})`)
      return response.json()
    },
    async put(key, value, options) {
      const response = await fetch(
        `${base}${encodeURIComponent(key)}?expiration_ttl=${options.expirationTtl}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: value,
          signal: AbortSignal.timeout(60000),
        },
      )
      if (!response.ok) throw new Error(`Public snapshot write failed (HTTP ${response.status})`)
    },
  }
  await mkdir('diagnostics', { recursive: true })
  const outfile = resolve('diagnostics/public-feed-runtime.mjs')
  await build({
    entryPoints: ['src/server/public-feed.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
  const { PUBLIC_SOURCES, refreshPublicSource, publishPublicSnapshot } = await import(
    pathToFileURL(outfile).href
  )
  const current = await kv.get('published')
  if (
    current?.version === 1 &&
    current.ids?.length >= 2000 &&
    current.attemptedSources === PUBLIC_SOURCES.length &&
    Date.now() - Date.parse(current.refreshedAt) < 12 * 3600000 &&
    process.env.FJ_FORCE_PUBLIC_REFRESH !== 'true'
  ) {
    if (current.parts?.length !== Math.ceil(current.ids.length / 500)) {
      const repaired = await publishPublicSnapshot(kv)
      console.log(
        `::notice title=Publication index repaired::${repaired.jobs.length} unique listings republished in non-overlapping shards; no publisher recrawl.`,
      )
      return { id: ns.id, count: repaired.jobs.length }
    }
    // Legacy fat shards (debug evidence inline) blow the free request budget.
    // Rebuild the publication from the stored source indexes — no recrawl.
    const sample = current.parts?.length ? await kv.get(current.parts[0]) : null
    const fat = Array.isArray(sample) && sample.some((job) => job.quality?.skillEvidence?.length)
    if (fat) {
      const slimmed = await publishPublicSnapshot(kv)
      console.log(
        `::notice title=Publication slimmed::${slimmed.jobs.length} listings republished without inline evidence; no publisher recrawl.`,
      )
      return { id: ns.id, count: slimmed.jobs.length }
    }
    console.log(
      `::notice title=Fresh public publication retained::${current.ids.length} listings already refreshed at ${current.refreshedAt}; avoiding duplicate publisher requests and KV writes. The independent 12-hour cron remains responsible for refreshes.`,
    )
    return { id: ns.id, count: current.ids.length }
  }
  const run = String(Date.now())
  let cursor = 0,
    healthy = 0,
    failed = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < PUBLIC_SOURCES.length) {
        const source = PUBLIC_SOURCES[cursor++]
        try {
          if (
            current &&
            Date.now() - Date.parse(current.refreshedAt) < 12 * 3600000 &&
            process.env.FJ_FORCE_PUBLIC_REFRESH !== 'true'
          ) {
            const retained = await kv.get(`source:${source.id}`)
            if (retained && Date.now() - retained.fetchedAt < 12 * 3600000) {
              healthy++
              console.log(
                `Recent publisher retained: ${source.id}, ${retained.jobs.length} open listings`,
              )
              continue
            }
          }
          const count = await refreshPublicSource(kv, source.id, run)
          healthy++
          console.log(`Public publisher: ${source.id}, ${count} open listings`)
        } catch {
          failed++
          console.log(`Public publisher unavailable/disallowed: ${source.id}`)
        }
      }
    }),
  )
  const snapshot = await publishPublicSnapshot(kv)
  console.log(
    `::notice title=Expanded public feed::${snapshot.jobs.length} distinct real listings; ${healthy} publishers fetched, ${failed} unavailable/disallowed. Refresh interval 12 hours. No D1 dependency.`,
  )
  // The floor protects a healthy site from a bad harvest — it must never
  // block recovery of a collapsed one. Require 2,000 when the live feed is
  // healthy, but only "clearly alive" (>=200 and >= what is live now) when
  // the live feed has already fallen below that.
  const previousCount = current?.ids?.length ?? current?.jobs?.length ?? 0
  const floor = Math.max(200, Math.min(2000, previousCount))
  if (snapshot.jobs.length < floor)
    throw new Error(
      `Expanded feed reached ${snapshot.jobs.length} genuine listings (floor ${floor}, live ${previousCount}); existing site kept unchanged`,
    )
  return { id: ns.id, count: snapshot.jobs.length }
}
