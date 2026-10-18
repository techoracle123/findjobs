/** Small HTML helpers. The Workers runtime has no DOM, so these are text-level. */

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&bull;': '•',
  '&middot;': '·',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥',
  '&deg;': '°',
  '&times;': '×',
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<h[1-6][^>]*>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Pulls every `application/ld+json` block out of a page. Employer career
 * pages usually publish their openings as schema.org `JobPosting`, which is
 * the same structured data the search engines read.
 */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = []
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  let match = pattern.exec(html)
  while (match !== null) {
    const raw = match[1].trim()
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else blocks.push(parsed)
    } catch {
      // A malformed block is not fatal; the page may have others.
    }
    match = pattern.exec(html)
  }

  return blocks
}

/** Finds the first node of a given schema.org type, anywhere in a graph. */
export function findJsonLdType(node: unknown, type: string): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findJsonLdType(entry, type)
      if (found) return found
    }
    return null
  }

  const record = node as Record<string, unknown>
  const types = record['@type']
  const list = Array.isArray(types) ? types : [types]
  if (list.some((entry) => String(entry).toLowerCase() === type.toLowerCase())) {
    return record
  }

  const graph = record['@graph']
  if (graph) {
    const found = findJsonLdType(graph, type)
    if (found) return found
  }

  return null
}

export function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.name === 'string') return record.name.trim()
    if (typeof record.value === 'string') return record.value.trim()
  }
  return ''
}
