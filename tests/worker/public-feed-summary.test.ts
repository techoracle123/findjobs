import { describe, expect, it } from 'vitest'
import { publishedPublicSummary } from '../../src/server/public-feed'

describe('published public summary', () => {
  it('uses precomputed pointer totals without loading publication shards', async () => {
    const pointer = {
      version: 1,
      opportunityVersion: 1,
      refreshedAt: new Date().toISOString(),
      refreshHours: 12,
      sourceCount: 109,
      attemptedSources: 243,
      olderSources: 18,
      added: 2144,
      jobs: [],
      parts: ['publication:must-not-be-read'],
      ids: ['job-1'],
      stats: {
        total: 13564,
        gigs: 333,
        nigeria: 609,
        remote: 3297,
        countries: 84,
        totalAllLanguages: 15610,
      },
    }
    const kv = {
      get: async (key: string | string[]) => {
        if (Array.isArray(key)) throw new Error('Summary must not load shards')
        if (key === 'published') return pointer
        if (key === 'moderation:hidden') return null
        return null
      },
    } as unknown as KVNamespace

    await expect(publishedPublicSummary(kv)).resolves.toMatchObject({
      total: 13564,
      gigs: 333,
      nigeria: 609,
      remote: 3297,
      countries: 84,
      totalAllLanguages: 15610,
      sourceCount: 109,
      attemptedSources: 243,
    })
  })
})
