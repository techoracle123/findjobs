import type {
  Job,
  SalaryPeriod,
  Seniority,
  Sponsorship,
  VerificationLevel,
  WorkMode,
} from '../../shared/types'
import { ROLE_FAMILY_KEYWORDS, SENIORITY_KEYWORDS, SKILL_CATALOGUE } from '../../shared/skills'
import { COUNTRIES } from '../../shared/countries'
import type { RawPosting, RawSalary } from './types'

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  lead: 5,
  principal: 6,
}

const COUNTRY_LOOKUP = COUNTRIES.map((country) => ({
  code: country.code,
  name: country.name.toLowerCase(),
})).sort((a, b) => b.name.length - a.name.length)

/**
 * Picks the role family a posting belongs to.
 *
 * The title is the strongest signal, the source's own tags come next, and
 * the body text is the weakest. Scoring them separately stops a passing
 * mention in a description from outweighing the actual job title.
 */
export function inferRoleFamily(title: string, tags: string[], description: string): string {
  const titleHaystack = title.toLowerCase()
  const tagHaystack = tags.join(' ').toLowerCase()
  const bodyHaystack = description.slice(0, 600).toLowerCase()
  const scores = new Map<string, number>()

  for (const entry of ROLE_FAMILY_KEYWORDS) {
    let score = 0
    for (const pattern of entry.patterns) {
      let weight = 0
      if (pattern.test(titleHaystack)) weight = 3
      else if (pattern.test(tagHaystack)) weight = 2
      else if (pattern.test(bodyHaystack)) weight = 1
      if (weight > score) score = weight
    }
    if (score > 0) scores.set(entry.family, Math.max(scores.get(entry.family) ?? 0, score))
  }

  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : 'unknown'
}

export function inferSeniority(title: string, description: string): Seniority {
  const haystack = `${title} ${description.slice(0, 400)}`.toLowerCase()
  let best: Seniority | null = null
  let bestRank = -1

  for (const entry of SENIORITY_KEYWORDS) {
    if (!entry.patterns.some((pattern) => pattern.test(haystack))) continue
    const rank = SENIORITY_RANK[entry.level] ?? 0
    if (rank > bestRank) {
      bestRank = rank
      best = entry.level as Seniority
    }
  }

  return best ?? 'unknown'
}

export function inferWorkMode(remote: boolean, title: string): WorkMode {
  if (remote) return 'remote'
  if (/hybrid/i.test(title)) return 'hybrid'
  if (/on[ -]?site|in[ -]?office/i.test(title)) return 'onsite'
  return 'unknown'
}

/**
 * Finds the country a posting names. Returns an empty string when the
 * location is a city or region with no country attached, because guessing
 * would corrupt the eligibility check.
 */
export function inferCountry(location: string): string {
  if (!location) return ''
  const haystack = ` ${location.toLowerCase()} `
  for (const country of COUNTRY_LOOKUP) {
    if (haystack.includes(` ${country.name} `) || haystack.includes(`, ${country.name}`)) {
      return country.code
    }
  }
  return ''
}

/** Skills the source itself tagged, canonicalised to the catalogue labels. */
export function skillsFromTags(tags: string[]): string[] {
  const found = new Map<string, string>()

  for (const tag of tags) {
    const haystack = tag.toLowerCase()
    for (const entry of SKILL_CATALOGUE) {
      const label = entry.label.toLowerCase()
      if (haystack === label || haystack.includes(label)) {
        found.set(entry.label, entry.label)
      }
    }
  }

  return [...found.values()]
}

/** Skills mentioned in the body text that the source did not tag. */
export function skillsFromText(text: string, exclude: string[]): string[] {
  const excluded = new Set(exclude.map((skill) => skill.toLowerCase()))
  const haystack = text.toLowerCase()
  const found: string[] = []

  for (const entry of SKILL_CATALOGUE) {
    if (excluded.has(entry.label.toLowerCase())) continue
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      found.push(entry.label)
    }
  }

  return found.slice(0, 10)
}

const CURRENCY_PATTERNS: { pattern: RegExp; currency: string }[] = [
  { pattern: /€|EUR/i, currency: 'EUR' },
  { pattern: /£|GBP/i, currency: 'GBP' },
  { pattern: /\$|USD/i, currency: 'USD' },
  { pattern: /CHF/i, currency: 'CHF' },
  { pattern: /SEK/i, currency: 'SEK' },
  { pattern: /NOK/i, currency: 'NOK' },
  { pattern: /DKK/i, currency: 'DKK' },
  { pattern: /PLN/i, currency: 'PLN' },
  { pattern: /CAD/i, currency: 'CAD' },
  { pattern: /AUD/i, currency: 'AUD' },
  { pattern: /SGD/i, currency: 'SGD' },
  { pattern: /INR|₹/i, currency: 'INR' },
  { pattern: /BRL/i, currency: 'BRL' },
  { pattern: /NGN|₦/i, currency: 'NGN' },
  { pattern: /JPY|¥/i, currency: 'JPY' },
]

