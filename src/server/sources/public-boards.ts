import type { RawPosting, SourceParser, SourceRef } from './types'
import { stripHtml } from './html'
import { COUNTRIES } from '../../shared/countries'

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

function numberOption(
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = options?.[key]
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

interface SearchSlice {
  params: Record<string, string>
  pages: number
}

function searchSlicesOption(options: Record<string, unknown> | undefined): SearchSlice[] {
  const raw = options?.searchSlices
  if (!Array.isArray(raw)) return []
  const slices: SearchSlice[] = []
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const rawParams =
      record.params && typeof record.params === 'object'
        ? (record.params as Record<string, unknown>)
        : record
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawParams)) {
      if (key === 'pages' || key === 'params') continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        params[key] = String(value)
    }
    if (!Object.keys(params).length) continue
    slices.push({ params, pages: numberOption(record, 'pages', 5, 1, 50) })
  }
  return slices
}

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

function himalayasSalaryPeriod(value: unknown): NonNullable<RawPosting['salary']>['period'] {
  const period = String(value ?? '').toLowerCase()
  if (period === 'hourly' || period === 'hour') return 'hour'
  if (period === 'weekly' || period === 'week') return 'week'
  if (period === 'fortnightly' || period === 'fortnight') return 'fortnight'
  if (period === 'monthly' || period === 'month') return 'month'
  if (period === 'annual' || period === 'yearly' || period === 'year') return 'year'
  return 'unknown'
}

