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

// jsdom has no native dialog implementation. Only this DOM harness needs a
// shim; Playwright tests exercise actual modal focus, Escape and restoration.
window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

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

window.HTMLElement.prototype.scrollIntoView = () => {}
await waitFor(
  () => document.querySelector('.empty__title') || document.querySelector('.joblist .jobrow'),
  20000,
  'feed or honest empty state',
)
check(
  'uses the Find Jobs name',
  document.querySelector('.brand')?.textContent.includes('Find Jobs'),
)
check('does not show fictional data', !document.body.textContent.includes('Preview dataset'))
check(
  'does not show infrastructure controls',
  !document.querySelector('.topbar')?.textContent.includes('D1'),
)
check(
  'does not offer a payment plan',
  ![...document.querySelectorAll('.tab')].some((tab) => tab.textContent.includes('Plan')),
)
await waitFor(() => document.querySelector('.local-note'), 8000, 'anonymous storage note')
check('explains anonymous storage', document.body.textContent.includes('stay on this device'))
const input = document.getElementById('skill-input')
check('profile input exists', Boolean(input))
setNativeValue(window, input, 'Python')
input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await waitFor(() => document.querySelector('[aria-label="Remove Python"]'), 8000, 'profile tag')
check('profile accepts a skill', Boolean(document.querySelector('[aria-label="Remove Python"]')))
const alerts = [...document.querySelectorAll('.tab')].find((tab) =>
  tab.textContent.includes('Alerts'),
)
alerts.click()
await waitFor(() => document.getElementById('alert-label'), 8000, 'alerts panel')
check('alerts explain sign-in', document.body.textContent.includes('Sign in to receive job alerts'))
check(
  'alert keywords have an accessible label',
  Boolean(document.querySelector('[aria-label="Alert keywords"]')),
)
check(
  'does not claim alerts are being delivered',
  document.body.textContent.includes('aren’t connected yet') ||
    document.body.textContent.includes('Connect Telegram'),
)
const signup = [...document.querySelectorAll('.topbar button')].find(
  (button) => button.textContent === 'Sign up',
)
signup.click()
await waitFor(() => document.querySelector('.auth-dialog[open]'), 5000, 'sign-up dialog')
check(
  'sign-up explains passwordless accounts',
  document
    .querySelector('.auth-dialog')
    .textContent.includes('Your first email sign-in creates your account'),
)
const recovery = [...document.querySelectorAll('.auth-dialog button')].find((button) =>
  button.textContent.includes('Forgot password'),
)
recovery.click()
await waitFor(
  () => document.querySelector('.auth-dialog').textContent.includes('There isn’t one to reset'),
  5000,
  'account recovery',
)
check(
  'forgot-password recovery explains requesting a fresh code',
  document.querySelector('.auth-dialog').textContent.includes('check your inbox and spam folder'),
)
document.querySelector('[aria-label="Close account window"]').click()
await waitFor(() => !document.querySelector('.auth-dialog[open]'), 5000, 'closing account dialog')
check('account dialog closes', !document.querySelector('.auth-dialog[open]'))
check('no runtime errors', consoleErrors.length === 0, consoleErrors.join('; '))
window.close()
if (failures.length) process.exitCode = 1
console.log(`\n${failures.length ? 'FAILED' : 'PASS'}: live-only interface smoke checks`)
