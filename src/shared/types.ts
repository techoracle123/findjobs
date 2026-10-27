export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export type Seniority =
  'unknown' | 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'lead' | 'principal'

export type EligibilityTier = 'eligible' | 'unknown' | 'restricted'

export type Sponsorship = 'available' | 'unavailable' | 'unknown'

export type SalaryPeriod = 'hour' | 'month' | 'year' | 'unknown'

export type VerificationLevel = 'verified' | 'unverified' | 'stale'

export type JobStatus = 'open' | 'closed' | 'unknown'

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
  /** Lightweight search excerpt; detail pages must load the full listing. */
  descriptionPreview?: boolean
  requiredSkills: string[]
  usefulSkills: string[]
  eligibleCountries: string[]
  sponsorship: Sponsorship
  sourceName: string
  sourceUrl: string
  postedAt: string
  isDemo: boolean
  /** Whether the posting could be confirmed with the employer. */
  verification?: VerificationLevel
  /** Why it carries that level, in words the interface can show. */
  verificationReason?: string
  verifiedAt?: string
  /** Whether the role is still open. */
  jobStatus?: JobStatus
  closedAt?: string
  closedReason?: string
  /** When the posting was first seen, and when it was last confirmed alive. */
  firstSeenAt?: string
  lastSeenAt?: string
  /** Where to apply, which is not always the posting's own page. */
  applyUrl?: string
  companyUrl?: string
  sourceKind?: string
  sourcePlatform?: string
  /** 'external' opens the employer's own application; 'onsite' supports Fast Apply. */
  applyMode?: 'external' | 'onsite'
  /** ISO 639-1 code of the listing's own language; 'unknown' when undetectable. */
  language?: string
  /** Set when the listing itself demands another language; otherwise null. */
  languageRequired?: string | null
  normalizerVersion?: string
  /** Per-field confidence, completeness and evidence produced by the quality pass. */
  quality?: JobQuality
}

export interface JobQuality {
  normalizerVersion: string
  language: string
  isEnglish: boolean
  languageRequired: string | null
  location: { city: string | null; state: string | null; country: string | null }
  confidence: Record<string, number>
  completeness: number
  salaryRaw: string | null
  salaryPlausible: boolean
  skillEvidence: { name: string; required: boolean; confidence: number; sentence: string }[]
}

export interface Profile {
  skills: string[]
  targetRoleFamilies: string[]
  targetSeniority: Seniority[]
  preferredWorkModes: WorkMode[]
  workCountry: string
}

export type ScoreComponentKey =
  'requiredSkills' | 'usefulSkills' | 'roleFamily' | 'seniority' | 'workMode'

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
  source: 'frankfurter' | 'exchangerate-api' | 'open-currency' | 'fallback'
  rates: Record<string, number>
}

export interface ApiHealth {
  ok: boolean
  appMode: string
  aiBinding: boolean
  telegramConfigured: boolean
  /** Cloudflare Access is configured and can issue identities. */
  accessConfigured: boolean
  /** A payment provider is configured. */
  billingConfigured: boolean
  /** Whether the account routes require a verified identity. */
  authenticationRequired: boolean
  /** Where to send a person to sign in, when identity is available. */
  accessLoginUrl: string | null
  dataSource: 'd1' | 'fixture' | 'public-snapshot'
  /** Public browsing can continue independently when this is false. */
  storageAvailable?: boolean
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
  provider: 'workers-ai' | 'openrouter' | 'keyword-fallback'
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

export interface ApplicationTip {
  title: string
  text: string
}
export interface JobAdvice {
  tips: ApplicationTip[]
  provider: 'openrouter' | 'listing-based'
  message?: string
}
export interface JobTranslation {
  description: string
  originalLanguage: string
  translated: boolean
  available: boolean
  message?: string
}
