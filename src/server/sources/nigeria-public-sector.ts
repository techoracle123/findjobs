import { decodeEntities, stripHtml } from './html'
import type { RawPosting, SourceParser } from './types'
import { SourceError } from './types'

/**
 * Nigerian public recruitment portals that do not publish a conventional ATS
 * feed.
 *
 * These readers are deliberately fail-closed. A closed banner, a past closing
 * date, or a vacancy marked Closed produces no listing. That matters more here
 * than squeezing out a doubtful row: old federal recruitment exercises are a
 * common source of scams and stale reposts. Applications always stay on the
 * official portal named by the source.
 */

async function readText(url: string, sourceId: string, fetchImpl: typeof fetch): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'text/html,application/json,*/*' } })
  } catch (error) {
    throw new SourceError(
      `Could not reach the official portal: ${error instanceof Error ? error.message : String(error)}`,
      sourceId,
    )
  }
  if (!response.ok) {
    throw new SourceError(`The official portal responded with ${response.status}`, sourceId)
  }
  return response.text()
}

function originOf(listingUrl: string, sourceId: string): string {
  try {
    return new URL(listingUrl).origin
  } catch {
    throw new SourceError('The official portal URL is not valid', sourceId)
  }
}

interface AnchorCandidate {
  index: number
  title: string
  url: string
  pathname: string
}

function anchors(html: string, pageUrl: string): AnchorCandidate[] {
  const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
  const found: AnchorCandidate[] = []
  let match = pattern.exec(html)
  while (match !== null) {
    let url: URL
    try {
      url = new URL(decodeEntities(match[2] ?? ''), pageUrl)
    } catch {
      match = pattern.exec(html)
      continue
    }
    const title = stripHtml(match[3] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    found.push({ index: match.index, title, url: url.href, pathname: url.pathname })
    match = pattern.exec(html)
  }
  return found
}

function labeledValue(text: string, labels: string[]): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(new RegExp(`^${label}\\s*:?\\s*(.*)$`, 'i'))
      if (!match) continue
      if (match[1]?.trim()) return match[1].trim()
      if (lines[index + 1]) return lines[index + 1]
    }
  }
  return ''
}

function parsePortalDate(value: string): string | null {
  const clean = value.replace(/(\d)(st|nd|rd|th)\b/gi, '$1').trim()
  const numeric = clean.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/)
  if (numeric) {
    const date = new Date(
      Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), 23, 59, 59),
    )
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const parsed = Date.parse(clean)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function closingDate(text: string): string | null {
  const match = text.match(
    /(?:closing date|close date|application deadline|deadline)[^0-9A-Za-z]{0,20}([^\n]{4,50})/i,
  )
  return match ? parsePortalDate(match[1]) : null
}

/* ------------------------------------------------------------------ EFCC */

interface EfccCategory {
  code: string
  cadre: string
  title: string
  gradeLevel: string
  minAge: number | null
  maxAge: number | null
  requirement: string
  positions: string[]
}

function decodeJsString(value: string): string {
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\([`'"\\/])/g, '$1')
    .trim()
}

function objectSlice(bundle: string, fromIndex: number): string {
  const start = bundle.lastIndexOf('{', fromIndex)
  if (start < 0) return ''
  let depth = 0
  let quote = ''
  for (let index = start; index < bundle.length; index += 1) {
    const char = bundle[index]
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return bundle.slice(start, index + 1)
    }
  }
  return ''
}

function jsStringField(objectText: string, key: string): string {
  const match = objectText.match(
    new RegExp(key + '\\s*:\\s*(["\'`])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1'),
  )
  return match ? decodeJsString(match[2]) : ''
}

function jsNumberField(objectText: string, key: string): number | null {
  const match = objectText.match(new RegExp(`${key}\\s*:\\s*(\\d{1,3})`))
  return match ? Number(match[1]) : null
}

function jsStringArray(objectText: string, key: string): string[] {
  const arrayText = objectText.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`))?.[1] ?? ''
  const values: string[] = []
  const pattern = /([`'"])((?:\\.|(?!\1)[\s\S])*?)\1/g
  let match = pattern.exec(arrayText)
  while (match !== null) {
    values.push(decodeJsString(match[2]))
    match = pattern.exec(arrayText)
  }
  return values.filter(Boolean)
}

