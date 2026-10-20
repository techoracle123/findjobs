import { countryName } from '../../shared/countries'
import type { RawPosting, SourceParser, SourceRef } from './types'
import { SourceError } from './types'
import { stripHtml } from './html'

/**
 * Applicant-tracking systems.
 *
 * Most employers publish their openings through one of a small number of
 * platforms, and those platforms expose a public JSON listing. Supporting
 * one platform therefore covers hundreds of employers, which is how a registry
 * of thousands of sources needs only a handful of parsers.
 *
 * A posting read straight from the employer's own board is marked verified,
 * because the employer published it there.
 */

async function readJson(url: string, sourceId: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    throw new SourceError(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      sourceId,
    )
  }
  if (!response.ok) {
    throw new SourceError(`${url} responded with ${response.status}`, sourceId)
  }
  try {
    return (await response.json()) as unknown
  } catch {
    throw new SourceError(`${url} did not return JSON`, sourceId)
  }
}

function slugOf(source: SourceRef): string {
  const slug = source.options.company ?? source.options.slug
  if (typeof slug === 'string' && slug.trim()) return slug.trim()
  throw new SourceError('This source has no company slug configured', source.id)
}

interface GreenhouseJob {
  id?: number | string
  title?: string
  updated_at?: string
  first_published?: string
  application_deadline?: string | null
  company_name?: string
  absolute_url?: string
  location?: { name?: string }
  departments?: { name?: string }[]
  offices?: { name?: string }[]
  content?: string
  metadata?: { name?: string; value?: string }[]
}

export const greenhouse: SourceParser = {
  id: 'greenhouse',
  name: 'Greenhouse job board',
  kind: 'ats',
  platform: 'greenhouse',
  homepage: 'https://www.greenhouse.io',
  attribution: "Jobs via the employer's own Greenhouse board.",
  verification: 'verified',
  verificationReason: "the employer's own Greenhouse board",

  async fetchPostings(source, fetchImpl = fetch) {
    const company = slugOf(source)
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs?content=true`
    const payload = (await readJson(url, source.id, fetchImpl)) as { jobs?: GreenhouseJob[] }

    if (!Array.isArray(payload.jobs))
      throw new SourceError('The board did not return a jobs list', source.id)
    return payload.jobs
      .filter(
        (job) =>
          job.id !== undefined &&
          job.title &&
          !/^(?:general (?:interest|application)|open application|join (?:our |the )?talent|talent (?:pool|community)|expression of interest)\b/i.test(
            job.title.trim(),
          ),
      )
      .map((job) => {
        const location = job.location?.name ?? job.offices?.[0]?.name ?? ''
        const metadata = new Map(
          (job.metadata ?? []).map((entry) => [String(entry.name).toLowerCase(), entry.value]),
        )
        const salary = metadata.get('salary') ?? metadata.get('compensation') ?? ''

        return {
          externalId: String(job.id),
          title: String(job.title ?? '').trim(),
          company: String(
            job.company_name || source.options.companyLabel || metadata.get('company') || company,
          ),
          description: stripHtml(job.content ?? ''),
          url: job.absolute_url ?? `https://boards.greenhouse.io/${company}/jobs/${job.id}`,
          applyUrl: job.absolute_url ?? '',
          location,
          remote: /remote/i.test(location),
          tags: [
            ...(job.departments ?? []).map((entry) => entry.name ?? ''),
            ...(job.offices ?? []).map((entry) => entry.name ?? ''),
          ].filter(Boolean),
          jobType: metadata.get('employment type') ?? metadata.get('type') ?? '',
          publishedAt:
            job.first_published && Number.isFinite(Date.parse(job.first_published))
              ? new Date(job.first_published).toISOString()
              : null,
          validThrough:
            job.application_deadline && Number.isFinite(Date.parse(job.application_deadline))
              ? new Date(job.application_deadline).toISOString()
              : null,
          closed: false,
          salary: null,
          ...(salary ? { salary: null } : {}),
        } satisfies RawPosting
      })
  },
}

interface LeverPosting {
  id?: string
  text?: string
  hostedUrl?: string
  applyUrl?: string
  descriptionPlain?: string
  description?: string
  categories?: { commitment?: string; location?: string; team?: string; department?: string }
  lists?: { text?: string; content?: string }[]
  createdAt?: number
  additionalPlain?: string
}

