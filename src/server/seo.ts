import type { Job } from '../shared/types'
import { roleFamilyLabel } from '../shared/taxonomy'

/** The crawler surface. Humans get the SPA; crawlers get this. */

const BOT_UA =
  /googlebot|bingbot|duckduckbot|twitterbot|facebookexternalhit|linkedinbot|whatsapp|telegrambot|slackbot|yandexbot|baiduspider|applebot|embedly|pinterestbot|redditbot/i

export function isCrawler(userAgent: string | null, url: URL): boolean {
  return (
    Boolean(userAgent && BOT_UA.test(userAgent.toLowerCase())) ||
    url.searchParams.has('_escaped_fragment_')
  )
}

const APP_ROUTES = new Set([
  '/',
  '/jobs',
  '/dashboard',
  '/profile',
  '/about',
  '/privacy',
  '/terms',
  '/faq',
  '/scams',
  '/contact',
  '/employers',
  '/pricing',
])

export function isAppRoute(pathname: string): boolean {
  if (APP_ROUTES.has(pathname)) return true
  return /^\/(?:auth\/(?:signup|login|recovery)|admin\/data-quality|jobs\/[A-Za-z0-9_-]+)$/.test(
    pathname,
  )
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export function jobMeta(
  job: Job,
  origin: string,
): { title: string; description: string; canonical: string } {
  const place = job.locationLabel || (job.workMode === 'remote' ? 'Remote' : '')
  const title = truncate(
    `${job.title} - ${job.company || 'Employer'}${place ? ` | ${place}` : ''} | FJ`,
    60,
  )
  const description = truncate(
    `${job.title} at ${job.company || 'the employer'}${place ? ` in ${place}` : ''}. ${roleFamilyLabel(job.roleFamily)} role on FJ. Always verify the original listing before applying.`,
    155,
  )
  return { title, description, canonical: `${origin}/jobs/${encodeURIComponent(job.id)}` }
}

export function pageMeta(pathname: string): { title: string; description: string } {
  const pages: Record<string, { title: string; description: string }> = {
    '/': {
      title: 'FJ - Find Jobs: work in Nigeria and worldwide',
      description:
        'Search thousands of real job listings across Nigeria and worldwide, by profession and country. Free to explore — never pay to apply.',
    },
    '/jobs': {
      title: 'Search jobs by skill, country and profession | FJ',
      description:
        'Browse current openings by role, country, work mode and experience. Real listings, cleaned up and linked to the original source.',
    },
    '/dashboard': {
      title: 'Your dashboard: progress, saved jobs and alerts | FJ',
      description:
        'Track the applications you confirm each month, your saved roles and job alerts.',
    },
    '/profile': {
      title: 'Improve my matches: skills and preferences | FJ',
      description: 'Add your skills and preferences so FJ can rank the jobs most relevant to you.',
    },
    '/pricing': {
      title: 'Pricing | FJ - Find Jobs',
      description: 'Free browsing and applying for everyone. Pro tools for active job seekers.',
    },
    '/about': {
      title: 'About FJ - Find Jobs',
      description: 'What FJ is, and what we promise job seekers.',
    },
    '/privacy': {
      title: 'Privacy | FJ - Find Jobs',
      description: 'What FJ collects, why, and your rights over your data.',
    },
    '/terms': {
      title: 'Terms | FJ - Find Jobs',
      description: 'The terms for using FJ - Find Jobs.',
    },
    '/faq': {
      title: 'Questions | FJ - Find Jobs',
      description: 'Common questions about applying, scams and how FJ works.',
    },
    '/scams': {
      title: 'How to spot a job scam | FJ',
      description: 'The red flags every job seeker in Nigeria should know before applying.',
    },
    '/contact': {
      title: 'Contact | FJ - Find Jobs',
      description: 'Reach the FJ team or report a suspicious listing.',
    },
    '/employers': {
      title: 'For employers | FJ - Find Jobs',
      description: 'Employer profiles and job posting are coming to FJ.',
    },
    '/auth/login': {
      title: 'Sign in to FJ',
      description: 'Sign in to FJ - Find Jobs with a secure email code.',
    },
    '/auth/signup': {
      title: 'Create your FJ account',
      description: 'Create a free FJ account to save jobs and track your applications.',
    },
    '/auth/recovery': {
      title: 'Recover access to FJ',
      description: 'Get back into your FJ account with a fresh email code.',
    },
    '/admin/data-quality': {
      title: 'Data quality | FJ admin',
      description: 'Field completeness and source quality across the published corpus.',
    },
  }
  return pages[pathname] ?? pages['/']
}

/** Hard Google Jobs rules live here; breaking them risks delisting. */
export function jobPostingJsonLd(job: Job, origin: string, nonce: string): string | null {
  const ageDays = (Date.now() - Date.parse(job.postedAt || '')) / 86_400_000
  if (
    job.jobStatus !== 'open' ||
    (job.moderationState ?? 'publish') === 'hold' ||
    (job.moderationState ?? 'publish') === 'reject'
  )
    return null
  if (!job.postedAt || !(ageDays >= 0 && ageDays <= 30)) return null
  if (job.quality && job.quality.isEnglish === false) return null
  // A valid JobPosting needs a location or TELECOMMUTE; without either, emit
  // nothing rather than risk a delisting.
  if (!job.locationCountry && job.workMode !== 'remote') return null

  const { title } = jobMeta(job, origin)
  const structured: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: (job.description || title).slice(0, 4000),
    identifier: { '@type': 'PropertyValue', name: 'FJ', value: job.id },
    datePosted: job.postedAt,
    validThrough: new Date(Date.parse(job.postedAt) + 30 * 86_400_000).toISOString(),
    employmentType: job.seniority === 'intern' ? 'INTERN' : 'FULL_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company || 'Employer not stated',
      ...(job.companyUrl ? { sameAs: job.companyUrl } : {}),
    },
    directApply: false,
  }
  if (job.locationCountry) {
    structured.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressCountry: job.locationCountry,
        ...(job.quality?.location.city ? { addressLocality: job.quality.location.city } : {}),
        ...(job.quality?.location.state ? { addressRegion: job.quality.location.state } : {}),
      },
    }
  }
  if (job.workMode === 'remote') {
    structured.jobLocationType = 'TELECOMMUTE'
    structured.applicantLocationRequirements = {
      '@type': 'Country',
      name: job.locationCountry || 'Worldwide',
    }
  }
  // Zero means "not stated" in our data — Google forbids zero-salary postings.
  if (job.salaryMin > 0 && job.salaryMax > 0 && job.salaryCurrency) {
    structured.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency,
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.salaryMin,
        maxValue: job.salaryMax,
        unitText:
          job.salaryPeriod === 'year' ? 'YEAR' : job.salaryPeriod === 'month' ? 'MONTH' : 'HOUR',
      },
    }
  }
  return `<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(structured)}</script>`
}

