import type {
  IdeaCountry,
  IdeaEvidenceSnapshot,
  IdeaFacet,
  IdeaObservation,
  IdeaListResponse,
  ProductIdea,
} from '../../shared/ideas'
import { normalizeSearchText } from '../../shared/search-matching'
import { IDEA_CATEGORIES, IDEA_CONCEPTS, type IdeaCategory, type IdeaConcept } from './concepts'

interface Candidate {
  concept: IdeaConcept
  category: IdeaCategory
  country: IdeaCountry
  observation: IdeaObservation
  strength: number
}

interface IdeaIndex {
  snapshot: IdeaEvidenceSnapshot
  candidates: Candidate[] | null
  byCountry: Map<string, Candidate[]>
  countryById: Map<string, IdeaCountry>
  countries: IdeaListResponse['countries']
  catalogTotal: number
}

export interface IdeaQuery {
  country?: string
  category?: string
  format?: string
  q?: string
  limit?: number
  offset?: number
  sort?: string
}

const categoryById = new Map(IDEA_CATEGORIES.map((entry) => [entry.id, entry]))
const conceptById = new Map(IDEA_CONCEPTS.map((entry) => [entry.id, entry]))
const indexCache = new WeakMap<IdeaEvidenceSnapshot, IdeaIndex>()

function strengthFor(concept: IdeaConcept, country: IdeaCountry): number | null {
  const category = categoryById.get(concept.categoryId)
  const observation = country.observations[category?.indicatorId ?? '']
  if (!category || !observation || !Number.isFinite(observation.value)) return null
  const strength =
    category.direction === 'lower_access'
      ? ((category.scaleMax - observation.value) / category.scaleMax) * 100
      : (observation.value / category.scaleMax) * 100
  // A zero-strength observation supplies no problem pressure under this
  // deliberately simple rule. It must not inflate the public idea total.
  return strength > 0 ? Math.min(100, strength) : null
}

function candidateFor(concept: IdeaConcept, country: IdeaCountry): Candidate | null {
  const strength = strengthFor(concept, country)
  if (strength === null) return null
  const category = categoryById.get(concept.categoryId)!
  const observation = country.observations[category.indicatorId]!
  return { concept, category, country, observation, strength }
}

function buildIndex(snapshot: IdeaEvidenceSnapshot): IdeaIndex {
  const cached = indexCache.get(snapshot)
  if (cached) return cached
  let catalogTotal = 0
  const countries = snapshot.countries
    .map((country) => {
      // Stored counts avoid a whole-catalogue scan on each cold request.
      // Older snapshots still compute the exact count once, without creating
      // 25,000 short-lived candidate objects.
      const stored = snapshot.countryCounts?.[country.iso3]
      let count = 0
      if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 0) {
        count = stored
      } else {
        for (const concept of IDEA_CONCEPTS) {
          if (strengthFor(concept, country) !== null) count += 1
        }
      }
      catalogTotal += count
      return {
        iso3: country.iso3,
        iso2: country.iso2,
        name: country.iso3 === 'WLD' ? 'Worldwide' : country.name,
        region: country.region,
        count,
      }
    })
    .filter((country) => country.count > 0)
    .sort((a, b) => {
      if (a.iso3 === 'WLD') return -1
      if (b.iso3 === 'WLD') return 1
      if (a.iso3 === 'NGA') return -1
      if (b.iso3 === 'NGA') return 1
      return a.name.localeCompare(b.name)
    })
  const index: IdeaIndex = {
    snapshot,
    candidates: null,
    byCountry: new Map<string, Candidate[]>(),
    countryById: new Map(snapshot.countries.map((country) => [country.iso3, country])),
    countries,
    catalogTotal,
  }
  indexCache.set(snapshot, index)
  return index
}

