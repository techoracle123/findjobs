export type IdeaFormat = 'physical' | 'software' | 'hybrid'
export type IdeaRoute = 'build' | 'sell' | 'both'

export interface IdeaObservation {
  indicatorId: string
  indicatorName: string
  value: number
  year: number
  unit: 'percent' | 'per_1000' | 'pm25'
  sourceLastUpdated: string
}

export interface IdeaCountry {
  iso3: string
  iso2: string
  name: string
  region: string
  incomeLevel: string
  observations: Record<string, IdeaObservation>
}

export interface IdeaEvidenceSnapshot {
  version: 1
  refreshedAt: string
  sourceLastUpdated: string
  earliestYearAllowed: number
  countries: IdeaCountry[]
  catalogTotal: number
  /** Exact eligible concept counts, computed when the evidence is stored. */
  countryCounts?: Record<string, number>
}

export interface IdeaEvidence {
  indicatorId: string
  indicatorName: string
  value: number
  unit: IdeaObservation['unit']
  displayValue: string
  year: number
  sourceName: string
  sourceUrl: string
  sourceLastUpdated: string
  interpretation: string
}

export interface ProductIdea {
  id: string
  conceptId: string
  title: string
  categoryId: string
  categoryLabel: string
  location: {
    iso3: string
    iso2: string
    name: string
    region: string
  }
  format: IdeaFormat
  route: IdeaRoute
  buyer: string
  problem: string
  product: string
  firstVersion: string
  validationSteps: string[]
  revenueModel: string
  testWindow: string
  skills: string[]
  risks: string[]
  evidence: IdeaEvidence
  /** Internal evidence ordering only. This is not a market or success score. */
  evidenceStrength: number
}

export interface IdeaFacet {
  id: string
  label: string
  count: number
}

export interface IdeaListResponse {
  ideas: ProductIdea[]
  total: number
  catalogTotal: number
  limit: number
  offset: number
  countries: Array<{
    iso3: string
    iso2: string
    name: string
    region: string
    count: number
  }>
  facets: {
    categories: IdeaFacet[]
    formats: IdeaFacet[]
  }
  evidence: {
    refreshedAt: string
    sourceLastUpdated: string
    countryCount: number
    indicatorCount: number
  }
}

export interface IdeaDetailResponse {
  idea: ProductIdea
  related: ProductIdea[]
  catalogTotal: number
}

export interface LiveTrend {
  id: string
  query: string
  geo: string
  countryName: string
  trafficLabel: string
  approximateSearches: number
  startedAt: string
  exploreUrl: string
  news: Array<{ title: string; url: string; source: string }>
}

export interface TrendResponse {
  trends: LiveTrend[]
  geo: string
  fetchedAt: string
  stale: boolean
  sourceName: string
  sourceUrl: string
  message?: string
}

export const IDEA_UNIT_LABELS: Record<IdeaObservation['unit'], string> = {
  percent: 'Percent',
  per_1000: 'For every 1,000 people',
  pm25: 'Micrograms in each cubic metre of air (µg/m³)',
}

export const IDEA_PLAIN_FIGURE_LABELS: Record<string, string> = {
  'EG.ELC.ACCS.ZS': 'People with an electricity connection',
  'SH.H2O.BASW.ZS': 'People with basic drinking water',
  'SH.STA.BASS.ZS': 'People with basic sanitation',
  'IT.NET.USER.ZS': 'People using the internet',
  'SE.ADT.LITR.ZS': 'Adults who can read and write',
  'SL.UEM.1524.ZS': 'Young people looking for work without a job',
  'SN.ITK.DEFC.ZS': 'People who do not get enough food',
  'SH.MED.PHYS.ZS': 'Doctors for every 1,000 people',
  'EN.ATM.PM25.MC.M3': 'Tiny particles in the air',
  'SP.URB.GROW': 'Growth in towns and cities',
  'FP.CPI.TOTL.ZG': 'How fast everyday prices are rising',
  'SP.RUR.TOTL.ZS': 'People living in rural areas',
  'EG.CFT.ACCS.ZS': 'People with clean fuels and equipment for cooking',
  'FX.OWN.TOTL.ZS': 'Adults with a financial account',
  'SP.POP.65UP.TO.ZS': 'People aged 65 and over',
}

export const IDEA_FORMAT_LABELS: Record<IdeaFormat, string> = {
  physical: 'Physical product',
  software: 'Software or app',
  hybrid: 'Product and software',
}

export const IDEA_ROUTE_LABELS: Record<IdeaRoute, string> = {
  build: 'Make it yourself',
  sell: 'Buy it and resell it',
  both: 'Make it yourself or buy and resell it',
}
