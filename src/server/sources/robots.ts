/**
 * A reader for `robots.txt`.
 *
 * The crawler consults this before it fetches anything, and honours what it
 * says. That is a deliberate constraint, not an oversight: it is what makes
 * crawling a large number of employer sites a thing we can do without
 * becoming the kind of crawler people block.
 */

export interface RobotsPolicy {
  /** Whether the path may be fetched. */
  allowed: boolean
  /** The crawl delay the site asked for, in milliseconds. */
  crawlDelayMs: number
  /** The raw rules, kept so they can be shown in an operator view. */
  rules: string
}

const DEFAULT_POLICY: RobotsPolicy = { allowed: true, crawlDelayMs: 1000, rules: '' }
const ROBOTS_TIMEOUT_MS = 8_000

interface Rule {
  allow: boolean
  path: string
}

export function parseRobots(text: string): { rules: Rule[]; crawlDelayMs: number } {
  const rules: Rule[] = []
  let crawlDelayMs = 1000

  const lines = text.split('\n')
  let appliesToUs = false
  let seenSpecificAgent = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'user-agent') {
      const agent = value.toLowerCase()
      if (agent === '*') {
        // A wildcard group applies unless a named group matched, and named
        // groups win.
        appliesToUs = true
      } else if (agent.includes('rolesignal') || agent.includes('bot')) {
        appliesToUs = true
        seenSpecificAgent = true
      }
      continue
    }

    if (!appliesToUs) continue

    if (key === 'disallow') {
      if (value === '') {
        // "Disallow:" with no value means allow everything.
        continue
      }
      rules.push({ allow: false, path: value })
    } else if (key === 'allow') {
      rules.push({ allow: true, path: value })
    } else if (key === 'crawl-delay') {
      const seconds = Number.parseFloat(value)
      if (Number.isFinite(seconds) && seconds >= 0) {
        crawlDelayMs = Math.min(60_000, Math.round(seconds * 1000))
      }
    }
  }

  if (seenSpecificAgent) {
    // A named group was found: only its rules apply, so drop the wildcard's.
    // The parser above already separated them by toggling, but the wildcard
    // group may have been read first, so re-parse in a second pass.
    const specific = parseSpecific(text)
    if (specific) {
      return { rules: specific.rules, crawlDelayMs: specific.crawlDelayMs }
    }
  }

  return { rules, crawlDelayMs }
}

function parseSpecific(text: string): { rules: Rule[]; crawlDelayMs: number } | null {
  const rules: Rule[] = []
  let crawlDelayMs = 1000
  let active = false
  let found = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'user-agent') {
      const agent = value.toLowerCase()
      if (agent === '*') {
        if (found) break
        active = false
      } else if (agent.includes('rolesignal') || agent.includes('bot')) {
        active = true
        found = true
      }
      continue
    }

    if (!active) continue
    if (key === 'disallow' && value !== '') rules.push({ allow: false, path: value })
    else if (key === 'allow') rules.push({ allow: true, path: value })
    else if (key === 'crawl-delay') {
      const seconds = Number.parseFloat(value)
      if (Number.isFinite(seconds) && seconds >= 0) {
        crawlDelayMs = Math.min(60_000, Math.round(seconds * 1000))
      }
    }
  }

  return found ? { rules, crawlDelayMs } : null
}

/** The longest matching rule wins; on a tie, Allow wins. */
export function isPathAllowed(rules: Rule[], path: string): boolean {
  let decision: { allow: boolean; length: number } | null = null

  for (const rule of rules) {
    if (!path.startsWith(rule.path)) continue
    if (decision === null || rule.path.length > decision.length) {
      decision = { allow: rule.allow, length: rule.path.length }
    } else if (rule.path.length === decision.length && rule.allow) {
      decision = { allow: true, length: rule.path.length }
    }
  }

  return decision === null ? true : decision.allow
}

export async function loadRobots(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsPolicy> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)

  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { accept: 'text/plain' },
      signal: controller.signal,
    })
    if (!response.ok) {
      // No robots.txt means no stated restriction.
      return DEFAULT_POLICY
    }
    const text = await response.text()
    const { rules, crawlDelayMs } = parseRobots(text)
    return { allowed: isPathAllowed(rules, '/'), crawlDelayMs, rules: text }
  } catch {
    // If the rules cannot be read, do not guess: leave the host alone.
    return { allowed: false, crawlDelayMs: 60_000, rules: '' }
  } finally {
    clearTimeout(timer)
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function originOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return ''
  }
}
