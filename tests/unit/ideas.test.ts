import { describe, expect, it } from 'vitest'
import {
  IDEA_CATEGORIES,
  IDEA_CONCEPTS,
  MIN_IDEA_CATALOG_TOTAL,
} from '../../src/server/ideas/concepts'
import { findIdea, searchIdeas } from '../../src/server/ideas/catalog'
import { makeIdeaSnapshot } from '../fixtures/ideas'
import { parseGoogleTrends } from '../../src/server/ideas/trends'

describe('localized product idea catalogue', () => {
  it('has twelve detailed concepts in each of twelve fields and all three formats', () => {
    expect(IDEA_CATEGORIES).toHaveLength(12)
    expect(IDEA_CONCEPTS).toHaveLength(144)
    expect(new Set(IDEA_CONCEPTS.map((idea) => idea.format))).toEqual(
      new Set(['physical', 'software', 'hybrid']),
    )
    for (const idea of IDEA_CONCEPTS) {
      expect(idea.buyer.length).toBeGreaterThan(10)
      expect(idea.product.length).toBeGreaterThan(40)
      expect(idea.firstVersion.length).toBeGreaterThan(40)
      expect(idea.revenueModel.length).toBeGreaterThan(10)
    }
  })

  it('computes more than 15,000 ideas from eligible observations, without a hardcoded marketing total', () => {
    const snapshot = makeIdeaSnapshot()
    const response = searchIdeas(snapshot, { country: 'ALL', limit: 24 })
    expect(response.catalogTotal).toBe(snapshot.countries.length * 144)
    expect(response.catalogTotal).toBeGreaterThanOrEqual(MIN_IDEA_CATALOG_TOTAL)
    expect(response.total).toBe(response.catalogTotal)
    expect(response.ideas).toHaveLength(24)
    expect(response.evidence.countryCount).toBe(snapshot.countries.length - 1)
    expect(response.evidence.indicatorCount).toBe(12)
  })

  it('filters by country, category, format and search, with stable pagination', () => {
    const snapshot = makeIdeaSnapshot()
    const nigeria = searchIdeas(snapshot, { country: 'NGA', limit: 12 })
    expect(nigeria.total).toBe(144)
    expect(nigeria.ideas.every((idea) => idea.location.iso3 === 'NGA')).toBe(true)
    const software = searchIdeas(snapshot, { country: 'NGA', format: 'software', limit: 48 })
    expect(software.total).toBeGreaterThan(0)
    expect(software.ideas.every((idea) => idea.format === 'software')).toBe(true)
    const energy = searchIdeas(snapshot, { country: 'NGA', category: 'energy-access', limit: 48 })
    expect(energy.total).toBe(12)
    const solar = searchIdeas(snapshot, { country: 'NGA', q: 'solar', limit: 48 })
    expect(solar.total).toBeGreaterThan(0)
    expect(
      solar.ideas.some((idea) => `${idea.title} ${idea.product}`.toLowerCase().includes('solar')),
    ).toBe(true)
    expect(solar.ideas.every((idea) => idea.categoryId === 'energy-access')).toBe(true)
    const first = searchIdeas(snapshot, { country: 'ALL', limit: 12, offset: 0 })
    const second = searchIdeas(snapshot, { country: 'ALL', limit: 12, offset: 12 })
    expect(first.ideas.map((idea) => idea.id)).not.toEqual(second.ideas.map((idea) => idea.id))
    expect(new Set([...first.ideas, ...second.ideas].map((idea) => idea.id)).size).toBe(24)
  })

  it('returns a complete detail brief with exact evidence and related ideas', () => {
    const snapshot = makeIdeaSnapshot()
    const list = searchIdeas(snapshot, { country: 'NGA', q: 'solar charging kit', limit: 1 })
    const id = list.ideas[0].id
    const detail = findIdea(snapshot, id)
    expect(detail).not.toBeNull()
    expect(detail?.idea.id).toBe(id)
    expect(detail?.idea.validationSteps).toHaveLength(4)
    expect(detail?.idea.risks.length).toBeGreaterThan(2)
    expect(detail?.idea.evidence.value).toBe(20)
    expect(detail?.idea.evidence.unit).toBe('percent')
    expect(detail?.idea.evidence.displayValue).toBe('20%')
    expect(detail?.idea.evidence.year).toBe(2024)
    expect(detail?.idea.evidence.sourceLastUpdated).toBe('2026-10-08')
    expect(detail?.idea.evidence.sourceUrl).toContain('data.worldbank.org/indicator/')
    expect(detail?.related.length).toBeGreaterThan(0)
    expect(detail?.related.every((idea) => idea.id !== id)).toBe(true)
    expect(findIdea(snapshot, 'not-an-idea')).toBeNull()
  })

  it('parses trend traffic labels and nested news without turning attention into demand', () => {
    const trends = parseGoogleTrends(
      `<rss><channel><item><title><![CDATA[Solar & repair]]></title><pubDate>Thu, 05 Nov 2026 05:30:00 GMT</pubDate><ht:approx_traffic>20K+</ht:approx_traffic><ht:news_item><ht:news_item_title><![CDATA[A & B report]]></ht:news_item_title><ht:news_item_url>https://example.com/report?a=1&amp;b=2</ht:news_item_url><ht:news_item_source>Example News</ht:news_item_source></ht:news_item></item></channel></rss>`,
      'NG',
      'Nigeria',
    )
    expect(trends).toHaveLength(1)
    expect(trends[0].query).toBe('Solar & repair')
    expect(trends[0].trafficLabel).toBe('20K+')
    expect(trends[0].approximateSearches).toBe(20_000)
    expect(trends[0].news[0]).toEqual({
      title: 'A & B report',
      url: 'https://example.com/report?a=1&b=2',
      source: 'Example News',
    })
    expect(trends[0].exploreUrl).toContain('geo=NG')
  })
})
