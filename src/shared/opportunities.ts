import type {
  EngagementBasis,
  EngagementType,
  Job,
  OpportunityFilter,
  OpportunityType,
  SalaryPeriod,
} from './types'

export interface OpportunityClassification {
  opportunityType: OpportunityType
  engagementType: EngagementType
  engagementLabel: string
  engagementBasis?: EngagementBasis
  projectDuration?: string
}

export interface OpportunityInput {
  jobType?: string | string[] | null
  tags?: string[]
  title?: string
  description?: string
  salaryPeriod?: SalaryPeriod | string | null
}

const LABELS: Record<EngagementType, string> = {
  'full-time': 'Full-time job',
  'part-time': 'Part-time job',
  permanent: 'Permanent job',
  contract: 'Contract',
  freelance: 'Freelance gig',
  project: 'Project work',
  temporary: 'Temporary work',
  internship: 'Internship',
  unknown: '',
}

const GIG_ENGAGEMENTS = new Set<EngagementType>(['contract', 'freelance', 'project', 'temporary'])

function classification(
  opportunityType: OpportunityType,
  engagementType: EngagementType,
  basis?: EngagementBasis,
): OpportunityClassification {
  return {
    opportunityType,
    engagementType,
    engagementLabel: LABELS[engagementType],
    ...(basis ? { engagementBasis: basis } : {}),
  }
}

function fromEngagement(
  engagementType: EngagementType,
  basis: EngagementBasis,
): OpportunityClassification {
  return classification(
    GIG_ENGAGEMENTS.has(engagementType) ? 'gig' : engagementType === 'unknown' ? 'unknown' : 'job',
    engagementType,
    basis,
  )
}

function sourceEngagement(text: string): EngagementType | null {
  const value = ` ${text.toLowerCase().replace(/[_/]+/g, ' ')} `
  if (/\b(?:freelance|freelancer|freelancing|independent contractor)\b/.test(value))
    return 'freelance'
  if (/\b(?:project[-\s]?based|project work|fixed[-\s]?scope|gig|bounty)\b/.test(value))
    return 'project'
  if (
    /\b(?:contractor|contract|fixed[-\s]?term|contract[-\s]?to[-\s]?hire|c2c|c2h|1099)\b/.test(
      value,
    )
  )
    return 'contract'
  if (/\b(?:temporary|temp|seasonal|short[-\s]?term)\b/.test(value)) return 'temporary'
  if (/\b(?:intern|internship)\b/.test(value)) return 'internship'
  if (/\b(?:part[-\s]?time|parttime)\b/.test(value)) return 'part-time'
  if (/\b(?:full[-\s]?time|fulltime)\b/.test(value)) return 'full-time'
  if (/\b(?:permanent|regular|direct[-\s]?hire)\b/.test(value)) return 'permanent'
  return null
}

function exactTagEngagement(tags: string[]): EngagementType | null {
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase().replace(/[_/]+/g, ' ')
    if (
      /^(?:freelance|freelancer|contract|contractor|temporary|temp|seasonal|project based|project-based|gig|full[-\s]?time|part[-\s]?time|permanent|internship|intern)$/.test(
        normalized,
      )
    ) {
      return sourceEngagement(normalized)
    }
  }
  return null
}

function titleEngagement(title: string): EngagementType | null {
  const value = title.toLowerCase()
  if (/\b(?:freelance|freelancer)\b/.test(value)) return 'freelance'
  if (/\b(?:project[-\s]?based|fixed[-\s]?scope|gig)\b/.test(value)) return 'project'
  if (/\b(?:temporary|fixed[-\s]?term|short[-\s]?term)\b/.test(value)) return 'temporary'
  if (/\bcontract[-\s]?to[-\s]?hire\b|\bc2h\b|\bc2c\b|\b1099\b/.test(value)) return 'contract'

  // "Contracts Manager" and similar titles describe the work itself, not
  // necessarily a time-bounded engagement. Do not move those into Gigs from
  // the word contract alone.
  const contractOccupation =
    /\bcontracts?\s+(?:manager|administrator|specialist|coordinator|analyst|officer|assistant|management|negotiator|paralegal|attorney|lawyer)\b/.test(
      value,
    )
  if (!contractOccupation) {
    // A smart-contract developer builds blockchain contracts; that phrase
    // alone says nothing about how the person is engaged.
    const engagementTitle = value.replace(/\bsmart\s+contracts?\b/g, ' ')
    if (
      /(?:^|[\s([{|,:;/-])(?:contractor|contract)(?:\s|$|[)\]}|,:;/-])/.test(engagementTitle) ||
      /\bcontract\s+(?:role|position|opportunity|engagement|assignment|developer|engineer|designer|analyst|writer|consultant|programmer|specialist)\b/.test(
        engagementTitle,
      )
    ) {
      return 'contract'
    }
  }
  if (/\b(?:intern|internship)\b/.test(value)) return 'internship'
  if (/\bpart[-\s]?time\b/.test(value)) return 'part-time'
  if (/\bfull[-\s]?time\b/.test(value)) return 'full-time'
  if (/\bpermanent\b/.test(value)) return 'permanent'
  return null
}

