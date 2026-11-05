import { describe, expect, it } from 'vitest'
import { workday } from '../../src/server/sources/ats'
import { oracleRecruiting } from '../../src/server/sources/oracle-recruiting'
import { zohoRecruit } from '../../src/server/sources/zoho-recruit'
import {
  efccRecruitment,
  fcscVacancies,
  nnpcCareers,
} from '../../src/server/sources/nigeria-public-sector'
import { PUBLIC_SOURCES } from '../../src/server/public-feed'
import { SEED_SOURCES } from '../../src/server/sources/seed'
import type { SourceRef } from '../../src/server/sources/types'

function source(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    id: 'test-source',
    listingUrl: 'https://example.com/careers',
    options: {},
    verification: 'unverified',
    verificationReason: 'A public opportunity; verify with the employer.',
    ...overrides,
  }
}

describe('direct Nigerian sources', () => {
  it('are seeded and publishable through the public feed', () => {
    const ids = [
      'workday-shell-nigeria',
      'oracle-mtn-nigeria',
      'zoho-gtbank',
      'efcc-recruitment-portal',
      'fcsc-vacancies',
      'nnpc-careers',
    ]
    for (const id of ids) {
      expect(
        SEED_SOURCES.some((entry) => entry.id === id),
        id,
      ).toBe(true)
      expect(
        PUBLIC_SOURCES.some((entry) => entry.id === id),
        id,
      ).toBe(true)
    }
    expect(
      [workday, oracleRecruiting, zohoRecruit, efccRecruitment, fcscVacancies, nnpcCareers].map(
        (parser) => parser.verification,
      ),
    ).toEqual(['unverified', 'unverified', 'unverified', 'unverified', 'unverified', 'unverified'])
  })

  it('pages through Workday, reads detail records, and keeps only the configured country', async () => {
    const offsets: number[] = []
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/jobs')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          offset: number
          searchText: string
        }
        offsets.push(body.offset)
        expect(body.searchText).toBe('Nigeria')
        if (body.offset === 0) {
          return Response.json({
            total: 21,
            jobPostings: Array.from({ length: 20 }, (_, index) => ({
              title: `Shell Role ${index + 1}`,
              externalPath: `/job/Lagos/Shell-Role-${index + 1}_R${index + 1}`,
              locationsText: 'Lagos',
              postedOn: 'Posted 2 Days Ago',
              bulletFields: [`R${index + 1}`],
            })),
          })
        }
        return Response.json({
          total: 21,
          jobPostings: [
            {
              title: 'US Only Role',
              externalPath: '/job/Houston/US-Role_R99',
              locationsText: 'Houston',
              postedOn: 'Posted Today',
            },
          ],
        })
      }
      const req = url.match(/_R(\d+)$/)?.[1] ?? '0'
      const isUs = req === '99'
      return Response.json({
        jobPostingInfo: {
          title: isUs ? 'US Only Role' : `Shell Role ${req}`,
          jobReqId: `R${req}`,
          jobDescription: '<p>Work on <strong>energy projects</strong> in Nigeria.</p>',
          startDate: '2026-10-20',
          timeType: 'Full time',
          workerType: 'Regular',
          location: isUs ? 'Houston, Texas' : 'Lagos',
          canApply: req !== '2',
          jobRequisitionLocation: {
            country: {
              alpha2Code: isUs ? 'US' : 'NG',
              descriptor: isUs ? 'United States' : 'Nigeria',
            },
          },
        },
      })
    }) as typeof fetch

    const postings = await workday.fetchPostings(
      source({
        listingUrl: 'https://shell.wd3.myworkdayjobs.com/wday/cxs/shell/ShellCareers/jobs',
        options: {
          companyLabel: 'Shell',
          searchText: 'Nigeria',
          countryCode: 'NG',
          maxPostings: 30,
        },
      }),
      fetcher,
    )

    expect(offsets).toEqual([0, 20])
    expect(postings).toHaveLength(20)
    expect(postings[0]).toMatchObject({
      externalId: 'R1',
      company: 'Shell',
      url: 'https://shell.wd3.myworkdayjobs.com/ShellCareers/job/Lagos/Shell-Role-1_R1',
      location: 'Lagos, Nigeria',
      jobType: 'Full time · Regular',
      publishedAt: '2026-10-20',
      closed: false,
    })
    expect(postings[0].description).toContain('energy projects')
    expect(postings[0].description).not.toContain('<strong>')
    expect(postings.find((posting) => posting.externalId === 'R2')?.closed).toBe(true)
    expect(postings.some((posting) => posting.title === 'US Only Role')).toBe(false)
  })

  it('reads MTN Nigeria roles and their closing dates from Oracle Recruiting', async () => {
    const requested: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url.includes('recruitingCEJobRequisitionDetails')) {
        return Response.json({
          items: [
            {
              Id: '7820',
              Title: 'Manager - Sales and Trade Development',
              RequisitionType: 'Permanent Staff',
              JobSchedule: 'Full time',
              ExternalPostedStartDate: '2026-10-26T09:43:31+00:00',
              ExternalPostedEndDate: '2026-11-02T23:00:00+00:00',
              ExternalDescriptionStr: '<p>Lead regional trade work.</p>',
              PrimaryLocation: 'South South Region, Nigeria',
              PrimaryLocationCountry: 'NG',
              WorkplaceType: 'On-site',
              JobFunction: 'Sales',
              secondaryLocations: [],
              skills: [],
            },
          ],
        })
      }
      return Response.json({
        items: [
          {
            TotalJobsCount: 2,
            requisitionList: [
              {
                Id: '7820',
                Title: 'Manager - Sales and Trade Development',
                PostedDate: '2026-10-26',
                PrimaryLocationCountry: 'NG',
                PrimaryLocation: 'South South Region, Nigeria',
                ShortDescriptionStr: 'Lead regional trade work.',
              },
              {
                Id: '9000',
                Title: 'Role Outside Nigeria',
                PostedDate: '2026-10-26',
                PrimaryLocationCountry: 'ZA',
                PrimaryLocation: 'Johannesburg, South Africa',
              },
            ],
          },
        ],
      })
    }) as typeof fetch

    const postings = await oracleRecruiting.fetchPostings(
      source({
        listingUrl:
          'https://ehle.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs',
        options: { companyLabel: 'MTN Nigeria', siteNumber: 'CX_1', countryCode: 'NG' },
      }),
      fetcher,
    )

    expect(requested[0]).toContain('location=%22Nigeria%22')
    expect(postings).toHaveLength(1)
    expect(postings[0]).toMatchObject({
      externalId: '7820',
      company: 'MTN Nigeria',
      url: 'https://ehle.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/7820',
      publishedAt: '2026-10-26T09:43:31+00:00',
      validThrough: '2026-11-02T23:00:00+00:00',
      jobType: 'Full time · Permanent Staff',
    })
    expect(postings[0].description).toContain('Lead regional trade work')
  })

  it('excludes GTBank roles marked filled or past the Zoho closing date', async () => {
    const requested: string[] = []
    const listing = `
      <main>
        <section><a href="/jobs/Job-Portal/111/filled-role">Filled Role</a><p>Lagos, Nigeria</p><span>Position filled</span></section>
        <section><a href="/jobs/Careers/222/open-role?source=CareerSite">Open Role</a><p>Lagos, Nigeria</p></section>
        <section><a href="/jobs/specialists/333/past-role">Past Role</a><p>Lagos, Nigeria</p></section>
      </main>`
    const openDetail = `
      <main><h1>Open Role</h1><p>Lagos, Nigeria | Posted on 20/10/2026</p>
      <h2>Job Description</h2><p>Support customers and branch teams with careful, accurate work.</p>
      <div>Job Information</div><div>City</div><div>Lekki</div><div>Country</div><div>Nigeria</div>
      <div>Job Type</div><div>Full Time</div><div>Close Date</div><div>31/12/2026</div></main>`
    const pastDetail = openDetail
      .replace('Open Role', 'Past Role')
      .replace('31/12/2026', '01/01/2026')
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url.includes('/111/')) throw new Error('filled detail must not be fetched')
      if (url.includes('/222/')) return new Response(openDetail, { status: 200 })
      if (url.includes('/333/')) return new Response(pastDetail, { status: 200 })
      return new Response(listing, { status: 200 })
    }) as typeof fetch

    const postings = await zohoRecruit.fetchPostings(
      source({
        listingUrl: 'https://gtbank.zohorecruit.com/jobs/Job-Portal',
        options: { companyLabel: 'Guaranty Trust Bank (GTBank)', country: 'NG' },
      }),
      fetcher,
    )

    expect(requested.some((url) => url.includes('/111/'))).toBe(false)
    expect(postings).toHaveLength(1)
    expect(postings[0]).toMatchObject({
      externalId: '222',
      title: 'Open Role',
      company: 'Guaranty Trust Bank (GTBank)',
      location: 'Lekki, Nigeria',
      jobType: 'Full Time',
      publishedAt: '2026-10-20T00:00:00.000Z',
      validThrough: '2026-12-31T23:59:59.000Z',
    })
  })

  it('publishes EFCC categories only while the official portal says the exercise is open', async () => {
    const bundle = `
      const categories=[
        {code:'A',cadre:'Detective Superintendent',title:'Assistant Superintendent of EFCC II',gradeLevel:'GL 08',minAge:18,maxAge:35,requirement:'A degree or HND is required.',positions:[]},
        {code:'D',cadre:'Professionals and Skilled Workers',title:'Professionals and Skilled Workers',gradeLevel:'',minAge:18,maxAge:40,requirement:'Relevant professional experience is required.',positions:['ICT','Legal']}
      ];`
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/config')) {
        return Response.json({
          status: 'open',
          opensAt: '2026-01-01T00:00:00.000Z',
          closesAt: '2099-01-01T23:00:00.000Z',
        })
      }
      if (url.endsWith('/assets/index-test.js')) return new Response(bundle, { status: 200 })
      return new Response('<script type="module" src="/assets/index-test.js"></script>', {
        status: 200,
      })
    }) as typeof fetch
    const postings = await efccRecruitment.fetchPostings(
      source({ listingUrl: 'https://recruitment.efcc.gov.ng/' }),
      fetcher,
    )
    expect(postings).toHaveLength(2)
    expect(postings[0]).toMatchObject({
      title: 'Assistant Superintendent of EFCC II – GL 08',
      company: 'Economic and Financial Crimes Commission (EFCC)',
      applyUrl: 'https://recruitment.efcc.gov.ng/signup',
      validThrough: '2099-01-01T23:00:00.000Z',
    })
    expect(postings[1].description).toContain('Open areas: ICT, Legal')

    const closedFetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.endsWith('/api/v1/config')) throw new Error('closed portal needs no bundle fetch')
      return Response.json({ status: 'closed' })
    }) as typeof fetch
    await expect(
      efccRecruitment.fetchPostings(
        source({ listingUrl: 'https://recruitment.efcc.gov.ng/' }),
        closedFetcher,
      ),
    ).resolves.toEqual([])
  })

  it('keeps closed FCSC vacancies out and reads an explicitly open vacancy', async () => {
    const closedListing = `
      <a href="/vacancies/abc-administrative-officer">Administrative Officer I, SGL 09</a>
      <p>Office of the Head of Civil Service</p><span>Closed</span>`
    const closedFetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/vacancies/')) throw new Error('closed detail must not be fetched')
      return new Response(closedListing, { status: 200 })
    }) as typeof fetch
    await expect(
      fcscVacancies.fetchPostings(
        source({ listingUrl: 'https://recruitment.fedcivilservice.gov.ng/' }),
        closedFetcher,
      ),
    ).resolves.toEqual([])

    const openListing = `
      <a href="/vacancies/xyz-procurement-officer">Procurement Officer II, SGL 08</a>
      <p>Office of the Head of Civil Service</p><span>Open</span>`
    const detail = `
      <h1>Procurement Officer II, SGL 08</h1>
      <h2>Description</h2><p>Candidates must possess a relevant degree and completed NYSC.</p>
      <h2>Information</h2><div>Grade Level</div><div>SGL 08</div>
      <div>MDAs</div><div>Office of the Head of Civil Service of the Federation</div>
      <a href="/apply/xyz">Apply Now</a>`
    const openFetcher = (async (input: RequestInfo | URL) =>
      new Response(String(input).includes('/vacancies/') ? detail : openListing, {
        status: 200,
      })) as typeof fetch
    const postings = await fcscVacancies.fetchPostings(
      source({ listingUrl: 'https://recruitment.fedcivilservice.gov.ng/' }),
      openFetcher,
    )
    expect(postings).toHaveLength(1)
    expect(postings[0]).toMatchObject({
      title: 'Procurement Officer II, SGL 08',
      company: 'Office of the Head of Civil Service of the Federation',
      location: 'Nigeria',
    })
    expect(postings[0].description).toContain('relevant degree')
  })

  it('publishes no NNPC listing while the official site says applications are closed', async () => {
    const fetcher = (async () =>
      new Response('<main>Application submission is now closed!</main>', {
        status: 200,
      })) as typeof fetch
    await expect(
      nnpcCareers.fetchPostings(source({ listingUrl: 'https://careers.nnpcgroup.com/' }), fetcher),
    ).resolves.toEqual([])
  })
})
