import { env } from 'cloudflare:test'
import { describe, it, expect, vi, afterEach } from 'vitest'
import './setup'
import { app } from '../../src/server/app'
import { listJobs } from '../../src/server/jobs'
import { createLinkToken, verifyLinkToken } from '../../src/server/telegram'
import { upsertUser, getTelegramChatId } from '../../src/server/auth/accounts'
import { extractSalary, inferRoleFamily, inferWorkMode } from '../../src/server/sources/normalize'
import { getRates } from '../../src/server/rates'

const botEnv = {
  ...env,
  APP_MODE: 'test',
  TELEGRAM_BOT_TOKEN: 'test-only-bot-token',
  TELEGRAM_BOT_USERNAME: 'test_findjobs_bot',
  TELEGRAM_WEBHOOK_SECRET: 'test-only-webhook-secret',
}

afterEach(() => vi.restoreAllMocks())

describe('live-data safety', () => {
  it('never invents jobs when storage is absent', async () => {
    expect((await listJobs(undefined)).jobs).toEqual([])
  })
  it('does not convert currencies using invented rates', async () => {
    expect((await getRates(false)).rates).toEqual({ USD: 1 })
  })
  it('does not turn experience counts or dates into salaries', () => {
    expect(extractSalary('5 years of experience. Team of 200.')).toBeNull()
    expect(extractSalary('Join our 2026 graduate programme.')).toBeNull()
    expect(inferRoleFamily('Receptionist', [], '')).toBe('unknown')
    expect(inferWorkMode(false, 'Engineer')).toBe('unknown')
  })
  it('rejects cross-origin account writes', async () => {
    const response = await app.fetch(
      new Request('https://find-jobs.pages.dev/api/account/profile', {
        method: 'PUT',
        headers: {
          origin: 'https://untrusted.example',
          'content-type': 'application/json',
          'x-dev-user-email': 'test@example.com',
        },
        body: '{}',
      }),
      botEnv,
    )
    expect(response.status).toBe(403)
  })
})

describe('real Telegram update format', () => {
  it('uses short, one-use links and rejects replay', async () => {
    const user = await upsertUser(env.DB, 'token@example.com')
    const token = await createLinkToken(env.DB, user.id)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifyLinkToken(env.DB, token)).toBe(user.id)
    expect(await verifyLinkToken(env.DB, token)).toBeNull()
  })
  it('rejects expired and malformed links', async () => {
    const user = await upsertUser(env.DB, 'expiry@example.com')
    const token = await createLinkToken(env.DB, user.id)
    expect(await verifyLinkToken(env.DB, token, Date.now() + 20 * 60 * 1000)).toBeNull()
    expect(await verifyLinkToken(env.DB, 'bad.token')).toBeNull()
  })
  it('links a standard private /start update and sends confirmation', async () => {
    const user = await upsertUser(env.DB, 'telegram@example.com')
    const token = await createLinkToken(env.DB, user.id)
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }))
    const response = await app.fetch(
      new Request('https://find-jobs.pages.dev/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': botEnv.TELEGRAM_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          update_id: 1,
          message: { chat: { id: 123456, type: 'private' }, text: `/start ${token}` },
        }),
      }),
      botEnv,
    )
    expect(response.status).toBe(200)
    expect(await getTelegramChatId(env.DB, user.id)).toBe(123456)
    expect(outbound).toHaveBeenCalledTimes(1)
  })
  it('rejects a webhook without the secret', async () => {
    const response = await app.fetch(
      new Request('https://find-jobs.pages.dev/api/telegram/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      botEnv,
    )
    expect(response.status).toBe(403)
  })
})
