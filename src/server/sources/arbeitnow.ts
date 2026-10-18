import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'
import { stripHtml } from './html'

const ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api'

interface ArbeitnowPosting {
  slug?: string
  company_name?: string
  title?: string
  description?: string
  remote?: boolean
  url?: string
  tags?: string[]
  job_types?: string[]
  location?: string
  created_at?: number
}

/**
 * Arbeitnow publishes a job board API intended for job boards. It needs no
 * key and returns HTML inside the description, which is stripped here.
 */
export const arbeitnow: SourceParser = {
  id: 'arbeitnow',
  name: 'Arbeitnow Job Board API',
  kind: 'api',
  homepage: 'https://www.arbeitnow.com',
  attribution: 'Jobs via the Arbeitnow Job Board API.',
  verification: 'unverified',
  verificationReason: 'a public job board that aggregates employer listings',

  async fetchPostings(source, fetchImpl = fetch) {
    let payload: { data?: ArbeitnowPosting[] }
    try {
      const response = await fetchImpl(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new SourceError(`Arbeitnow responded with ${response.status}`, source.id)
      }
      payload = (await response.json()) as { data?: ArbeitnowPosting[] }
    } catch (error) {
      if (error instanceof SourceError) throw error
      throw new SourceError(
        `Could not reach Arbeitnow: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }

    const rows = payload.data ?? []
    return rows
      .filter((row) => row.slug && row.title)
      .map(
        (row) =>
          ({
            externalId: String(row.slug),
            title: String(row.title ?? '').trim(),
            company: String(row.company_name ?? 'Unknown employer').trim(),
            description: stripHtml(String(row.description ?? '')),
            url: String(row.url ?? ''),
            location: String(row.location ?? '').trim(),
            remote: Boolean(row.remote),
            tags: (row.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
            jobType: (row.job_types ?? []).join(', '),
            publishedAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : null,
            validThrough: null,
            closed: false,
            salary: null,
          }) satisfies RawPosting,
      )
  },
}
