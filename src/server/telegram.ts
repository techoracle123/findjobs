import { logger } from './logging'
import { decodeBase64Url } from './auth/jwt'

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

/**
 * A short-lived token that carries the account id across the Telegram deep
 * link. It is signed with the bot token, so a user cannot mint a link for
 * someone else's account.
 */
export async function createLinkToken(botToken: string, userId: string): Promise<string> {
  const expiresAt = Date.now() + 15 * 60 * 1000
  const payload = `${userId}.${expiresAt}`
  const signature = await hmacHex(botToken, payload)
  return `${Buffer.from(payload).toString('base64url')}.${signature}`
}

export async function verifyLinkToken(
  botToken: string,
  token: string,
  now: number = Date.now(),
): Promise<string | null> {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null

  const payload = new TextDecoder().decode(decodeBase64Url(encoded))
  const expected = await hmacHex(botToken, payload)
  if (expected !== signature) return null

  const [userId, expiresAt] = payload.split('.')
  if (!userId || !expiresAt) return null
  if (Number(expiresAt) < now) return null

  return userId
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
  const lines = [`*${job.title}* — ${job.company}`, `${job.locationLabel}`]
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