/**
 * Extracts a salary range from free text. Anything that is not stated
 * plainly is left out rather than guessed at.
 */
export function extractSalary(text: string): RawSalary | null {
  if (!text) return null

  const period: SalaryPeriod = /per\s?hour|\/\s?hr|hourly|\bhour\b/i.test(text)
    ? 'hour'
    : /per\s?month|monthly|\/\s?mo\b/i.test(text)
      ? 'month'
      : 'year'

  const currency = CURRENCY_PATTERNS.find((entry) => entry.pattern.test(text))?.currency ?? null

  // A number in prose (years of experience, dates, headcount) is not a salary.
  if (!currency) return null
  const compensation = text.match(
    /[^.!?\n]*(?:salary|compensation|pay range|base pay|[$€£¥₹₦]|USD|EUR|GBP)[^.!?\n]*/i,
  )?.[0]
  if (!compensation) return null
  text = compensation

  const range = text.match(
    /(?:[$€£¥₹₦]|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|SGD|INR|BRL|NGN|JPY)?\s*(\d[\d.,]*)\s*(k|K)?\s*(?:-|–|—|to)\s*(?:[$€£¥₹₦]|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|SGD|INR|BRL|NGN|JPY)?\s*(\d[\d.,]*)\s*(k|K)?/,
  )

  const toAmount = (digits: string, thousands: string | undefined): number | null => {
    const value = Number.parseFloat(digits.replace(/,/g, ''))
    if (Number.isNaN(value)) return null
    return thousands ? value * 1000 : value
  }

  if (range) {
    const min = toAmount(range[1], range[2])
    const max = toAmount(range[3], range[4])
    if (min !== null && max !== null && min > 0 && max >= min) {
      return { min, max, currency, period }
    }
  }

  const single = text.match(
    /(?:[$€£¥₹₦]|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|SGD|INR|BRL|NGN|JPY)?\s*(\d[\d.,]*)\s*(k|K)?\s*(?:per\s?hour|\/\s?hr|hourly|per\s?month|monthly|per\s?year|annually)?/i,
  )
  if (single) {
    const value = toAmount(single[1], single[2])
    if (value !== null && value >= 100) {
      return { min: value, max: value, currency, period }
    }
  }

  return null
}

export interface NormaliseContext {
  verification: VerificationLevel
  verificationReason: string
  sourceKind: string
  sourcePlatform?: string
  now: number
}

export interface NormalisedPosting extends Omit<
  Job,
  'id' | 'sourceName' | 'sourceUrl' | 'postedAt'
> {
  postedAt: string | null
}

/**
 * Turns a source payload into the canonical posting shape. Everything the
 * application knows how to reason about — role family, seniority, work mode,
 * skills, salary, whether it is open, whether it is verified — is derived
 * here, once, for every source.
 */
export function normalizePosting(raw: RawPosting, context: NormaliseContext): NormalisedPosting {
  const text = `${raw.title}\n${raw.description}`
  const required = skillsFromTags(raw.tags)
  const useful = skillsFromText(text, required)
  const salary = raw.salary ?? extractSalary(raw.description)

  const nowIso = new Date(context.now).toISOString()

  // A posting that carries a validity date in the past has closed, whatever
  // the source's listing still says.
  const expired =
    raw.validThrough !== null && !Number.isNaN(Date.parse(raw.validThrough))
      ? Date.parse(raw.validThrough) < context.now
      : false

  const closed = raw.closed || expired

  return {
    title: raw.title,
    company: raw.company,
    roleFamily: inferRoleFamily(raw.title, raw.tags, raw.description),
    seniority: inferSeniority(raw.title, raw.description),
    workMode: inferWorkMode(raw.remote, `${raw.title} ${raw.location}`),
    locationCountry: inferCountry(raw.location),
    locationLabel: raw.location || 'Location not stated',
    salaryMin: salary?.min ?? 0,
    salaryMax: salary?.max ?? 0,
    salaryCurrency: salary?.currency ?? '',
    salaryPeriod: salary?.period ?? 'year',
    description: raw.description.slice(0, 4000),
    requiredSkills: required,
    usefulSkills: useful,
    eligibleCountries: [],
    sponsorship: 'unknown' as Sponsorship,
    postedAt:
      raw.publishedAt && Number.isFinite(Date.parse(raw.publishedAt)) ? raw.publishedAt : null,
    isDemo: false,
    applyUrl: raw.applyUrl || raw.url,
    companyUrl: raw.companyUrl,
    verification: context.verification,
    verificationReason: context.verificationReason,
    verifiedAt: context.verification === 'verified' ? nowIso : undefined,
    jobStatus: closed ? 'closed' : 'open',
    closedAt: closed ? nowIso : undefined,
    closedReason: raw.closed
      ? 'the source marked it closed'
      : expired
        ? 'it passed its validity date'
        : undefined,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    sourceKind: context.sourceKind,
    sourcePlatform: context.sourcePlatform,
  }
}
