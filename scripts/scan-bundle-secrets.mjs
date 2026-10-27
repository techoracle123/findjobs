/**
 * Fails the build if secret-looking material ships in the browser bundle.
 * Patterns are deliberately broad; each finding names the file only, never
 * the matched content.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}(?![0-9A-Z])/, // real AWS access keys are exactly 20 chars
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
        if (pattern.test(text)) findings.push(`${path} matches ${pattern.source.slice(0, 40)}`)
      }
    }
  }
}

try {
  await walk(dist)
} catch (error) {
  if (error && error.code === 'ENOENT') {
    console.error(`No build output at ${dist}; run the build first.`)
    process.exit(1)
  }
  throw error
}

if (findings.length) {
  console.error('Secret-looking material found in the built bundle:')
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}
console.log(`No secret patterns in ${dist}.`)
