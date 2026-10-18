export type WorkMode = 'remote' | 'hybrid' | 'onsite'

export type Seniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'lead'
  | 'principal'

export type EligibilityTier = 'eligible' | 'unknown' | 'restricted'

export type Sponsorship = 'available' | 'unavailable' | 'unknown'

export type SalaryPeriod = 'hour' | 'month' | 'year'

export interface Job {
  id: string
  title: string
  company: string
  roleFamily: string
  seniority: Seniority
  workMode: WorkMode
  locationCountry: string
  locationLabel: string
  salaryMin: number
  salaryMax: number
  salaryCurrency: string
  salaryPeriod: SalaryPeriod
  description: string
  requiredSkills: string[]
  usefulSkills: string[]
  eligibleCountries: string[]
  sponsorship: Sponsorship
  sourceName: string
  sourceUrl: string
  postedAt: string
  isDemo: boolean
}

export interface Profile {
  skills: string[]
  targetRoleFamilies: string[]
  targetSeniority: Seniority[]
  preferredWorkModes: WorkMode[]
  workCountry: string
}

export type ScoreComponentKey =
  | 'requiredSkills'
  | 'usefulSkills'
  | 'roleFamily'
  | 'seniority'
  | 'workMode'

export interface ScoreComponent {
  key: ScoreComponentKey
  label: string
  weight: number
  earned: number
  applicable: boolean
  detail: string
  matched: string[]
  missing: string[]
}

export interface ScoredJob {
  job: Job
  score: number
  tier: EligibilityTier
  tierReason: string
  components: ScoreComponent[]
  matchedSkills: string[]
  missingSkills: string[]
}

export interface RatesPayload {
  base: string
  date: string
  source: 'frankfurter' | 'fallback'
  rates: Record<string, number>
}

export interface ApiHealth {
  ok: boolean
  appMode: string
  aiBinding: boolean
  telegramConfigured: boolean
  dataSource: 'd1' | 'fixture'
  jobCount: number
  ratesDate: string
  ratesSource: string
}

export interface CvSuggestion {
  skills: string[]
  roleFamilies: string[]
  seniority: Seniority[]
  workModes: WorkMode[]
  summary: string
  provider: 'workers-ai' | 'keyword-fallback'
  notes: string[]
}

export interface SavedApplication {
  jobId: string
  savedAt: string
  status: 'saved' | 'applied'
  appliedAt?: string
  note?: string
}

export interface AlertPreference {
  id: string
  label: string
  query: string
  channels: string[]
  enabled: boolean
}