function descriptionEngagement(description: string): EngagementType | null {
  const value = description.toLowerCase().slice(0, 16_000)
  const structured =
    /\b(?:employment type|job type|engagement type|role type|position type|work type)\s*[:\-–]\s*([a-z][a-z\s-]{2,36})/.exec(
      value,
    )
  if (structured) {
    const found = sourceEngagement(structured[1])
    if (found) return found
  }

  if (
    /\b(?:freelance|freelancer)\s+(?:role|position|opportunity|engagement|assignment|basis|contract)\b/.test(
      value,
    ) ||
    /\bon a freelance basis\b/.test(value)
  )
    return 'freelance'
  if (
    /\bproject[-\s]?based\s+(?:role|position|opportunity|engagement|work|contract)\b/.test(value) ||
    /\bfixed[-\s]?scope\s+(?:project|engagement|contract)\b/.test(value)
  )
    return 'project'
  if (
    /\b(?:this is|this|the)\s+(?:is\s+)?(?:a\s+|an\s+)?(?:\d+\s*(?:-\s*\d+\s*)?(?:week|month)[-\s]*)?(?:contract|temporary|fixed[-\s]?term)\s+(?:role|position|opportunity|engagement|assignment)\b/.test(
      value,
    ) ||
    /\b(?:contract|temporary|fixed[-\s]?term)\s+(?:role|position|opportunity|engagement|assignment)\b/.test(
      value,
    ) ||
    /\bon a (?:contract|temporary|fixed[-\s]?term) basis\b/.test(value) ||
    /\bshort[-\s]?term\s+(?:contract|assignment|engagement|role|position)\b/.test(value) ||
    /\b\d+\s*(?:-\s*\d+\s*)?(?:week|month)s?\s+(?:contract|assignment|engagement)\b/.test(value) ||
    /\b(?:contract|assignment|engagement)\s+duration\s*(?:is|:|-)?\s*\d+/.test(value)
  ) {
    return /\btemporary\b/.test(value.slice(0, 2500)) && !/\bcontract\b/.test(value.slice(0, 2500))
      ? 'temporary'
      : 'contract'
  }
  if (/\btype\s*[:\-–]\s*full[-\s]?time\b/.test(value)) return 'full-time'
  if (/\btype\s*[:\-–]\s*part[-\s]?time\b/.test(value)) return 'part-time'
  if (/\btype\s*[:\-–]\s*permanent\b/.test(value)) return 'permanent'
  if (/\btype\s*[:\-–]\s*(?:intern|internship)\b/.test(value)) return 'internship'
  return null
}

