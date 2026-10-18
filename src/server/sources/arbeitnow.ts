import type { RawPosting, SourceAdapter } from './types'
import { SourceError } from './types'

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
export const arbeitnow: SourceAdapter = {
  id: 'arbeitnow',
  name: 'Arbeitnow Job Board API',
  homepage: 'https://www.arbeitnow.com',
  attribution: 'Jobs via the Arbeitnow Job Board API.',

  async fetchPostings(fetchImpl: typeof fetch = fetch): Promise<RawPosting[]> {
    let payload: { data?: ArbeitnowPosting[] }
    try {
      const response = await fetchImpl(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new SourceError(`Arbeitnow responded with ${response.status}`, 'arbeitnow')
      }
      payload = (await response.json()) as { data?: ArbeitnowPosting[] }
    } catch (error) {
      if (error instanceof SourceError) throw error
      throw new SourceError(
        `Could not reach Arbeitnow: ${error instanceof Error ? error.message : String(error)}`,
        'arbeitnow',
      )
    }

    const rows = payload.data ?? []
    return rows
      .filter((row) => row.slug && row.title)
      .map((row) => ({
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
        salary: null,
      }))
  },
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
