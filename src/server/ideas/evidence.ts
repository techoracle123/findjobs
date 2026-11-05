import type { IdeaCountry, IdeaEvidenceSnapshot, IdeaObservation } from '../../shared/ideas'
import { IDEA_CATEGORIES, IDEA_INDICATOR_IDS, MIN_IDEA_CATALOG_TOTAL } from './concepts'
import { catalogTotal } from './catalog'

export const IDEA_EVIDENCE_KEY = 'ideas:evidence:v1'
export { MIN_IDEA_CATALOG_TOTAL } from './concepts'

interface WorldBankMeta {
  page?: number
  pages?: number
  total?: number
  lastupdated?: string | null
}

interface WorldBankCountryRow {
  id: string
  iso2Code: string
  name: string
  region: { value: string }
  incomeLevel: { value: string }
}

interface WorldBankObservationRow {
  indicator: { id: string; value: string }
  countryiso3code: string
  date: string
  value: number | null
}

type WorldBankResponse<T> = [WorldBankMeta, T[]?]

const memory = new WeakMap<
  KVNamespace,
  { at: number; generation: number; value: IdeaEvidenceSnapshot | null }
>()
let cacheGeneration = 0
const indicatorUnits = new Map(
  IDEA_CATEGORIES.map((category) => [category.indicatorId, category.unit]),
)

async function worldBankJson<T>(
  path: string,
  fetcher: typeof fetch,
): Promise<WorldBankResponse<T>> {
  const response = await fetcher(`https://api.worldbank.org/v2/${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`World Bank returned HTTP ${response.status}`)
  const body = (await response.json()) as WorldBankResponse<T>
  if (!Array.isArray(body) || !Array.isArray(body[1])) {
    throw new Error('World Bank returned an unexpected response shape')
  }
  return body
}

function validSnapshot(value: unknown): value is IdeaEvidenceSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IdeaEvidenceSnapshot>
  return (
    candidate.version === 1 &&
    typeof candidate.refreshedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.refreshedAt)) &&
    Array.isArray(candidate.countries) &&
    typeof candidate.catalogTotal === 'number'
  )
}

export async function readIdeaEvidence(kv?: KVNamespace): Promise<IdeaEvidenceSnapshot | null> {
  if (!kv) return null
  const cached = memory.get(kv)
  if (cached && cached.generation === cacheGeneration && Date.now() - cached.at < 60_000)
    return cached.value
  const value = await kv.get<IdeaEvidenceSnapshot>(IDEA_EVIDENCE_KEY, {
    type: 'json',
    cacheTtl: 60,
  })
  const snapshot = validSnapshot(value) ? value : null
  memory.set(kv, { at: Date.now(), generation: cacheGeneration, value: snapshot })
  return snapshot
}

export function clearIdeaEvidenceCache(): void {
  cacheGeneration += 1
}

/** Fetches only most-recent, non-empty official observations in a ten-year window. */
export async function refreshIdeaEvidence(
  kv: KVNamespace,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  options: { requireMinimum?: boolean } = {},
): Promise<IdeaEvidenceSnapshot> {
  const currentYear = new Date(now).getUTCFullYear()
  const earliestYearAllowed = currentYear - 10
  const [countryMeta, countryRows] = await worldBankJson<WorldBankCountryRow>(
    'country?format=json&per_page=400',
    fetcher,
  )
  void countryMeta
  const countries = new Map<string, IdeaCountry>()
  for (const row of countryRows ?? []) {
    const aggregate = row.region?.value?.trim() === 'Aggregates'
    if (aggregate && row.id !== 'WLD') continue
    if (!/^[A-Z]{3}$/.test(row.id) || !row.name) continue
    countries.set(row.id, {
      iso3: row.id,
      iso2: row.id === 'WLD' ? 'WW' : row.iso2Code,
      name: row.id === 'WLD' ? 'Worldwide' : row.name,
      region: row.region?.value?.trim() || 'Worldwide',
      incomeLevel: row.incomeLevel?.value?.trim() || 'Not classified',
      observations: {},
    })
  }
  if (countries.size < 100 || !countries.has('NGA') || !countries.has('WLD')) {
    throw new Error('World Bank country metadata was incomplete')
  }

  let sourceLastUpdated = ''
  for (const indicatorId of IDEA_INDICATOR_IDS) {
    const path = `country/all/indicator/${encodeURIComponent(indicatorId)}?format=json&per_page=20000&mrnev=1&date=${earliestYearAllowed}%3A${currentYear}`
    const [meta, rows] = await worldBankJson<WorldBankObservationRow>(path, fetcher)
    if (meta.lastupdated && meta.lastupdated > sourceLastUpdated) {
      sourceLastUpdated = meta.lastupdated
    }
    let accepted = 0
    for (const row of rows ?? []) {
      const country = countries.get(row.countryiso3code)
      const year = Number(row.date)
      if (
        !country ||
        typeof row.value !== 'number' ||
        !Number.isFinite(row.value) ||
        !Number.isInteger(year) ||
        year < earliestYearAllowed ||
        year > currentYear
      ) {
        continue
      }
      const unit = indicatorUnits.get(indicatorId) ?? 'percent'
      const observation: IdeaObservation = {
        indicatorId,
        indicatorName: row.indicator.value,
        value: row.value,
        year,
        unit,
        sourceLastUpdated: meta.lastupdated || sourceLastUpdated || 'Not stated',
      }
      country.observations[indicatorId] = observation
      accepted += 1
    }
    // A broken or empty indicator must not silently collapse a whole field.
    if (accepted < 20) throw new Error(`World Bank returned too little evidence for ${indicatorId}`)
  }

  const snapshot: IdeaEvidenceSnapshot = {
    version: 1,
    refreshedAt: new Date(now).toISOString(),
    sourceLastUpdated: sourceLastUpdated || 'Not stated',
    earliestYearAllowed,
    countries: [...countries.values()].filter(
      (country) => Object.keys(country.observations).length > 0,
    ),
    catalogTotal: 0,
  }
  snapshot.catalogTotal = catalogTotal(snapshot)
  if (options.requireMinimum !== false && snapshot.catalogTotal < MIN_IDEA_CATALOG_TOTAL) {
    throw new Error(
      `Evidence supports ${snapshot.catalogTotal} localized ideas, below the required ${MIN_IDEA_CATALOG_TOTAL}`,
    )
  }
  await kv.put(IDEA_EVIDENCE_KEY, JSON.stringify(snapshot))
  memory.set(kv, { at: Date.now(), generation: cacheGeneration, value: snapshot })
  return snapshot
}
