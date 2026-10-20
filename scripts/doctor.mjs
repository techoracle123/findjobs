#!/usr/bin/env node
/**
 * Doctor — what is working and what is not, in one place.
 *
 * Hits the readiness endpoint the app already exposes, prints every check
 * with what to do about it, and exits non-zero when the deployment is not
 * fit to run. It is what the deploy script runs and what an operator looks
 * at before trusting a deployment.
 *
 * Usage:
 *   npm run doctor
 *   npm run doctor -- https://rolesignal.example.com
 *   API_URL=https://rolesignal.example.com npm run doctor
 */

const target = process.argv[2] || process.env.API_URL || 'http://127.0.0.1:8787'
const url = target.replace(/\/$/, '') + '/api/readiness'

const colors = {
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  missing: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
}

function icon(status) {
  if (status === 'ok') return '✓'
  if (status === 'warn') return '○'
  return '✗'
}

function color(status) {
  return colors[status] ?? colors.dim
}

let report
try {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.error(`The readiness endpoint answered ${response.status}.`)
    if (text) console.error(text.slice(0, 600))
    process.exit(1)
  }
  report = await response.json()
} catch (error) {
  console.error(`Could not reach ${url}.`)
  console.error(error instanceof Error ? error.message : String(error))
  console.error('')
  console.error('Is the API running? Try: npm run dev:api')
  process.exit(1)
}

console.log('')
console.log(`Role Signal — readiness  ${colors.dim}${report.generatedAt}${colors.reset}`)
console.log(
  `${colors.dim}mode: ${report.appMode}  provider: ${report.provider}  price: ${report.price || '—'}${colors.reset}`,
)
console.log('')

for (const check of report.checks) {
  const c = color(check.status)
  console.log(
    `${c}${icon(check.status)} ${check.name}${colors.reset}  ${colors.dim}[${check.required ? 'required' : 'optional'}]${colors.reset}`,
  )
  console.log(`  ${check.detail}`)
  if (check.action) {
    console.log(`  ${colors.dim}→ ${check.action}${colors.reset}`)
  }
  console.log('')
}

if (report.ready) {
  console.log(`${colors.ok}Ready.${colors.reset} This deployment is fit to run.`)
} else {
  console.log(
    `${colors.missing}Not ready.${colors.reset} The checks marked "required" must be green before this deployment is trusted.`,
  )
}

process.exit(report.ready ? 0 : 2)
