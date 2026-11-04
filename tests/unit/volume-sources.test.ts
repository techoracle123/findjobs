import { describe, expect, it } from 'vitest'
import { arbeitnow } from '../../src/server/sources/arbeitnow'
import {
  himalayas,
  jobicy,
  remoteJobsOrg,
  themuse,
  workable,
} from '../../src/server/sources/public-boards'
import { smartrecruiters } from '../../src/server/sources/ats'
import type { SourceRef } from '../../src/server/sources/types'

const ref = (id: string, listingUrl: string): SourceRef => ({
  id,
  listingUrl,
  options: {},
  verification: 'unverified',
  verificationReason: 'test',
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('arbeitnow pagination', () => {
  it('walks pages until the API says there is no next page', async () => {
    const page = (n: number, slugs: string[], next: string | null) => ({
      data: slugs.map((slug) => ({
        slug,
        title: `Job ${slug}`,
        company_name: 'Acme',
        description: '<p>Work</p>',
        remote: true,
        url: `https://example.com/${slug}`,
        tags: [],
        job_types: [],
        location: 'Remote',
        created_at: 1700000000,
      })),
      links: { next },
      meta: { current_page: n, last_page: 3 },
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=3')) return json(page(3, ['e'], null))
      if (url.includes('page=2')) return json(page(2, ['c', 'd'], 'next'))
      return json(page(1, ['a', 'b'], 'next'))
    }) as typeof fetch
    const postings = await arbeitnow.fetchPostings(
      ref('arbeitnow', 'https://www.arbeitnow.com/api/job-board-api'),
      fetchImpl,
    )
    expect(postings.map((p) => p.externalId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('treats a payload without links/meta as a single page', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return json({ data: [{ slug: 'x', title: 'One', company_name: 'Co' }] })
    }) as typeof fetch
    const postings = await arbeitnow.fetchPostings(
      ref('arbeitnow', 'https://example.com/api'),
      fetchImpl,
    )
    expect(postings).toHaveLength(1)
    expect(calls).toBe(1)
  })
})

describe('himalayas pagination', () => {
  it('walks cursors and maps the fields the API actually sends', async () => {
    const mk = (from: number, count: number, nextCursor: string | null) => ({
      nextCursor,
      jobs: Array.from({ length: count }, (_, i) => ({
        guid: `https://himalayas.app/companies/remoteco/jobs/role-${from + i}`,
        applicationLink: `https://himalayas.app/companies/remoteco/jobs/role-${from + i}?utm_source=api`,
        title: `Role ${from + i}`,
        companyName: 'RemoteCo',
        description: 'Desc',
        locationRestrictions: ['United States'],
        employmentType: 'Full Time',
        pubDate: 1793351475,
        expiryDate: 1798535474,
        minSalary: 90000,
        maxSalary: 120000,
        currency: 'USD',
        salaryPeriod: 'annual',
        categories: ['Software-Engineer'],
        seniority: ['Senior'],
      })),
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=abc')) return json(mk(100, 3, null))
      return json(mk(0, 100, 'abc'))
    }) as typeof fetch
    const postings = await himalayas.fetchPostings(
      ref('himalayas', 'https://himalayas.app/jobs/api'),
      fetchImpl,
    )
    expect(postings).toHaveLength(103)
    expect(postings[0].remote).toBe(true)
    expect(postings[0].url).toBe('https://himalayas.app/companies/remoteco/jobs/role-0')
    expect(postings[0].location).toBe('United States')
    expect(postings[0].salary).toEqual({ min: 90000, max: 120000, currency: 'USD', period: 'year' })
    expect(postings[0].publishedAt).toBe(new Date(1793351475 * 1000).toISOString())
  })

  it('keeps following the cursor when the API caps pages below the request', async () => {
    // The live API echoes limit:20 even when asked for more; stopping on a
    // "short" page once cut this source to 20 postings total.
    const mk = (from: number, nextCursor: string | null) => ({
      nextCursor,
      jobs: Array.from({ length: 20 }, (_, i) => ({
        guid: `https://himalayas.app/companies/remoteco/jobs/role-${from + i}`,
        title: `Role ${from + i}`,
        companyName: 'RemoteCo',
        description: 'Desc',
      })),
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=c2')) return json(mk(40, null))
      if (url.includes('cursor=c1')) return json(mk(20, 'c2'))
      return json(mk(0, 'c1'))
    }) as typeof fetch
    const postings = await himalayas.fetchPostings(
      ref('himalayas', 'https://himalayas.app/jobs/api'),
      fetchImpl,
    )
    expect(postings).toHaveLength(60)
  })
})

describe('himalayas gig top-up', () => {
  it('dedupes contractor search results into the same source and preserves hourly contractor fields', async () => {
    const browseJob = {
      guid: 'https://himalayas.app/jobs/permanent',
      applicationLink: 'https://example.com/apply/permanent',
      title: 'Permanent Engineer',
      companyName: 'RemoteCo',
      description: 'Permanent role',
      employmentType: 'Full Time',
      pubDate: 1793351475,
      currency: 'USD',
      minSalary: 90000,
      maxSalary: 100000,
      salaryPeriod: 'annual',
    }
    const contractor = {
      guid: 'https://himalayas.app/jobs/contractor',
      applicationLink: 'https://example.com/apply/contractor',
      title: 'Security Contractor',
      companyName: 'RemoteCo',
      description: 'Run security reviews.',
      employmentType: 'Contractor',
      pubDate: 1793351475,
      currency: 'USD',
      minSalary: 70,
      maxSalary: 90,
      salaryPeriod: 'hourly',
    }
    const temporary = {
      ...contractor,
      guid: 'https://himalayas.app/jobs/temporary',
      applicationLink: 'https://example.com/apply/temporary',
      title: 'Temporary Data Analyst',
      employmentType: 'Temporary',
      salaryPeriod: 'weekly',
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/jobs/api/search') && url.includes('employment_type=Contractor')) {
        return json({ jobs: [browseJob, contractor] })
      }
      if (url.includes('/jobs/api/search') && url.includes('employment_type=Temporary')) {
        return json({ jobs: [temporary] })
      }
      return json({ jobs: [browseJob], nextCursor: null })
    }) as typeof fetch

    const postings = await himalayas.fetchPostings(
      ref('himalayas', 'https://himalayas.app/jobs/api'),
      fetchImpl,
    )
    expect(postings).toHaveLength(3)
    const found = postings.find((posting) => posting.externalId === contractor.guid)
    expect(found?.jobType).toBe('Contractor')
    expect(found?.applyUrl).toBe('https://example.com/apply/contractor')
    expect(found?.salary).toEqual({ min: 70, max: 90, currency: 'USD', period: 'hour' })
    expect(postings.find((posting) => posting.externalId === temporary.guid)?.salary?.period).toBe(
      'week',
    )
  })
})

describe('himalayas category search sources', () => {
  it('walks the seeded search and companion skill slices without duplicates', async () => {
    const requests: string[] = []
    const mk = (id: string, title: string) => ({
      guid: `https://himalayas.app/jobs/${id}`,
      applicationLink: `https://example.com/apply/${id}`,
      title,
      companyName: 'RemoteCo',
      description: 'Remote role',
      employmentType: 'Full Time',
      pubDate: 1793351475,
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requests.push(url.toString())
      const query = url.searchParams.get('q')
      if (query === 'WordPress') return json({ jobs: [mk('wp', 'WordPress Developer')] })
      if (query === 'cybersecurity')
        return json({ jobs: [mk('wp', 'WordPress Developer'), mk('soc', 'SOC Analyst')] })
      return json({ jobs: [] })
    }) as typeof fetch
    const source = ref(
      'himalayas-nigeria-skills',
      'https://himalayas.app/jobs/api/search?q=WordPress&country=NG&sort=recent',
    )
    source.options = {
      maxPages: 2,
      searchSlices: [{ params: { q: 'cybersecurity', country: 'NG' }, pages: 2 }],
    }
    const postings = await himalayas.fetchPostings(source, fetchImpl)
    expect(postings.map((posting) => posting.title)).toEqual(['WordPress Developer', 'SOC Analyst'])
    expect(requests.every((url) => url.includes('country=NG'))).toBe(true)
    expect(requests.every((url) => url.includes('sort=recent'))).toBe(true)
  })
})

describe('jobicy structured gigs', () => {
  it('walks cursors, preserves structured type and salary, and dedupes title top-ups', async () => {
    const contract = {
      id: 101,
      jobTitle: 'Contract Web Developer',
      companyName: 'BuildCo',
      url: 'https://jobicy.com/jobs/101',
      jobGeo: 'Worldwide',
      jobDescription: 'Build a website.',
      jobType: ['Contract'],
      jobIndustry: ['Web Development'],
      pubDate: '2026-10-30T10:00:00Z',
      salaryMin: 50,
      salaryMax: 70,
      salaryCurrency: 'USD',
      salaryPeriod: 'hourly',
    }
    const fullTime = {
      ...contract,
      id: 102,
      jobTitle: 'Frontend Developer',
      jobType: ['Full-Time'],
    }
    const freelance = {
      ...contract,
      id: 103,
      jobTitle: 'Freelance Data Analyst',
      jobType: ['Freelance'],
      salaryMin: 1200,
      salaryMax: 1200,
      salaryPeriod: 'weekly',
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const tag = url.searchParams.get('tag')
      if (tag === 'contract') return json({ jobs: [contract], nextCursor: null, hasMore: false })
      if (tag === 'freelance') return json({ jobs: [freelance], nextCursor: null, hasMore: false })
      if (url.searchParams.get('cursor') === 'next-1') {
        return json({ jobs: [fullTime], nextCursor: null, hasMore: false })
      }
      return json({ jobs: [contract], nextCursor: 'next-1', hasMore: true })
    }) as typeof fetch

    const postings = await jobicy.fetchPostings(
      ref('jobicy', 'https://jobicy.com/api/v2/remote-jobs?count=100'),
      fetchImpl,
    )
    expect(postings.map((posting) => posting.externalId)).toEqual(['101', '102', '103'])
    expect(postings[0].jobType).toBe('Contract')
    expect(postings[0].publishedAt).toBe('2026-10-30T10:00:00.000Z')
    expect(postings[0].salary).toEqual({ min: 50, max: 70, currency: 'USD', period: 'hour' })
    expect(postings[2].jobType).toBe('Freelance')
    expect(postings[2].salary?.period).toBe('week')
  })
})

