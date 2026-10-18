import type { RawPosting, RawSalary, SourceParser } from './types'
import { SourceError } from './types'
import { decodeEntities, extractJsonLd, findJsonLdType, stripHtml, textOf } from './html'

/**
 * A generic reader for any page that publishes schema.org `JobPosting`
 * markup. Employer career pages overwhelmingly use it, and it carries the
 * same structured fields the search engines read.
 *
 * A page found this way is marked unverified by default: the markup is
 * self-declared, and only the employer's own domain proves it.
 */
export const jsonLd: SourceParser = {
  id: 'jsonld',
  name: 'schema.org JobPosting',
  kind: 'jsonld',
  homepage: 'https://schema.org/JobPosting',
  attribution: "Read from the employer's own careers page.",
  verification: 'unverified',
  verificationReason: 'a careers page publishing structured job data',

  async fetchPostings(source, fetchImpl = fetch) {
    let response: Response
    try {
      response = await fetchImpl(source.listingUrl, { headers: { accept: 'text/html' } })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${source.listingUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        source.id,
      )
    }
    if (!response.ok) {
      throw new SourceError(`${source.listingUrl} responded with ${response.status}`, source.id)
    }

    const html = await response.text()
    const blocks = extractJsonLd(html)
    const postings = blocks
      .map((block) => findJsonLdType(block, 'JobPosting'))
      .filter((posting): posting is Record<string, unknown> => posting !== null)

    const seen = new Set<string>()

    const parsed: (RawPosting | null)[] = postings.map((posting) => {
      const organisation = (posting.hiringOrganization ?? {}) as Record<string, unknown>
      const location = (posting.jobLocation ?? {}) as Record<string, unknown>
      const address = (location.address ?? {}) as Record<string, unknown>
      const place =
        [textOf(address.addressLocality), textOf(address.addressRegion)]
          .filter(Boolean)
          .join(', ') || textOf(location.name)

      const baseSalary = (posting.baseSalary ?? {}) as Record<string, unknown>
      const value = (baseSalary.value ?? {}) as Record<string, unknown>
      const currency = textOf(baseSalary.currency) || textOf(value.currency)
      const min = typeof value.minValue === 'number' ? value.minValue : null
      const max = typeof value.maxValue === 'number' ? value.maxValue : null
      const salary: RawSalary | null =
        min !== null || max !== null
          ? { min, max: max ?? min, currency: currency || null, period: 'year' }
          : null

      const url = textOf(posting.url) || source.listingUrl
      const identifier = textOf(posting.identifier) || url
      const validThrough = textOf(posting.validThrough)

      const remote =
        textOf(location.jobLocationType).toUpperCase() === 'TELECOMMUTE' || /remote/i.test(place)

      const result: RawPosting = {
        externalId: identifier,
        title: textOf(posting.title),
        company: textOf(organisation.name) || textOf(organisation.legalName),
        description: stripHtml(textOf(posting.description)),
        url,
        applyUrl: textOf(posting.applyUrl) || url,
        companyUrl: textOf(organisation.sameAs),
        location: place,
        remote,
        tags: Array.isArray(posting.jobLocationType)
          ? posting.jobLocationType.map(String)
          : [textOf(posting.employmentType)].filter(Boolean),
        jobType: textOf(posting.employmentType),
        publishedAt: textOf(posting.datePosted) || null,
        validThrough: validThrough || null,
        closed: false,
        salary,
      }

      if (!result.title || !result.externalId) return null
      return result
    })

    return parsed
      .filter((posting): posting is RawPosting => posting !== null)
      .filter((posting) => {
        if (seen.has(posting.externalId)) return false
        seen.add(posting.externalId)
        return true
      })
  },
}

function tagValue(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const match = block.match(pattern)
  if (!match) return ''
  return decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()
}

/**
 * A reader for RSS and Atom feeds. Many employer sites publish one even
 * when they have no applicant-tracking system.
 */
export const rss: SourceParser = {
  id: 'rss',
  name: 'RSS job feed',
  kind: 'rss',
  homepage: 'https://www.rssboard.org',
  attribution: "Read from the employer's own job feed.",
  verification: 'unverified',
  verificationReason: 'an employer job feed',

  async fetchPostings(source, fetchImpl = fetch) {
    let response: Response
    try {
      response = await fetchImpl(source.listingUrl, { headers: { accept: 'application/xml' } })
    } catch (error) {
      throw new SourceError(
        `Could not reach ${source.listingUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        source.id,
      )
    }
    if (!response.ok) {
      throw new SourceError(`${source.listingUrl} responded with ${response.status}`, source.id)
    }

    const xml = await response.text()
    const items = [
      ...[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]),
      ...[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]),
    ]

    const company = textOf(source.options.companyLabel) || ''

    return items
      .map((block) => {
        const title = stripHtml(tagValue(block, 'title'))
        const link = tagValue(block, 'link') || tagValue(block, 'guid')
        const description = stripHtml(tagValue(block, 'description') || tagValue(block, 'content'))
        const published =
          tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated')
        const categories = [
          ...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi),
        ].map((match) =>
          decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim(),
        )

        if (!title || !link) return null

        const publishedAt = published ? new Date(published).toISOString() : null
        const posting: RawPosting = {
          externalId: link,
          title,
          company,
          description,
          url: link,
          applyUrl: link,
          location: '',
          remote: /remote/i.test(`${title} ${description}`),
          tags: categories.filter(Boolean),
          jobType: '',
          publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
          validThrough: null,
          closed: false,
          salary: null,
        }
        return posting
      })
      .filter((posting): posting is RawPosting => posting !== null)
  },
}

export const FEED_PARSERS: SourceParser[] = [jsonLd, rss]
