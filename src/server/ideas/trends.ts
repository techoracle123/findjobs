import { decodeXML } from 'entities'
import type { LiveTrend, TrendResponse } from '../../shared/ideas'

const FRESH_MS = 15 * 60_000
const STALE_MS = 7 * 86_400_000
const trendKey = (geo: string) => `ideas:trends:${geo}`
const memory = new WeakMap<KVNamespace, Map<string, { at: number; value: TrendResponse }>>()
const pending = new WeakMap<KVNamespace, Map<string, Promise<TrendResponse>>>()

function cleanText(value: string): string {
  return decodeXML(
    value
      .replace(/^\s*<!\[CDATA\[/, '')
      .replace(/\]\]>\s*$/, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string {
  const escaped = name.replace(':', '\\:')
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'))
  return match ? cleanText(match[1]) : ''
}

function tags(block: string, name: string): string[] {
  const escaped = name.replace(':', '\\:')
  return [
    ...block.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi')),
  ].map((match) => match[1])
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function approximateSearches(label: string): number {
  const match = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KM])?/i)
  if (!match) return 0
  const multiplier =
    match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2]?.toUpperCase() === 'K' ? 1_000 : 1
  return Math.round(Number(match[1]) * multiplier)
}

function trendId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `trend-${(hash >>> 0).toString(36)}`
}

export function parseGoogleTrends(xml: string, geo: string, countryName: string): LiveTrend[] {
  if (xml.length > 2_000_000) throw new Error('Trend feed exceeded the safety limit')
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []
  const trends: LiveTrend[] = []
  for (const item of items.slice(0, 50)) {
    const query = tag(item, 'title')
    const started = Date.parse(tag(item, 'pubDate'))
    if (!query || !Number.isFinite(started)) continue
    const startedAt = new Date(started).toISOString()
    const trafficLabel = tag(item, 'ht:approx_traffic') || 'Not stated'
    const news = tags(item, 'ht:news_item')
      .map((entry) => ({
        title: tag(entry, 'ht:news_item_title'),
        url: safeUrl(tag(entry, 'ht:news_item_url')),
        source: tag(entry, 'ht:news_item_source'),
      }))
      .filter((entry) => entry.title && entry.url)
      .slice(0, 3)
    trends.push({
      id: trendId(`${geo}:${query}:${startedAt}`),
      query,
      geo,
      countryName,
      trafficLabel,
      approximateSearches: approximateSearches(trafficLabel),
      startedAt,
      exploreUrl: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(query)}`,
      news,
    })
  }
  return trends
}

function validTrendResponse(value: unknown, geo: string): value is TrendResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TrendResponse>
  return (
    candidate.geo === geo &&
    typeof candidate.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.fetchedAt)) &&
    Array.isArray(candidate.trends)
  )
}

export async function liveTrends(
  kv: KVNamespace | undefined,
  geoInput: string,
  countryName: string,
  fetcher: typeof fetch = fetch,
): Promise<TrendResponse> {
  const geo = geoInput.toUpperCase()
  if (!/^[A-Z]{2}$/.test(geo)) throw new Error('Invalid trend country')
  const sourceUrl = `https://trends.google.com/trending/rss?geo=${geo}`
  if (!kv) {
    const response = await fetcher(sourceUrl, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Trend source unavailable')
    return {
      trends: parseGoogleTrends(await response.text(), geo, countryName),
      geo,
      fetchedAt: new Date().toISOString(),
      stale: false,
      sourceName: 'Google Trends, Trending Now RSS',
      sourceUrl,
    }
  }

  const cache = memory.get(kv) ?? new Map<string, { at: number; value: TrendResponse }>()
  memory.set(kv, cache)
  let cached = cache.get(geo)?.value ?? null
  if (!cached) {
    const stored = await kv.get<TrendResponse>(trendKey(geo), { type: 'json', cacheTtl: 60 })
    cached = validTrendResponse(stored, geo) ? stored : null
  }
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) return cached

  const waits = pending.get(kv) ?? new Map<string, Promise<TrendResponse>>()
  pending.set(kv, waits)
  const existing = waits.get(geo)
  if (existing) return existing

  const work = (async () => {
    try {
      const response = await fetcher(sourceUrl, {
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'FJFindJobs/1.0 (+https://fj-find-jobs.pages.dev/ideas)',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('Trend source unavailable')
      const result: TrendResponse = {
        trends: parseGoogleTrends(await response.text(), geo, countryName),
        geo,
        fetchedAt: new Date().toISOString(),
        stale: false,
        sourceName: 'Google Trends, Trending Now RSS',
        sourceUrl,
        ...(cached
          ? {}
          : { message: 'Trend availability is controlled by Google and varies by country.' }),
      }
      await kv.put(trendKey(geo), JSON.stringify(result), {
        expirationTtl: Math.ceil(STALE_MS / 1000),
      })
      cache.set(geo, { at: Date.now(), value: result })
      return result
    } catch (error) {
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < STALE_MS) {
        return {
          ...cached,
          stale: true,
          message:
            'The live trend feed is unavailable. These are the last saved trends, with their original collection time.',
        }
      }
      throw error
    } finally {
      waits.delete(geo)
    }
  })()
  waits.set(geo, work)
  return work
}
