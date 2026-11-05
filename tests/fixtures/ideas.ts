import type { IdeaEvidenceSnapshot, IdeaObservation } from '../../src/shared/ideas'
import { IDEA_CATEGORIES } from '../../src/server/ideas/concepts'

function code(index: number): string {
  const first = String.fromCharCode(65 + Math.floor(index / 26))
  const second = String.fromCharCode(65 + (index % 26))
  return `${first}${second}X`
}

export function observation(indicatorId: string, value = 50, year = 2024): IdeaObservation {
  const category = IDEA_CATEGORIES.find((entry) => entry.indicatorId === indicatorId)
  if (!category) throw new Error(`Unknown test indicator ${indicatorId}`)
  return {
    indicatorId,
    indicatorName: category.label,
    value,
    year,
    unit: category.unit,
    sourceLastUpdated: '2026-10-08',
  }
}

export function makeIdeaSnapshot(countryCount = 110): IdeaEvidenceSnapshot {
  const countries = Array.from({ length: countryCount }, (_, index) => {
    const iso3 = index === 0 ? 'NGA' : index === 1 ? 'WLD' : code(index)
    return {
      iso3,
      iso2: iso3 === 'WLD' ? 'WW' : iso3.slice(0, 2),
      name: iso3 === 'NGA' ? 'Nigeria' : iso3 === 'WLD' ? 'Worldwide' : `Test country ${index}`,
      region: 'Test region',
      incomeLevel: 'Test income',
      observations: Object.fromEntries(
        IDEA_CATEGORIES.map((category) => [
          category.indicatorId,
          observation(category.indicatorId, category.unit === 'per_1000' ? 2 : 20),
        ]),
      ),
    }
  })
  return {
    version: 1,
    refreshedAt: '2026-11-05T06:00:00.000Z',
    sourceLastUpdated: '2026-10-08',
    earliestYearAllowed: 2016,
    countries,
    // searchIdeas computes the public total from the actual eligible pairs;
    // this stored value is only a cache/deploy check and is replaced below.
    catalogTotal: countries.length * 144,
  }
}
