/**
 * Local browser-test seed only. Builds the synthetic Ideas fixture and puts it
 * in LOCAL Wrangler KV. It never contacts or changes a remote namespace, and
 * the fixture must never be deployed as production evidence.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const node = join(root, 'node_modules', 'node', 'bin', 'node')
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const fixtureEntry = join(root, 'tests', 'fixtures', 'ideas.ts')

const bundled = await build({
  entryPoints: [fixtureEntry],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
})
const code = bundled.outputFiles[0]?.text
if (!code) throw new Error('Could not build the local Ideas fixture')
const fixture = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const snapshot = fixture.makeIdeaSnapshot(110)
if (snapshot.catalogTotal <= 15000) throw new Error('The local Ideas fixture is too small')

const dir = mkdtempSync(join(tmpdir(), 'fj-ideas-seed-'))
const file = join(dir, 'evidence.json')
writeFileSync(file, JSON.stringify(snapshot))
try {
  execFileSync(
    node,
    [
      wrangler,
      'kv',
      'key',
      'put',
      'ideas:evidence:v1',
      '--config',
      'wrangler.local.jsonc',
      '--local',
      '--binding',
      'PUBLIC_JOBS',
      '--path',
      file,
    ],
    { cwd: root, stdio: 'inherit' },
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(
  `Seeded ${snapshot.catalogTotal.toLocaleString('en-US')} synthetic local-test ideas (never production evidence).`,
)