describe('themuse parser', () => {
  it('maps Muse results and stops at page_count', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const page = url.includes('page=1') ? 1 : 0
      return json({
        page_count: 2,
        results: [
          {
            id: 100 + page,
            name: `Engineer ${page}`,
            company: { name: 'MuseCo' },
            refs: { landing_page: `https://www.themuse.com/jobs/x${page}` },
            locations: [{ name: 'New York, NY' }],
            contents: '<p>Build things</p>',
            publication_date: '2026-10-20T00:00:00Z',
          },
        ],
      })
    }) as typeof fetch
    const postings = await themuse.fetchPostings(
      ref('themuse', 'https://www.themuse.com/api/public/jobs'),
      fetchImpl,
    )
    expect(postings).toHaveLength(2)
    expect(postings[0].title).toBe('Engineer 0')
    expect(postings[0].company).toBe('MuseCo')
    expect(postings[0].description).toBe('Build things')
    expect(postings[0].location).toBe('New York, NY')
  })

  it('preserves category filters, keeps category tags, and skips stale expanded results', async () => {
    const requests: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return json({
        page_count: 1,
        results: [
          {
            id: 201,
            name: 'Remote Data Analyst',
            company: { name: 'MuseCo' },
            refs: { landing_page: 'https://www.themuse.com/jobs/data' },
            locations: [{ name: 'Flexible / Remote' }],
            categories: [{ name: 'Data and Analytics' }],
            levels: [{ name: 'Mid Level' }],
            tags: [{ name: 'SQL' }],
            contents: '<p>Analyse data</p>',
            publication_date: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          },
          {
            id: 202,
            name: 'Old Data Analyst',
            company: { name: 'MuseCo' },
            refs: { landing_page: 'https://www.themuse.com/jobs/old' },
            locations: [{ name: 'Flexible / Remote' }],
            contents: '<p>Old advert</p>',
            publication_date: '2020-01-01T00:00:00Z',
          },
        ],
      })
    }) as typeof fetch
    const source = ref(
      'themuse-data-remote',
      'https://www.themuse.com/api/public/jobs?category=Data%20and%20Analytics&location=Flexible%20%2F%20Remote',
    )
    source.options = { maxPages: 32, maxAgeDays: 365 }
    const postings = await themuse.fetchPostings(source, fetchImpl)
    expect(postings).toHaveLength(1)
    expect(postings[0].tags).toEqual(['Data and Analytics', 'Mid Level', 'SQL'])
    expect(postings[0].remote).toBe(true)
    expect(requests[0]).toContain('category=Data+and+Analytics')
    expect(requests[0]).toContain('location=Flexible+%2F+Remote')
    expect(requests[0]).toContain('page=0')
  })
})

