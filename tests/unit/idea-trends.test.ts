import { describe, expect, it, vi } from 'vitest'
import { liveTrends, parseGoogleTrends } from '../../src/server/ideas/trends'
import type { TrendResponse } from '../../src/shared/ideas'

const XML = `<rss><channel><item><title>Power repair</title><pubDate>Thu, 05 Nov 2026 05:30:00 GMT</pubDate><ht:approx_traffic>2K+</ht:approx_traffic></item></channel></rss>`

function kvWith(initial?: TrendResponse) {
  const values = new Map<string, string>()
  if (initial) values.set('ideas:trends:NG', JSON.stringify(initial))
  return {
    values,
    kv: {
      get: vi.fn(async (key: string) => (values.has(key) ? JSON.parse(values.get(key)!) : null)),
      put: vi.fn(async (key: string, value: string) => values.set(key, value)),
    } as unknown as KVNamespace,
  }
}

function response(): Response {
  return new Response(XML, { status: 200 })
}

describe('current trend cache', () => {
  it('coalesces concurrent fetches and reuses fresh data', async () => {
    const { kv } = kvWith()
    let release: (() => void) | undefined
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(response())
        }),
    )
    const first = liveTrends(kv, 'NG', 'Nigeria', fetcher as unknown as typeof fetch)
    const second = liveTrends(kv, 'NG', 'Nigeria', fetcher as unknown as typeof fetch)
    await new Promise((resolve) => setTimeout(resolve, 0))
    release?.()
    const [a, b] = await Promise.all([first, second])
    expect(a.trends[0].trafficLabel).toBe('2K+')
    expect(b.fetchedAt).toBe(a.fetchedAt)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await liveTrends(kv, 'NG', 'Nigeria', fetcher as unknown as typeof fetch)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns the last saved trends with their original timestamp when the source fails', async () => {
    const previous: TrendResponse = {
      trends: parseGoogleTrends(XML, 'NG', 'Nigeria'),
      geo: 'NG',
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      stale: false,
      sourceName: 'Google Trends, Trending Now RSS',
      sourceUrl: 'https://trends.google.com/trending/rss?geo=NG',
    }
    const { kv } = kvWith(previous)
    const fetcher = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const result = await liveTrends(kv, 'NG', 'Nigeria', fetcher as unknown as typeof fetch)
    expect(result.stale).toBe(true)
    expect(result.fetchedAt).toBe(previous.fetchedAt)
    expect(result.message).toContain('last saved')
  })

  it('does not silently serve a week-old trend feed as current', async () => {
    const previous: TrendResponse = {
      trends: [],
      geo: 'NG',
      fetchedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      stale: false,
      sourceName: 'Google Trends, Trending Now RSS',
      sourceUrl: 'https://trends.google.com/trending/rss?geo=NG',
    }
    const { kv } = kvWith(previous)
    await expect(
      liveTrends(
        kv,
        'NG',
        'Nigeria',
        vi.fn(async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('offline')
  })

  it('rejects invalid country codes before calling the source', async () => {
    const fetcher = vi.fn()
    await expect(liveTrends(undefined, 'NGA', 'Nigeria', fetcher as typeof fetch)).rejects.toThrow(
      'Invalid trend country',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
