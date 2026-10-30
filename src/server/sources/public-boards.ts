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

/**
 * Himalayas returns { jobs: [...] } with cursor pagination (offset is
 * deprecated by the publisher). Items key on `guid` (the canonical job URL);
 * an earlier version of this adapter read `id`/`url` fields the API does not
 * send, so every item was skipped and the source silently yielded nothing.
 */
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
    // Small pages: each item carries a full description, so a 100-item page
    // is a multi-MB response that risks fetch timeouts; 25-item pages stay
    // light. 40 pages bounds one refresh at 1,000 postings (each also costs
    // a detail write downstream).
    const pageSize = 25
    const maxPages = 40
    const seen = new Set<string>()
    const postings: RawPosting[] = []
    let cursor: string | null = null
    for (let page = 0; page < maxPages; page += 1) {
      const url = cursor
        ? `${source.listingUrl}?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`
        : `${source.listingUrl}?limit=${pageSize}`
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        if (page === 0) throw new Error(`himalayas returned ${response.status}`)
        break
      }
      const body = (await response.json()) as {
        jobs?: Record<string, unknown>[]
        nextCursor?: string | null
      }
      const jobs = body.jobs ?? []
      let fresh = 0
      for (const item of jobs) {
        const guid = String(item.guid ?? item.applicationLink ?? '')
        const id = guid || String(item.id ?? item.slug ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        fresh += 1
        const restrictions = Array.isArray(item.locationRestrictions)
          ? item.locationRestrictions.map(String).filter(Boolean)
          : []
        const location = restrictions.length > 0 ? restrictions.join(', ') : 'Remote'
        const min = typeof item.minSalary === 'number' ? item.minSalary : null
        const max = typeof item.maxSalary === 'number' ? item.maxSalary : null
        const epoch = (value: unknown): string | null =>
          typeof value === 'number' && value > 0 ? new Date(value * 1000).toISOString() : null
        postings.push(
          posting(
            id,
            String(item.title ?? ''),
            String(item.companyName ?? item.company ?? 'Employer not stated'),
            guid || `https://himalayas.app/jobs/${String(item.slug ?? '')}`,
            location,
            String(item.description ?? ''),
            {
              remote: true,
              applyUrl: typeof item.applicationLink === 'string' ? item.applicationLink : undefined,
              publishedAt: epoch(item.pubDate),
              validThrough: epoch(item.expiryDate),
              jobType: String(item.employmentType ?? ''),
              tags: [
                ...(Array.isArray(item.categories) ? item.categories.map(String) : []),
                ...(Array.isArray(item.seniority) ? item.seniority.map(String) : []),
              ],
              salary:
                (min ?? max) !== null && typeof item.currency === 'string' && item.currency
                  ? {
                      min,
                      max,
                      currency: item.currency,
                      period: item.salaryPeriod === 'monthly' ? 'month' : 'year',
                    }
                  : null,
            },
          ),
        )
      }
      cursor = typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null
      // Follow the cursor, not the requested size: the publisher may serve
      // fewer items per page than asked (it caps at 20), and treating that
      // as the last page once cut this source to a single page of 20.
      if (!cursor || jobs.length === 0 || fresh === 0) break
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
export const workable = jsonBoard('workable', 'workable', (body) => {
  // The widget payload is { name: <employer>, jobs: [...] }; each job carries
  // a `locations` array plus flat city/state/country fields — there is no
  // per-job `company` or `location` object, which an earlier mapping assumed.
  const employer = String((body as { name?: unknown }).name ?? '')
  return ((body as { jobs?: Record<string, unknown>[] }).jobs ?? []).map((item) => {
    const first = Array.isArray(item.locations)
      ? (item.locations[0] as { city?: string; region?: string; country?: string } | undefined)
      : undefined
    const location = [first?.city, first?.region, first?.country].filter(Boolean).join(', ')
    const flat = [item.city, item.state, item.country].filter(Boolean).join(', ')
    return posting(
      String(item.shortcode ?? item.id ?? item.url),
      String(item.title ?? ''),
      String(item.company ?? '') || employer || 'Employer not stated',
      String(item.url ?? `https://apply.workable.com/jobs/${String(item.shortcode ?? '')}`),
      location || flat,
      String(item.description ?? ''),
      {
        remote: item.telecommuting === true,
        applyUrl: typeof item.application_url === 'string' ? item.application_url : undefined,
        publishedAt: typeof item.published_on === 'string' ? item.published_on : null,
        jobType: String(item.employment_type ?? ''),
      },
    )
  })
})

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
