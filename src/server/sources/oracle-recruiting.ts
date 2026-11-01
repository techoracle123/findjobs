import { countryName } from '../../shared/countries'
import { stripHtml } from './html'
import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'

/**
 * Oracle Recruiting Cloud Candidate Experience.
 *
 * Employers using Oracle's public career sites expose the same unauthenticated
 * JSON endpoints their own pages use. The list endpoint gives the posting
 * card; the detail endpoint carries the full advert and, importantly for
 * public-sector and large-employer roles, the closing date. This parser reads
 * both and leaves every application on the employer's Oracle site.
 */

interface OracleListJob {
  Id?: string | number
  Title?: string
  PostedDate?: string
  PostingEndDate?: string | null
  PrimaryLocationCountry?: string
  PrimaryLocation?: string
  WorkplaceType?: string
  JobSchedule?: string | null
  JobType?: string | null
  WorkerType?: string | null
  ContractType?: string | null
  JobFamily?: string | null
  JobFunction?: string | null
  ShortDescriptionStr?: string | null
  Organization?: string | null
  LegalEmployer?: string | null
  secondaryLocations?: unknown[]
  [key: string]: unknown
}

interface OracleSearchItem {
  TotalJobsCount?: number
  requisitionList?: OracleListJob[]
  Id?: string | number
  Title?: string
  [key: string]: unknown
}

interface OracleDetail extends OracleListJob {
  Category?: string | null
  RequisitionType?: string | null
  ExternalPostedStartDate?: string | null
  ExternalPostedEndDate?: string | null
  ExternalDescriptionStr?: string | null
  ExternalQualificationsStr?: string | null
  ExternalResponsibilitiesStr?: string | null
  StudyLevel?: string | null
  skills?: unknown[]
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['Name', 'name', 'LocationName', 'PrimaryLocation', 'Value', 'value']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
    }
  }
  return ''
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))]
}

function oracleConfig(listingUrl: string, options: Record<string, unknown>, sourceId: string) {
  let parsed: URL
  try {
    parsed = new URL(listingUrl)
  } catch {
    throw new SourceError('The Oracle recruiting listing URL is not valid', sourceId)
  }
  const siteFromPath = parsed.pathname.match(/\/sites\/([^/]+)/i)?.[1]
  const siteNumber =
    typeof options.siteNumber === 'string' && options.siteNumber.trim()
      ? options.siteNumber.trim()
      : siteFromPath
        ? decodeURIComponent(siteFromPath)
        : 'CX_1'
  const language =
    typeof options.language === 'string' && options.language.trim()
      ? options.language.trim()
      : (parsed.pathname.match(/\/CandidateExperience\/([^/]+)\/sites\//i)?.[1] ?? 'en')
  const countryCode =
    typeof options.countryCode === 'string' ? options.countryCode.trim().toUpperCase() : ''
  const location =
    typeof options.location === 'string' && options.location.trim()
      ? options.location.trim()
      : countryCode
        ? countryName(countryCode)
        : ''
  const keyword = typeof options.keyword === 'string' ? options.keyword.trim() : ''
  const requestedMax = Number(options.maxPostings ?? 100)
  const maxPostings = Number.isFinite(requestedMax)
    ? Math.min(200, Math.max(1, Math.floor(requestedMax)))
    : 100
  return {
    origin: parsed.origin,
    siteNumber,
    language,
    countryCode,
    location,
    keyword,
    maxPostings,
    fetchDetails: options.fetchDetails !== false,
  }
}

function finderText(value: string): string {
  return `%22${encodeURIComponent(value.replace(/"/g, ''))}%22`
}

async function readJson(
  url: string,
  sourceId: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    throw new SourceError(
      `Could not reach the recruiting board: ${error instanceof Error ? error.message : String(error)}`,
      sourceId,
    )
  }
  if (!response.ok) {
    throw new SourceError(`The recruiting board responded with ${response.status}`, sourceId)
  }
  try {
    const payload = (await response.json()) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('not an object')
    }
    return payload as Record<string, unknown>
  } catch {
    throw new SourceError('The recruiting board did not return JSON', sourceId)
  }
}

function descriptionFrom(detail: OracleDetail | null, listing: OracleListJob): string {
  const sections = [
    stripHtml(detail?.ExternalDescriptionStr ?? ''),
    stripHtml(detail?.ExternalResponsibilitiesStr ?? ''),
    stripHtml(detail?.ExternalQualificationsStr ?? ''),
    stripHtml(detail?.ShortDescriptionStr ?? listing.ShortDescriptionStr ?? ''),
  ].filter(Boolean)
  const kept: string[] = []
  for (const section of sections) {
    const fingerprint = section.slice(0, 100).toLowerCase()
    if (kept.some((existing) => existing.toLowerCase().includes(fingerprint) && fingerprint)) {
      continue
    }
    kept.push(section)
  }
  return kept.join('\n\n')
}

