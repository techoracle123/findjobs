/**
 * End-to-end smoke test.
 *
 * Builds the app as an IIFE bundle, runs it inside jsdom against the local
 * API worker, and asserts that the opportunity desk actually renders, ranks
 * and reacts to input.
 *
 * Usage: npm run test:smoke   (the API must be running on :8787)
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8787'

const failures = []
const consoleErrors = []

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

async function waitFor(predicate, timeoutMs = 15000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function setNativeValue(window, element, value) {
  const prototype =
    element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : element.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
  element.dispatchEvent(new window.Event('change', { bubbles: true }))
}

console.log('Building smoke bundle…')
execFileSync(
  join(root, 'node_modules', 'node', 'bin', 'node'),
  [
    join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    'scripts/smoke.vite.config.ts',
  ],
  { cwd: root, stdio: 'inherit' },
)

console.log('\nRunning app in jsdom…')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})

const { window } = dom
const { document } = window

// Route the app's relative /api calls at the running local worker.
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input?.url ?? '')
  const target = url.startsWith('/') ? `${API}${url}` : url
  return fetch(target, init)
}

const originalError = window.console.error
window.console.error = (...args) => {
  consoleErrors.push(args.map((arg) => String(arg)).join(' '))
  originalError.apply(window.console, args)
}

// Some transitive dependencies still reach for `process` in a browser context.
window.process = { env: { NODE_ENV: 'production' } }

window.addEventListener('error', (event) => {
  consoleErrors.push(`window error: ${event.message}`)
})

const bundle = readFileSync(join(root, 'dist-smoke', 'smoke.js'), 'utf8')
window.eval(bundle)

try {
  await waitFor(() => document.querySelectorAll('.jobrow').length > 0, 20000, 'job rows to render')
} catch (error) {
  console.log(`  FAIL  app never rendered rows — ${error.message}`)
  console.log('  console errors:', consoleErrors.slice(0, 5))
  process.exit(1)
}

const rows = document.querySelectorAll('.jobrow')
check('renders all 8 demo roles', rows.length === 8, `got ${rows.length}`)

const banner = document.querySelector('.banner--demo')
check(
  'shows the preview-data warning',
  Boolean(banner && banner.textContent.includes('Preview dataset')),
)

const topbar = document.querySelector('.topbar')?.textContent ?? ''
check('reports AI binding as off', topbar.includes('AI off'), topbar)
check('reports Telegram as off', topbar.includes('Telegram off'), topbar)
check('reports the D1 data source', topbar.includes('D1'), topbar)

// Every row should show an eligibility label and a source.
const rowText = rows[0].textContent ?? ''
check(
  'row shows an eligibility verdict',
  /Eligible|Needs checking|Restricted/.test(rowText),
  rowText,
)
check('row shows a source', /Demo board/.test(rowText), rowText)

// Scores start at zero because no profile has been entered yet.
const firstScore = document.querySelector('.scorebadge__inner')?.textContent ?? ''
check('starts with a zero score', firstScore.trim() === '0', firstScore)

// Enter a skill and confirm the ranking reacts.
const skillInput = document.getElementById('skill-input')
check('profile skill input exists', Boolean(skillInput))

if (skillInput) {
  setNativeValue(window, skillInput, 'TypeScript')
  skillInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await waitFor(
    () => Number(document.querySelector('.scorebadge__inner')?.textContent ?? '0') > 0,
    8000,
    'score to update after adding a skill',
  )
  const updated = document.querySelector('.scorebadge__inner')?.textContent ?? ''
  check('score reacts to a new skill', Number(updated) > 0, `score=${updated}`)
  check(
    'skill appears as a tag',
    (document.querySelector('.taglist')?.textContent ?? '').includes('TypeScript'),
  )
}

// Selecting a row should populate the detail panel.
rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await waitFor(() => Boolean(document.querySelector('.detail__title')), 8000, 'detail panel to open')
const detailTitle = document.querySelector('.detail__title')?.textContent ?? ''
check('detail panel opens with the role title', detailTitle.length > 0, detailTitle)

const breakdown = document.querySelectorAll('.bd')
check('detail shows the score breakdown', breakdown.length === 5, `got ${breakdown.length}`)

const detailText = document.querySelector('.detail')?.textContent ?? ''
check('detail explains eligibility', detailText.includes('Eligibility'), '')
check('detail shows the pay period', /\/(yr|mo|hr)/.test(detailText), '')
check('detail shows a rate date', /\d{4}-\d{2}-\d{2}/.test(detailText), '')

// Tabs should switch panels.
const sortSelect = document.getElementById('sort')
check('sort control exists', Boolean(sortSelect))
if (sortSelect) {
  setNativeValue(window, sortSelect, 'salary-desc')
  await waitFor(
    () => document.body.textContent?.includes('mix pay periods'),
    8000,
    'mixed pay period notice',
  )
  check('salary sort warns that periods are not annualised', true)
  const salaries = [...document.querySelectorAll('.jobrow__salary')].map(
    (node) => node.textContent ?? '',
  )
  check('salary sort still lists every role', salaries.length === 8, `got ${salaries.length}`)
}

const alertsTab = [...document.querySelectorAll('.tab')].find((tab) =>
  tab.textContent?.includes('Alerts'),
)
if (alertsTab) {
  alertsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => document.body.textContent?.includes('No Telegram bot is configured'),
    8000,
    'alerts panel',
  )
  check('alerts tab explains that nothing is delivered', true)
  const alertsHead = document.querySelector('.content .panel__head')?.textContent ?? ''
  check('alerts tab is marked as not linked', alertsHead.includes('Not linked'), alertsHead)
} else {
  check('alerts tab exists', false)
}

const planTab = [...document.querySelectorAll('.tab')].find((tab) =>
  tab.textContent?.includes('Plan'),
)
if (planTab) {
  planTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => document.body.textContent?.includes('No payment provider is configured'),
    8000,
    'plan panel',
  )
  check('plan tab says no provider is connected', true)

  const checkout = [...document.querySelectorAll('.content button')].find((button) =>
    button.textContent?.includes('Choose Desk+'),
  )
  check('plan tab offers the paid plan', Boolean(checkout))
  check('checkout is disabled without a provider', checkout?.disabled === true)
} else {
  check('plan tab exists', false)
}

const realErrors = consoleErrors.filter(
  (message) =>
    !message.includes('not wrapped in act') &&
    !message.includes('ReactDOMTestUtils') &&
    !message.includes('Download the React DevTools'),
)
check(
  'no runtime errors in the console',
  realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '),
)

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log('All smoke checks passed.')
window.close()
process.exit(0)
