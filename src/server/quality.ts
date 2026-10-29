import { franc } from 'franc-min'
import type { Job, SalaryPeriod, Seniority, WorkMode } from '../shared/types'
import {
  NORMALIZER_VERSION,
  QUALITY_FLOORS,
  QUALITY_FIELDS,
  type FieldCoverage,
  type QualitySnapshot,
} from '../shared/quality'
import { extractSkills, type SkillMatch } from '../shared/skills-dictionary'
import { scamScore } from './trust'

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
  skillEvidence: SkillMatch[]
}

/* ---------------- language ---------------- */

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'en',
  deu: 'de',
  fra: 'fr',
  spa: 'es',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  ara: 'ar',
  zul: 'zu',
  hau: 'ha',
  yor: 'yo',
  ibo: 'ig',
  swa: 'sw',
}

const REQUIRED_LANGUAGE_PATTERNS: { code: string; pattern: RegExp }[] = [
  {
    code: 'de',
    pattern:
      /\b(?:german(?:[- ]required| fluency| speaking)?|fließend deutsch|deutschkenntnisse|native german|c1 german)\b/i,
  },
  {
    code: 'fr',
    pattern:
      /\b(?:french(?:[- ]required| fluency| speaking)?|français courant|native french|c1 french)\b/i,
  },
  {
    code: 'es',
    pattern: /\b(?:spanish(?:[- ]required| fluency| speaking)?|español|native spanish)\b/i,
  },
  { code: 'pt', pattern: /\b(?:portuguese(?:[- ]required| fluency| speaking)?)\b/i },
  { code: 'nl', pattern: /\b(?:dutch(?:[- ]required| fluency| speaking)?)\b/i },
  { code: 'ar', pattern: /\b(?:arabic(?:[- ]required| fluency| speaking)?)\b/i },
]

export function detectLanguage(
  title: string,
  description: string,
): {
  language: string
  isEnglish: boolean
  languageRequired: string | null
} {
  const sample = `${title} ${description}`.slice(0, 4000)
  const iso3 = sample.trim().length >= 40 ? franc(sample, { minLength: 20 }) : 'und'
  const language = LANGUAGE_NAMES[iso3] ?? (iso3 === 'und' ? 'unknown' : iso3)
  const required = REQUIRED_LANGUAGE_PATTERNS.find((entry) => entry.pattern.test(sample))
  return {
    language,
    isEnglish: language === 'en' && !required,
    languageRequired: required && required.code !== 'en' ? required.code : null,
  }
}

/* ---------------- location gazetteer ---------------- */

const NIGERIA_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
]
const NIGERIA_CITIES = [
  'Lagos',
  'Abuja',
  'Kano',
  'Ibadan',
  'Port Harcourt',
  'Benin City',
  'Kaduna',
  'Enugu',
  'Onitsha',
  'Aba',
  'Jos',
  'Warri',
  'Calabar',
  'Uyo',
  'Maiduguri',
  'Sokoto',
  'Ilorin',
  'Abeokuta',
  'Owerri',
  'Yola',
  'Makurdi',
  'Bauchi',
  'Osogbo',
  'Ado-Ekiti',
  'Lokoja',
  'Minna',
  'Gombe',
  'Awka',
  'Asaba',
  'Akure',
  'Nnewi',
  'Zaria',
  'Katsina',
  'Nasarawa',
]

export interface StructuredLocation {
  city: string | null
  state: string | null
  country: string | null
}

