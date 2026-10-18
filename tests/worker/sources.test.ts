import { describe, expect, it } from 'vitest'
import { ashby, greenhouse, lever } from '../../src/server/sources/ats'
import { jsonLd, rss } from '../../src/server/sources/feeds'
import { isPathAllowed, parseRobots } from '../../src/server/sources/robots'
import { getParser, listParsers } from '../../src/server/sources/registry'
import { SEED_SOURCES } from '../../src/server/sources/seed'
import type { SourceRef } from '../../src/server/sources/types'
import greenhouseFixture from '../fixtures/greenhouse.json'
import leverFixture from '../fixtures/lever.json'
import ashbyFixture from '../fixtures/ashby.json'
import careersPage from '../fixtures/careers-page.html?raw'
import jobsFeed from '../fixtures/jobs.xml?raw'

function source(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    id: 'test-source',
    listingUrl: 'https://example.com/careers',
    options: { company: 'examplecorp' },
    verification: 'verified',
    verificationReason: "the employer's own board",
    ...overrides,
  }
}

function textFetch(body: string, contentType = 'application/json'): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } })) as typeof fetch
}

describe('greenhouse parser', () => {
  it('reads the board listing', async () => {
    const postings = await greenhouse.fetchPostings(
      source(),
      textFetch(JSON.stringify(greenhouseFixture)),
    )

    expect(postings).toHaveLength(2)

    const sre = postings[0]
    expect(sre.title).toBe('Senior Site Reliability Engineer')
    expect(sre.externalId).toBe('99101')
    expect(sre.company).toBe('examplecorp')
    expect(sre.location).toBe('Berlin, Germany')
    expect(sre.remote).toBe(false)
    expect(sre.description).toContain('Kubernetes')
    expect(sre.description).not.toContain('<p>')
    expect(sre.publishedAt).toBeNull() // Greenhouse's updated_at is not a publication date.
    expect(sre.tags).toContain('Engineering')
  })

  it('marks a remote posting as remote', async () => {
    const postings = await greenhouse.fetchPostings(
      source(),
      textFetch(JSON.stringify(greenhouseFixture)),
    )
    expect(postings[1].remote).toBe(true)
  })

  it('is marked as employer-verified', () => {
    expect(greenhouse.verification).toBe('verified')
  })
})

describe('lever parser', () => {
  it('reads the postings listing', async () => {
    const postings = await lever.fetchPostings(
      source({ options: { company: 'leverdemo' } }),
      textFetch(JSON.stringify(leverFixture)),
    )

    expect(postings).toHaveLength(1)
    expect(postings[0].title).toBe('Product Designer')
    expect(postings[0].location).toBe('Amsterdam, Netherlands')
    expect(postings[0].description).toContain('Own the design system.')
    expect(postings[0].description).toContain('Five years of product design.')
    expect(postings[0].applyUrl).toContain('/apply')
  })
})

describe('ashby parser', () => {
  it('reads the job board and notes a posting the source has closed', async () => {
    const postings = await ashby.fetchPostings(
      source({ options: { company: 'ashbydemo' } }),
      textFetch(JSON.stringify(ashbyFixture)),
    )

    expect(postings).toHaveLength(2)
    expect(postings[0].title).toBe('Data Scientist')
    expect(postings[0].closed).toBe(false)
    expect(postings[1].closed).toBe(true)
  })
})

describe('schema.org parser', () => {
  it('reads a JobPosting out of a careers page', async () => {
    const postings = await jsonLd.fetchPostings(
      source({ listingUrl: 'https://example.com/careers' }),
      textFetch(careersPage, 'text/html'),
    )

    expect(postings).toHaveLength(1)
    const posting = postings[0]
    expect(posting.title).toBe('Staff Platform Engineer')
    expect(posting.company).toBe('Example Industries')
    expect(posting.location).toBe('Toronto, ON')
    expect(posting.description).toContain('Own the platform team.')
    expect(posting.salary).toEqual({ min: 150000, max: 190000, currency: 'CAD', period: 'year' })
    expect(posting.publishedAt).toBe('2026-10-12')
    expect(posting.validThrough).toBe('2026-12-31')
    expect(posting.externalId).toBe('EX-2026-114')
  })

  it('is unverified by default, because the markup is self-declared', () => {
    expect(jsonLd.verification).toBe('unverified')
  })
})

describe('rss parser', () => {
  it('reads the items out of a feed', async () => {
    const postings = await rss.fetchPostings(
      source({ listingUrl: 'https://example.com/careers/feed' }),
      textFetch(jobsFeed, 'application/xml'),
    )

    expect(postings).toHaveLength(2)
    expect(postings[0].title).toBe('Backend Engineer (Python)')
    expect(postings[0].url).toBe('https://example.com/careers/backend-engineer-python')
    expect(postings[0].description).toContain('PostgreSQL')
    expect(postings[0].tags).toContain('Engineering')
    expect(postings[0].publishedAt).toBe('2026-10-13T08:00:00.000Z')
  })
})

describe('robots.txt', () => {
  it('reads the rules for a named agent', () => {
    const { rules } = parseRobots(['User-agent: *', 'Disallow: /private/', 'Allow: /'].join('\n'))
    expect(isPathAllowed(rules, '/private/secret')).toBe(false)
    expect(isPathAllowed(rules, '/jobs/1')).toBe(true)
  })

  it('gives a named agent its own rules', () => {
    const { rules } = parseRobots(
      ['User-agent: *', 'Allow: /', 'User-agent: RoleSignalBot', 'Disallow: /'].join('\n'),
    )
    expect(isPathAllowed(rules, '/anything')).toBe(false)
  })

  it('lets the longest rule win', () => {
    const { rules } = parseRobots(
      ['User-agent: *', 'Disallow: /jobs/', 'Allow: /jobs/public/'].join('\n'),
    )
    expect(isPathAllowed(rules, '/jobs/private/1')).toBe(false)
    expect(isPathAllowed(rules, '/jobs/public/1')).toBe(true)
  })

  it('reads a crawl delay', () => {
    const { crawlDelayMs } = parseRobots(['User-agent: *', 'Crawl-delay: 3'].join('\n'))
    expect(crawlDelayMs).toBe(3000)
  })
})

describe('the registry', () => {
  it('has a parser for every seed source', () => {
    for (const source of SEED_SOURCES) {
      expect(getParser(source.parser), `${source.id} has no parser`).toBeDefined()
    }
  })

  it('gives every source a unique id', () => {
    const ids = SEED_SOURCES.map((source) => source.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists the parsers', () => {
    expect(listParsers().length).toBeGreaterThanOrEqual(10)
  })
})
