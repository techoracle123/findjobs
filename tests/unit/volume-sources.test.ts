import { describe, expect, it } from 'vitest'
import { arbeitnow } from '../../src/server/sources/arbeitnow'
import { himalayas, themuse } from '../../src/server/sources/public-boards'
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
  it('stops on a short page and dedupes repeats', async () => {
    const mk = (from: number, count: number) => ({
      jobs: Array.from({ length: count }, (_, i) => ({
        id: `h${from + i}`,
        title: `Role ${from + i}`,
        companyName: 'RemoteCo',
        slug: `role-${from + i}`,
        description: 'Desc',
      })),
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('offset=100')) return json(mk(100, 3))
      return json(mk(0, 100))
    }) as typeof fetch
    const postings = await himalayas.fetchPostings(
      ref('himalayas', 'https://himalayas.app/jobs/api'),
      fetchImpl,
    )
    expect(postings).toHaveLength(103)
    expect(postings[0].remote).toBe(true)
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
})
