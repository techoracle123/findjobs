import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'
import { stripHtml } from './html'

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

interface ArbeitnowPage {
  data?: ArbeitnowPosting[]
  links?: { next?: string | null }
  meta?: { current_page?: number; last_page?: number }
}

/** Pages are newest-first; 25 pages covers the freshest ~2,500 per locale. */
const MAX_PAGES = 25

/**
 * Arbeitnow publishes a job board API intended for job boards. It needs no
 * key and returns HTML inside the description, which is stripped here.
 * The endpoint is paginated (`?page=N`, Laravel-style links/meta); walking
 * the pages is the difference between ~100 postings and a few thousand.
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
    const base = source.listingUrl || 'https://www.arbeitnow.com/api/job-board-api'
    const seen = new Set<string>()
    const postings: RawPosting[] = []

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = page === 1 ? base : `${base}?page=${page}`
      let payload: ArbeitnowPage
      try {
        const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (page === 1)
            throw new SourceError(`Arbeitnow responded with ${response.status}`, source.id)
          break
        }
        payload = (await response.json()) as ArbeitnowPage
      } catch (error) {
        if (page === 1) {
          if (error instanceof SourceError) throw error
          throw new SourceError(
            `Could not reach Arbeitnow: ${error instanceof Error ? error.message : String(error)}`,
            source.id,
          )
        }
        break
      }

      const rows = (payload.data ?? []).filter((row) => row.slug && row.title)
      let fresh = 0
      for (const row of rows) {
        const slug = String(row.slug)
        if (seen.has(slug)) continue
        seen.add(slug)
        fresh += 1
        postings.push({
          externalId: slug,
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
        } satisfies RawPosting)
      }

      // Stop when the API says there is no next page, when a page is empty,
      // or when a page only repeats what we already have (defensive: a
      // fixture or mirror that ignores ?page= must not loop 25 times).
      const lastPage = payload.meta?.last_page
      if (!rows.length || fresh === 0) break
      if (typeof lastPage === 'number' && page >= lastPage) break
      if (payload.links && !payload.links.next) break
      if (!payload.links && !payload.meta) break // single-page payload
    }

    return postings
  },
}
