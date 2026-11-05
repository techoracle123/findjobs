import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Operator diagnostics run as plain JavaScript in Node.
import * as diagnostics from '../../scripts/check-brevo-email.mjs'

const { maskEmail, parseSender, runBrevoDiagnostics, safeDetail, summariseEvents } = diagnostics

describe('Brevo email diagnostics', () => {
  it('parses and masks the configured sender', () => {
    expect(parseSender('FJ - Find Jobs <FJ@Example.com>')).toEqual({
      name: 'FJ - Find Jobs',
      email: 'fj@example.com',
    })
    expect(maskEmail('person@example.com')).toBe('p***@example.com')
    expect(safeDetail('failed for person@example.com with key secret', ['secret'])).toBe(
      'failed for [email] with key [redacted]',
    )
  })

  it('summarises events without full recipient addresses', () => {
    expect(
      summariseEvents([
        {
          date: '2026-10-31T12:00:00Z',
          email: 'person@example.com',
          event: 'blocked',
          subject: 'Reset your FJ password',
          reason: 'Blocked for person@example.com',
        },
      ]),
    ).toEqual({
      total: 1,
      counts: { blocked: 1 },
      latest: [
        {
          date: '2026-10-31T12:00:00Z',
          event: 'blocked',
          recipientDomain: 'example.com',
          subject: 'Reset your FJ password',
          reason: 'Blocked for [email]',
        },
      ],
    })
  })

  it('checks account, active sender and a test send without logging the key', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/account')) return Response.json({ email: 'owner@example.com' })
      if (url.endsWith('/senders')) {
        return Response.json({
          senders: [{ email: 'sender@example.com', active: true, name: 'FJ - Find Jobs' }],
        })
      }
      if (url.includes('/smtp/statistics/events')) return Response.json({ events: [] })
      if (url.endsWith('/smtp/email')) {
        return new Response(JSON.stringify({ messageId: '<test@example.com>' }), { status: 201 })
      }
      throw new Error(`unexpected ${url}`)
    }) as unknown as typeof fetch

    const result = await runBrevoDiagnostics(
      {
        BREVO_API_KEY: 'brevo-test-secret',
        EMAIL_FROM: 'sender@example.com',
        SEND_TEST: 'true',
      },
      fetcher,
    )

    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('brevo-test-secret')
    expect(JSON.stringify(result)).not.toContain('sender@example.com')
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: 'test-send', ok: true, status: 201 }),
    )
  })
})