function himalayasPosting(
  item: Record<string, unknown>,
): { id: string; posting: RawPosting } | null {
  const guid = String(item.guid ?? item.applicationLink ?? '')
  const id = guid || String(item.id ?? item.slug ?? '')
  if (!id) return null
  const restrictions = Array.isArray(item.locationRestrictions)
    ? item.locationRestrictions.map(String).filter(Boolean)
    : []
  const location = restrictions.length > 0 ? restrictions.join(', ') : 'Remote'
  const min = typeof item.minSalary === 'number' ? item.minSalary : null
  const max = typeof item.maxSalary === 'number' ? item.maxSalary : null
  const epoch = (value: unknown): string | null =>
    typeof value === 'number' && value > 0 ? new Date(value * 1000).toISOString() : null
  return {
    id,
    posting: posting(
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
                period: himalayasSalaryPeriod(item.salaryPeriod),
              }
            : null,
      },
    ),
  }
}

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
    // is a multi-MB response that risks fetch timeouts. The publisher caps a
    // page at 20. Source-specific page bounds keep one refresh finite while
    // separate search slices give skilled categories real depth.
    const pageSize = 20
    const maxPages = numberOption(source.options, 'maxPages', 40, 1, 150)
    const seen = new Set<string>()
    const postings: RawPosting[] = []

    const addJobs = (jobs: Record<string, unknown>[]): number => {
      let fresh = 0
      for (const item of jobs) {
        const mapped = himalayasPosting(item)
        if (!mapped || seen.has(mapped.id)) continue
        seen.add(mapped.id)
        fresh += 1
        postings.push(mapped.posting)
      }
      return fresh
    }

    const fetchSearch = async (
      params: Record<string, string>,
      pages: number,
      required = false,
    ): Promise<void> => {
      const origin = new URL(source.listingUrl)
      for (let page = 1; page <= pages; page += 1) {
        const url = new URL('/jobs/api/search', origin)
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
        if (!url.searchParams.has('sort')) url.searchParams.set('sort', 'recent')
        url.searchParams.set('page', String(page))
        const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (required && page === 1) throw new Error(`himalayas returned ${response.status}`)
          break
        }
        const body = (await response.json()) as {
          jobs?: Record<string, unknown>[]
          totalCount?: number
        }
        const jobs = body.jobs ?? []
        const fresh = addJobs(jobs)
        if (!jobs.length || fresh === 0 || jobs.length < 20) break
        if (typeof body.totalCount === 'number' && page * 20 >= body.totalCount) break
      }
    }

    const listing = new URL(source.listingUrl)
    if (listing.pathname.endsWith('/search')) {
      const params = Object.fromEntries(listing.searchParams.entries())
      await fetchSearch(params, numberOption(source.options, 'maxPages', 10, 1, 50), true)
      for (const slice of searchSlicesOption(source.options)) {
        try {
          await fetchSearch(slice.params, slice.pages)
        } catch {
          // One unavailable category must not discard the slices already read.
        }
      }
      return postings
    }

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
      const fresh = addJobs(jobs)
      cursor = typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null
      // Follow the cursor, not the requested size: the publisher may serve
      // fewer items per page than asked (it caps at 20), and treating that
      // as the last page once cut this source to a single page of 20.
      if (!cursor || jobs.length === 0 || fresh === 0) break
    }

    // The full recent feed can bury time-bounded work under permanent roles.
    // Himalayas' documented search endpoint lets the main source top up real
    // contractor and temporary listings without creating duplicate job IDs:
    // every result is deduped by its stable guid above. Dedicated search
    // sources in seed.ts handle the deeper WordPress, security, data, media,
    // development and teaching slices.
    try {
      if (listing.hostname.endsWith('himalayas.app') && source.id === 'himalayas') {
        for (const employmentType of ['Contractor', 'Temporary'])
          await fetchSearch({ employment_type: employmentType }, 5)

        for (const query of [
          'video editor',
          'photo editor',
          'penetration tester',
          'cybersecurity',
          'web developer',
          'data analyst',
          'WordPress',
          'tutor',
        ])
          await fetchSearch({ employment_type: 'Contractor', q: query }, 1)
      }
      for (const slice of searchSlicesOption(source.options))
        await fetchSearch(slice.params, slice.pages)
    } catch {
      // The browse feed is the source of truth; a search-top-up failure must
      // not discard hundreds of valid listings already fetched.
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
    const maxPages = numberOption(source.options, 'maxPages', 25, 1, 100)
    const maxAgeDays = numberOption(source.options, 'maxAgeDays', 0, 0, 3650)
    const oldestAllowed = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : null
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(source.listingUrl || 'https://www.themuse.com/api/public/jobs')
      url.searchParams.set('page', String(page))
      const response = await fetchImpl(url, {
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
        const publishedAt = typeof item.publication_date === 'string' ? item.publication_date : null
        if (
          oldestAllowed !== null &&
          (!publishedAt ||
            !Number.isFinite(Date.parse(publishedAt)) ||
            Date.parse(publishedAt) < oldestAllowed)
        )
          continue
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
        const namedTags = (value: unknown): string[] =>
          Array.isArray(value)
            ? value
                .map((entry) =>
                  typeof entry === 'string'
                    ? entry
                    : entry && typeof entry === 'object'
                      ? String((entry as { name?: unknown }).name ?? '')
                      : '',
                )
                .filter(Boolean)
            : []
        const tags = [
          ...namedTags(item.categories),
          ...namedTags(item.levels),
          ...namedTags(item.tags),
        ]
        postings.push(
          posting(
            id,
            String(item.name ?? ''),
            String(company.name ?? 'Employer not stated'),
            String(refs.landing_page ?? ''),
            locations,
            stripHtml(String(item.contents ?? '')),
            {
              publishedAt,
              tags,
              remote: /flexible|remote/i.test(locations),
            },
          ),
        )
      }
      if (!results.length || (fresh === 0 && oldestAllowed === null)) break
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

function jobicySalaryPeriod(value: unknown): NonNullable<RawPosting['salary']>['period'] {
  const period = String(value ?? '').toLowerCase()
  if (period === 'hourly' || period === 'hour') return 'hour'
  if (period === 'weekly' || period === 'week') return 'week'
  if (period === 'fortnightly' || period === 'fortnight') return 'fortnight'
  if (period === 'monthly' || period === 'month') return 'month'
  if (period === 'yearly' || period === 'annual' || period === 'year') return 'year'
  return 'unknown'
}

function jobicyPosting(item: Record<string, unknown>): { id: string; posting: RawPosting } | null {
  const id = String(item.id ?? item.url ?? '')
  if (!id) return null
  const numberOrNull = (value: unknown): number | null => {
    const number =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(number) && number > 0 ? number : null
  }
  const min = numberOrNull(item.salaryMin)
  const max = numberOrNull(item.salaryMax)
  const jobType = Array.isArray(item.jobType)
    ? item.jobType.map(String).join(', ')
    : String(item.jobType ?? '')
  const publishedAt =
    typeof item.pubDate === 'string' && Number.isFinite(Date.parse(item.pubDate))
      ? new Date(item.pubDate).toISOString()
      : null
  return {
    id,
    posting: posting(
      id,
      String(item.jobTitle ?? item.title ?? ''),
      String(item.companyName ?? 'Employer not stated'),
      String(item.url),
      String(item.jobGeo ?? item.location ?? 'Remote'),
      String(item.jobDescription ?? item.description ?? ''),
      {
        tags: Array.isArray(item.jobIndustry) ? item.jobIndustry.map(String) : [],
        jobType,
        publishedAt,
        remote: true,
        salary:
          (min ?? max) !== null && typeof item.salaryCurrency === 'string' && item.salaryCurrency
            ? {
                min,
                max,
                currency: item.salaryCurrency,
                period: jobicySalaryPeriod(item.salaryPeriod),
              }
            : null,
      },
    ),
  }
}

/**
 * Jobicy returns structured employment type, publication date and salary
 * fields. Preserve them: they are the reliable route to real contract and
 * freelance inventory, rather than guessing solely from advert prose.
 */
export const jobicy: SourceParser = {
  id: 'jobicy',
  name: 'Jobicy',
  kind: 'api',
  platform: 'jobicy',
  homepage: 'https://jobicy.com',
  attribution: 'Jobicy public job feed',
  verification: 'unverified',
  verificationReason: 'A public opportunity; verify with the employer.',
  async fetchPostings(source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const seen = new Set<string>()
    const postings: RawPosting[] = []
    const base = new URL(source.listingUrl)

    const walk = async (start: URL, maxPages: number, required: boolean): Promise<void> => {
      let cursor: string | null = null
      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(start)
        if (cursor) url.searchParams.set('cursor', cursor)
        else url.searchParams.delete('cursor')
        const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (required && page === 0) throw new Error(`jobicy returned ${response.status}`)
          break
        }
        const body = (await response.json()) as {
          jobs?: Record<string, unknown>[]
          nextCursor?: string | null
          hasMore?: boolean
        }
        const jobs = body.jobs ?? []
        let fresh = 0
        for (const item of jobs) {
          const mapped = jobicyPosting(item)
          if (!mapped || seen.has(mapped.id)) continue
          seen.add(mapped.id)
          fresh += 1
          postings.push(mapped.posting)
        }
        cursor = typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null
        if (!cursor || body.hasMore === false || !jobs.length || fresh === 0) break
      }
    }

    await walk(
      base,
      numberOption(source.options, 'walkPages', source.id === 'jobicy' ? 8 : 4, 1, 20),
      true,
    )

    // Jobicy's `tag` filter searches available job content. On the global
    // feed only, top up explicitly titled contract/freelance work plus one
    // small page for detailed categories people search for directly. Every
    // result is deduped into the same source, and the normal opportunity
    // classifier still decides whether it belongs in the gig lane.
    if (source.id === 'jobicy' && base.hostname.endsWith('jobicy.com')) {
      const topUps: Array<{ tag: string; pages: number; count?: string }> = [
        { tag: 'contract', pages: 3 },
        { tag: 'freelance', pages: 3 },
        { tag: 'video editor', pages: 2, count: '50' },
        { tag: 'photo editor', pages: 2, count: '50' },
        { tag: 'penetration testing', pages: 2, count: '50' },
        { tag: 'cybersecurity', pages: 2, count: '50' },
        { tag: 'web developer', pages: 2, count: '50' },
        { tag: 'WordPress', pages: 2, count: '50' },
        { tag: 'data analyst', pages: 2, count: '50' },
        { tag: 'data analytics', pages: 2, count: '50' },
        { tag: 'frontend developer', pages: 2, count: '50' },
        { tag: 'backend developer', pages: 2, count: '50' },
        { tag: 'tutor', pages: 2, count: '50' },
        { tag: 'teacher', pages: 2, count: '50' },
      ]
      for (const topUp of topUps) {
        const targeted = new URL(base)
        targeted.searchParams.set('tag', topUp.tag)
        if (topUp.count) targeted.searchParams.set('count', topUp.count)
        targeted.searchParams.delete('cursor')
        try {
          await walk(targeted, topUp.pages, false)
        } catch {
          // Keep the main Jobicy feed if a category top-up is unavailable.
        }
      }
    }
    return postings
  },
}