export function renderShell(options: {
  title: string
  description: string
  canonical: string
  origin: string
  jsonLd?: string | null
  ogImage?: string
  nonce: string
  bodyHtml: string
}): string {
  const og = options.ogImage ?? `${options.origin}/favicon.svg`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<link rel="canonical" href="${esc(options.canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${esc(options.canonical)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:site_name" content="FJ - Find Jobs">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(options.title)}">
<meta name="twitter:description" content="${esc(options.description)}">
<meta name="twitter:image" content="${esc(og)}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${options.jsonLd ?? ''}
</head>
<body>
<main class="auth-page">
<article class="info-card">
<h1>${esc(options.title)}</h1>
${options.bodyHtml}
<p><a href="${esc(options.origin)}">Explore current jobs on FJ</a></p>
</article>
</main>
</body>
</html>`
}

export function render404(origin: string, nonce: string): string {
  return renderShell({
    title: 'Page not found | FJ',
    description: 'This FJ page does not exist. Explore current job listings instead.',
    canonical: `${origin}/404`,
    origin,
    nonce,
    bodyHtml:
      '<p>This page does not exist. The link may be old, or the job may have been removed by its publisher.</p>',
  })
}

/* ------------------------------- sitemaps ------------------------------- */

const DAY = 86_400_000

export function sitemapEligible(jobs: Job[]): Job[] {
  return jobs.filter(
    (job) =>
      job.jobStatus === 'open' &&
      (job.moderationState ?? 'publish') !== 'hold' &&
      (job.moderationState ?? 'publish') !== 'reject' &&
      job.quality?.isEnglish !== false &&
      job.postedAt &&
      Date.now() - Date.parse(job.postedAt) < 30 * DAY,
  )
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`

export function renderSitemapIndex(origin: string, jobPages: number): string {
  const children = [
    `<sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap>`,
    ...Array.from(
      { length: jobPages },
      (_, i) => `<sitemap><loc>${origin}/sitemap-jobs-${i + 1}.xml</loc></sitemap>`,
    ),
  ].join('')
  return xml(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children}</sitemapindex>`,
  )
}

export function renderPagesSitemap(origin: string): string {
  const pages = [
    '/',
    '/jobs',
    '/pricing',
    '/employers',
    '/about',
    '/privacy',
    '/terms',
    '/faq',
    '/scams',
  ]
  return xml(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages
      .map(
        (page) =>
          `<url><loc>${origin}${page === '/' ? '/' : page}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`,
      )
      .join('')}</urlset>`,
  )
}

export function renderJobSitemap(
  origin: string,
  jobs: Job[],
  page: number,
  perPage = 10_000,
): string {
  const slice = jobs.slice((page - 1) * perPage, page * perPage)
  return xml(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${slice
      .map(
        (job) =>
          `<url><loc>${origin}/jobs/${encodeURIComponent(job.id)}</loc><lastmod>${(job.lastSeenAt || job.postedAt || new Date().toISOString()).slice(0, 10)}</lastmod></url>`,
      )
      .join('')}</urlset>`,
  )
}

/** Simple branded 1200×630 OG card. Served as SVG; PNG rasterisation needs an image binding we do not have. */
export function renderOgImage(job: Job): string {
  const title = esc(truncate(job.title, 48))
  const company = esc(truncate(job.company || 'Employer not stated', 40))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f4f5ef"/>
<rect x="64" y="64" width="72" height="72" rx="14" fill="#2f6b4a"/>
<text x="100" y="112" font-family="Arial,sans-serif" font-size="34" fill="#ffffff" text-anchor="middle" font-weight="bold">FJ</text>
<text x="64" y="240" font-family="Arial,sans-serif" font-size="56" fill="#1b1e17" font-weight="bold">${title}</text>
<text x="64" y="320" font-family="Arial,sans-serif" font-size="36" fill="#3d4237">${company}</text>
<text x="64" y="560" font-family="Arial,sans-serif" font-size="26" fill="#6A7062">fj-find-jobs.pages.dev · Always verify the original listing</text>
</svg>`
}