/** Country names as boards actually write them in location labels. */
const COUNTRY_NAMES: [RegExp, string][] = [
  [/\bnigeria\b/i, 'NG'],
  [/\b(?:united states|usa|u\.s\.a\.?)\b/i, 'US'],
  [/\b(?:united kingdom|uk|u\.k\.|england|scotland|wales|great britain)\b/i, 'GB'],
  [/\bgermany\b|\bdeutschland\b/i, 'DE'],
  [/\bfrance\b/i, 'FR'],
  [/\bspain\b/i, 'ES'],
  [/\bitaly\b|\bitalia\b/i, 'IT'],
  [/\bnetherlands\b|\bnederland\b/i, 'NL'],
  [/\bpoland\b|\bpolska\b/i, 'PL'],
  [/\bportugal\b/i, 'PT'],
  [/\bireland\b/i, 'IE'],
  [/\bsweden\b|\bsverige\b/i, 'SE'],
  [/\bswitzerland\b|\bschweiz\b|\bsuisse\b/i, 'CH'],
  [/\baustria\b/i, 'AT'],
  [/\bbelgium\b/i, 'BE'],
  [/\bcanada\b/i, 'CA'],
  [/\bmexico\b/i, 'MX'],
  [/\bbrazil\b|\bbrasil\b/i, 'BR'],
  [/\bargentina\b/i, 'AR'],
  [/\bcolombia\b/i, 'CO'],
  [/\bchile\b/i, 'CL'],
  [/\bindia\b/i, 'IN'],
  [/\bpakistan\b/i, 'PK'],
  [/\bphilippines\b/i, 'PH'],
  [/\bindonesia\b/i, 'ID'],
  [/\bvietnam\b/i, 'VN'],
  [/\bsingapore\b/i, 'SG'],
  [/\bjapan\b/i, 'JP'],
  [/\b(?:south korea|korea)\b/i, 'KR'],
  [/\bchina\b/i, 'CN'],
  [/\baustralia\b/i, 'AU'],
  [/\bnew zealand\b/i, 'NZ'],
  [/\bsouth africa\b/i, 'ZA'],
  [/\bkenya\b/i, 'KE'],
  [/\bghana\b/i, 'GH'],
  [/\begypt\b/i, 'EG'],
  [/\bmorocco\b/i, 'MA'],
  [/\b(?:united arab emirates|uae|dubai|abu dhabi)\b/i, 'AE'],
  [/\bsaudi arabia\b/i, 'SA'],
  [/\bisrael\b/i, 'IL'],
  [/\bturkey\b/i, 'TR'],
  [/\bukraine\b/i, 'UA'],
  [/\bromania\b/i, 'RO'],
  [/\bczech(?:ia| republic)\b/i, 'CZ'],
  [/\bgreece\b/i, 'GR'],
  [/\bestonia\b/i, 'EE'],
  [/\blithuania\b/i, 'LT'],
  [/\blatvia\b/i, 'LV'],
  [/\bfinland\b/i, 'FI'],
  [/\bnorway\b/i, 'NO'],
  [/\bdenmark\b/i, 'DK'],
]

const US_STATE_CODES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
])

/** Parses free-text location into structured fields. Unresolved parts stay null. */
export function parseLocation(raw: string, countryCode: string): StructuredLocation {
  const text = raw.trim()
  if (!text) return { city: null, state: null, country: countryCode || null }
  let city: string | null = null
  let state: string | null = null
  for (const name of NIGERIA_CITIES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) {
      city = name
      break
    }
  }
  for (const name of NIGERIA_STATES) {
    if (new RegExp(`\\b${name}(?: state)?\\b`, 'i').test(text)) {
      state = name === 'FCT' ? 'FCT' : `${name} State`
      break
    }
  }
  let country = countryCode || null
  if (!country && (city || state)) country = 'NG'
  if (!country) {
    for (const [pattern, code] of COUNTRY_NAMES) {
      if (pattern.test(text)) {
        country = code
        break
      }
    }
  }
  // "Austin, TX" — a trailing US state code settles the country.
  if (!country) {
    const stateMatch = /,\s*([A-Z]{2})(?:\s+\d{5})?\s*$/.exec(text)
    if (stateMatch && US_STATE_CODES.has(stateMatch[1])) {
      country = 'US'
      state = state ?? stateMatch[1]
      city = city ?? text.slice(0, stateMatch.index).trim().split(',').pop()?.trim() ?? null
    }
  }
  // "Berlin, Germany" — the segment before the country is the city.
  if (!city && country && country !== 'NG' && text.includes(',')) {
    const first = text.split(',')[0]?.trim()
    if (first && first.length >= 2 && first.length <= 40 && !/remote|hybrid/i.test(first))
      city = first
  }
  return { city, state, country }
}

