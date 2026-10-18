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
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = []
  let group = { agents: [] as string[], rules: [] as Rule[], delay: 1000 }
  let directives = false
  const flush = () => {
    if (group.agents.length) groups.push(group)
    group = { agents: [], rules: [], delay: 1000 }
    directives = false
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [name, ...rest] = line.split(':')
    const key = name.trim().toLowerCase(),
      value = rest.join(':').trim()
    if (key === 'user-agent') {
      if (directives) flush()
      group.agents.push(value.toLowerCase())
      continue
    }
    if (!group.agents.length) continue
    directives = true
    if (key === 'disallow' && value) group.rules.push({ allow: false, path: value })
    if (key === 'allow' && value) group.rules.push({ allow: true, path: value })
    if (key === 'crawl-delay' && Number.isFinite(Number(value)) && Number(value) >= 0)
      group.delay = Math.min(60000, Number(value) * 1000)
  }
  flush()
  // Keep the established crawler identity. Unrelated training/search bots' groups
  // do not apply to RoleSignalBot, and must never be conflated with it.
  const product = 'rolesignalbot'
  const specificity = (agents: string[]) =>
    Math.max(
      -1,
      ...agents.map((agent) => (agent === '*' ? 0 : product.includes(agent) ? agent.length : -1)),
    )
  const best = Math.max(-1, ...groups.map((entry) => specificity(entry.agents)))
  const selected = groups.filter((entry) => specificity(entry.agents) === best && best >= 0)
  return {
    rules: selected.flatMap((entry) => entry.rules),
    crawlDelayMs: Math.max(1000, ...selected.map((entry) => entry.delay)),
  }
}

/** The longest matching rule wins; on a tie, Allow wins. */
export function isPathAllowed(rules: Rule[], path: string): boolean {
  let decision: { allow: boolean; length: number } | null = null

  for (const rule of rules) {
    const end = rule.path.endsWith('$')
    const expression = rule.path
      .replace(/\$$/, '')
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    if (!new RegExp(`^${expression}${end ? '$' : ''}`).test(path)) continue
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
      if (response.status === 404) return DEFAULT_POLICY
      return { allowed: false, crawlDelayMs: 60000, rules: 'User-agent: *\nDisallow: /' }
    }
    const text = await response.text()
    const { rules, crawlDelayMs } = parseRobots(text)
    return { allowed: isPathAllowed(rules, '/'), crawlDelayMs, rules: text }
  } catch {
    // If the rules cannot be read, do not guess: leave the host alone.
    return { allowed: false, crawlDelayMs: 60_000, rules: 'User-agent: *\nDisallow: /' }
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
