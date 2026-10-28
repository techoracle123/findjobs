/** Small HTML helpers. The Workers runtime has no DOM, so these are text-level. */

import { decodeHTML } from 'entities'

export function decodeEntities(input: string): string {
  return decodeHTML(input)
}

/** Plain text only, including HTML that a feed encoded more than once. */
export function stripHtml(input: string): string {
  let text = String(input ?? '')
  for (let pass = 0; pass < 4; pass++) {
    const decoded = decodeEntities(text)
    text = decoded
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|h[1-6]|ul|ol|table|tr)>/gi, '\n\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
    if (!/&(?:amp|lt|gt|#\d+|#x[0-9a-f]+);/i.test(text)) break
  }
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanJobText(input: string): string {
  return stripHtml(input)
    .split('\n')
    .filter(
      (line) =>
        !/^find more .*(?:jobs|opportunities).*on\s+(?:arbeitnow|remotive)\b/i.test(line.trim()),
    )
    .join('\n')
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
