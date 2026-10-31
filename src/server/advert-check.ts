import { COUNTRIES, countryName } from '../shared/countries'
import type { AdvertCheckResult, Job, NigeriaEligibilityCheck } from '../shared/types'
import { scamScore } from './trust'

export interface AdvertCheckInput {
  title?: string
  company?: string
  location?: string
  url?: string
  text: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  salaryPeriod?: string
  eligibleCountries?: string[]
  sponsorship?: string
  locationCountry?: string
}

function clean(value: string | undefined, limit: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function evidenceSentences(text: string, pattern: RegExp, limit = 4): string[] {
  const parts = text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 12)
  const found: string[] = []
  for (const part of parts) {
    pattern.lastIndex = 0
    if (pattern.test(part) && !found.includes(part)) found.push(part.slice(0, 320))
    if (found.length >= limit) break
  }
  return found
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const COUNTRY_CONTEXT =
  /\b(?:based in|located in|reside in|residents? of|eligible|open to|hiring in|location|countries|country|regions?|worldwide|anywhere|global)\b/i

function countriesNamed(input: AdvertCheckInput, text: string): string[] {
  const named = new Set<string>()
  for (const code of input.eligibleCountries ?? []) {
    if (/^[A-Z]{2}$/i.test(code)) named.add(countryName(code))
  }
  if (input.locationCountry) named.add(countryName(input.locationCountry))

  const haystacks = [input.location ?? '', ...text.split(/(?<=[.!?])\s+|\n+/)]
    .filter((part) => COUNTRY_CONTEXT.test(part))
    .join(' ')
  for (const country of COUNTRIES) {
    if (country.name.length < 4) continue
    const pattern = new RegExp(`\\b${escapeRegExp(country.name)}\\b`, 'i')
    if (pattern.test(haystacks)) named.add(country.name)
  }
  if (/\bUnited States\b|\bUSA\b|\bU\.S\.\b/i.test(haystacks)) named.add('United States')
  if (/\bUnited Kingdom\b|\bUK\b|\bU\.K\.\b/i.test(haystacks)) named.add('United Kingdom')
  if (/\bEuropean Union\b|\bEU\b/i.test(haystacks)) named.add('European Union')
  return [...named].slice(0, 16)
}

function nigeriaCheck(input: AdvertCheckInput, text: string): NigeriaEligibilityCheck {
  const allText = `${input.location ?? ''}\n${text}`
  const named = countriesNamed(input, text)
  const eligibleCodes = (input.eligibleCountries ?? []).map((code) => code.toUpperCase())
  const nigeriaEvidence = evidenceSentences(
    allText,
    /\b(?:Nigeria|Nigerian|Lagos|Abuja|Port Harcourt|Ibadan)\b/i,
    4,
  )
  const worldwideEvidence = evidenceSentences(
    allText,
    /\b(?:worldwide|work from anywhere|anywhere in the world|global(?:ly)? remote|open globally|all countries)\b/i,
    3,
  )
  const workAuthorization = evidenceSentences(
    allText,
    /\b(?:authori[sz]ed to work|work authori[sz]ation|right to work|work permit|legally (?:allowed|authori[sz]ed)|must reside|based in|residents? (?:of|only)|citizens? (?:of|only))\b/i,
    5,
  )
  const sponsorship = evidenceSentences(
    allText,
    /\b(?:visa sponsorship|sponsor(?:ship)? (?:is )?(?:available|not available|offered|not offered)|relocation (?:support|package|assistance)|must relocate)\b/i,
    4,
  )
  const timeZones = [
    ...new Set(
      [
        ...allText.matchAll(
          /\b(?:UTC|GMT)\s*[+-]?\d{1,2}(?::\d{2})?\b|\b(?:WAT|EST|EDT|CST|CDT|PST|PDT|CET|CEST|BST|IST|EAT|SAST)\b/gi,
        ),
      ].map((match) => match[0].toUpperCase().replace(/\s+/g, '')),
    ),
  ]

  const notes: string[] = []
  if (workAuthorization.length)
    notes.push(
      'Check the work-authorization wording on the original advert before spending time on an application.',
    )
  if (timeZones.length)
    notes.push(
      `Time-zone wording found: ${timeZones.join(', ')}. Confirm the overlap expected from Nigeria.`,
    )
  if (!sponsorship.length) notes.push('Visa sponsorship or relocation support is not stated.')

  if (
    input.locationCountry?.toUpperCase() === 'NG' ||
    eligibleCodes.includes('NG') ||
    nigeriaEvidence.length
  ) {
    return {
      status: 'nigeria-named',
      headline: 'Nigeria is named or is the job location in the information provided.',
      evidence: nigeriaEvidence.length
        ? nigeriaEvidence
        : ['Nigeria is recorded as the job location or an eligible country.'],
      countriesNamed: named,
      timeZones,
      workAuthorization,
      sponsorship,
      notes,
    }
  }

  if (worldwideEvidence.length) {
    if (workAuthorization.length)
      notes.push(
        'The advert uses worldwide wording but also contains work-location conditions. Check both before applying.',
      )
    return {
      status: 'worldwide-stated',
      headline: 'The advert says the role is open worldwide or from anywhere.',
      evidence: worldwideEvidence,
      countriesNamed: named,
      timeZones,
      workAuthorization,
      sponsorship,
      notes,
    }
  }

  if (eligibleCodes.length || (named.length && workAuthorization.length)) {
    return {
      status: 'nigeria-not-named',
      headline: 'Nigeria is not named, while other locations or work conditions are stated.',
      evidence: workAuthorization,
      countriesNamed: named,
      timeZones,
      workAuthorization,
      sponsorship,
      notes: [
        'Do not assume “remote” means Nigeria is accepted. Confirm on the original advert or employer site first.',
        ...notes,
      ],
    }
  }

  return {
    status: 'not-stated',
    headline: 'The advert does not clearly state whether someone in Nigeria can apply.',
    evidence: [],
    countriesNamed: named,
    timeZones,
    workAuthorization,
    sponsorship,
    notes: [
      '“Remote” alone does not prove that Nigeria is accepted. Look for permitted countries, payroll location and work authorization.',
      ...notes,
    ],
  }
}

function signalEvidence(label: string, text: string): string | undefined {
  const patterns: Record<string, RegExp> = {
    'Asks the applicant for money':
      /\b(?:fee|deposit|pay|payment|money|token|cash|training|registration|processing|form|uniform|equipment)\b/i,
    'Requests bank or identity details': /\b(?:BVN|bank|account number|NIN|national identity)\b/i,
    'Free webmail is the only contact':
      /@(?:gmail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|mail)\./i,
    'Mobile contact with no verifiable website': /(?:\+?234|0)[789][01]\d{8}|\+\d{7,15}/,
    'Salary implausible for the role': /(?:₦|NGN|salary|pay|earn|per month|monthly)/i,
  }
  const pattern = patterns[label]
  return pattern ? evidenceSentences(text, pattern, 1)[0] : undefined
}

export function buildAdvertCheck(rawInput: AdvertCheckInput, now = new Date()): AdvertCheckResult {
  const input: AdvertCheckInput = {
    ...rawInput,
    title: clean(rawInput.title || 'Job advert', 180),
    company: clean(rawInput.company, 160),
    location: clean(rawInput.location, 220),
    url: clean(rawInput.url, 600),
    text: (rawInput.text ?? '').slice(0, 30_000),
  }
  const text = input.text.trim()
  const scored = scamScore({
    title: input.title || 'Job advert',
    company: input.company || '',
    description: text,
    applyUrl: input.url,
    sourceUrl: input.url,
    salaryMin: input.salaryMin ?? 0,
    salaryMax: input.salaryMax ?? 0,
    salaryCurrency: input.salaryCurrency ?? '',
    salaryPeriod: input.salaryPeriod ?? 'unknown',
  })

  const extraSignals: AdvertCheckResult['signals'] = []
  let extraScore = 0
  if (/\b(?:whatsapp|telegram)\b/i.test(text) && !/https?:\/\//i.test(text) && !input.url) {
    extraScore += 10
    extraSignals.push({
      label: 'Messaging app appears to be the only route',
      detail:
        'Check whether the same vacancy exists on the employer’s official website before continuing in chat.',
      evidence: evidenceSentences(text, /\b(?:whatsapp|telegram)\b/i, 1)[0],
    })
  }
  if (
    /\b(?:guaranteed (?:job|employment|income|salary)|100% (?:sure|guaranteed)|no interview (?:needed|required))\b/i.test(
      text,
    )
  ) {
    extraScore += 15
    extraSignals.push({
      label: 'Guaranteed outcome wording',
      detail: 'No honest employer can guarantee a job before assessing applicants.',
      evidence: evidenceSentences(
        text,
        /\b(?:guaranteed (?:job|employment|income|salary)|100% (?:sure|guaranteed)|no interview (?:needed|required))\b/i,
        1,
      )[0],
    })
  }
  if (
    /\b(?:buy (?:crypto|gift cards?)|send (?:crypto|gift cards?)|task commission|recharge (?:task|account)|investment task)\b/i.test(
      text,
    )
  ) {
    extraScore += 25
    extraSignals.push({
      label: 'Asks the applicant to move or spend money for tasks',
      detail:
        'Stop. Legitimate employment does not require you to fund tasks or buy items for commission.',
      evidence: evidenceSentences(
        text,
        /\b(?:buy (?:crypto|gift cards?)|send (?:crypto|gift cards?)|task commission|recharge (?:task|account)|investment task)\b/i,
        1,
      )[0],
    })
  }

  const riskScore = Math.max(0, Math.min(100, scored.score + extraScore))
  const riskLevel: AdvertCheckResult['riskLevel'] =
    riskScore >= 30 ? 'warning-signs-found' : riskScore >= 15 ? 'caution' : 'no-warning-signs-found'

  const signals = [
    ...scored.signals
      .filter((signal) => signal.delta > 0)
      .map((signal) => ({
        label: signal.label,
        detail:
          signal.label === 'Asks the applicant for money'
            ? 'A real employer should not charge you to apply, train or be interviewed.'
            : signal.label === 'Requests bank or identity details'
              ? 'Do not send BVN, bank details or identity documents before a verified hiring process.'
              : signal.label === 'No company website or registration evidence'
                ? 'This does not prove a scam. It means you need to find and check the employer independently.'
                : 'Treat this as a reason to slow down and check the original source.',
        evidence: signalEvidence(signal.label, text),
      })),
    ...extraSignals,
  ]

  const emails = [
    ...new Set(
      [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase()),
    ),
  ].slice(0, 8)
  const links = [...new Set([...text.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((m) => m[0]))].slice(
    0,
    8,
  )
  if (input.url && !links.includes(input.url)) links.unshift(input.url)

  const deadlineText =
    evidenceSentences(
      text,
      /\b(?:closing date|deadline|apply by|applications close|submit by)\b/i,
      1,
    )[0] ?? null
  const salaryStated = Boolean(
    (input.salaryMin ?? 0) > 0 ||
    (input.salaryMax ?? 0) > 0 ||
    /(?:₦|\$|£|€|\bNGN\b|\bUSD\b|\bGBP\b|\bEUR\b)\s?\d|salary[^.]{0,50}\d/i.test(text),
  )

  const missingInformation: string[] = []
  if (!input.company) missingInformation.push('Employer name')
  if (!input.location && !/\b(?:remote|hybrid|onsite|on-site|location)\b/i.test(text))
    missingInformation.push('Work location or arrangement')
  if (!salaryStated) missingInformation.push('Salary')
  if (!links.length && !emails.length)
    missingInformation.push('Official application link or contact')
  if (!deadlineText) missingInformation.push('Closing date')
  if (text.length < 300) missingInformation.push('Full duties and requirements')

  const nextSteps = [
    'Open the employer’s official website yourself and confirm that this exact vacancy is listed there.',
    'Compare the job title, closing date and application route with the advert you checked.',
    'Never pay to apply, train, buy equipment or unlock an interview.',
    'Do not send BVN, bank login details, card details or identity documents through chat.',
  ]
  if (riskLevel === 'warning-signs-found')
    nextSteps.unshift(
      'Stop and verify independently before sending personal documents or continuing.',
    )

  return {
    checkedAt: now.toISOString(),
    riskLevel,
    riskScore,
    headline:
      riskLevel === 'warning-signs-found'
        ? 'Warning signs found. Do not pay or send sensitive documents until you verify this independently. This is not employer verification.'
        : riskLevel === 'caution'
          ? 'Use caution. Some information needs independent checking. This is not employer verification.'
          : 'No warning signs found in the text supplied. This is not employer verification.',
    signals,
    nigeria: nigeriaCheck(input, text),
    missingInformation,
    nextSteps,
    salaryStated,
    deadlineText,
    contacts: { emails, links },
  }
}

export function buildAdvertCheckForJob(job: Job, now = new Date()): AdvertCheckResult {
  return buildAdvertCheck(
    {
      title: job.title,
      company: job.company,
      location: job.locationLabel,
      url: job.applyUrl || job.sourceUrl,
      text: job.description,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryPeriod: job.salaryPeriod,
      eligibleCountries: job.eligibleCountries,
      sponsorship: job.sponsorship,
      locationCountry: job.locationCountry,
    },
    now,
  )
}

export function normaliseAdvertCheckInput(input: unknown): AdvertCheckInput {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    title: clean(typeof raw.title === 'string' ? raw.title : '', 180),
    company: clean(typeof raw.company === 'string' ? raw.company : '', 160),
    location: clean(typeof raw.location === 'string' ? raw.location : '', 220),
    url: clean(typeof raw.url === 'string' ? raw.url : '', 600),
    text: typeof raw.text === 'string' ? raw.text.slice(0, 30_000) : '',
  }
}
