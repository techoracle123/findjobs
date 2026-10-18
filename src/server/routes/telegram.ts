import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readConfig, telegramConfigured } from '../config'
import {
  findUserByTelegramChatId,
  getTelegramChatId,
  linkTelegram,
  recordAudit,
} from '../auth/accounts'
import { createLinkToken, verifyLinkToken, verifySecretToken } from '../telegram'
import { readJson, requireUser, unauthorized } from '../http'
import { logger } from '../logging'

export const telegramRoutes = new Hono<AppEnv>()

/** Whether this account has linked a Telegram chat, and the bot handle. */
telegramRoutes.get('/telegram/status', async (c) => {
  const config = readConfig(c.env ?? {})
  const user = await requireUser(c)
  if (!user) return unauthorized(c)

  const chatId = c.env?.DB ? await getTelegramChatId(c.env.DB, user.id) : null
  return c.json({
    configured: telegramConfigured(config),
    linked: chatId !== null,
    botUsername: config.telegram.botUsername,
  })
})

/**
 * Returns a deep link that starts the linking flow. The token is signed and
 * short-lived, so it cannot be used to claim somebody else's account.
 */
telegramRoutes.post('/telegram/link', async (c) => {
  const config = readConfig(c.env ?? {})
  const user = await requireUser(c)
  if (!user) return unauthorized(c)

  if (!config.telegram.botToken || !config.telegram.botUsername) {
    return c.json(
      { error: 'telegram_not_configured', message: 'No Telegram bot is configured.' },
      503,
    )
  }

  const token = await createLinkToken(config.telegram.botToken, user.id)
  const url = `https://t.me/${config.telegram.botUsername}?start=${encodeURIComponent(token)}`

  return c.json({ url, token })
})

/**
 * The bot's webhook. Telegram's secret token is checked before the update is
 * read, and the /start payload is verified before an account is linked.
 */
telegramRoutes.post('/telegram/webhook', async (c) => {
  const config = readConfig(c.env ?? {})
  const secret = c.req.header('x-telegram-bot-api-secret-token')

  if (!config.telegram.botToken) {
    return c.json({ error: 'telegram_not_configured' }, 503)
  }

  if (!verifySecretToken(c.env?.TELEGRAM_WEBHOOK_SECRET ?? null, secret ?? null)) {
    return c.json({ error: 'invalid_secret' }, 403)
  }

  const body = await readJson(c)
  const update = body.update as { message?: { chat?: { id?: number }; text?: string } } | undefined
  const message = update?.message
  const chatId = message?.chat?.id
  const text = message?.text ?? ''

  if (typeof chatId !== 'number' || !text.startsWith('/start')) {
    return c.json({ ok: true })
  }

  const token = text.split(/\s+/)[1] ?? ''
  if (!token) return c.json({ ok: true })

  const userId = await verifyLinkToken(config.telegram.botToken, token)
  if (!userId) {
    logger.warn('telegram link token rejected')
    return c.json({ ok: true })
  }

  if (!c.env?.DB) return c.json({ error: 'storage_unavailable' }, 503)

  const existing = await findUserByTelegramChatId(c.env.DB, chatId)
  if (existing && existing !== userId) {
    // The chat is already linked to a different account.
    return c.json({ ok: true })
  }

  await linkTelegram(c.env.DB, userId, chatId)
  await recordAudit(c.env.DB, userId, 'telegram.linked', { chatId })

  logger.info('telegram account linked', { userId })
  return c.json({ ok: true })
})
