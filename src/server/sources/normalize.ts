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
import { specialistRole } from '../../shared/specialisms'
import { qualityPass } from '../quality'
import { cleanJobText } from './html'

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
  const specialist = specialistRole(title)
  if (specialist) return specialist
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
  const code = location.trim().toUpperCase()
  if (COUNTRY_LOOKUP.some((country) => country.code === code)) return code
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
export function extractSalary(text: string, country = ''): RawSalary | null {
  if (!text) return null
  // Require a currency next to the amount, never a year or experience count.
  const token =
    '(?:NGN|USD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|CAD|AUD|SGD|INR|BRL|JPY|[$€£¥₹₦]|\\bN(?=\\s*\\d{2,}))'
  const amount = '(\\d[\\d.,]*)([kK])?'
  const range = new RegExp(
    `${token}\\s*${amount}\\s*(?:-|–|—|to)\\s*(?:${token})?\\s*${amount}`,
    'i',
  )
  const single = new RegExp(`${token}\\s*${amount}`, 'i')
  const match = text.match(range) || text.match(single)
  if (!match) return null
  let currency =
    CURRENCY_PATTERNS.find((entry) => entry.pattern.test(match[0]))?.currency ??
    (/\bN\s*\d/.test(match[0]) ? 'NGN' : null)
  // Dollar/yen symbols alone do not identify a currency in a worldwide feed.
  if (/\$/.test(match[0]) && !/\b(?:USD|CAD|AUD|SGD|NZD)\b/i.test(match[0]))
    currency =
      ({ US: 'USD', CA: 'CAD', AU: 'AUD', SG: 'SGD', NZ: 'NZD' } as Record<string, string>)[
        country
      ] || null
  if (/¥/.test(match[0]) && !/\b(?:JPY|CNY)\b/i.test(match[0]))
    currency = country === 'JP' ? 'JPY' : country === 'CN' ? 'CNY' : null
  if (!currency) return null
  const context = text.slice(
    Math.max(0, (match.index ?? 0) - 35),
    (match.index ?? 0) + match[0].length + 60,
  )
  const period: SalaryPeriod = /per\s*hour|\/\s*h(?:r|our)?\b|hourly|stunde/i.test(context)
    ? 'hour'
    : /per\s*month|monthly|\/\s*(?:mo|month)\b|monat|par mois/i.test(context)
      ? 'month'
      : /per\s*year|annually|annual|\/\s*yr\b|per annum|jahr|par an\b/i.test(context)
        ? 'year'
        : 'unknown'
  const number = (digits: string, suffix?: string): number => {
    const cleaned = digits.replace(/[,.](?=\d{3}(?:[,.]|$))/g, '').replace(',', '.')
    return Number(cleaned) * (suffix ? 1000 : 1)
  }
  const min = number(
    match[1],
    match[2] || (match[4] && Number(match[1]) < 1000 ? match[4] : undefined),
  )
  const max = match[3] ? number(match[3], match[4]) : min
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null
  return { min, max, currency, period }
}

export interface NormaliseContext {
  verification: VerificationLevel
  verificationReason: string
  sourceKind: string
  sourcePlatform?: string
  now: number
  /**
   * The country of a country-specific board/feed (e.g. a Nigerian jobs
   * feed). Used only when the listing's own location carries no country
   * signal — the board itself is confident evidence. Never set for
   * company ATS boards, which list roles worldwide.
   */
  sourceCountry?: string
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
  const countryHint = inferCountry(raw.location) || (context.sourceCountry ?? '')
  const salary = raw.salary ?? extractSalary(raw.description, countryHint)

  const nowIso = new Date(context.now).toISOString()

  // A posting that carries a validity date in the past has closed, whatever
  // the source's listing still says.
  const expired =
    raw.validThrough !== null && !Number.isNaN(Date.parse(raw.validThrough))
      ? Date.parse(raw.validThrough) < context.now
      : false

  const closed = raw.closed || expired

  const { patch } = qualityPass({
    title: raw.title,
    company: raw.company,
    description: cleanJobText(raw.description).slice(0, 16000),
    applyUrl: raw.applyUrl || raw.url,
    sourceUrl: raw.url,
    tags: raw.tags,
    locationLabel: raw.location,
    locationCountry: countryHint,
    workMode: inferWorkMode(raw.remote, `${raw.title} ${raw.location}`),
    seniority: inferSeniority(raw.title, raw.description),
    salaryMin: salary?.min ?? 0,
    salaryMax: salary?.max ?? 0,
    salaryCurrency: salary?.currency ?? '',
    salaryPeriod: salary?.period ?? 'year',
    requiredSkills: required,
    usefulSkills: useful,
  })

  return {
    ...patch,
    roleFamily: specialistRole(raw.title) || inferRoleFamily(raw.title, raw.tags, raw.description),
    locationCountry: patch.quality.location.country || countryHint,
    locationLabel: raw.location.trim(),
    description: cleanJobText(raw.description).slice(0, 16000),
    // The quality pass owns the required/useful split (it merges these same
    // tag/text skills with section- and cue-based evidence). Overwriting it
    // here was why production rows carried zero required skills.
    requiredSkills: patch.requiredSkills,
    usefulSkills: patch.usefulSkills,
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
