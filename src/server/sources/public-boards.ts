import type { RawPosting, SourceParser, SourceRef } from './types'
import { stripHtml } from './html'

/**
 * Public job-board adapters. One parser per response shape; adding a company
 * or board is a one-line registry entry in seed.ts. Every adapter obeys the
 * same contract: return raw postings, never invent fields.
 */

function posting(
  externalId: string,
  title: string,
  company: string,
  url: string,
  location: string,
  description: string,
  extra: Partial<RawPosting> = {},
): RawPosting {
  return {
    externalId,
    title,
    company,
    description,
    url,
    location,
    remote: /remote/i.test(location) || /remote/i.test(title),
    tags: [],
    jobType: '',
    publishedAt: null,
    validThrough: null,
    closed: false,
    salary: null,
    ...extra,
  }
}

const jsonBoard = (
  id: string,
  platform: string,
  parse: (body: unknown) => RawPosting[],
  name = id,
): SourceParser => ({
  id,
  name,
  kind: 'api',
  platform,
  homepage: 'https://fj-find-jobs.pages.dev',
  attribution: `${name} public job feed`,
  verification: 'unverified',
  verificationReason: 'A public opportunity; verify with the employer.',
  async fetchPostings(source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const response = await fetchImpl(source.listingUrl, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`${id} returned ${response.status}`)
    return parse(await response.json())
  },
})

/** RemoteOK publishes a JSON array; the first element is metadata. */
export const remoteok = jsonBoard('remoteok', 'remoteok', (body) =>
  (Array.isArray(body) ? body : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.position === 'string')
    .map((item) =>
      posting(
        String(item.id ?? item.url),
        String(item.position),
        String(item.company ?? 'Employer not stated'),
        String(item.url),
        String(item.location ?? 'Remote'),
        String(item.description ?? ''),
        {
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
          publishedAt: typeof item.date === 'string' ? item.date : null,
          remote: true,
        },
      ),
    ),
)

/** Himalayas returns { jobs: [...] } and paginates with limit/offset. */
export const himalayas: SourceParser = {
  id: 'himalayas',
  name: 'Himalayas',
  kind: 'api',
  platform: 'himalayas',
  homepage: 'https://himalayas.app',
  attribution: 'Himalayas public job feed',
  verification: 'unverified',
  verificationReason: 'A public opportunity; verify with the employer.',
  async fetchPostings(source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const pageSize = 100
    const seen = new Set<string>()
    const postings: RawPosting[] = []
    for (let page = 0; page < 10; page += 1) {
      const url = `${source.listingUrl}?limit=${pageSize}&offset=${page * pageSize}`
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        if (page === 0) throw new Error(`himalayas returned ${response.status}`)
        break
      }
      const body = (await response.json()) as { jobs?: Record<string, unknown>[] }
      const jobs = body.jobs ?? []
      let fresh = 0
      for (const item of jobs) {
        const id = String(item.id ?? item.url ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        fresh += 1
        postings.push(
          posting(
            id,
            String(item.title ?? ''),
            String(item.companyName ?? item.company ?? 'Employer not stated'),
            `https://himalayas.app/jobs/${String(item.slug ?? item.id ?? '')}`,
            [item.location, item.countries].flat().filter(Boolean).join(', ') || 'Remote',
            String(item.description ?? ''),
            { remote: true },
          ),
        )
      }
      if (jobs.length < pageSize || fresh === 0) break
    }
    return postings
  },
}

/**
 * The Muse public jobs API: 20 results per page, `page` is zero-based.
 * Contents arrive as HTML and are stripped to text like every other source.
 */