describe('RemoteJobs.org parser', () => {
  const item = (id: string, title: string) => ({
    id,
    title,
    url: `https://remotejobs.org/remote-jobs/${id}`,
    apply_url: `https://example.com/apply/${id}`,
    company: { name: 'Example Co', website: 'https://example.com' },
    category: { name: 'Programming', slug: 'programming' },
    description:
      '<p>Build and maintain WordPress websites.</p> Apply directly on RemoteJobs.org: https://remotejobs.org/example',
    location: 'Worldwide',
    applicant_location_requirements: { scope: 'worldwide', work_arrangement: 'remote' },
    type: 'contract',
    employment_types: ['contractor'],
    salary_min: 50,
    salary_max: 75,
    salary_currency: 'USD',
    salary_period: 'hour',
    posted_at: '2026-11-01T10:00:00Z',
    search_facts: {
      role_family: 'frontend',
      seniority: 'mid',
      required_skills: ['WordPress'],
      mentioned_skills: ['Elementor'],
      preferred_skills: ['WooCommerce'],
    },
  })

  it('walks offsets and maps attribution, skills, worldwide scope, and pay', async () => {
    const requests: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requests.push(url.toString())
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return json({
        data:
          offset === 0
            ? [item('one', 'WordPress Developer')]
            : [item('two', 'WooCommerce Developer')],
        pagination: { total: 2, limit: 50, offset, has_more: offset === 0 },
      })
    }) as typeof fetch
    const source = ref(
      'remotejobs-wordpress',
      'https://remotejobs.org/api/v1/jobs?limit=50&q=WordPress&sort=relevance',
    )
    source.options = { maxPages: 3 }
    const postings = await remoteJobsOrg.fetchPostings(source, fetchImpl)
    expect(remoteJobsOrg.attribution).toBe('Powered by RemoteJobs.org')
    expect(postings).toHaveLength(2)
    expect(postings[0].location).toBe('Remote worldwide')
    expect(postings[0].remote).toBe(true)
    expect(postings[0].jobType).toBe('contract')
    expect(postings[0].salary).toEqual({ min: 50, max: 75, currency: 'USD', period: 'hour' })
    expect(postings[0].tags).toEqual(
      expect.arrayContaining(['Programming', 'WordPress', 'Elementor', 'WooCommerce']),
    )
    expect(postings[0].description).not.toContain('Apply directly on RemoteJobs.org')
    expect(requests.map((url) => new URL(url).searchParams.get('offset'))).toEqual(['0', '1'])
  })

  it('maps daily pay to unknown and lists a small set of allowed countries by name', async () => {
    const postingItem = {
      ...item('three', 'Contract Tutor'),
      location: 'Nigeria, Ghana',
      applicant_location_requirements: {
        scope: 'country_list',
        allowed_countries: ['NG', 'GH'],
        work_arrangement: 'remote',
      },
      salary_period: 'day',
    }
    const fetchImpl = (async () =>
      json({ data: [postingItem], pagination: { total: 1, has_more: false } })) as typeof fetch
    const postings = await remoteJobsOrg.fetchPostings(
      ref('remotejobs-tutoring', 'https://remotejobs.org/api/v1/jobs?q=tutor'),
      fetchImpl,
    )
    expect(postings[0].location).toBe('Nigeria, Ghana')
    expect(postings[0].salary?.period).toBe('unknown')
  })
})

