import { describe, it, expect, vi } from 'vitest'
// @ts-expect-error Deployment helpers run as plain JavaScript in Node.
import * as integrations from '../../scripts/cloudflare-integrations.mjs'

const { telegramSetup, provisionAccess, workerSecrets, reservePageNames } = integrations

describe('encrypted deployment integrations', () => {
  it('does not call Telegram without an encrypted token', async () => {
    const fetcher = vi.fn()
    expect(await telegramSetup('', 'find-jobs', fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks the bot, registers a secret webhook, and verifies the assigned host', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { username: 'my_jobs_bot' } }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: true }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          result: { url: 'https://find-jobs-assigned.pages.dev/api/telegram/webhook' },
        }),
      )
    const bot = await telegramSetup(
      'test-only-token',
      'find-jobs',
      fetcher,
      'find-jobs-assigned.pages.dev',
    )
    expect(bot.username).toBe('my_jobs_bot')
    expect(bot.secret).toMatch(/^[a-f0-9]{64}$/)
    await bot.register()
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      url: 'https://find-jobs-assigned.pages.dev/api/telegram/webhook',
      secret_token: bot.secret,
      allowed_updates: ['message'],
    })
  })
  it('does not expose Telegram credentials on a network failure', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error('https://api.telegram.org/botsecret-token/getMe'))
    await expect(telegramSetup('secret-token', 'find-jobs', fetcher)).rejects.toThrow(
      'could not be reached',
    )
    await expect(telegramSetup('secret-token', 'find-jobs', fetcher)).rejects.not.toThrow(
      'secret-token',
    )
  })
  it('creates a login-only Access application with verified email OTP', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ result: { auth_domain: 'team.cloudflareaccess.com' } })
      .mockResolvedValueOnce({ result: [{ id: 'otp-id', type: 'onetimepin' }] })
      .mockResolvedValueOnce({ result: [] })
      .mockResolvedValueOnce({ result: { aud: 'app-aud' } })
    expect(await provisionAccess(api, 'find-jobs', 'assigned.pages.dev')).toEqual({
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      ACCESS_AUD: 'app-aud',
    })
    const application = api.mock.calls[3][1].body
    expect(application.domain).toBe('assigned.pages.dev/api/auth/login')
    expect(application.allowed_idps).toEqual(['otp-id'])
    expect(application.policies[0].decision).toBe('allow')
  })
  it('does not bypass Access permissions or overwrite unrelated apps', async () => {
    const api = vi.fn().mockRejectedValue(new Error('HTTP 403'))
    await expect(provisionAccess(api, 'find-jobs')).rejects.toThrow('HTTP 403')
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('stores worker credentials only as secret_text', async () => {
    const api = vi.fn().mockResolvedValue({ success: true })
    await workerSecrets(api, 'consumer', { TELEGRAM_BOT_TOKEN: 'test-only' })
    expect(api).toHaveBeenCalledWith('/workers/scripts/consumer/secrets', {
      method: 'PUT',
      body: { name: 'TELEGRAM_BOT_TOKEN', type: 'secret_text', text: 'test-only' },
    })
  })
})

it('confirms alternative hostnames from Cloudflare assignment, not missing DNS', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ result: { subdomain: 'fj-find-jobs.pages.dev' } })
    .mockResolvedValueOnce({ result: { subdomain: 'find-jobs-fj-xyz.pages.dev' } })
  const names = await reservePageNames(api)
  expect(names).toEqual([
    { requested: 'fj-find-jobs.pages.dev', assigned: 'fj-find-jobs.pages.dev', exact: true },
    { requested: 'find-jobs-fj.pages.dev', assigned: 'find-jobs-fj-xyz.pages.dev', exact: false },
  ])
  expect(api).toHaveBeenCalledTimes(3)
})
