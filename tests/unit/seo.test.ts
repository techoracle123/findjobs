import { describe, expect, it } from 'vitest'
import {
  jobMeta,
  jobPostingJsonLd,
  pageMeta,
  render404,
  renderJobSitemap,
  renderSitemapIndex,
  sitemapEligible,
} from '../../src/server/seo'
import type { Job } from '../../src/shared/types'

const now = Date.now()
const job = (over: Partial<Job> = {}): Job => ({
  id: 'job_1',
  title: 'Data Analyst',
  company: 'Acme',
  roleFamily: 'data',
  seniority: 'mid',
  workMode: 'onsite',
  locationCountry: 'NG',
  locationLabel: 'Lagos, Nigeria',
  salaryMin: 0,
  salaryMax: 0,
  salaryCurrency: '',
  salaryPeriod: 'year',
  description: 'Requirements\n- SQL\n- Data analysis',
  requiredSkills: ['SQL'],
  usefulSkills: [],
  eligibleCountries: [],
  sponsorship: 'unknown',
  sourceName: 'source',
  sourceUrl: 'https://example.org/jobs/1',
  postedAt: new Date(now - 2 * 86_400_000).toISOString(),
  isDemo: false,
  jobStatus: 'open',
  lastSeenAt: new Date(now).toISOString(),
  applyUrl: 'https://example.org/apply/1',
  ...over,
})

const ORIGIN = 'https://fj-find-jobs.pages.dev'

describe('JobPosting structured data', () => {
  it('emits the required fields for a fresh published listing', () => {
    const html = jobPostingJsonLd(job(), ORIGIN, 'abc')!
    expect(html).toContain('application/ld+json')
    const data = JSON.parse(html.replace(/^[^>]*>/, '').replace(/<\/script>$/, ''))
    expect(data['@type']).toBe('JobPosting')
    expect(data.datePosted).toBeTruthy()
    expect(data.hiringOrganization.name).toBe('Acme')
    expect(data.jobLocation.address.addressCountry).toBe('NG')
    expect(data.baseSalary).toBeUndefined() // zero means not stated — never emitted
  })

  it('never emits salary zeros, missing locations, or stale listings', () => {
    const zeroSalary = jobPostingJsonLd(job({ salaryMin: 0, salaryMax: 0 }), ORIGIN, 'n')!
    expect(zeroSalary).not.toContain('baseSalary') // zero means not stated — omitted, not guessed
    expect(
      jobPostingJsonLd(job({ salaryMin: 100, salaryMax: 200, salaryCurrency: 'NGN' }), ORIGIN, 'n'),
    ).toContain('baseSalary')
    expect(
      jobPostingJsonLd(job({ locationCountry: '', quality: undefined }), ORIGIN, 'n'),
    ).toBeNull()
    expect(
      jobPostingJsonLd(
        job({ postedAt: new Date(now - 31 * 86_400_000).toISOString() }),
        ORIGIN,
        'n',
      ),
    ).toBeNull()
  })

  it('uses TELECOMMUTE only for remote roles', () => {
    const remote = jobPostingJsonLd(
      job({ workMode: 'remote', salaryMin: 1, salaryMax: 2, salaryCurrency: 'USD' }),
      ORIGIN,
      'n',
    )!
    expect(remote).toContain('TELECOMMUTE')
    const onsite = jobPostingJsonLd(
      job({ salaryMin: 1, salaryMax: 2, salaryCurrency: 'USD' }),
      ORIGIN,
      'n',
    )!
    expect(onsite).not.toContain('TELECOMMUTE')
  })
})

describe('metadata and sitemaps', () => {
  it('gives every page a unique title and description', () => {
    const routes = [
      '/',
      '/jobs',
      '/pricing',
      '/about',
      '/privacy',
      '/terms',
      '/faq',
      '/auth/login',
      '/auth/signup',
      '/auth/recovery',
    ]
    const titles = routes.map((route) => pageMeta(route).title)
    const descriptions = routes.map((route) => pageMeta(route).description)
    expect(new Set(titles).size).toBe(routes.length)
    expect(new Set(descriptions).size).toBe(routes.length)
    for (const title of titles) expect(title.length).toBeLessThanOrEqual(70)
  })

  it('builds job titles within the display budget and canonical URLs', () => {
    const meta = jobMeta(
      job({ title: 'A very long senior data analyst position title that keeps going and going' }),
      ORIGIN,
    )
    expect(meta.title.length).toBeLessThanOrEqual(61)
    expect(meta.canonical).toBe(`${ORIGIN}/jobs/job_1`)
  })

  it('chunks sitemaps and only lists fresh, published, English jobs', () => {
    const fresh = job()
    const jobs = [
      fresh,
      job({ id: 'old', postedAt: new Date(now - 40 * 86_400_000).toISOString() }),
      job({ id: 'held', moderationState: 'hold' }),
      job({ id: 'de', quality: { isEnglish: false } as Job['quality'] }),
    ]
    const eligible = sitemapEligible(jobs)
    expect(eligible.map((item) => item.id)).toEqual(['job_1'])
    const xml = renderJobSitemap(ORIGIN, eligible, 1)
    expect(xml).toContain(`${ORIGIN}/jobs/job_1`)
    expect(renderSitemapIndex(ORIGIN, 2)).toContain('sitemap-jobs-2.xml')
    expect(render404(ORIGIN, 'n')).toContain('Page not found')
  })
})
