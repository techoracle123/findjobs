#!/usr/bin/env node
/**
 * One-off source audit: runs every seeded source through its real parser
 * and reports which boards actually answer. Read-only; changes nothing.
 *
 *   node scripts/audit-sources.mjs > /tmp/source-audit.txt
 *   sort -n /tmp/source-audit.txt        # dead boards float to the top
 *
 * Output columns: STATUS  COUNT  SOURCE_ID  PARSER  ERROR
 * STATUS is the HTTP status when the failure carries one, 200 on success,
 * 0 when the board answered but yielded nothing, -1 on network errors.
 * Needs open network access — run locally or in CI, not in a sandbox.
 */
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = `
export { SEED_SOURCES } from './src/server/sources/seed.ts'
export { getParser } from './src/server/sources/registry.ts'
`
const dir = await mkdtemp(join(tmpdir(), 'fj-audit-'))
const entryPath = join(dir, 'entry.ts')
const bundlePath = join(dir, 'bundle.mjs')
await writeFile(entryPath, entry.replaceAll('./src/', `${process.cwd()}/src/`))
await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { SEED_SOURCES, getParser } = await import(pathToFileURL(bundlePath).href)

const TIMEOUT_MS = 15_000
const CONCURRENCY = 6

async function timedFetch(input, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: { 'user-agent': 'FJ source audit (read-only)', ...(init?.headers ?? {}) },
    })
  } finally {
    clearTimeout(timer)
  }
}

function statusOf(error) {
  const match = /(\b[1-5]\d\d\b)/.exec(String(error?.message ?? error ?? ''))
  return match ? Number(match[1]) : -1
}

let cursor = 0
async function worker() {
  while (cursor < SEED_SOURCES.length) {
    const source = SEED_SOURCES[cursor++]
    const parser = getParser(source.parser)
    if (!parser) {
      console.log(`-2\t0\t${source.id}\t${source.parser}\tno parser registered`)
      continue
    }
    try {
      const postings = await parser.fetchPostings(
        {
          id: source.id,
          listingUrl: source.listingUrl,
          options: {
            company: source.company,
            companyLabel: source.companyLabel,
            country: source.country,
          },
          verification: 'unverified',
          verificationReason: 'audit',
        },
        timedFetch,
      )
      console.log(
        `${postings.length ? 200 : 0}\t${postings.length}\t${source.id}\t${source.parser}\t`,
      )
    } catch (error) {
      console.log(
        `${statusOf(error)}\t0\t${source.id}\t${source.parser}\t${String(error?.message ?? error).slice(0, 140)}`,
      )
    }
  }
}

console.error(`Auditing ${SEED_SOURCES.length} sources (concurrency ${CONCURRENCY})…`)
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.error('Done. Review, then delete dead rows from src/server/sources/seed.ts.')
