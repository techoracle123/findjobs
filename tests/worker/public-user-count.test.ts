import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import './setup'

import { countRegisteredUsers, upsertUser, userIdFor } from '../../src/server/auth/accounts'

describe('public registered-user count', () => {
  it('counts registered accounts without inflating the number with test accounts', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const before = await countRegisteredUsers(env.DB)

    await upsertUser(env.DB, `public-count-${suffix}@mailbox.org`, 'Public Count')
    await upsertUser(env.DB, `fj-browser-${suffix}@example.com`, 'Browser Test')
    await upsertUser(env.DB, `person-${suffix}@example.org`, 'Reserved Domain Test')

    const after = await countRegisteredUsers(env.DB)
    expect(after).toBe(before + 1)

    const response = await SELF.fetch('http://localhost:8787/api/public-stats')
    expect([200, 503]).toContain(response.status)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.registeredUsers).toBe('number')
    expect(body.registeredUsers as number).toBeGreaterThanOrEqual(after)
    expect(body.users).toBeUndefined()
    expect(body.email).toBeUndefined()
    expect(body.emails).toBeUndefined()
  })

  it('never stores an internal user id as a display name', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `display-name-${suffix}@mailbox.org`
    const internalId = await userIdFor(email)

    const created = await upsertUser(env.DB, email, internalId)
    expect(created.displayName).toBeNull()

    const named = await upsertUser(env.DB, email, 'Real Person')
    expect(named.displayName).toBe('Real Person')

    const afterInternalSubject = await upsertUser(env.DB, email, internalId)
    expect(afterInternalSubject.displayName).toBe('Real Person')

    // Repair a row polluted by the old requireUser behaviour on its next use.
    await env.DB.prepare('UPDATE users SET display_name = ?1 WHERE id = ?2')
      .bind(internalId, internalId)
      .run()
    const repaired = await upsertUser(env.DB, email)
    expect(repaired.displayName).toBeNull()
  })
})
