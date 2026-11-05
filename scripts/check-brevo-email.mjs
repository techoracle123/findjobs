/** Trusted operator diagnostic for password-reset email. It logs statuses and masked domains only: never an API key, full email address, reset link or token. */
import { fileURLToPath } from 'node:url'

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/
const ANY_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function parseSender(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const bracketed = raw.match(/<([^<>]+)>/)
  const email = (bracketed?.[1] ?? raw).trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) return null
  const name = bracketed
    ? raw.slice(0, bracketed.index).trim().replace(/^"|"$/g, '').replace(/[<>]/g, '').slice(0, 80)
    : ''
  return { name: name || 'FJ - Find Jobs', email }
}

export function maskEmail(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1) return '[invalid-email]'
  return `${email[0]}***@${email.slice(at + 1)}`
}

export function safeDetail(value, secrets = []) {
  let text = String(value ?? '')
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]')
  return text
    .replace(ANY_EMAIL_PATTERN, '[email]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 220)
}

export function summariseEvents(events, secrets = []) {
  const list = Array.isArray(events) ? events : []
  const counts = {}
  for (const event of list) {
    const name = String(event?.event ?? 'unknown')
    counts[name] = (counts[name] ?? 0) + 1
  }
  return {
    total: list.length,
    counts,
    latest: list.slice(0, 10).map((event) => ({
      date: event?.date ?? null,
      event: event?.event ?? null,
      recipientDomain: String(event?.email ?? '').split('@')[1] ?? null,
      subject: event?.subject ? safeDetail(event.subject, secrets) : null,
      reason: event?.reason ? safeDetail(event.reason, secrets) : null,
    })),
  }
}

async function brevoRequest(fetcher, apiKey, path, options = {}) {
  try {
    const response = await fetcher(`https://api.brevo.com/v3${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json().catch(() => ({}))
    return { status: response.status, ok: response.ok, body }
  } catch {
    return {
      status: 0,
      ok: false,
      body: { code: 'network_error', message: 'Provider not reached' },
    }
  }
}

function providerError(result, secrets) {
  return {
    code: result.body?.code ? safeDetail(result.body.code, secrets) : null,
    message: result.body?.message ? safeDetail(result.body.message, secrets) : null,
  }
}

export async function runBrevoDiagnostics(env, fetcher = fetch) {
  const apiKey = env.BREVO_API_KEY?.trim() ?? ''
  const sender = parseSender(
    env.EMAIL_FROM?.trim() || env.BREVO_SENDER_EMAIL?.trim() || env.OTP_FROM?.trim(),
  )
  const sendTest = env.SEND_TEST === 'true'
  const testRecipientRaw = env.TEST_RECIPIENT?.trim() || sender?.email || ''
  const testRecipient = EMAIL_PATTERN.test(testRecipientRaw) ? testRecipientRaw.toLowerCase() : ''
  const secrets = [apiKey, sender?.email, testRecipient]
  const checks = []

  if (!apiKey || !sender) {
    return {
      ok: false,
      checks: [
        {
          name: 'configuration',
          ok: false,
          configured: Boolean(apiKey && sender),
          sender: sender ? maskEmail(sender.email) : null,
        },
      ],
    }
  }

  const account = await brevoRequest(fetcher, apiKey, '/account')
  checks.push({
    name: 'account',
    ok: account.ok,
    status: account.status,
    ...(account.ok ? {} : providerError(account, secrets)),
  })

  const senders = await brevoRequest(fetcher, apiKey, '/senders')
  const senderRows = Array.isArray(senders.body?.senders) ? senders.body.senders : []
  const matchedSender = senderRows.find(
    (row) => String(row?.email ?? '').toLowerCase() === sender.email,
  )
  checks.push({
    name: 'sender',
    ok: senders.ok && Boolean(matchedSender?.active),
    status: senders.status,
    sender: maskEmail(sender.email),
    found: Boolean(matchedSender),
    active: matchedSender ? Boolean(matchedSender.active) : null,
    totalSenders: senderRows.length,
    ...(senders.ok ? {} : providerError(senders, secrets)),
  })

  const events = await brevoRequest(
    fetcher,
    apiKey,
    '/smtp/statistics/events?days=2&limit=50&sort=desc',
  )
  checks.push({
    name: 'recent-events',
    ok: events.ok,
    status: events.status,
    ...(events.ok ? summariseEvents(events.body?.events, secrets) : providerError(events, secrets)),
  })

  let sendAccepted = false
  if (sendTest) {
    if (!testRecipient) {
      checks.push({ name: 'test-send', ok: false, status: 0, code: 'invalid_recipient' })
    } else {
      const stamp = new Date().toISOString()
      const send = await brevoRequest(fetcher, apiKey, '/smtp/email', {
        method: 'POST',
        body: JSON.stringify({
          sender,
          to: [{ email: testRecipient }],
          subject: 'FJ email check',
          textContent: `This is an FJ email delivery check sent at ${stamp}. No action is needed.`,
          tags: ['fj-email-diagnostic'],
        }),
      })
      sendAccepted = send.ok
      checks.push({
        name: 'test-send',
        ok: send.ok,
        status: send.status,
        recipient: maskEmail(testRecipient),
        messageIdPresent: Boolean(send.body?.messageId),
        ...(send.ok ? {} : providerError(send, secrets)),
      })
    }
  }

  const senderCheck = checks.find((check) => check.name === 'sender')
  return {
    ok: sendTest ? sendAccepted : Boolean(account.ok && senderCheck?.ok),
    checks,
  }
}

function annotation(level, title, data) {
  console.log(`::${level} title=${title}::${JSON.stringify(data)}`)
}

export async function main() {
  const result = await runBrevoDiagnostics(process.env)
  for (const check of result.checks) {
    annotation(check.ok ? 'notice' : 'warning', `Brevo ${check.name}`, check)
  }
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