function efccCategories(bundle: string): EfccCategory[] {
  const codePattern = /\bcode\s*:\s*[`'"]([A-Z])[`'"]/g
  const categories: EfccCategory[] = []
  const seen = new Set<string>()
  let match = codePattern.exec(bundle)
  while (match !== null) {
    const objectText = objectSlice(bundle, match.index)
    const category: EfccCategory = {
      code: match[1],
      cadre: jsStringField(objectText, 'cadre'),
      title: jsStringField(objectText, 'title'),
      gradeLevel: jsStringField(objectText, 'gradeLevel'),
      minAge: jsNumberField(objectText, 'minAge'),
      maxAge: jsNumberField(objectText, 'maxAge'),
      requirement: jsStringField(objectText, 'requirement'),
      positions: jsStringArray(objectText, 'positions'),
    }
    if (category.cadre && category.title && category.requirement && !seen.has(category.code)) {
      seen.add(category.code)
      categories.push(category)
    }
    match = codePattern.exec(bundle)
  }
  return categories.sort((a, b) => a.code.localeCompare(b.code))
}

export const efccRecruitment: SourceParser = {
  id: 'efcc-recruitment',
  name: 'EFCC official recruitment portal',
  kind: 'html',
  platform: 'efcc-recruitment',
  homepage: 'https://recruitment.efcc.gov.ng/',
  attribution: 'Recruitment categories read from the official EFCC recruitment portal.',
  verification: 'unverified',
  verificationReason:
    'Read from the official public portal; check the details there before applying.',

  async fetchPostings(source, fetchImpl = fetch) {
    const origin = originOf(source.listingUrl, source.id)
    const configText = await readText(`${origin}/api/v1/config`, source.id, fetchImpl)
    let config: { status?: string; opensAt?: string; closesAt?: string }
    try {
      config = JSON.parse(configText) as { status?: string; opensAt?: string; closesAt?: string }
    } catch {
      throw new SourceError('The EFCC portal did not return its public status', source.id)
    }
    const now = Date.now()
    if (config.status !== 'open') return []
    if (
      config.opensAt &&
      Number.isFinite(Date.parse(config.opensAt)) &&
      Date.parse(config.opensAt) > now
    ) {
      return []
    }
    if (
      config.closesAt &&
      Number.isFinite(Date.parse(config.closesAt)) &&
      Date.parse(config.closesAt) < now
    ) {
      return []
    }

    const homepage = await readText(`${origin}/`, source.id, fetchImpl)
    const scriptMatches = [...homepage.matchAll(/<script[^>]+src=(["'])(.*?\.js)\1/gi)].map(
      (match) => match[2],
    )
    const bundlePath =
      scriptMatches.find((path) => /\/index-[^/]+\.js$/i.test(path)) ?? scriptMatches[0]
    if (!bundlePath) return []
    const bundleUrl = new URL(bundlePath, `${origin}/`).href
    const bundle = await readText(bundleUrl, source.id, fetchImpl)
    const categories = efccCategories(bundle)
    const exercise = (config.closesAt ?? config.opensAt ?? 'current').slice(0, 10)
    const company =
      typeof source.options.companyLabel === 'string'
        ? source.options.companyLabel
        : 'Economic and Financial Crimes Commission (EFCC)'

    return categories.map((category) => {
      const title = `${category.title}${category.gradeLevel ? ` – ${category.gradeLevel}` : ''}`
      const description = [
        `Category ${category.code}: ${category.cadre}.`,
        category.requirement,
        category.minAge && category.maxAge
          ? `Age range for this category: ${category.minAge} to ${category.maxAge}.`
          : '',
        category.positions.length ? `Open areas: ${category.positions.join(', ')}.` : '',
        config.closesAt ? `Applications close on ${config.closesAt.slice(0, 10)}.` : '',
        'Apply through the official EFCC recruitment portal. Check the full requirements there before you start.',
      ]
        .filter(Boolean)
        .join('\n\n')
      return {
        externalId: `efcc-${exercise}-category-${category.code.toLowerCase()}`,
        title,
        company,
        description,
        url: `${origin}/#requirements`,
        applyUrl: `${origin}/signup`,
        location: 'Nigeria',
        remote: false,
        tags: [category.cadre, category.gradeLevel, ...category.positions].filter(Boolean),
        jobType: '',
        publishedAt: config.opensAt ?? null,
        validThrough: config.closesAt ?? null,
        closed: false,
        salary: null,
      } satisfies RawPosting
    })
  },
}

/* ------------------------------------------------------------------ FCSC */

export const fcscVacancies: SourceParser = {
  id: 'fcsc-vacancies',
  name: 'Federal Civil Service Commission vacancies',
  kind: 'html',
  platform: 'fcsc-vacancies',
  homepage: 'https://recruitment.fedcivilservice.gov.ng/',
  attribution: 'Vacancies read from the official Federal Civil Service recruitment portal.',
  verification: 'unverified',
  verificationReason:
    'Read from the official public portal; check the details there before applying.',

  async fetchPostings(source, fetchImpl = fetch) {
    const html = await readText(source.listingUrl, source.id, fetchImpl)
    const allAnchors = anchors(html, source.listingUrl)
    const candidates = allAnchors.filter(
      (anchor) => /^\/vacancies\/[^/]+/i.test(anchor.pathname) && anchor.title.length >= 4,
    )
    const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    const companyFallback =
      typeof source.options.companyLabel === 'string'
        ? source.options.companyLabel
        : 'Federal Civil Service Commission'

    const postings: RawPosting[] = []
    for (const candidate of unique.slice(0, 100)) {
      const nextIndex =
        allAnchors.find((anchor) => anchor.index > candidate.index && anchor !== candidate)
          ?.index ?? Math.min(html.length, candidate.index + 4500)
      const chunk = stripHtml(
        html.slice(candidate.index, Math.min(nextIndex, candidate.index + 4500)),
      )
      if (/\bclosed\b/i.test(chunk)) continue

      let detailHtml = ''
      try {
        detailHtml = await readText(candidate.url, source.id, fetchImpl)
      } catch {
        continue
      }
      const detailText = stripHtml(detailHtml)
      const title =
        stripHtml(detailHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') || candidate.title
      const relevant = detailText.slice(
        Math.max(0, detailText.toLowerCase().indexOf(title.toLowerCase())),
      )
      if (/\bclosed\b/i.test(relevant.slice(0, 6000))) continue
      const hasOpenRoute =
        /href=(["'])[^"']*(?:apply|application)[^"']*\1/i.test(detailHtml) ||
        /apply now|apply for this (?:job|position)|status\s*:?\s*open/i.test(relevant)
      if (!hasOpenRoute) continue

      const validThrough = closingDate(detailText)
      if (validThrough && Date.parse(validThrough) < Date.now()) continue
      const descriptionStart = relevant.search(/\bdescription\b/i)
      let description = descriptionStart >= 0 ? relevant.slice(descriptionStart) : relevant
      description = description.replace(/^description\s*:?/i, '')
      const informationIndex = description.search(/\binformation\b/i)
      if (informationIndex > 80) description = description.slice(0, informationIndex)
      const grade = labeledValue(detailText, ['Grade Level'])
      const mda = labeledValue(detailText, ['MDAs', 'MDA', 'Ministry', 'Agency'])
      const id = candidate.pathname.split('/').filter(Boolean).at(-1) ?? candidate.url

      postings.push({
        externalId: id,
        title,
        company: mda || companyFallback,
        description: description.trim().slice(0, 20000),
        url: candidate.url,
        applyUrl: candidate.url,
        location: 'Nigeria',
        remote: false,
        tags: [grade, mda].filter(Boolean),
        jobType: '',
        publishedAt: null,
        validThrough,
        closed: false,
        salary: null,
      })
    }
    return postings
  },
}

/* ------------------------------------------------------------------ NNPC */

export const nnpcCareers: SourceParser = {
  id: 'nnpc-careers',
  name: 'NNPC Limited careers',
  kind: 'html',
  platform: 'nnpc-careers',
  homepage: 'https://careers.nnpcgroup.com/',
  attribution: 'Openings read from the official NNPC careers site when an exercise is open.',
  verification: 'unverified',
  verificationReason: 'Read from the official public careers site; check it there before applying.',

  async fetchPostings(source, fetchImpl = fetch) {
    const html = await readText(source.listingUrl, source.id, fetchImpl)
    const text = stripHtml(html)
    if (
      /application submission is now closed|applications? (?:are|is) closed|recruitment (?:is )?closed/i.test(
        text,
      )
    ) {
      return []
    }
    const candidates = anchors(html, source.listingUrl).filter((anchor) => {
      if (
        /login|sign in|faq|help|support|privacy|terms/i.test(`${anchor.title} ${anchor.pathname}`)
      ) {
        return false
      }
      const jobPath = /^\/(?:jobs|vacancies|openings)\/[^/]+/i.test(anchor.pathname)
      const recruitmentPath =
        /recruitment\.nnpcgroup\.com/i.test(anchor.url) &&
        /\/(?:jobs|vacancies|openings)\//i.test(anchor.pathname)
      return (jobPath || recruitmentPath) && anchor.title.length >= 4
    })
    const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    const company =
      typeof source.options.companyLabel === 'string' ? source.options.companyLabel : 'NNPC Limited'

    const postings: RawPosting[] = []
    for (const candidate of unique.slice(0, 30)) {
      let detailText = ''
      try {
        detailText = stripHtml(await readText(candidate.url, source.id, fetchImpl))
      } catch {
        continue
      }
      if (
        /application submission is now closed|applications? (?:are|is) closed/i.test(detailText)
      ) {
        continue
      }
      const validThrough = closingDate(detailText)
      if (validThrough && Date.parse(validThrough) < Date.now()) continue
      const start = Math.max(0, detailText.toLowerCase().indexOf(candidate.title.toLowerCase()))
      postings.push({
        externalId: candidate.pathname.split('/').filter(Boolean).join('-') || candidate.url,
        title: candidate.title,
        company,
        description: detailText.slice(start, start + 20000).trim(),
        url: candidate.url,
        applyUrl: candidate.url,
        location: 'Nigeria',
        remote: /remote/i.test(candidate.title),
        tags: [],
        jobType: '',
        publishedAt: null,
        validThrough,
        closed: false,
        salary: null,
      })
    }
    return postings
  },
}

export const NIGERIA_PUBLIC_SECTOR_PARSERS: SourceParser[] = [
  efccRecruitment,
  fcscVacancies,
  nnpcCareers,
]