function countryCandidates(index: IdeaIndex, countryId: string): Candidate[] {
  const cached = index.byCountry.get(countryId)
  if (cached) return cached
  const country = index.countryById.get(countryId)
  const candidates: Candidate[] = []
  if (country) {
    for (const concept of IDEA_CONCEPTS) {
      const candidate = candidateFor(concept, country)
      if (candidate) candidates.push(candidate)
    }
  }
  index.byCountry.set(countryId, candidates)
  return candidates
}

function allCandidates(index: IdeaIndex): Candidate[] {
  if (index.candidates) return index.candidates
  index.candidates = index.snapshot.countries.flatMap((country) =>
    countryCandidates(index, country.iso3),
  )
  return index.candidates
}

function displayValue(observation: IdeaObservation): string {
  const digits = observation.unit === 'per_1000' ? 2 : 1
  const value = observation.value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
  if (observation.unit === 'percent') return `${value}%`
  if (observation.unit === 'per_1000') return `${value} physicians per 1,000 people`
  return `${value} µg/m³`
}

function materialize(candidate: Candidate): ProductIdea {
  const { concept, category, country, observation } = candidate
  const place = country.iso3 === 'WLD' ? 'Worldwide' : country.name
  const localTitle =
    country.iso3 === 'WLD' ? `${concept.title} worldwide` : `${concept.title} in ${place}`
  const sourceUrl = `https://data.worldbank.org/indicator/${encodeURIComponent(category.indicatorId)}?locations=${encodeURIComponent(country.iso3)}`
  return {
    id: `${concept.id}:${country.iso3}`,
    conceptId: concept.id,
    title: localTitle,
    categoryId: category.id,
    categoryLabel: category.label,
    location: {
      iso3: country.iso3,
      iso2: country.iso2,
      name: place,
      region: country.region,
    },
    format: concept.format,
    route: concept.route,
    buyer: concept.buyer,
    problem: category.problem,
    product: concept.product,
    firstVersion: concept.firstVersion,
    validationSteps: [
      `Speak with at least five ${concept.buyer} in ${place}. Ask about ${category.validationFocus}.`,
      `Offer this small first version: ${concept.firstVersion}`,
      'Ask for a real next step, such as a paid preorder, an agreement to run a small trial, or another order. Kind words do not prove that people will buy.',
      `Write down what would make you stop. Check the official figures again and remember their limits: ${category.interpretation}`,
    ],
    revenueModel: concept.revenueModel,
    testWindow: concept.testWindow,
    skills: [...category.skills],
    risks: [
      ...category.risks,
      ...(concept.format === 'software'
        ? []
        : [
            'Use approved suppliers and check the warranty, safety and return terms before reselling equipment.',
          ]),
      'The official figure helps explain the broader problem. It does not prove that people will buy this exact product.',
    ],
    evidence: {
      indicatorId: observation.indicatorId,
      indicatorName: observation.indicatorName,
      value: observation.value,
      unit: observation.unit,
      displayValue: displayValue(observation),
      year: observation.year,
      sourceName: 'World Bank, World Development Indicators (CC BY 4.0)',
      sourceUrl,
      sourceLastUpdated: observation.sourceLastUpdated,
      interpretation: category.interpretation,
    },
    evidenceStrength: Math.round(candidate.strength),
  }
}

function matches(candidate: Candidate, query: string): boolean {
  if (!query) return true
  const text = normalizeSearchText(
    `${candidate.concept.title} ${candidate.concept.product} ${candidate.concept.buyer} ${candidate.concept.keywords.join(' ')} ${candidate.category.label} ${candidate.country.name} ${candidate.country.region} ${candidate.concept.format}`,
  )
  return normalizeSearchText(query)
    .split(' ')
    .filter(Boolean)
    .every((term) => text.includes(term))
}

