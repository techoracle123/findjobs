import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'
import { stripHtml } from './html'

const ENDPOINT = 'https://remotive.com/api/remote-jobs'

interface RemotivePosting {
  id?: number | string
  url?: string
  title?: string
  company_name?: string
  category?: string
  tags?: string[]
  job_type?: string
  publication_date?: number | string
  candidate_required_location?: string
  salary?: string
  description?: string
}

/**
 * Remotive publishes a public API of remote jobs. It needs no key and asks
 * that the source is credited, which the attribution field carries.
 */
export const remotive: SourceParser = {
  id: 'remotive',
  name: 'Remotive API',
  kind: 'api',
  homepage: 'https://remotive.com',
  attribution: 'Jobs via the Remotive API.',
  verification: 'unverified',
  verificationReason: 'a public job board that aggregates employer listings',

  async fetchPostings(source, fetchImpl = fetch) {
    let payload: { jobs?: RemotivePosting[] }
    try {
      const response = await fetchImpl(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new SourceError(`Remotive responded with ${response.status}`, source.id)
      }
      payload = (await response.json()) as { jobs?: RemotivePosting[] }
    } catch (error) {
      if (error instanceof SourceError) throw error
      throw new SourceError(
        `Could not reach Remotive: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }

    const rows = payload.jobs ?? []
    return rows
      .filter((row) => row.id !== undefined && row.title)
      .map(
        (row) =>
          ({
            externalId: String(row.id),
            title: String(row.title ?? '').trim(),
            company: String(row.company_name ?? 'Unknown employer').trim(),
            description: stripHtml(String(row.description ?? '')),
            url: String(row.url ?? ''),
            location: String(row.candidate_required_location ?? '').trim(),
            remote: true,
            tags: [row.category, ...(row.tags ?? [])]
              .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
              .map((tag) => tag.trim()),
            jobType: String(row.job_type ?? ''),
            publishedAt: publicationDate(row.publication_date),
            validThrough: null,
            closed: false,
            salary: parseRemotiveSalary(row.salary),
          }) satisfies RawPosting,
      )
  },
}

/**
 * Remotive publishes salary as free text, e.g. "$50k - $70k". The currency
 * and period are only recorded when they are stated plainly.
 */
export function parseRemotiveSalary(raw: string | undefined): RawPosting['salary'] {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  const currency = /€|EUR/i.test(text)
    ? 'EUR'
    : /£|GBP/i.test(text)
      ? 'GBP'
      : /\$|USD/i.test(text)
        ? 'USD'
        : null

  const period = /hour|hr|hourly/i.test(text)
    ? 'hour'
    : /month|monthly|mo\b/i.test(text)
      ? 'month'
      : 'year'

  const numbers = [...text.matchAll(/(\d[\d.,]*)\s*(k)?/g)]
    .map((match) => {
      const digits = match[1].replace(/,/g, '')
      const value = Number.parseFloat(digits)
      if (Number.isNaN(value)) return null
      return match[2] ? value * 1000 : value
    })
    .filter((value): value is number => value !== null && value > 0)

  if (numbers.length === 0) return null

  return {
    min: numbers[0],
    max: numbers.length > 1 ? numbers[1] : numbers[0],
    currency,
    period,
  }
}

export function publicationDate(value: number | string | undefined): string | null {
  if (!value) return null
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