export const themuse: SourceParser = {
  id: 'themuse',
  name: 'The Muse',
  kind: 'api',
  platform: 'themuse',
  homepage: 'https://www.themuse.com',
  attribution: 'The Muse public jobs feed',
  verification: 'unverified',
  verificationReason: 'A public opportunity; verify with the employer.',
  async fetchPostings(source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const seen = new Set<string>()
    const postings: RawPosting[] = []
    for (let page = 0; page < 25; page += 1) {
      const base = source.listingUrl || 'https://www.themuse.com/api/public/jobs'
      const response = await fetchImpl(`${base}?page=${page}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        if (page === 0) throw new Error(`themuse returned ${response.status}`)
        break
      }
      const body = (await response.json()) as {
        results?: Record<string, unknown>[]
        page_count?: number
      }
      const results = body.results ?? []
      let fresh = 0
      for (const item of results) {
        const id = String(item.id ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        fresh += 1
        const company = (item.company ?? {}) as { name?: string }
        const refs = (item.refs ?? {}) as { landing_page?: string }
        const locations = Array.isArray(item.locations)
          ? (item.locations as { name?: string }[])
              .map((loc) => loc.name)
              .filter(Boolean)
              .join(', ')
          : ''
        postings.push(
          posting(
            id,
            String(item.name ?? ''),
            String(company.name ?? 'Employer not stated'),
            String(refs.landing_page ?? ''),
            locations,
            stripHtml(String(item.contents ?? '')),
            {
              publishedAt: typeof item.publication_date === 'string' ? item.publication_date : null,
              remote: /flexible|remote/i.test(locations),
            },
          ),
        )
      }
      if (!results.length || fresh === 0) break
      if (typeof body.page_count === 'number' && page + 1 >= body.page_count) break
    }
    return postings
  },
}

/** Working Nomads exposes [{...}] with url/title/company. */
export const workingNomads = jsonBoard('workingnomads', 'workingnomads', (body) =>
  (Array.isArray(body) ? body : []).map((item: Record<string, unknown>) =>
    posting(
      String(item.id ?? item.url),
      String(item.title ?? ''),
      String(item.company ?? 'Employer not stated'),
      String(item.url),
      String(item.location ?? 'Remote'),
      String(item.description ?? ''),
      { publishedAt: typeof item.date === 'string' ? item.date : null, remote: true },
    ),
  ),
)

/** Jobicy returns { jobs: [...] } with geo and compensation fields. */
export const jobicy = jsonBoard('jobicy', 'jobicy', (body) =>
  ((body as { jobs?: Record<string, unknown>[] }).jobs ?? []).map((item) =>
    posting(
      String(item.id ?? item.url),
      String(item.jobTitle ?? item.title ?? ''),
      String(item.companyName ?? 'Employer not stated'),
      String(item.url),
      String(item.jobGeo ?? item.location ?? 'Remote'),
      String(item.jobDescription ?? item.description ?? ''),
      {
        tags: Array.isArray(item.jobIndustry) ? item.jobIndustry.map(String) : [],
        remote: true,
      },
    ),
  ),
)

/** Workable: { jobs: [{ shortcode, title, company, url, location, description }] }. */
export const workable = jsonBoard('workable', 'workable', (body) =>
  ((body as { jobs?: Record<string, unknown>[] }).jobs ?? []).map((item) =>
    posting(
      String(item.shortcode ?? item.id ?? item.url),
      String(item.title ?? ''),
      String(item.company ?? (item.department as string) ?? 'Employer not stated'),
      String(item.url ?? `https://apply.workable.com/jobs/${String(item.shortcode ?? '')}`),
      typeof item.location === 'object' && item.location !== null
        ? String((item.location as { city?: string; country?: string }).city ?? '') ||
            String((item.location as { country?: string }).country ?? '')
        : String(item.location ?? ''),
      String(item.description ?? ''),
    ),
  ),
)

/**
 * Hacker News "Who is hiring": top-level comments follow the community
 * convention "Company | Role | Location | ...". Only comments that fit the
 * pattern become postings; everything else is a discussion, not a job.
 */
export const hnHiring: SourceParser = {
  id: 'hn-hiring',
  name: 'Hacker News — Who is hiring',
  kind: 'api',
  platform: 'hackernews',
  homepage: 'https://news.ycombinator.com',
  attribution: 'Hacker News “Who is hiring?” community thread',
  verification: 'unverified',
  verificationReason: 'A public community posting; verify with the employer.',
  async fetchPostings(_source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const search = await fetchImpl(
      'https://hn.algolia.com/api/v1/search?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story,author_whoishiring&hitsPerPage=3',
      { headers: { accept: 'application/json' } },
    )
    if (!search.ok) throw new Error(`hn-hiring search returned ${search.status}`)
    const stories = (await search.json()) as { hits?: { objectID: string; title: string }[] }
    const story = stories.hits?.find((hit) => /who is hiring/i.test(hit.title))
    if (!story) return []
    const thread = await fetchImpl(`https://hn.algolia.com/api/v1/items/${story.objectID}`, {
      headers: { accept: 'application/json' },
    })
    if (!thread.ok) throw new Error(`hn-hiring thread returned ${thread.status}`)
    const item = (await thread.json()) as {
      children?: { id: number; text?: string; children?: unknown[] }[]
    }
    const postings: RawPosting[] = []
    for (const comment of item.children ?? []) {
      const text = String(comment.text ?? '')
        .replace(/&#x2F;/g, '/')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, ' ')
      const parts = text.split('|').map((part) => part.trim())
      if (parts.length < 2 || !parts[0] || !parts[1]) continue
      if (text.length > 4000) continue
      postings.push(
        posting(
          `hn-${comment.id}`,
          parts[1].slice(0, 160),
          parts[0].slice(0, 120),
          `https://news.ycombinator.com/item?id=${comment.id}`,
          parts[2] ? parts[2].slice(0, 120) : 'Remote',
          text.slice(0, 12000),
          { remote: /remote/i.test(text) },
        ),
      )
      if (postings.length >= 250) break
    }
    return postings
  },
}

export const PUBLIC_BOARD_PARSERS: SourceParser[] = [
  remoteok,
  himalayas,
  themuse,
  workingNomads,
  jobicy,
  workable,
  hnHiring,
]