const COUNTRY_NAME_BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country.name]))

function remoteJobsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function remoteJobsStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function remoteJobsLocation(item: Record<string, unknown>): string {
  const applicant = remoteJobsRecord(item.applicant_location_requirements)
  const normalized = remoteJobsRecord(item.location_normalization)
  if (applicant.scope === 'worldwide' || normalized.scope === 'worldwide') return 'Remote worldwide'
  const allowed = remoteJobsStrings(applicant.allowed_countries).length
    ? remoteJobsStrings(applicant.allowed_countries)
    : remoteJobsStrings(normalized.allowed_countries)
  const regions = [
    ...remoteJobsStrings(applicant.regions),
    ...remoteJobsStrings(applicant.allowed_regions),
    ...remoteJobsStrings(normalized.regions),
  ]
  const places = [
    ...new Set([
      ...regions,
      ...allowed.map((code) => COUNTRY_NAME_BY_CODE.get(code.toUpperCase()) ?? code),
    ]),
  ]
  if (places.length > 5) return 'Remote, multiple countries'
  if (places.length) return places.join(', ')
  return typeof item.location === 'string' && item.location.trim() ? item.location.trim() : 'Remote'
}

function remoteJobsPosting(
  item: Record<string, unknown>,
): { id: string; posting: RawPosting } | null {
  const id = String(item.id ?? item.url ?? '')
  const url = String(item.url ?? '')
  if (!id || !url) return null
  const company = remoteJobsRecord(item.company)
  const category = remoteJobsRecord(item.category)
  const applicant = remoteJobsRecord(item.applicant_location_requirements)
  const normalized = remoteJobsRecord(item.location_normalization)
  const facts = remoteJobsRecord(item.search_facts)
  const location = remoteJobsLocation(item)
  const workArrangement = String(applicant.work_arrangement ?? normalized.work_arrangement ?? '')
  const numberOrNull = (value: unknown): number | null => {
    const number =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(number) && number > 0 ? number : null
  }
  const min = numberOrNull(item.salary_min)
  const max = numberOrNull(item.salary_max)
  const description = stripHtml(String(item.description ?? '')).replace(
    /\s*Apply directly on RemoteJobs\.org:\s*https?:\/\/\S+\s*$/i,
    '',
  )
  const employmentTypes = remoteJobsStrings(item.employment_types)
  const tags = [
    typeof category.name === 'string' ? category.name : '',
    typeof facts.role_family === 'string' ? facts.role_family : '',
    typeof facts.seniority === 'string' ? facts.seniority : '',
    ...remoteJobsStrings(facts.required_skills),
    ...remoteJobsStrings(facts.mentioned_skills),
    ...remoteJobsStrings(facts.preferred_skills),
  ].filter(Boolean)

  return {
    id,
    posting: posting(
      id,
      String(item.title ?? ''),
      String(company.name ?? 'Employer not stated'),
      url,
      location,
      description,
      {
        applyUrl: typeof item.apply_url === 'string' && item.apply_url ? item.apply_url : url,
        companyUrl: typeof company.website === 'string' ? company.website : undefined,
        remote:
          workArrangement.toLowerCase() === 'remote' ||
          applicant.scope === 'worldwide' ||
          normalized.scope === 'worldwide' ||
          /remote/i.test(location),
        tags,
        jobType:
          typeof item.type === 'string' && item.type ? item.type : employmentTypes.join(', '),
        publishedAt: typeof item.posted_at === 'string' ? item.posted_at : null,
        salary:
          (min ?? max) !== null && typeof item.salary_currency === 'string' && item.salary_currency
            ? {
                min,
                max,
                currency: item.salary_currency,
                period: jobicySalaryPeriod(item.salary_period),
              }
            : null,
      },
    ),
  }
}