function filtered(index: IdeaIndex, query: IdeaQuery, omit?: 'category' | 'format'): Candidate[] {
  const country = (query.country || 'NGA').toUpperCase()
  const category = omit === 'category' ? '' : (query.category ?? '')
  const format = omit === 'format' ? '' : (query.format ?? '')
  const text = (query.q ?? '').trim().slice(0, 100)
  const source = country === 'ALL' ? allCandidates(index) : countryCandidates(index, country)
  return source.filter(
    (candidate) =>
      (!category || candidate.category.id === category) &&
      (!format || candidate.concept.format === format) &&
      matches(candidate, text),
  )
}

function sorted(candidates: Candidate[], query: IdeaQuery): Candidate[] {
  const text = normalizeSearchText(query.q ?? '')
  return [...candidates].sort((a, b) => {
    if (text) {
      const aTitle = normalizeSearchText(a.concept.title).includes(text) ? 1 : 0
      const bTitle = normalizeSearchText(b.concept.title).includes(text) ? 1 : 0
      if (aTitle !== bTitle) return bTitle - aTitle
    }
    if (query.sort === 'recent' && a.observation.year !== b.observation.year) {
      return b.observation.year - a.observation.year
    }
    return (
      b.strength - a.strength ||
      b.observation.year - a.observation.year ||
      a.concept.title.localeCompare(b.concept.title) ||
      a.country.name.localeCompare(b.country.name)
    )
  })
}

function facets(candidates: Candidate[], key: 'category' | 'format'): IdeaFacet[] {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    const id = key === 'category' ? candidate.category.id : candidate.concept.format
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const labels: Record<string, string> = {
    physical: 'Physical product',
    software: 'Software product',
    hybrid: 'Physical product with software',
  }
  for (const category of IDEA_CATEGORIES) labels[category.id] = category.label
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: labels[id] ?? id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function searchIdeas(snapshot: IdeaEvidenceSnapshot, query: IdeaQuery): IdeaListResponse {
  const index = buildIndex(snapshot)
  const matchesAll = filtered(index, query)
  const limit = Math.min(48, Math.max(1, Math.floor(query.limit ?? 24)))
  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const page = sorted(matchesAll, query).slice(offset, offset + limit)
  return {
    ideas: page.map(materialize),
    total: matchesAll.length,
    catalogTotal: index.catalogTotal,
    limit,
    offset,
    countries: index.countries,
    facets: {
      categories: facets(filtered(index, query, 'category'), 'category'),
      formats: facets(filtered(index, query, 'format'), 'format'),
    },
    evidence: {
      refreshedAt: snapshot.refreshedAt,
      sourceLastUpdated: snapshot.sourceLastUpdated,
      countryCount: index.countries.filter((country) => country.iso3 !== 'WLD').length,
      indicatorCount: IDEA_CATEGORIES.length,
    },
  }
}

export function findIdea(
  snapshot: IdeaEvidenceSnapshot,
  id: string,
): {
  idea: ProductIdea
  related: ProductIdea[]
  catalogTotal: number
} | null {
  const separator = id.lastIndexOf(':')
  if (separator < 1) return null
  const conceptId = id.slice(0, separator)
  const countryId = id.slice(separator + 1).toUpperCase()
  const concept = conceptById.get(conceptId)
  const index = buildIndex(snapshot)
  const local = countryCandidates(index, countryId)
  const candidate = local.find((entry) => entry.concept.id === conceptId)
  if (!concept || !candidate) return null
  const related = sorted(
    local.filter(
      (entry) => entry.category.id === candidate.category.id && entry.concept.id !== conceptId,
    ),
    {},
  )
    .slice(0, 4)
    .map(materialize)
  return { idea: materialize(candidate), related, catalogTotal: index.catalogTotal }
}

export function catalogSummary(snapshot: IdeaEvidenceSnapshot) {
  const index = buildIndex(snapshot)
  return { catalogTotal: index.catalogTotal, countries: index.countries }
}

export function catalogTotal(snapshot: IdeaEvidenceSnapshot): number {
  return buildIndex(snapshot).catalogTotal
}
