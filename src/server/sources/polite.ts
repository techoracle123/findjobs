import { hostOf, isPathAllowed, loadRobots, originOf, parseRobots } from './robots'
import { SourceError } from './types'

interface HostPolicy {
  rules: string
  crawlDelayMs: number
  lastRequestAt: number
  fetchedAt: number
}

const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12_000
const cache = new Map<string, HostPolicy>()

/**
 * A fetch that behaves the way a considerate crawler should: it reads
 * `robots.txt` before the first request to a host, honours the rules and
 * the crawl delay, and keeps a note of when it last called.
 *
 * The rules are cached in memory for the life of the isolate and in D1 for
 * the life of the deployment, so a restart does not mean re-reading them.
 */
export function createPoliteFetch(
  sourceId: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
  onRequest?: (host: string) => Promise<void>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const host = hostOf(url)
    if (!host) return fetchImpl(input as RequestInfo, init)

    const policy = await policyFor(host, fetchImpl)

    if (policy.rules && !allowedBy(policy.rules, new URL(url).pathname + new URL(url).search)) {
      throw new SourceError(
        `robots.txt does not allow ${new URL(url).pathname} on ${host}`,
        sourceId,
      )
    }

    const since = Date.now() - policy.lastRequestAt
    if (policy.lastRequestAt > 0 && since < policy.crawlDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, policy.crawlDelayMs - since))
    }

    policy.lastRequestAt = Date.now()
    if (onRequest) await onRequest(host)

    // A host that accepts the connection and then says nothing must not
    // hold up a whole run.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      return await fetchImpl(input as RequestInfo, {
        ...init,
        signal: controller.signal,
        headers: { 'user-agent': userAgent, ...(init?.headers ?? {}) },
      })
    } finally {
      clearTimeout(timer)
    }
  }) as typeof fetch
}

async function policyFor(host: string, fetchImpl: typeof fetch): Promise<HostPolicy> {
  const cached = cache.get(host)
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) {
    return cached
  }

  const origin = originOf(`https://${host}`)
  const robots = await loadRobots(origin, fetchImpl)

  const policy: HostPolicy = {
    rules: robots.rules,
    crawlDelayMs: robots.crawlDelayMs,
    lastRequestAt: Date.now(),
    fetchedAt: Date.now(),
  }
  cache.set(host, policy)
  return policy
}

/** A small wrapper so the robots check can be reused outside the fetcher. */
function allowedBy(rules: string, path: string): boolean {
  const parsed = parseRobots(rules)
  return isPathAllowed(parsed.rules, path)
}

export function resetHostCache(): void {
  cache.clear()
}