export const lever: SourceParser = {
  id: 'lever',
  name: 'Lever postings',
  kind: 'ats',
  platform: 'lever',
  homepage: 'https://www.lever.co',
  attribution: "Jobs via the employer's own Lever board.",
  verification: 'verified',
  verificationReason: "the employer's own Lever board",

  async fetchPostings(source, fetchImpl = fetch) {
    const company = slugOf(source)
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
    const payload = (await readJson(url, source.id, fetchImpl)) as
      LeverPosting[] | { postings?: LeverPosting[]; data?: LeverPosting[] }

    const postings = Array.isArray(payload) ? payload : (payload.postings ?? payload.data ?? [])
    return postings
      .filter((posting) => posting.id && posting.text)
      .map((posting) => {
        const description = [
          posting.descriptionPlain ?? stripHtml(posting.description ?? ''),
          ...(posting.lists ?? []).map((list) => stripHtml(list.content ?? '')),
        ]
          .filter(Boolean)
          .join('\n\n')

        const location = posting.categories?.location ?? ''
        return {
          externalId: String(posting.id),
          title: String(posting.text ?? '').trim(),
          company: String(source.options.companyLabel ?? company),
          description,
          url: posting.hostedUrl ?? `https://jobs.lever.co/${company}/${posting.id}`,
          applyUrl: posting.applyUrl ?? posting.hostedUrl ?? '',
          location,
          remote: /remote/i.test(location) || /remote/i.test(posting.categories?.commitment ?? ''),
          tags: [posting.categories?.department ?? '', posting.categories?.team ?? ''].filter(
            Boolean,
          ),
          jobType: posting.categories?.commitment ?? '',
          publishedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
          validThrough: null,
          closed: false,
          salary: null,
        } satisfies RawPosting
      })
  },
}

interface AshbyJob {
  id?: string
  title?: string
  location?: string
  employmentType?: string
  department?: string
  team?: string
  jobUrl?: string
  applyUrl?: string
  publishedAt?: string
  descriptionHtml?: string
  descriptionPlain?: string
  isListed?: boolean
}

export const ashby: SourceParser = {
  id: 'ashby',
  name: 'Ashby job board',
  kind: 'ats',
  platform: 'ashby',
  homepage: 'https://ashbyhq.com',
  attribution: "Jobs via the employer's own Ashby board.",
  verification: 'verified',
  verificationReason: "the employer's own Ashby board",

  async fetchPostings(source, fetchImpl = fetch) {
    const company = slugOf(source)
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`
    const payload = (await readJson(url, source.id, fetchImpl)) as { jobs?: AshbyJob[] }

    return (payload.jobs ?? [])
      .filter((job) => job.id && job.title)
      .map((job) => ({
        externalId: String(job.id),
        title: String(job.title ?? '').trim(),
        company: job.team ?? company,
        description: stripHtml(job.descriptionHtml ?? job.descriptionPlain ?? ''),
        url: job.jobUrl ?? `https://jobs.ashbyhq.com/${company}/${job.id}`,
        applyUrl: job.applyUrl ?? job.jobUrl ?? '',
        location: job.location ?? '',
        remote: /remote/i.test(job.location ?? ''),
        tags: [job.department ?? '', job.team ?? ''].filter(Boolean),
        jobType: job.employmentType ?? '',
        publishedAt: job.publishedAt ?? null,
        validThrough: null,
        closed: job.isListed === false,
        salary: null,
      }))
  },
}

interface RecruiteeOffer {
  id?: string | number
  slug?: string
  title?: string
  description?: string
  requirements?: string
  location?: string
  employment_type?: string
  departments?: string[]
  careers_url?: string
  published_at?: string
  created_at?: string
  remote?: boolean
}

export const recruitee: SourceParser = {
  id: 'recruitee',
  name: 'Recruitee careers',
  kind: 'ats',
  platform: 'recruitee',
  homepage: 'https://recruitee.com',
  attribution: "Jobs via the employer's own Recruitee board.",
  verification: 'verified',
  verificationReason: "the employer's own Recruitee board",

  async fetchPostings(source, fetchImpl = fetch) {
    const company = slugOf(source)
    const url = `https://${encodeURIComponent(company)}.recruitee.com/api/offers/?limit=200`
    const payload = (await readJson(url, source.id, fetchImpl)) as { offers?: RecruiteeOffer[] }

    return (payload.offers ?? [])
      .filter((offer) => offer.id !== undefined && offer.title)
      .map((offer) => {
        const location = offer.location ?? ''
        return {
          externalId: String(offer.id),
          title: String(offer.title ?? '').trim(),
          company,
          description: [offer.description ?? '', offer.requirements ?? '']
            .map((part) => stripHtml(part))
            .filter(Boolean)
            .join('\n\n'),
          url: offer.careers_url ?? `https://${company}.recruitee.com/o/${offer.slug ?? offer.id}`,
          applyUrl: offer.careers_url ?? '',
          location,
          remote: Boolean(offer.remote) || /remote/i.test(location),
          tags: offer.departments ?? [],
          jobType: offer.employment_type ?? '',
          publishedAt: offer.published_at ?? offer.created_at ?? null,
          validThrough: null,
          closed: false,
          salary: null,
        }
      })
  },
}

