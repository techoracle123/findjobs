import { describe, expect, it } from 'vitest'
import {
  breezy,
  personio,
  teamtailor,
  parseJsonLdPostings,
} from '../../src/server/sources/ats-modern'
import { CADENCE_HOURS, cadenceHours, dueForRun } from '../../src/server/public-schedule'
import type { PUBLIC_SOURCES } from '../../src/server/public-feed'
import { isInMarket, remoteOpenToNigeria, inMarketShare } from '../../src/server/market'
import type { SourceRef } from '../../src/server/sources/types'
import type { Job } from '../../src/shared/types'

const ref = (options: Record<string, unknown>): SourceRef => ({
  id: 'test',
  listingUrl: 'https://example.com',
  options,
  verification: 'verified',
  verificationReason: 'test',
})

function fetchOf(body: string, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => JSON.parse(body),
      text: async () => body,
    }) as unknown as Response) as typeof fetch
}

describe('modern ATS parsers (Prompt 16)', () => {
  it('reads Teamtailor pages from JobPosting JSON-LD', async () => {
    const page = `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Backend Engineer',
      identifier: 'tt-1',
      description: '<p>Build things</p>',
      url: 'https://acme.teamtailor.com/jobs/1',
      datePosted: '2026-10-01',
      hiringOrganization: { name: 'Acme' },
      jobLocation: { address: { addressLocality: 'Lagos', addressCountry: 'NG' } },
    })}</script></html>`
    const postings = await teamtailor.fetchPostings(ref({ subdomain: 'acme' }), fetchOf(page))
    expect(postings).toHaveLength(1)
    expect(postings[0].title).toBe('Backend Engineer')
    expect(postings[0].company).toBe('Acme')
    expect(postings[0].location).toContain('Lagos')
    expect(parseJsonLdPostings(page)).toHaveLength(1)
  })

  it('reads Personio XML feeds', async () => {
    const xml = `<jobs><position><id>42</id><name>Data Engineer</name><office>Berlin (Remote)</office><employmentType>Full-time</employmentType><jobDescriptions><value>&lt;p&gt;Pipelines&lt;/p&gt;</value></jobDescriptions></position></jobs>`
    const postings = await personio.fetchPostings(
      ref({ company: 'Acme', xmlUrl: 'https://acme.jobs.personio.de/xml' }),
      fetchOf(xml),
    )
    expect(postings).toHaveLength(1)
    expect(postings[0].title).toBe('Data Engineer')
    expect(postings[0].remote).toBe(true)
    expect(postings[0].description).toContain('Pipelines')
  })

  it('reads Breezy JSON listings', async () => {
    const body = JSON.stringify([
      {
        id: 'b1',
        name: 'Product Designer',
        description: '<p>Design</p>',
        location: { name: 'Remote - Africa' },
        url: 'https://acme.breezy.hr/p/b1',
        tags: [{ name: 'design' }],
      },
    ])
    const postings = await breezy.fetchPostings(ref({ subdomain: 'acme' }), fetchOf(body))
    expect(postings).toHaveLength(1)
    expect(postings[0].title).toBe('Product Designer')
    expect(postings[0].tags).toEqual(['design'])
    expect(postings[0].remote).toBe(true)
  })

  it('fails closed when a source has no configured slug', async () => {
    await expect(teamtailor.fetchPostings(ref({}), fetchOf(''))).rejects.toThrow('subdomain')
    await expect(breezy.fetchPostings(ref({}), fetchOf(''))).rejects.toThrow('subdomain')
  })
})

describe('refresh cadence (Prompt 16)', () => {
  it('runs ATS every 2h, remote every 6h, Nigeria every 12h', () => {
    expect(cadenceHours('ats')).toBe(2)
    expect(cadenceHours('remote')).toBe(6)
    expect(cadenceHours('nigeria')).toBe(12)
    expect(CADENCE_HOURS.hourly).toBe(2)
  })

  it('only runs sources when their cadence slot arrives', () => {
    const sources = [
      { id: 'a', tier: 'ats' },
      { id: 'r', tier: 'remote' },
      { id: 'n', tier: 'nigeria' },
    ] as never as typeof PUBLIC_SOURCES
    expect(dueForRun(sources, 2).map((s) => s.id)).toEqual(['a'])
    expect(dueForRun(sources, 4).map((s) => s.id)).toEqual(['a'])
    expect(dueForRun(sources, 0).map((s) => s.id)).toEqual(['a', 'r', 'n'])
    expect(dueForRun(sources, 6).map((s) => s.id)).toEqual(['a', 'r'])
    expect(dueForRun(sources, 12, new Set(['a'])).map((s) => s.id)).toEqual(['r', 'n'])
  })
})

describe('in-market definition (Prompt 16)', () => {
  const job = (country: string | null, workMode: Job['workMode']): Job =>
    ({ locationCountry: country ?? '', workMode }) as Job

  it('counts Nigeria-based listings in any work mode', () => {
    expect(isInMarket(job('NG', 'onsite'))).toBe(true)
    expect(isInMarket(job('NG', 'hybrid'))).toBe(true)
  })

  it('counts remote listings open to Nigeria, excludes remote locked elsewhere', () => {
    expect(isInMarket(job(null, 'remote'))).toBe(true)
    expect(isInMarket(job('WORLDWIDE', 'remote'))).toBe(true)
    expect(isInMarket(job('US', 'remote'))).toBe(false)
    expect(isInMarket(job('US,GB', 'remote'))).toBe(false)
    expect(isInMarket(job('US,NG', 'remote'))).toBe(true)
    expect(remoteOpenToNigeria(job('US', 'remote'))).toBe(false)
  })

  it('excludes onsite listings outside Nigeria', () => {
    expect(isInMarket(job('US', 'onsite'))).toBe(false)
  })

  it('measures in-market share', () => {
    const jobs = [job('NG', 'onsite'), job('US', 'remote'), job(null, 'remote')]
    expect(inMarketShare(jobs)).toBeCloseTo(2 / 3)
  })
})
