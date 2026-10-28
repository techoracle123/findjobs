import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY, copy, INTERNAL, DEGRADED, USER_ACTION } from '../../src/shared/copy'
import { renderMessage, classify, userAction, internal } from '../../src/shared/errors'

/**
 * Message hygiene (Prompt 19): the registry covers every id the app renders,
 * internal failures render nothing, and the audit endpoint stays admin-only.
 */
describe('copy registry', () => {
  it('exposes every id with a class and short plain-English text', () => {
    for (const [id, entry] of Object.entries(COPY)) {
      expect(entry.id).toBe(id)
      expect([USER_ACTION, DEGRADED, INTERNAL]).toContain(entry.className)
      // Rule 3: plain short English — one or two sentences at most.
      expect(entry.text.length).toBeGreaterThan(3)
      expect(entry.text.length).toBeLessThan(160)
    }
  })

  it('keeps the mandated OpenRouter disclosure as the only legal entry', () => {
    const legal = Object.entries(COPY).filter(([, entry]) => entry.legal)
    expect(legal.length).toBe(1)
    expect(legal[0][0]).toBe('legal.aiProvider')
  })

  it('renders nothing for INTERNAL failures', () => {
    expect(renderMessage({ kind: INTERNAL, copyId: 'internal' })).toBeNull()
    expect(renderMessage(classify(new Error('KABOOM'), 'jobs.unavailable'))).toBeNull()
    // internal() is a log string only, never a user message.
    expect(typeof internal('kaboom')).toBe('string')
  })

  it('renders USER_ACTION and DEGRADED from the registry', () => {
    expect(renderMessage(userAction('jobs.unavailable'))).toBe(copy('jobs.unavailable'))
    expect(renderMessage(userAction('stale.24h'))).toContain('day')
    expect(userAction('x').kind).toBe(USER_ACTION)
    expect(classify(new Error('x'), 'stale.24h').kind).toBe(INTERNAL)
  })

  it('classifies unknown throws as INTERNAL, never user text', () => {
    const classified = classify(new Error('econnreset'), 'jobs.unavailable')
    expect(classified.kind).toBe(INTERNAL)
    expect(renderMessage(classified)).toBeNull()
    expect(classify('string failure', 'jobs.unavailable').kind).toBe(INTERNAL)
  })
})

describe('copy audit endpoints', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv?.('ADMIN_EMAILS', 'admin@example.com')
  })

  it('rejects copy-render beacons without a valid id', async () => {
    const { app } = await import('../../src/server/app')
    const response = await app.request('/api/copy-render', {
      method: 'POST',
      body: JSON.stringify({ id: 'not valid id!' }),
    })
    expect(response.status).toBe(400)
  })

  it('accepts copy-render beacons for known id shapes', async () => {
    const { app } = await import('../../src/server/app')
    const response = await app.request('/api/copy-render', {
      method: 'POST',
      body: JSON.stringify({ id: 'jobs.unavailable' }),
    })
    expect(response.status).toBe(200)
  })
})