/* ---------------- salary plausibility ---------------- */

/** Plausible yearly gross bands; anything outside is discarded, never guessed. */
const YEARLY_BANDS: Record<string, [number, number]> = {
  NGN: [400_000, 250_000_000],
  USD: [3_000, 2_000_000],
  EUR: [3_000, 2_000_000],
  GBP: [3_000, 2_000_000],
  CAD: [4_000, 2_000_000],
  AUD: [4_000, 2_000_000],
  SGD: [4_000, 2_000_000],
  INR: [100_000, 100_000_000],
  ZAR: [30_000, 20_000_000],
  KES: [50_000, 50_000_000],
  GHS: [2_000, 5_000_000],
  JPY: [1_000_000, 100_000_000],
}
const PERIOD_MULTIPLIER: Record<string, number> = {
  hour: 2080,
  day: 260,
  week: 52,
  month: 12,
  year: 1,
  unknown: 1,
}

export function salaryPlausible(
  min: number,
  max: number,
  currency: string,
  period: string,
): boolean {
  if (!currency || min <= 0) return false
  const band = YEARLY_BANDS[currency.toUpperCase()]
  const multiplier = PERIOD_MULTIPLIER[period] ?? 1
  const yearlyMin = min * multiplier
  const yearlyMax = max * multiplier
  if (!band) return yearlyMin >= 500 && yearlyMax <= 2_000_000_000
  return yearlyMin >= band[0] && yearlyMax <= band[1] && yearlyMax >= yearlyMin
}

/* ---------------- confidence-gated inference ---------------- */

const WORK_MODE_SIGNALS: { mode: WorkMode; pattern: RegExp }[] = [
  // Hybrid first: "hybrid, remote-friendly" is hybrid, not remote.
  {
    mode: 'hybrid',
    pattern:
      /\bhybrid\b|\b\d\s*days?\s*(?:per|a)\s*week\s*(?:in|at)\s*(?:the\s*)?office\b|\bpartly remote\b|\bpartially remote\b/i,
  },
  {
    mode: 'onsite',
    pattern:
      /\b(?:not (?:a )?remote|no remote|on[- ]?site|in[- ]?office|in[- ]person|office[- ]based|on[- ]premises|work from (?:the )?office|based in our [^.]{0,40}office)\b/i,
  },
  {
    mode: 'remote',
    pattern:
      /\b(?:fully remote|100% remote|remote[- ]only|remote[- ]first|remote work|work from home|work remotely|work from anywhere|home[- ]based|home office|wfh|telecommut|telework|distributed team|fully distributed|remote[- ]friendly role|this is a remote (?:role|position|job))\b/i,
  },
]

export function inferWorkModeQuality(
  text: string,
  fallback: WorkMode,
): { mode: WorkMode; confidence: number } {
  for (const signal of WORK_MODE_SIGNALS)
    if (signal.pattern.test(text)) return { mode: signal.mode, confidence: 0.85 }
  if (fallback !== 'unknown') return { mode: fallback, confidence: 0.75 }
  return { mode: 'unknown', confidence: 0 }
}

/** Boards write the mode into the location itself: "Remote", "Remote — EU". */
export function workModeFromLocation(locationLabel: string): WorkMode {
  const label = locationLabel.trim()
  if (/^remote\b/i.test(label) && !/hybrid/i.test(label)) return 'remote'
  if (/\bhybrid\b/i.test(label)) return 'hybrid'
  return 'unknown'
}

