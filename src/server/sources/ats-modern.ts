import type { RawPosting, RawSalary, SourceParser, SourceRef } from './types'
import { SourceError } from './types'
import { stripHtml } from './html'

/**
 * Modern ATS platforms (Prompt 16): Teamtailor, Personio and Breezy each
 * publish employer career pages with a public listing endpoint. One parser
 * per platform covers many employers. Postings read straight from the
 * employer's own board are employer-verified.
 *
 * Endpoints used (public, documented by each platform):
 * - Teamtailor: https://<sub>.teamtailor.com/jobs (JobPosting JSON-LD in page)
 * - Personio:   https://<sub>.jobs.personio.de/xml (public XML feed)
 * - Breezy:     https://<sub>.breezy.hr/json (public JSON listing)
 */

const EMPTY_SALARY: RawSalary = { min: null, max: null, currency: null, period: 'unknown' }

function parseSalaryValue(value: unknown): RawSalary {
  if (!value || typeof value !== 'object') return EMPTY_SALARY
  const salary = value as { currency?: unknown; value?: unknown; unitText?: unknown }
  const base =
    salary.value && typeof salary.value === 'object'
      ? (salary.value as Record<string, unknown>)
      : {}
  const min =
    typeof base.minValue === 'number'
      ? base.minValue
      : typeof base.value === 'number'
        ? base.value
        : null
  const max =
    typeof base.maxValue === 'number'
      ? base.maxValue
      : typeof base.value === 'number'
        ? base.value
        : null
  const currency = typeof salary.currency === 'string' ? salary.currency : null
  const unit = typeof salary.unitText === 'string' ? salary.unitText.toLowerCase() : ''
  const period = unit.startsWith('year')
    ? 'year'
    : unit.startsWith('month')
      ? 'month'
      : unit.startsWith('hour')
        ? 'hour'
        : 'unknown'
  return { min, max, currency, period }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Extracts every JobPosting block from a page's JSON-LD script tags. */
export function parseJsonLdPostings(page: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  const scriptPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = scriptPattern.exec(page)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const type = record['@type']
        const isJob = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))
        if (isJob) blocks.push(record)
      }
    } catch {
      // A malformed block never stops the rest of the page being read.
    }
  }
  return blocks
}

function postingFromJsonLd(record: Record<string, unknown>, source: SourceRef): RawPosting {
  const location = record.jobLocation as Record<string, unknown> | undefined
  const address = (location?.address ?? {}) as Record<string, unknown>
  const locationText = [
    textOf(address.addressLocality),
    textOf(address.addressRegion),
    textOf(address.addressCountry),
  ]
    .filter(Boolean)
    .join(', ')
  const country = textOf(address.addressCountry)
  return {
    externalId:
      textOf(record.identifier) ||
      textOf(record['@id']) ||
      textOf(record.url) ||
      textOf(record.title),
    title: textOf(record.title),
    company:
      textOf((record.hiringOrganization as Record<string, unknown> | undefined)?.name) ||
      (typeof source.options.company === 'string' ? source.options.company : ''),
    description: stripHtml(textOf(record.description)),
    url: textOf(record.url),
    location: locationText,
    remote:
      /remote|anywhere/i.test(locationText) || textOf(record.jobLocationType) === 'TELECOMMUTE',
    tags: [],
    jobType: textOf(record.employmentType).toLowerCase() || 'full_time',
    publishedAt: textOf(record.datePosted) || null,
    validThrough: textOf(record.validThrough) || null,
    closed: false,
    salary: parseSalaryValue(record.baseSalary),
    ...(country ? { country } : {}),
  }
}

export const teamtailor: SourceParser = {
  id: 'teamtailor',
  name: 'Teamtailor career page',
  kind: 'ats',
  platform: 'teamtailor',
  homepage: 'https://www.teamtailor.com',
  attribution: "Jobs via the employer's own Teamtailor career page.",
  verification: 'verified',
  verificationReason: "the employer's own Teamtailor career page",
  async fetchPostings(source, fetchImpl = fetch) {
    const subdomain = source.options.subdomain
    if (typeof subdomain !== 'string' || !subdomain.trim()) {
      throw new SourceError('This source has no subdomain configured', source.id)
    }
    const url = `https://${subdomain.trim()}.teamtailor.com/jobs`
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { accept: 'text/html' } })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }
    if (!response.ok) throw new SourceError(`${url} responded with ${response.status}`, source.id)
    const page = await response.text()
    return parseJsonLdPostings(page).map((record) => postingFromJsonLd(record, source))
  },
}

function xmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return match ? match[1].trim() : ''
}

export const personio: SourceParser = {
  id: 'personio',
  name: 'Personio job feed',
  kind: 'ats',
  platform: 'personio',
  homepage: 'https://www.personio.com',
  attribution: "Jobs via the employer's own Personio feed.",
  verification: 'verified',
  verificationReason: "the employer's own Personio feed",
  async fetchPostings(source, fetchImpl = fetch) {
    const url =
      typeof source.options.xmlUrl === 'string' ? source.options.xmlUrl : source.listingUrl
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/xml,text/xml' } })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }
    if (!response.ok) throw new SourceError(`${url} responded with ${response.status}`, source.id)
    const xml = await response.text()
    const blocks = xml.split(/<position[\s>]/i).slice(1)
    return blocks.map((block) => {
      const descriptions = /<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/i.exec(block)
      const description = descriptions
        ? Array.from(descriptions[1].matchAll(/<value>([\s\S]*?)<\/value>/gi))
            .map((entry) => stripHtml(entry[1]))
            .join('\n')
        : stripHtml(xmlTag(block, 'jobDescription'))
      const name = xmlTag(block, 'name')
      const id = xmlTag(block, 'id') || name
      return {
        externalId: id,
        title: name,
        company: typeof source.options.company === 'string' ? source.options.company : '',
        description,
        url: `https://app.personio.com/job/${id}`,
        location: xmlTag(block, 'office'),
        remote: /remote/i.test(xmlTag(block, 'office')),
        tags: [],
        jobType: xmlTag(block, 'employmentType').toLowerCase() || 'full_time',
        publishedAt: xmlTag(block, 'createdAt') || null,
        validThrough: null,
        closed: false,
        salary: EMPTY_SALARY,
      } satisfies RawPosting
    })
  },
}

interface BreezyPosition {
  id?: string
  name?: string
  description?: string
  location?: { name?: string }
  url?: string
  apply_url?: string
  published_date?: string | number
  tags?: Array<{ name?: string }>
  type?: string
  salary?: { min?: number; max?: number; currency?: string }
}

export const breezy: SourceParser = {
  id: 'breezy',
  name: 'Breezy career page',
  kind: 'ats',
  platform: 'breezy',
  homepage: 'https://breezy.hr',
  attribution: "Jobs via the employer's own Breezy career page.",
  verification: 'verified',
  verificationReason: "the employer's own Breezy career page",
  async fetchPostings(source, fetchImpl = fetch) {
    const subdomain = source.options.subdomain
    if (typeof subdomain !== 'string' || !subdomain.trim()) {
      throw new SourceError('This source has no subdomain configured', source.id)
    }
    const url = `https://${subdomain.trim()}.breezy.hr/json`
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }
    if (!response.ok) throw new SourceError(`${url} responded with ${response.status}`, source.id)
    const payload = (await response.json()) as BreezyPosition[]
    if (!Array.isArray(payload)) throw new SourceError(`${url} did not return a list`, source.id)
    return payload.map((position) => ({
      externalId: String(position.id ?? position.name ?? ''),
      title: position.name ?? '',
      company: typeof source.options.company === 'string' ? source.options.company : '',
      description: stripHtml(position.description ?? ''),
      url: position.url ?? `https://${subdomain.trim()}.breezy.hr/p/${position.id}`,
      applyUrl: position.apply_url,
      location: position.location?.name ?? '',
      remote: /remote|anywhere/i.test(position.location?.name ?? ''),
      tags: (position.tags ?? []).map((tag) => tag.name ?? '').filter(Boolean),
      jobType: (position.type ?? 'full_time').toLowerCase(),
      publishedAt: position.published_date ? String(position.published_date) : null,
      validThrough: null,
      closed: false,
      salary: position.salary
        ? {
            min: position.salary.min ?? null,
            max: position.salary.max ?? null,
            currency: position.salary.currency ?? null,
            period: 'year',
          }
        : EMPTY_SALARY,
    }))
  },
}