function durationOf(text: string): string | undefined {
  const pattern = /\b(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?[-\s]+(weeks?|months?)\b/i
  // Keep the evidence in one line or sentence. A source label on one line
  // must not turn "6 months of experience" elsewhere into a contract length.
  const segments = text
    .split(/[\r\n.!?;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  for (const segment of segments) {
    const lower = segment.toLowerCase()
    if (/\bexperience\b/.test(lower)) continue
    if (!/\b(?:contract|assignment|engagement|project|duration|term|gig)\b/.test(lower)) continue
    const match = pattern.exec(segment)
    if (!match) continue
    const first = Number(match[1])
    const second = match[2] ? Number(match[2]) : null
    const unit = match[3].toLowerCase().startsWith('week') ? 'week' : 'month'
    const limit = unit === 'week' ? 104 : 60
    if (!first || first > limit || (second !== null && (second < first || second > limit))) continue
    const plural = (second ?? first) === 1 ? unit : `${unit}s`
    return second ? `${first}-${second} ${plural}` : `${first} ${plural}`
  }
  return undefined
}

/**
 * Conservative opportunity classifier. A source-declared type wins. Title
 * evidence comes next, then only explicit engagement phrases in the advert.
 * Duties such as "contract management" do not turn an ordinary job into a gig.
 */
export function classifyOpportunity(input: OpportunityInput): OpportunityClassification {
  const jobTypeText = Array.isArray(input.jobType) ? input.jobType.join(' ') : (input.jobType ?? '')
  const source = sourceEngagement(jobTypeText) ?? exactTagEngagement(input.tags ?? [])
  let result = source ? fromEngagement(source, 'source') : null

  if (!result && input.salaryPeriod === 'project') result = fromEngagement('project', 'source')
  if (!result) {
    const title = titleEngagement(input.title ?? '')
    if (title) result = fromEngagement(title, 'title')
  }
  if (!result) {
    const description = descriptionEngagement(input.description ?? '')
    if (description) result = fromEngagement(description, 'description')
  }
  if (!result) result = classification('unknown', 'unknown')

  if (result.opportunityType === 'gig') {
    const duration = durationOf(
      [jobTypeText, ...(input.tags ?? []), input.title ?? '', input.description ?? ''].join('\n'),
    )
    if (duration) result.projectDuration = duration
  }
  return result
}

export function opportunityOf(
  job: Pick<
    Job,
    | 'opportunityType'
    | 'engagementType'
    | 'engagementLabel'
    | 'engagementBasis'
    | 'projectDuration'
    | 'title'
    | 'description'
    | 'salaryPeriod'
  >,
): OpportunityClassification {
  if (job.engagementType && job.engagementType !== 'unknown') {
    const derived = fromEngagement(job.engagementType, job.engagementBasis ?? 'stored')
    return {
      ...derived,
      opportunityType:
        job.opportunityType && job.opportunityType !== 'unknown'
          ? job.opportunityType
          : derived.opportunityType,
      engagementLabel: job.engagementLabel || derived.engagementLabel,
      ...(job.projectDuration ? { projectDuration: job.projectDuration } : {}),
    }
  }
  if (job.opportunityType === 'gig') {
    return {
      opportunityType: 'gig',
      engagementType: job.salaryPeriod === 'project' ? 'project' : 'contract',
      engagementLabel:
        job.engagementLabel || (job.salaryPeriod === 'project' ? 'Project work' : 'Contract'),
      engagementBasis: job.engagementBasis ?? 'stored',
      ...(job.projectDuration ? { projectDuration: job.projectDuration } : {}),
    }
  }
  if (job.opportunityType === 'job') {
    return {
      opportunityType: 'job',
      engagementType: 'unknown',
      engagementLabel: job.engagementLabel || '',
      engagementBasis: job.engagementBasis ?? 'stored',
    }
  }
  return classifyOpportunity({
    title: job.title,
    description: job.description,
    salaryPeriod: job.salaryPeriod,
  })
}

export function withOpportunity<T extends Job>(job: T): T {
  const found = opportunityOf(job)
  return {
    ...job,
    opportunityType: found.opportunityType,
    engagementType: found.engagementType,
    engagementLabel: found.engagementLabel,
    engagementBasis: found.engagementBasis,
    ...(found.projectDuration ? { projectDuration: found.projectDuration } : {}),
  }
}

export function isGig(job: Parameters<typeof opportunityOf>[0]): boolean {
  return opportunityOf(job).opportunityType === 'gig'
}

export function matchesOpportunityFilter(
  job: Parameters<typeof opportunityOf>[0],
  filter: OpportunityFilter | undefined,
): boolean {
  if (!filter || filter === 'all') return true
  const type = opportunityOf(job).opportunityType
  // The Jobs lane includes postings whose engagement was not stated; only a
  // positively classified gig/contract is held back from that lane.
  return filter === 'gig' ? type === 'gig' : type !== 'gig'
}

export function matchesOpportunityPreference(
  job: Parameters<typeof opportunityOf>[0],
  preferred: OpportunityType[] | undefined,
): boolean {
  const wanted = (preferred ?? []).filter((type) => type === 'job' || type === 'gig')
  if (!wanted.length || wanted.length === 2) return true
  return matchesOpportunityFilter(job, wanted[0] === 'gig' ? 'gig' : 'job')
}

export function opportunityBadge(job: Parameters<typeof opportunityOf>[0]): string {
  const found = opportunityOf(job)
  if (!found.engagementLabel) return ''
  return found.projectDuration
    ? `${found.engagementLabel} · ${found.projectDuration}`
    : found.engagementLabel
}

export const OPPORTUNITY_FILTER_OPTIONS: { id: OpportunityFilter; label: string }[] = [
  { id: 'all', label: 'All work' },
  { id: 'job', label: 'Jobs' },
  { id: 'gig', label: 'Gigs and contracts' },
]
