import { logger } from './logging'

const API = 'https://api.telegram.org'

export interface TelegramMessage {
  message_id: number
  chat: { id: number; type: string }
  text?: string
  from?: { id: number; username?: string; first_name?: string }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export class TelegramError extends Error {}

async function call<T>(botToken: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/bot${botToken}/${method}`, {
    signal: AbortSignal.timeout(10_000),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    result?: T
    description?: string
  }

  if (!response.ok || !payload.ok) {
    throw new TelegramError(`Telegram ${method} failed: ${payload.description ?? response.status}`)
  }

  return payload.result as T
}

export async function sendMessage(
  botToken: string,
  chatId: number,
  text: string,
): Promise<TelegramMessage> {
  return call<TelegramMessage>(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  })
}

export async function setWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<boolean> {
  await call(botToken, 'setWebhook', { url, secret_token: secretToken })
  return true
}

export async function getUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>(botToken, 'getUpdates', offset ? { offset } : undefined)
}

/**
 * Telegram passes the secret token back in a header on every webhook call.
 * Comparing it is what stops anyone who guesses the webhook URL from
 * injecting fake updates.
 */
export function verifySecretToken(expected: string | null, received: string | null): boolean {
  if (!expected) return false
  if (!received) return false
  if (expected.length !== received.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index)
  }
  return difference === 0
}

/** A random, single-use deep-link token. Only its hash is stored. */
async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createLinkToken(db: D1Database, userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const now = Date.now()
  await db.batch([
    db
      .prepare('DELETE FROM telegram_link_tokens WHERE user_id = ?1 OR expires_at <= ?2')
      .bind(userId, now),
    db
      .prepare(
        'INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)',
      )
      .bind(await tokenHash(token), userId, now + 15 * 60 * 1000),
  ])
  return token
}

export async function verifyLinkToken(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const row = await db
    .prepare(
      'DELETE FROM telegram_link_tokens WHERE token_hash = ?1 AND expires_at > ?2 RETURNING user_id',
    )
    .bind(await tokenHash(token), now)
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Builds the message the user receives when a new role matches one of their
 * alerts. Plain text on purpose: it is the format Telegram renders most
 * reliably across clients.
 */
export function formatAlertMessage(job: {
  title: string
  company: string
  locationLabel: string
  sourceName: string
  sourceUrl: string
  salaryMin: number
  salaryMax: number
  salaryCurrency: string
}): string {
  const lines = [`${job.title} — ${job.company}`, `${job.locationLabel}`]
  if (job.salaryMax > 0) {
    lines.push(`${job.salaryMin}–${job.salaryMax} ${job.salaryCurrency}`)
  }
  lines.push('', job.sourceName, job.sourceUrl)
  return lines.join('\n')
}

export async function deliverAlert(
  botToken: string,
  chatId: number,
  text: string,
): Promise<boolean> {
  try {
    await sendMessage(botToken, chatId, text)
    return true
  } catch (error) {
    logger.error('telegram delivery failed', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
