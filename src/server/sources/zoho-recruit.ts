import { countryName } from '../../shared/countries'
import { decodeEntities, extractJsonLd, findJsonLdType, stripHtml, textOf } from './html'
import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'

/**
 * Public Zoho Recruit career sites.
 *
 * Zoho keeps filled roles on some employer pages, clearly marked as filled,
 * and keeps an old closing date on others. This reader therefore checks the
 * listing status, fetches each remaining advert, and drops anything closed or
 * past its stated closing date. Every application stays on Zoho.
 */

interface ZohoCandidate {
  id: string
  url: string
  title: string
  locationHint: string
}

async function readText(url: string, sourceId: string, fetchImpl: typeof fetch): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'text/html,application/xhtml+xml' } })
  } catch (error) {
    throw new SourceError(
      `Could not reach the careers page: ${error instanceof Error ? error.message : String(error)}`,
      sourceId,
    )
  }
  if (!response.ok) {
    throw new SourceError(`The careers page responded with ${response.status}`, sourceId)
  }
  return response.text()
}

function isClosedText(value: string): boolean {
  return /position filled|no longer accepting applications|applications? (?:are )?closed|this job (?:is|has) closed|job (?:has )?expired/i.test(
    value,
  )
}

function extractCandidates(html: string, pageUrl: string): ZohoCandidate[] {
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
  const matches: Array<{ index: number; href: string; title: string; id: string; url: string }> = []
  let match = anchorPattern.exec(html)
  while (match !== null) {
    const href = decodeEntities(match[2] ?? '')
    let url: URL
    try {
      url = new URL(href, pageUrl)
    } catch {
      match = anchorPattern.exec(html)
      continue
    }
    const modern = url.pathname.match(/^\/jobs\/[^/]+\/(\d+)\/([^/?#]+)/i)
    const legacyId = url.searchParams.get('jobid') ?? url.searchParams.get('jobId') ?? ''
    const legacy = /ViewJob\.na$/i.test(url.pathname) && legacyId
    const id = modern?.[1] ?? (legacy ? legacyId : '')
    const title = stripHtml(match[3] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (id && title && !/^(apply|view|view job|learn more)$/i.test(title)) {
      matches.push({ index: match.index, href, title, id, url: url.href })
    }
    match = anchorPattern.exec(html)
  }

  const candidates: ZohoCandidate[] = []
  const seen = new Set<string>()
  matches.forEach((candidate, index) => {
    if (seen.has(candidate.id)) return
    const end = matches[index + 1]?.index ?? Math.min(html.length, candidate.index + 5000)
    const chunkText = stripHtml(html.slice(candidate.index, Math.min(end, candidate.index + 5000)))
    if (isClosedText(chunkText)) return
    seen.add(candidate.id)
    const lines = chunkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const locationHint =
      lines.find(
        (line) =>
          line !== candidate.title &&
          line.length <= 100 &&
          /,/.test(line) &&
          !/posted|closing|department|experience/i.test(line),
      ) ?? ''
    candidates.push({
      id: candidate.id,
      url: candidate.url,
      title: candidate.title,
      locationHint,
    })
  })
  return candidates
}

function parseDate(value: string, endOfDay = false): string | null {
  const clean = value
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const numeric = clean.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    const year = Number(numeric[3])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(
        Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0),
      )
      return date.toISOString()
    }
  }
  const parsed = Date.parse(clean)
  if (!Number.isFinite(parsed)) return null
  const date = new Date(parsed)
  if (endOfDay && !/\d{1,2}:\d{2}/.test(clean)) date.setUTCHours(23, 59, 59, 0)
  return date.toISOString()
}

function dateAfterLabel(text: string, labels: string[], endOfDay = false): string | null {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^0-9A-Za-z]{0,20}([^\\n]{4,50})`, 'i')
    const value = text.match(pattern)?.[1]
    if (value) {
      const parsed = parseDate(value, endOfDay)
      if (parsed) return parsed
    }
  }
  return null
}

function labeledValue(text: string, labels: string[]): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(new RegExp(`^${label}\\s*:?\\s*(.*)$`, 'i'))
      if (!match) continue
      if (match[1]?.trim()) return match[1].trim()
      const next = lines[index + 1] ?? ''
      if (
        next &&
        !/^(job type|department|industry|city|province|state|country|experience)$/i.test(next)
      ) {
        return next
      }
    }
  }
  return ''
}

function jsonLdLocation(posting: Record<string, unknown> | null): string {
  const location = posting?.jobLocation
  const first = Array.isArray(location) ? location[0] : location
  if (!first || typeof first !== 'object') return textOf(first)
  const address = (first as Record<string, unknown>).address
  if (!address || typeof address !== 'object') return textOf(first)
  const record = address as Record<string, unknown>
  return [record.addressLocality, record.addressRegion, record.addressCountry]
    .map((value) => textOf(value))
    .filter(Boolean)
    .join(', ')
}

function descriptionFrom(text: string, posting: Record<string, unknown> | null): string {
  const structured = stripHtml(typeof posting?.description === 'string' ? posting.description : '')
  if (structured.length >= 80) return structured
  const start = text.search(/job description/i)
  if (start < 0) return text.slice(0, 12000).trim()
  let segment = text.slice(start).replace(/^job description\s*:?/i, '')
  const endMarkers = [
    segment.search(/\{\{criteriaIndex\}\}/),
    segment.search(/\bjob information\b/i),
    segment.search(/\bsimilar jobs\b/i),
    segment.search(/\bshare this job\b/i),
  ].filter((index) => index > 100)
  if (endMarkers.length) segment = segment.slice(0, Math.min(...endMarkers))
  return segment.trim().slice(0, 30000)
}

function parseDetail(
  html: string,
  candidate: ZohoCandidate,
  options: Record<string, unknown>,
): RawPosting | null {
  const posting = findJsonLdType(extractJsonLd(html), 'JobPosting')
  const text = stripHtml(html)
  const h1 = stripHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const title = (typeof posting?.title === 'string' ? posting.title : h1 || candidate.title).trim()
  if (!title) return null
  if (posting && posting.validThrough && Date.parse(String(posting.validThrough)) < Date.now()) {
    return null
  }

  const closeDate =
    dateAfterLabel(
      text,
      ['Close Date', 'Closing Date', 'Application Deadline', 'Deadline'],
      true,
    ) ?? (posting?.validThrough ? parseDate(String(posting.validThrough), true) : null)
  if (closeDate && Date.parse(closeDate) < Date.now()) return null

  // The first part of a detail page is the visible advert. Later client-side
  // templates can contain words for states that are not being shown, so do
  // not treat the whole document as visible text for a closed marker.
  const visibleStart = text.toLowerCase().indexOf(title.toLowerCase())
  const visibleText = text.slice(Math.max(0, visibleStart), Math.max(0, visibleStart) + 2500)
  if (isClosedText(visibleText)) return null

  const countryCode = typeof options.country === 'string' ? options.country.toUpperCase() : ''
  const city = labeledValue(text, ['City'])
  const region = labeledValue(text, ['Province', 'State'])
  const country = labeledValue(text, ['Country'])
  let location =
    jsonLdLocation(posting) ||
    [city, region, country].filter(Boolean).join(', ') ||
    candidate.locationHint
  if (
    countryCode.length === 2 &&
    location &&
    !location.toLowerCase().includes(countryName(countryCode).toLowerCase())
  ) {
    location = `${location}, ${countryName(countryCode)}`
  }

  const organisation = posting?.hiringOrganization
  const company =
    (typeof options.companyLabel === 'string' && options.companyLabel) ||
    textOf(organisation) ||
    (typeof options.company === 'string' ? options.company : '')
  const jobType =
    (typeof posting?.employmentType === 'string' ? posting.employmentType : '') ||
    labeledValue(text, ['Job Type', 'Employment Type'])
  const publishedAt =
    dateAfterLabel(text, ['Posted on', 'Date Opened', 'Published']) ??
    (posting?.datePosted ? parseDate(String(posting.datePosted)) : null)
  const tags = [
    labeledValue(text, ['Department']),
    labeledValue(text, ['Industry']),
    labeledValue(text, ['Work Experience', 'Experience']),
  ].filter(Boolean)

  return {
    externalId: candidate.id,
    title,
    company,
    description: descriptionFrom(text, posting),
    url: candidate.url,
    applyUrl: candidate.url,
    location,
    remote: /remote|work from home/i.test(`${title} ${location} ${jobType}`),
    tags,
    jobType,
    publishedAt,
    validThrough: closeDate,
    closed: false,
    salary: null,
  }
}

export const zohoRecruit: SourceParser = {
  id: 'zoho-recruit',
  name: 'Zoho Recruit careers page',
  kind: 'html',
  platform: 'zoho-recruit',
  homepage: 'https://www.zoho.com/recruit/',
  attribution: "Jobs read from the employer's public Zoho Recruit careers page.",
  verification: 'unverified',
  verificationReason: 'Read from a public employer careers page; check it there before applying.',

  async fetchPostings(source, fetchImpl = fetch) {
    const listingUrls = Array.isArray(source.options.listingUrls)
      ? source.options.listingUrls.filter(
          (value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value),
        )
      : []
    const pages = listingUrls.length ? listingUrls : [source.listingUrl]
    const requestedMax = Number(source.options.maxPostings ?? 50)
    const maxPostings = Number.isFinite(requestedMax)
      ? Math.min(100, Math.max(1, Math.floor(requestedMax)))
      : 50

    const candidates: ZohoCandidate[] = []
    const seen = new Set<string>()
    for (const pageUrl of pages) {
      const html = await readText(pageUrl, source.id, fetchImpl)
      for (const candidate of extractCandidates(html, pageUrl)) {
        if (seen.has(candidate.id)) continue
        seen.add(candidate.id)
        candidates.push(candidate)
        if (candidates.length >= maxPostings) break
      }
      if (candidates.length >= maxPostings) break
    }

    const postings: RawPosting[] = []
    for (let index = 0; index < candidates.length; index += 3) {
      const batch = await Promise.all(
        candidates.slice(index, index + 3).map(async (candidate) => {
          try {
            const html = await readText(candidate.url, source.id, fetchImpl)
            return parseDetail(html, candidate, source.options)
          } catch {
            return null
          }
        }),
      )
      postings.push(...batch.filter((posting): posting is RawPosting => posting !== null))
    }
    return postings
  },
}