const SENIORITY_SIGNALS: { level: Seniority; pattern: RegExp }[] = [
  {
    level: 'intern',
    pattern: /\b(?:intern(?:ship)?|trainee|graduate scheme|national youth service|nysc|corper)\b/i,
  },
  { level: 'junior', pattern: /\b(?:junior|jr\.?|entry[- ]level|entry level|graduate)\b/i },
  { level: 'principal', pattern: /\bprincipal\b/i },
  { level: 'staff', pattern: /\bstaff\b/i },
  { level: 'senior', pattern: /\b(?:senior|sr\.?|snr)\b/i },
  { level: 'mid', pattern: /\b(?:mid[- ]level|mid level|intermediate|experienced)\b/i },
  {
    level: 'lead',
    pattern: /\b(?:lead|team lead|head of|director|vp\b|vice president|chief|executive|manager)\b/i,
  },
]

/**
 * "5+ years of experience", "3–5 years' experience", "at least 7 years".
 * Returns the smallest stated number of years — the floor the employer set.
 */
export function yearsOfExperience(text: string): number | null {
  const patterns = [
    /(\d{1,2})\s*(?:\+|or more|plus)?\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b[^.]{0,30}?(?:experience|exp\b)/i,
    /(?:at least|minimum(?: of)?|min\.?|over|more than)?\s*(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:relevant\s+|professional\s+|work\s+|hands-on\s+)?experience/i,
    /experience[^.]{0,40}?\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) {
      const years = Number(match[1])
      if (years >= 0 && years <= 40) return years
    }
  }
  return null
}

export function inferSeniorityQuality(
  title: string,
  fallback: Seniority,
  description = '',
): { level: Seniority; confidence: number } {
  for (const signal of SENIORITY_SIGNALS)
    if (signal.pattern.test(title)) return { level: signal.level, confidence: 0.8 }
  const years = yearsOfExperience(description.slice(0, 6000))
  if (years !== null) {
    if (years >= 8) return { level: 'senior', confidence: 0.65 }
    if (years >= 5) return { level: 'senior', confidence: 0.6 }
    if (years >= 3) return { level: 'mid', confidence: 0.6 }
    if (years >= 1) return { level: 'junior', confidence: 0.55 }
    return { level: 'junior', confidence: 0.5 }
  }
  if (fallback !== 'unknown') return { level: fallback, confidence: 0.7 }
  return { level: 'unknown', confidence: 0 }
}

/* ---------------- title / company cleanup ---------------- */

export function cleanTitle(raw: string): string {
  let title = raw
    .replace(/\((?:m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/d|w\/d\/m|all)\)/gi, '')
    .replace(/\b(?:m\/w\/d|f\/m\/d|w\/m\/d)\b/gi, '')
    .replace(/\s*[-–—|·]\s*(?:100%\s*)?(?:remote|hybrid|on[- ]?site)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;)\]])/g, '$1')
    .trim()
  if (title.length > 6 && title === title.toUpperCase() && /[A-Z]/.test(title)) {
    title = title.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  }
  return title.trim()
}

const LEGAL_SUFFIX =
  /,?\s+(?:gmbh(?:\s*&\s*co\.?\s*kg)?|limited|ltd\.?|plc|inc\.?|llc|llp|corp\.?|corporation|company|co\.|sarl|sa|nv|bv|pty|pty\.?\s*ltd|srl|ag)\s*$/i

export function cleanCompany(raw: string): string {
  return raw
    .replace(LEGAL_SUFFIX, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;\s]+$/, '')
    .trim()
}

/* ---------------- the versioned quality pass ---------------- */

export interface QualityInput {
  title: string
  company: string
  description: string
  applyUrl?: string
  sourceUrl?: string
  tags: string[]
  locationLabel: string
  locationCountry: string
  workMode: WorkMode
  seniority: Seniority
  salaryMin: number
  salaryMax: number
  salaryCurrency: string
  salaryPeriod: SalaryPeriod
  requiredSkills: string[]
  usefulSkills: string[]
}