export const oracleRecruiting: SourceParser = {
  id: 'oracle-recruiting',
  name: 'Oracle Recruiting Cloud board',
  kind: 'ats',
  platform: 'oracle-recruiting',
  homepage: 'https://www.oracle.com/human-capital-management/recruiting/',
  attribution: "Jobs read from the employer's public Oracle recruiting site.",
  verification: 'unverified',
  verificationReason:
    'Read from a public employer recruiting site; check it there before applying.',

  async fetchPostings(source, fetchImpl = fetch) {
    const config = oracleConfig(source.listingUrl, source.options, source.id)
    const listings: OracleListJob[] = []
    const seen = new Set<string>()
    let rawSeen = 0

    for (let offset = 0; listings.length < config.maxPostings; offset += 50) {
      const finder = [
        `findReqs;siteNumber=${encodeURIComponent(config.siteNumber)}`,
        ...(config.keyword ? [`keyword=${finderText(config.keyword)}`] : []),
        ...(config.location ? [`location=${finderText(config.location)}`] : []),
        'limit=50',
        `offset=${offset}`,
        'sortBy=POSTING_DATES_DESC',
      ].join(',')
      const url = `${config.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`
      const payload = await readJson(url, source.id, fetchImpl)
      if (!Array.isArray(payload.items)) {
        throw new SourceError('The recruiting board did not return a jobs list', source.id)
      }
      const items = payload.items as OracleSearchItem[]
      const page = items.flatMap((item) => {
        if (Array.isArray(item.requisitionList)) return item.requisitionList
        return item.Id !== undefined && item.Title ? [item as OracleListJob] : []
      })
      if (!page.length) break
      rawSeen += page.length

      for (const job of page) {
        const id = stringValue(job.Id)
        if (!id || !job.Title || seen.has(id)) continue
        if (
          config.countryCode &&
          job.PrimaryLocationCountry &&
          job.PrimaryLocationCountry.toUpperCase() !== config.countryCode
        ) {
          continue
        }
        seen.add(id)
        listings.push(job)
        if (listings.length >= config.maxPostings) break
      }

      const total = items.find((item) => typeof item.TotalJobsCount === 'number')?.TotalJobsCount
      if (page.length < 50 || (typeof total === 'number' && rawSeen >= total)) break
    }

    const companyLabel =
      typeof source.options.companyLabel === 'string' ? source.options.companyLabel : ''

    const toPosting = async (listing: OracleListJob): Promise<RawPosting> => {
      const id = stringValue(listing.Id)
      let detail: OracleDetail | null = null
      if (config.fetchDetails) {
        try {
          const detailUrl = `${config.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=${finderText(id)},siteNumber=${encodeURIComponent(config.siteNumber)}`
          const payload = await readJson(detailUrl, source.id, fetchImpl)
          if (Array.isArray(payload.items) && payload.items[0]) {
            detail = payload.items[0] as OracleDetail
          }
        } catch {
          detail = null
        }
      }

      const countryCode = (
        detail?.PrimaryLocationCountry ??
        listing.PrimaryLocationCountry ??
        ''
      ).toUpperCase()
      const locationValues = unique([
        detail?.PrimaryLocation ?? listing.PrimaryLocation,
        ...(((detail?.secondaryLocations ?? listing.secondaryLocations ?? []) as unknown[]).map(
          stringValue,
        ) as string[]),
      ])
      let location = locationValues.join('; ')
      const countryLabel = countryCode ? countryName(countryCode) : ''
      if (
        countryLabel &&
        location &&
        !location.toLowerCase().includes(countryLabel.toLowerCase())
      ) {
        location = `${location}, ${countryLabel}`
      }
      if (!location) location = countryLabel

      const workplace = detail?.WorkplaceType ?? listing.WorkplaceType ?? ''
      const publicUrl = `${config.origin}/hcmUI/CandidateExperience/${encodeURIComponent(config.language)}/sites/${encodeURIComponent(config.siteNumber)}/job/${encodeURIComponent(id)}`
      const validThrough = detail?.ExternalPostedEndDate ?? listing.PostingEndDate ?? null
      const jobType = unique([
        detail?.JobSchedule ?? listing.JobSchedule,
        detail?.RequisitionType,
        detail?.ContractType ?? listing.ContractType,
        detail?.WorkerType ?? listing.WorkerType,
        detail?.JobType ?? listing.JobType,
      ]).join(' · ')
      const tags = unique([
        detail?.Category,
        detail?.JobFunction ?? listing.JobFunction,
        detail?.JobFamily ?? listing.JobFamily,
        detail?.StudyLevel,
        workplace,
        ...((detail?.skills ?? []) as unknown[]).map(stringValue),
      ])

      return {
        externalId: id,
        title: String(detail?.Title ?? listing.Title ?? '').trim(),
        company:
          companyLabel ||
          stringValue(detail?.Organization ?? detail?.LegalEmployer) ||
          stringValue(listing.Organization ?? listing.LegalEmployer) ||
          String(source.options.company ?? ''),
        description: descriptionFrom(detail, listing),
        url: publicUrl,
        applyUrl: publicUrl,
        location,
        remote: /remote/i.test(`${workplace} ${location} ${listing.Title ?? ''}`),
        tags,
        jobType,
        publishedAt: detail?.ExternalPostedStartDate ?? listing.PostedDate ?? null,
        validThrough:
          validThrough && Number.isFinite(Date.parse(validThrough)) ? validThrough : null,
        closed: false,
        salary: null,
      }
    }

    const postings: RawPosting[] = []
    for (let index = 0; index < listings.length; index += 5) {
      postings.push(...(await Promise.all(listings.slice(index, index + 5).map(toPosting))))
    }
    return postings.filter((posting) => posting.title && posting.externalId)
  },
}