describe('workable widget mapping', () => {
  it('takes the employer from the payload name and location from locations[]', async () => {
    const fetchImpl = (async () =>
      json({
        name: 'Blueground',
        jobs: [
          {
            shortcode: 'ABC123',
            title: 'Operations Lead',
            url: 'https://apply.workable.com/j/ABC123',
            application_url: 'https://apply.workable.com/j/ABC123/apply',
            description: 'Run operations.',
            employment_type: 'Full-time',
            telecommuting: false,
            published_on: '2026-09-23',
            locations: [{ country: 'Greece', city: 'Athens', region: 'Attica' }],
          },
        ],
      })) as typeof fetch
    const postings = await workable.fetchPostings(
      ref('workable-blueground', 'https://apply.workable.com/api/v1/widget/accounts/blueground'),
      fetchImpl,
    )
    expect(postings).toHaveLength(1)
    expect(postings[0].company).toBe('Blueground')
    expect(postings[0].location).toBe('Athens, Attica, Greece')
    expect(postings[0].publishedAt).toBe('2026-09-23')
  })
})

describe('smartrecruiters pagination', () => {
  it('walks offsets and returns every listing, detailing only the first 20', async () => {
    const mk = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `p${from + i}`,
        name: `Role ${from + i}`,
        company: { name: 'SRCo' },
        location: { city: 'Berlin', country: 'de' },
        releasedDate: '2026-10-01T00:00:00Z',
      }))
    let detailCalls = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('offset=100')) return json({ content: mk(100, 50), totalFound: 150 })
      if (url.includes('/postings?')) return json({ content: mk(0, 100), totalFound: 150 })
      detailCalls += 1
      return json({ jobAd: { sections: { jobDescription: '<p>Build things</p>' } } })
    }) as typeof fetch
    const postings = await smartrecruiters.fetchPostings(
      {
        id: 'smartrecruiters-x',
        listingUrl: 'https://www.smartrecruiters.com/x',
        options: { company: 'x' },
        verification: 'unverified',
        verificationReason: 'test',
      },
      fetchImpl,
    )
    expect(postings).toHaveLength(150)
    expect(detailCalls).toBe(20)
    expect(postings[0].description).toContain('Build things')
    expect(postings[25].description).toBe('')
    expect(postings[25].company).toBe('SRCo')
  })
})
