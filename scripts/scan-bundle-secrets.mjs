/**
 * Fails the build if secret-looking material ships in the browser bundle.
 * Patterns are deliberately broad; each finding names the file and line only,
 * never the matched content.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /bachs[_-]?secret/i,
  /BACHS_SECRET_KEY\s*[:=]/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9/+_-]{20,}['"]/i,
]

const dist = process.argv[2] || 'dist'
const findings = []

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (/\.(js|mjs|css|html|json|map)$/.test(entry.name)) {
      const text = await readFile(path, 'utf8')
      for (const pattern of PATTERNS) {
        const match = text.match(pattern)
        if (match) findings.push(`${path} matches ${pattern.source.slice(0, 40)}`)
      }
    }
  }
}

await walk(dist)
if (findings.length) {
  console.error('Secret-looking material found in the built bundle:')
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}
console.log(`No secret patterns in ${dist}.`)
