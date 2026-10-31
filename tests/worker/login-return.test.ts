import { describe, expect, it } from 'vitest'
import app from '../../src/server/app'

/**
 * /api/auth/login is only a forwarder to FJ's own sign-in page. It must
 * never become an open redirect, and a forged header must never count as
 * authentication anywhere.
 */
describe('forwarding to FJ sign-in', () => {
  it.each([
    ['/jobs/job_123', '/auth/login?returnTo=%2Fjobs%2Fjob_123'],
    ['/', '/auth/login?returnTo=%2F'],
    ['/jobs', '/auth/login?returnTo=%2Fjobs'],
    ['/profile', '/auth/login?returnTo=%2Fprofile'],
    ['/dashboard', '/auth/login?returnTo=%2Fdashboard'],
    ['/pricing', '/auth/login?returnTo=%2Fpricing'],
    ['https://attacker.example', '/auth/login?returnTo=%2Fjobs'],
    ['//attacker.example', '/auth/login?returnTo=%2Fjobs'],
    ['/\\attacker.example', '/auth/login?returnTo=%2Fjobs'],
    ['/api/account', '/auth/login?returnTo=%2Fjobs'],
    ['/jobs/job_123?next=https://attacker.example', '/auth/login?returnTo=%2Fjobs'],
  ])('validates the return destination %s', async (returnTo, expected) => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/auth/login?returnTo=' + encodeURIComponent(returnTo),
      { headers: { 'x-dev-user-email': 'test@example.com' } },
      { APP_MODE: 'test' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(expected)
  })

  it('never points at a Cloudflare Access host', async () => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/auth/login?returnTo=/jobs/job_123',
      {},
      { APP_MODE: 'production' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).not.toContain('cloudflareaccess')
  })

  it('does not treat a forged email header as authentication in production', async () => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/account',
      { headers: { 'x-dev-user-email': 'test@example.com' } },
      { APP_MODE: 'production' },
    )
    expect(response.status).toBe(401)
  })
})