/**
 * RemoteJobs.org publishes a documented, no-key API for job boards. Keep the
 * publisher's application link intact and show its Powered by credit on the
 * listing page. The API allows 200 requests per hour per IP; source page
 * bounds in seed.ts keep a full refresh comfortably below that.
 */
export const remoteJobsOrg: SourceParser = {
  id: 'remotejobs',
  name: 'RemoteJobs.org',
  kind: 'api',
  platform: 'remotejobs',
  homepage: 'https://remotejobs.org',
  attribution: 'Powered by RemoteJobs.org',
  verification: 'unverified',
  verificationReason: 'A public opportunity; verify with the employer.',
  async fetchPostings(source: SourceRef, fetchImpl: typeof fetch = fetch) {
    const seen = new Set<string>()
    const postings: RawPosting[] = []
    const maxPages = numberOption(source.options, 'maxPages', 10, 1, 40)
    const base = new URL(source.listingUrl || 'https://remotejobs.org/api/v1/jobs')
    let offset = Number(base.searchParams.get('offset') ?? 0)
    if (!Number.isFinite(offset) || offset < 0) offset = 0

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(base)
      url.searchParams.set('limit', '50')
      url.searchParams.set('offset', String(offset))
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        if (page === 0) throw new Error(`remotejobs returned ${response.status}`)
        break
      }
      const body = (await response.json()) as {
        data?: Record<string, unknown>[]
        pagination?: { total?: number; has_more?: boolean }
      }
      const jobs = body.data ?? []
      let fresh = 0
      for (const item of jobs) {
        const mapped = remoteJobsPosting(item)
        if (!mapped || seen.has(mapped.id)) continue
        seen.add(mapped.id)
        fresh += 1
        postings.push(mapped.posting)
      }
      offset += jobs.length
      if (
        !jobs.length ||
        fresh === 0 ||
        body.pagination?.has_more === false ||
        (typeof body.pagination?.total === 'number' && offset >= body.pagination.total)
      )
        break
    }
    return postings
  },
}

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
      const jobType =
        parts
          .slice(2)
          .find((part) =>
            /^(?:contract|contractor|freelance|full[-\s]?time|part[-\s]?time|temporary|internship)$/i.test(
              part,
            ),
          ) ?? ''
      postings.push(
        posting(
          `hn-${comment.id}`,
          parts[1].slice(0, 160),
          parts[0].slice(0, 120),
          `https://news.ycombinator.com/item?id=${comment.id}`,
          parts[2] ? parts[2].slice(0, 120) : 'Remote',
          text.slice(0, 12000),
          { remote: /remote/i.test(text), jobType },
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
  remoteJobsOrg,
  workable,
  hnHiring,
]
