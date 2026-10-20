import { describe, expect, it } from 'vitest'
import app from '../../src/server/app'

describe('returning from email sign-in', () => {
  it.each([
    ['/jobs/job_123', '/jobs/job_123'],
    ['/', '/'],
    ['/dashboard', '/dashboard'],
    ['https://attacker.example', '/'],
    ['//attacker.example', '/'],
    ['/\\attacker.example', '/'],
    ['/api/account', '/'],
    ['/jobs/job_123?next=https://attacker.example', '/'],
  ])('validates the return destination %s', async (returnTo, expected) => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/auth/login?returnTo=' + encodeURIComponent(returnTo),
      { headers: { 'x-dev-user-email': 'test@example.com' } },
      { APP_MODE: 'test' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(expected)
  })
  it('does not treat a return URL or forged email header as authentication in production', async () => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/auth/login?returnTo=/jobs/job_123',
      { headers: { 'x-dev-user-email': 'test@example.com' } },
      { APP_MODE: 'production' },
    )
    expect(response.status).toBe(503)
  })
})
