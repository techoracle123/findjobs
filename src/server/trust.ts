/**
 * Trust scoring for listings. FJ points at opportunities; this engine decides
 * which ones deserve a warning, a hold, or nothing at all. It never fabricates
 * a verdict about an employer — it scores observable red flags and says so.
 */

export type ModerationState = 'publish' | 'caution' | 'hold' | 'reject'

export interface ScamSignal {
  label: string
  delta: number
}

export interface ScamResult {
  score: number
  signals: ScamSignal[]
  moderationState: ModerationState
}

const FREE_WEBMAIL =
  /@(?:gmail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|mail)\.(?:com|net|org|co)\b/i

// Nigerian English + Pidgin money-request phrases.
const MONEY_REQUEST =
  /\b(?:registration fee|processing fee|training fee|service fee|form fee|guarantee fee|visa fee|equipment fee|uniform fee|refundable deposit|pay small (?:token|money)|send (?:money|token|cash)|pay (?:before|to apply|to register|up ?front)|activation fee|clearance fee|registration fee|we require payment|fee is (?:required|needed))\b/i

const SPAMMY_TITLE =
  /\b(?:urgent|immediate(?:ly)?|work from home|no experience|earn (?:daily|big|money)|daily payment|make money|be your own boss|guaranteed (?:income|earnings))\b/i

const BVN_REQUEST = /\b(?:BVN|bank (?:account|details)|account number|NIN|national identity)\b/i
const CONTACT_PHONE = /(?:\+?234|0)[789][01]\d{8}|\+\d{7,15}/
const COMPANY_EMAIL_AT = /@([a-z0-9-]+)\.(?:com|ng|io|co|org|net)\b/i

function textContacts(description: string): {
  freeWebmail: boolean
  companyEmailDomain: string | null
  phone: boolean
} {
  const emails = [...description.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(
    (m) => m[0],
  )
  return {
    freeWebmail: emails.length > 0 && emails.every((email) => FREE_WEBMAIL.test(email)),
    companyEmailDomain:
      emails.find((email) => !FREE_WEBMAIL.test(email))?.match(COMPANY_EMAIL_AT)?.[1] ?? null,
    phone: CONTACT_PHONE.test(description),
  }
}

export interface ScamContext {
  /** Roles posted by the same company inside seven days. */
  companyRoles7d?: number
  /** CAC registration number present and plausible. */
  hasCac?: boolean
  /** Employer verification tier from the employer side (none today). */
  employerVerified?: boolean
}

/**
 * Scores one listing 0–100. Thresholds:
 * 0–14 publish · 15–29 caution banner · 30–59 hold for review · ≥60 reject.
 */
export function scamScore(
  job: {
    title: string
    company: string
    description: string
    companyUrl?: string
    salaryMin: number
    salaryMax: number
    salaryCurrency: string
    salaryPeriod: string
  },
  context: ScamContext = {},
): ScamResult {
  const signals: ScamSignal[] = []
  const description = job.description || ''
  const body = `${job.title} ${description}`

  if (MONEY_REQUEST.test(body)) signals.push({ label: 'Asks the applicant for money', delta: 25 })
  if (BVN_REQUEST.test(description) && /(?:send|provide|submit|forward)/i.test(description))
    signals.push({ label: 'Requests bank or identity details', delta: 10 })

  const contacts = textContacts(description)
  if (contacts.freeWebmail) signals.push({ label: 'Free webmail is the only contact', delta: 20 })
  if (!job.companyUrl && !context.hasCac && !context.employerVerified)
    signals.push({ label: 'No company website or registration evidence', delta: 15 })
  if (SPAMMY_TITLE.test(job.title.toLowerCase()))
    signals.push({ label: 'Spammy title wording', delta: 10 })
  if (description.length > 0 && description.length < 200)
    signals.push({ label: 'Very short description', delta: 10 })
  if ((context.companyRoles7d ?? 0) > 10)
    signals.push({ label: 'Same company posted 10+ roles in 7 days', delta: 10 })
  if (contacts.phone && !job.companyUrl)
    signals.push({ label: 'Mobile contact with no verifiable website', delta: 10 })

  // Salary wildly out of band for a non-executive role.
  const monthlyBand = job.salaryPeriod === 'month' ? [30_000, 5_000_000] : [200_000, 40_000_000]
  if (
    job.salaryCurrency === 'NGN' &&
    job.salaryMin > 0 &&
    (job.salaryMin > monthlyBand[1] || job.salaryMin < monthlyBand[0] / 4) &&
    !/\b(?:director|head of|chief|executive|manager)\b/i.test(job.title)
  )
    signals.push({ label: 'Salary implausible for the role', delta: 15 })

  if (contacts.companyEmailDomain && job.company) {
    const companyToken = job.company.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (
      companyToken.length > 3 &&
      contacts.companyEmailDomain.replace(/[^a-z0-9]/g, '').includes(companyToken.slice(0, 5))
    )
      signals.push({ label: 'Company-domain email matches the employer', delta: -10 })
  }
  if (context.hasCac) signals.push({ label: 'CAC registration number present', delta: -15 })
  if (context.employerVerified) signals.push({ label: 'Employer account verified', delta: -20 })

  const score = Math.max(
    0,
    Math.min(
      100,
      signals.reduce((sum, signal) => sum + signal.delta, 0),
    ),
  )
  const moderationState: ModerationState =
    score >= 60 ? 'reject' : score >= 30 ? 'hold' : score >= 15 ? 'caution' : 'publish'
  return { score, signals, moderationState }
}