interface SmartRecruitersPosting {
  id?: string
  name?: string
  uuid?: string
  ref?: string
  external_url?: string
  company?: { name?: string }
  location?: { city?: string; country?: string; region?: string }
  department?: { label?: string }
  releasedDate?: string
}

export const smartrecruiters: SourceParser = {
  id: 'smartrecruiters',
  name: 'SmartRecruiters postings',
  kind: 'ats',
  platform: 'smartrecruiters',
  homepage: 'https://www.smartrecruiters.com',
  attribution: "Jobs via the employer's own SmartRecruiters board.",
  verification: 'verified',
  verificationReason: "the employer's own SmartRecruiters board",

  async fetchPostings(source, fetchImpl = fetch) {
    const company = slugOf(source)
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`
    const payload = (await readJson(url, source.id, fetchImpl)) as {
      content?: SmartRecruitersPosting[]
    }

    const listings = (payload.content ?? []).filter((posting) => posting.id && posting.name)

    // The listing has no description, so the detail is fetched for the first
    // handful only. Running the source again picks up the next batch.
    const withDetail = await Promise.all(
      listings.slice(0, 20).map(async (posting) => {
        const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${posting.id}`
        let description = ''
        let applicationUrl =
          posting.external_url ||
          `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${posting.id}`
        try {
          const detail = (await readJson(detailUrl, source.id, fetchImpl)) as {
            applyUrl?: string
            postingUrl?: string
            jobAd?: {
              sections?: {
                jobDescription?: string | { text?: string }
                qualifications?: string | { text?: string }
                additionalInformation?: string | { text?: string }
              }
            }
          }
          applicationUrl = detail.applyUrl || detail.postingUrl || applicationUrl
          description = [
            detail.jobAd?.sections?.jobDescription ?? '',
            detail.jobAd?.sections?.qualifications ?? '',
            detail.jobAd?.sections?.additionalInformation ?? '',
          ]
            .map((part) => stripHtml(typeof part === 'string' ? part : part.text || ''))
            .filter(Boolean)
            .join('\n\n')
        } catch {
          // A posting with no description is still worth listing.
        }

        const location = [
          posting.location?.city,
          posting.location?.region,
          posting.location?.country ? countryName(posting.location.country.toUpperCase()) : '',
        ]
          .filter(Boolean)
          .join(', ')

        return {
          externalId: String(posting.id),
          title: String(posting.name ?? '').trim(),
          company: posting.company?.name ?? company,
          description,
          url: applicationUrl,
          applyUrl: applicationUrl,
          location,
          remote: /remote/i.test(location),
          tags: posting.department?.label ? [posting.department.label] : [],
          jobType: '',
          publishedAt: posting.releasedDate ?? null,
          validThrough: null,
          closed: false,
          salary: null,
        } satisfies RawPosting
      }),
    )

    return withDetail
  },
}

interface WorkdayPosting {
  title?: string
  externalPath?: string
  externalReqId?: string
  locationsText?: string
  postedOn?: string
  jobDescription?: string
  bulletFields?: { title?: string; text?: string }[]
}

export const workday: SourceParser = {
  id: 'workday',
  name: 'Workday postings',
  kind: 'ats',
  platform: 'workday',
  homepage: 'https://www.workday.com',
  attribution: "Jobs via the employer's own Workday board.",
  verification: 'verified',
  verificationReason: "the employer's own Workday board",

  async fetchPostings(source, fetchImpl = fetch) {
    const url = source.listingUrl
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        source.id,
      )
    }
    if (!response.ok) {
      throw new SourceError(`${url} responded with ${response.status}`, source.id)
    }

    const payload = (await response.json()) as { jobPostings?: WorkdayPosting[] }
    const postings = payload.jobPostings ?? []

    return postings
      .filter((posting) => posting.title && posting.externalPath)
      .map((posting) => {
        const location = posting.locationsText ?? ''
        const description = [
          stripHtml(posting.jobDescription ?? ''),
          ...(posting.bulletFields ?? [])
            .filter((field) => field.title)
            .map((field) => `${field.title}: ${stripHtml(field.text ?? '')}`),
        ]
          .filter(Boolean)
          .join('\n\n')

        return {
          externalId: posting.externalReqId ?? posting.externalPath ?? '',
          title: String(posting.title ?? '').trim(),
          company: source.options.companyLabel
            ? String(source.options.companyLabel)
            : slugOf(source),
          description,
          url: `${url.split('/wday/cxs/')[0]}${posting.externalPath ?? ''}`,
          applyUrl: '',
          location,
          remote: /remote/i.test(location),
          tags: [],
          jobType: '',
          publishedAt: posting.postedOn ?? null,
          validThrough: null,
          closed: false,
          salary: null,
        }
      })
  },
}

export const ATS_PARSERS: SourceParser[] = [
  greenhouse,
  lever,
  ashby,
  recruitee,
  smartrecruiters,
  workday,
]