export interface QualityPatch {
  scamScore: number
  scamSignals: { label: string; delta: number }[]
  moderationState: 'publish' | 'caution' | 'hold' | 'reject'
  title: string
  company: string
  workMode: WorkMode
  seniority: Seniority
  salaryMin: number
  salaryMax: number
  salaryCurrency: string
  salaryPeriod: SalaryPeriod
  requiredSkills: string[]
  usefulSkills: string[]
  language: string
  languageRequired: string | null
  normalizerVersion: string
  quality: JobQuality
}

export interface QualityResult {
  patch: QualityPatch
}

/**
 * Runs every quality rule against a posting and returns the canonical patch.
 * The pass is idempotent: re-running it on its own output changes nothing, so
 * stored rows can be backfilled by republishing.
 */
export function qualityPass(input: QualityInput): QualityResult {
  const title = cleanTitle(input.title)
  const company = cleanCompany(input.company)
  const language = detectLanguage(title, input.description)
  const location = parseLocation(input.locationLabel, input.locationCountry)
  const fromLocation = workModeFromLocation(input.locationLabel)
  const workMode =
    fromLocation !== 'unknown'
      ? { mode: fromLocation, confidence: 0.8 }
      : inferWorkModeQuality(
          `${title} ${input.locationLabel} ${input.description.slice(0, 3000)}`,
          input.workMode,
        )
  const seniority = inferSeniorityQuality(title, input.seniority, input.description)

  const plausible = salaryPlausible(
    input.salaryMin,
    input.salaryMax,
    input.salaryCurrency,
    input.salaryPeriod,
  )

  const evidence = extractSkills(`${title}\n${input.description}`, input.tags)
  const requiredSkills = [
    ...new Set([
      ...input.requiredSkills.filter((skill) => skill && skill.length > 1),
      ...evidence.filter((match) => match.required).map((match) => match.name),
    ]),
  ]
  const usefulSkills = [
    ...new Set([
      ...input.usefulSkills.filter(
        (skill) => skill && skill.length > 1 && !requiredSkills.includes(skill),
      ),
      ...evidence.filter((match) => !match.required).map((match) => match.name),
    ]),
  ]

  const confidence: Record<string, number> = {
    workMode: workMode.confidence,
    seniority: seniority.confidence,
    language: language.language === 'unknown' ? 0 : 0.85,
    salary: plausible ? 0.8 : 0,
    skills: evidence.length ? Math.min(1, 0.5 + evidence.length * 0.05) : 0,
    location: location.country ? 0.85 : 0,
    roleFamily: 0.8,
  }

  const populated = {
    locationCountry: Boolean(location.country),
    workMode: workMode.mode !== 'unknown',
    seniority: seniority.level !== 'unknown',
    salary: plausible,
    requiredSkills: requiredSkills.length > 0,
    roleFamily: true,
    language: language.language !== 'unknown',
    eligibleCountries: false,
  }
  const completeness =
    Object.values(populated).filter(Boolean).length / Object.keys(populated).length

  const trust = scamScore({
    title,
    company,
    description: input.description,
    applyUrl: input.applyUrl,
    sourceUrl: input.sourceUrl,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    salaryCurrency: input.salaryCurrency,
    salaryPeriod: input.salaryPeriod,
  })

  return {
    patch: {
      scamScore: trust.score,
      scamSignals: trust.signals,
      moderationState: trust.moderationState,
      title,
      company,
      workMode: workMode.confidence >= 0.7 ? workMode.mode : 'unknown',
      seniority: seniority.confidence >= 0.7 ? seniority.level : 'unknown',
      salaryMin: plausible ? input.salaryMin : 0,
      salaryMax: plausible ? input.salaryMax : 0,
      salaryCurrency: plausible ? input.salaryCurrency : '',
      salaryPeriod: plausible ? input.salaryPeriod : ('year' as SalaryPeriod),
      requiredSkills: requiredSkills.slice(0, 24),
      usefulSkills: usefulSkills.slice(0, 18),
      language: language.language,
      languageRequired: language.languageRequired,
      normalizerVersion: NORMALIZER_VERSION,
      quality: {
        normalizerVersion: NORMALIZER_VERSION,
        language: language.language,
        isEnglish: language.isEnglish,
        languageRequired: language.languageRequired,
        location,
        confidence,
        completeness,
        salaryRaw: plausible
          ? null
          : input.salaryMin > 0
            ? `${input.salaryMin}-${input.salaryMax} ${input.salaryCurrency} ${input.salaryPeriod}`
            : null,
        salaryPlausible: plausible,
        skillEvidence: evidence.slice(0, 24),
      },
    },
  }
}

