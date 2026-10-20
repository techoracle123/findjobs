import type { SalaryPeriod, VerificationLevel } from '../../shared/types'

export type SourceKind = 'api' | 'ats' | 'jsonld' | 'rss' | 'html'

export interface RawSalary {
  min: number | null
  max: number | null
  currency: string | null
  period: SalaryPeriod
}

export interface RawPosting {
  /** The source's own identifier for the posting. */
  externalId: string
  title: string
  company: string
  description: string
  /** The posting's own page. */
  url: string
  /** Where a person applies, if the source says. */
  applyUrl?: string
  /** The employer's site, if the source says. */
  companyUrl?: string
  location: string
  remote: boolean
  tags: string[]
  jobType: string
  publishedAt: string | null
  /** The last date the posting is valid for, if the source says. */
  validThrough: string | null
  /** The source says this posting is closed. */
  closed: boolean
  salary: RawSalary | null
}

/**
 * A source row: where to fetch from and how to read it.
 *
 * The parser and the source are separate on purpose. One parser — say,
 * Greenhouse — serves hundreds of employers, so a registry of a few thousand
 * sources needs only a dozen parsers.
 */
export interface SourceRef {
  id: string
  /** The listing to fetch. */
  listingUrl: string
  /** Parser-specific settings, such as the employer's slug. */
  options: Record<string, unknown>
  /** How postings from this source are to be marked. */
  verification: VerificationLevel
  /** The reason shown next to the verification badge. */
  verificationReason: string
}

export interface SourceParser {
  id: string
  name: string
  kind: SourceKind
  /** The applicant-tracking system, when there is one. */
  platform?: string
  homepage: string
  /** Terms or attribution note shown alongside the source. */
  attribution: string
  /** Whether postings from this parser can be treated as employer-verified. */
  verification: VerificationLevel
  /** The reason shown next to the verification badge. */
  verificationReason: string
  fetchPostings(source: SourceRef, fetchImpl?: typeof fetch): Promise<RawPosting[]>
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly sourceId: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}