/* ---------------- deduplication ---------------- */

export function fingerprintJob(job: Job): string {
  const norm = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  return [
    norm(job.company),
    norm(job.title),
    norm(job.locationLabel),
    job.salaryMin > 0 ? `${job.salaryCurrency}${job.salaryMin}-${job.salaryMax}` : '',
  ].join('|')
}

function tokenSortRatio(a: string, b: string): number {
  const tokens = (value: string) =>
    value.toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')
  const [x, y] = [tokens(a), tokens(b)]
  if (x === y) return 1
  const distance = levenshtein(x, y)
  return 1 - distance / Math.max(x.length, y.length, 1)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * Collapses the same role listed twice: identical fingerprints always, and
 * near-identical titles inside one company. The earlier observation wins and
 * the richer field values are kept.
 */
export function dedupeJobs<T extends Job>(jobs: T[]): { unique: T[]; dropped: number } {
  const byFingerprint = new Map<string, T>()
  const byCompany = new Map<string, T[]>()
  let dropped = 0

  for (const job of jobs) {
    const key = fingerprintJob(job)
    const existing = byFingerprint.get(key)
    if (existing) {
      dropped += 1
      byFingerprint.set(key, mergeJobs(existing, job))
      continue
    }
    const company = job.company.toLowerCase()
    const siblings = byCompany.get(company) ?? []
    const digits = (value: string) => (value.match(/\d+/g) ?? []).join(',')
    const fuzzy = siblings.find(
      (sibling) =>
        digits(sibling.title) === digits(job.title) &&
        tokenSortRatio(sibling.title, job.title) >= 0.92,
    )
    if (fuzzy) {
      dropped += 1
      const index = siblings.indexOf(fuzzy)
      siblings[index] = mergeJobs(fuzzy, job)
      byCompany.set(company, siblings)
      continue
    }
    byFingerprint.set(key, job)
    siblings.push(job)
    byCompany.set(company, siblings)
  }
  return { unique: [...byFingerprint.values()], dropped }
}

/** Keeps the earliest observation and the richest value for every field. */
function mergeJobs<T extends Job>(keep: T, incoming: T): T {
  const earlier =
    Date.parse(incoming.firstSeenAt || incoming.postedAt || '') <
    Date.parse(keep.firstSeenAt || keep.postedAt || '')
      ? incoming
      : keep
  return {
    ...keep,
    ...incoming,
    id: keep.id,
    sourceUrl: keep.sourceUrl,
    applyUrl: keep.applyUrl,
    detailKey:
      (keep as { detailKey?: string }).detailKey ?? (incoming as { detailKey?: string }).detailKey,
    firstSeenAt: earlier.firstSeenAt ?? keep.firstSeenAt,
    requiredSkills: [
      ...new Set([
        ...(keep.requiredSkills.length >= incoming.requiredSkills.length
          ? keep.requiredSkills
          : incoming.requiredSkills),
      ]),
    ],
    usefulSkills: [
      ...new Set([
        ...(keep.usefulSkills.length >= incoming.usefulSkills.length
          ? keep.usefulSkills
          : incoming.usefulSkills),
      ]),
    ],
    description:
      keep.description.length >= incoming.description.length
        ? keep.description
        : incoming.description,
    salaryMin: keep.salaryMin || incoming.salaryMin,
    salaryMax: keep.salaryMax || incoming.salaryMax,
    salaryCurrency: keep.salaryCurrency || incoming.salaryCurrency,
  }
}

/* ---------------- coverage & snapshots ---------------- */

export function coverageOf(jobs: Job[]): FieldCoverage {
  const total = jobs.length || 1
  // Partial rows (tests, legacy shards) are treated as missing fields, never a crash.
  const count = (test: (job: Job) => boolean) =>
    jobs.filter((job) => {
      try {
        return test(job)
      } catch {
        return false
      }
    }).length / total
  return {
    locationCountry: count((job) => Boolean(job.locationCountry)),
    workMode: count((job) => job.workMode !== 'unknown'),
    seniority: count((job) => job.seniority !== 'unknown'),
    salary: count((job) => (job.salaryMin ?? 0) > 0 || (job.salaryMax ?? 0) > 0),
    requiredSkills: count((job) => Boolean(job.requiredSkills?.length)),
    roleFamily: count((job) => job.roleFamily !== 'unknown'),
    language: count((job) => Boolean(job.language) && job.language !== 'unknown'),
    eligibleCountries: count((job) => Boolean(job.eligibleCountries?.length)),
  }
}

export function buildQualitySnapshot(
  jobs: Job[],
  duplicatesDropped: number,
  previous: QualitySnapshot | null,
  now = Date.now(),
): QualitySnapshot {
  const date = new Date(now).toISOString().slice(0, 10)
  const coverage = coverageOf(jobs)
  const nonEnglish = jobs.filter((job) => job.quality && !job.quality.isEnglish).length
  const implausibleSalaries = jobs.filter(
    (job) =>
      job.quality?.salaryRaw || (job.quality && !job.quality.salaryPlausible && job.salaryMin > 0),
  ).length

  const bySource = new Map<string, Job[]>()
  for (const job of jobs) {
    const key = job.sourceName || 'unknown'
    bySource.set(key, [...(bySource.get(key) ?? []), job])
  }

  const alerts: string[] = []
  for (const field of QUALITY_FIELDS) {
    const before = previous?.coverage[field]
    const nowValue = coverage[field]
    if (before !== undefined && before - nowValue > 0.1)
      alerts.push(
        `Field ${field} dropped ${(before - nowValue) * 100} percentage points since ${previous?.date}.`,
      )
  }
  if (coverage.locationCountry < QUALITY_FLOORS.locationCountry)
    alerts.push(
      `locationCountry coverage ${Math.round(coverage.locationCountry * 100)}% is below the 85% floor.`,
    )
  if (coverage.workMode < QUALITY_FLOORS.workMode)
    alerts.push(`workMode coverage ${Math.round(coverage.workMode * 100)}% is below the 85% floor.`)
  if (coverage.seniority < QUALITY_FLOORS.seniority)
    alerts.push(
      `seniority coverage ${Math.round(coverage.seniority * 100)}% is below the 80% floor.`,
    )
  if (coverage.requiredSkills < QUALITY_FLOORS.requiredSkills)
    alerts.push(
      `requiredSkills coverage ${Math.round(coverage.requiredSkills * 100)}% is below the 70% floor.`,
    )
  const duplicateRate = duplicatesDropped / Math.max(1, jobs.length + duplicatesDropped)
  if (duplicateRate > QUALITY_FLOORS.duplicateRate)
    alerts.push(`Duplicate rate ${(duplicateRate * 100).toFixed(1)}% is above the 1% floor.`)

  return {
    date,
    normalizerVersion: NORMALIZER_VERSION,
    total: jobs.length,
    coverage,
    duplicatesDropped,
    nonEnglish,
    implausibleSalaries,
    sources: [...bySource.entries()].map(([sourceId, rows]) => ({
      sourceId,
      total: rows.length,
      coverage: coverageOf(rows),
    })),
    alerts,
  }
}
