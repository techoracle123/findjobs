import type { Job } from '../shared/types'
import { opportunityOf } from '../shared/opportunities'
import { roleFamilyLabel } from '../shared/taxonomy'
import type { ProductIdea } from '../shared/ideas'

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
  '/ideas',
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
  return /^\/(?:auth\/(?:signup|login|recovery|reset)|admin\/data-quality|jobs\/[A-Za-z0-9_-]+|ideas\/[^/]+)$/.test(
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

export function ideaMeta(
  idea: ProductIdea,
  origin: string,
): { title: string; description: string; canonical: string } {
  return {
    title: truncate(`${idea.title} | FJ Ideas`, 60),
    description: truncate(
      `${idea.product} Official context: ${idea.evidence.displayValue} for ${idea.evidence.indicatorName} in ${idea.location.name} (${idea.evidence.year}). Validate the idea before building.`,
      155,
    ),
    canonical: `${origin}/ideas/${encodeURIComponent(idea.id)}`,
  }
}

export function pageMeta(pathname: string): { title: string; description: string } {
  const pages: Record<string, { title: string; description: string }> = {
    '/': {
      title: 'FJ - Find Jobs: work in Nigeria and worldwide',
      description:
        'Thousands of real job listings from Nigeria and abroad in one place. Create a free account to see them. Never pay to apply.',
    },
    '/jobs': {
      title: 'Search jobs by skill, country and profession | FJ',
      description:
        'Browse current openings by role, country, work mode and experience. A free account is needed to see the jobs.',
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
      title: 'Free early access | FJ - Find Jobs',
      description:
        'Every current FJ tool is free for now. Payments are paused; no card or trial is needed.',
    },
    '/ideas': {
      title: 'Problems and product ideas by location | FJ',
      description:
        'Explore detailed physical and software product ideas with dated official evidence, live trends and validation steps.',
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
      description: 'Employer accounts and direct job posting are paused on FJ.',
    },
    '/auth/login': {
      title: 'Sign in to FJ',
      description: 'Sign in to FJ - Find Jobs with your email and password.',
    },
    '/auth/signup': {
      title: 'Create your FJ account',
      description: 'Create a free FJ account to save jobs and track your applications.',
    },
    '/auth/recovery': {
      title: 'Recover access to FJ',
      description: 'Get back into your FJ account with an emailed password reset link.',
    },
    '/auth/reset': {
      title: 'Choose a new password | FJ',
      description: 'Set a new password for your FJ account.',
    },
    '/admin/data-quality': {
      title: 'Data quality | FJ admin',
      description: 'Field completeness and source quality across the published corpus.',
    },
  }
  return pages[pathname] ?? pages['/']
}

/**
 * Real body copy for crawlers, mirroring what humans read in the app. A
 * meta-description-only shell (what this used to serve) tells search
 * engines the page is nearly empty. Keep these in step with InfoPage.
 */
export function pageBody(pathname: string): string {
  const bodies: Record<string, string> = {
    '/': `<p>FJ - Find Jobs brings thousands of job opportunities into one place. Instead of checking many different websites, you come here. We collect real job adverts from companies in Nigeria and from companies abroad that hire people who work from home, and we link you to the original posting.</p>
<p>You need a free account to see the jobs. Some jobs pay in naira and some remote jobs pay in dollars, pounds or euros; the advert shows the salary when the company published it. Your chances depend mostly on your skills and how well you present them, so keep learning, show proof of your work, and apply early and often.</p>
<p>Applying on the employer's own site is always free. A real employer will never ask you to pay money to get a job. FJ is not an employer or recruiter and does not verify or endorse listings. Always check the company and the original listing before you apply.</p>`,
    '/jobs': `<p>Browse current jobs, gigs and contracts collected from employer career pages and established job boards. A free account is needed to see them. Choose all work, jobs, or gigs and contracts, then filter by profession, country, work setting and experience level.</p>
<p>Every listing links to the original posting, where applying is always free. FJ does not verify or endorse employers; always check the employer's official website and confirm the vacancy there.</p>`,
    '/about': `<p>FJ Find Jobs helps people in Nigeria and around the world find real jobs, gigs and contracts. We collect public adverts from company career pages and job boards. We put them in one place and link to the original advert.</p>
<p>FJ is not an employer, client or recruiter. We do not approve companies, clients or listings. Finding work and applying on the original website are free. Pro includes FJ Match Intelligence, which compares your CV with an advert, separates essential requirements from desirable ones, names missing skills, checks location signals and suggests stronger alternatives. Check the company or client and the original advert yourself before you apply. Never pay to apply.</p>
<p>FJ also has a separate Problems and product ideas section with dated location evidence, current search trends and validation plans. Evidence does not prove demand.</p>
<p>We help you find work and investigate ideas. You apply, build and validate independently.</p>`,
    '/privacy': `<p><strong>What we collect.</strong> Your account email, the profile you build (skills, preferences), saved jobs, your confirmed application history, and job alerts. The homepage and information pages need no account. Seeing the jobs needs the free account, so your saved jobs and alerts follow you on any device.</p>
<p><strong>Free CV import stays on your device.</strong> Basic CV import reads the file in your browser for skill suggestions and does not save it.</p>
<p><strong>Saved CV with permission.</strong> Only if you choose the saved-CV action and tick the box does FJ save the readable text from your CV and its report in your account. FJ does not keep the PDF or DOCX file. You can see, download, change or delete the saved text. It is removed when you delete your account. We do not save an advert pasted into the advert checker.</p>
<p><strong>Product ideas stay on your device.</strong> Browsing ideas and trends needs no account. Saved ideas and validation checklists are stored in your browser, not sent to FJ.</p>
<p><strong>Graduate-price check.</strong> FJ stores the status, answers, month and year, work history group, confirmation and result needed to offer the correct price. It does not ask for age, BVN or NIN.</p>
<p><strong>Your password.</strong> You sign in with your email and password. We store only a scrambled form of your password that cannot be turned back into the password itself. If you forget it, we email you a one time reset link through our email delivery partner, which processes your email address only to deliver that message.</p>
<p><strong>Payments are paused.</strong> Every current FJ tool is free for now and no new checkout is available. Historical payment records remain protected. FJ never sees or stores your full card number.</p>
<p><strong>Retention.</strong> Account data is kept until you delete the relevant item or your account. Saved CV text is kept until you delete or replace it, or delete your account. Aggregated application history is retained so your monthly progress works. Operational logs are kept for up to 30 days.</p>
<p><strong>Your rights (NDPA and similar laws).</strong> You may access, correct, export or erase your personal data, object to processing, and withdraw consent at any time. Use the account export/delete controls, or contact us. We respond within the periods the law requires.</p>`,
    '/terms': `<p><strong>What FJ is.</strong> FJ aggregates publicly listed jobs, gigs and contracts. We do not guarantee that any listing is accurate, current or genuine, or that any employer or client will respond. No employment relationship exists between you and FJ.</p>
<p><strong>Everything is free for now.</strong> Browsing, saving, receiving alerts, applying and using the current preparation tools are free during early access. Payments are paused. Normal account, privacy, fair-use and safety limits still apply.</p>
<p><strong>Preparation tools.</strong> FJ Match Intelligence is a decision aid, not a hiring prediction. Prepared words are drafts you must check. FJ does not apply for you, verify employers or clients, or guarantee a reply, interview, client call, offer, job or gig. Product ideas and trend signals are research starting points, not demand guarantees.</p>
<p><strong>Your use of FJ.</strong> Use the service lawfully, do not scrape or abuse it, and verify listings independently before sharing personal information.</p>
<p><strong>Liability.</strong> FJ is provided "as is". To the extent permitted by law, we are not liable for decisions made based on listings, or for the conduct of employers.</p>`,
    '/faq': `<p><strong>Do I pay to apply?</strong> No. Applying on the employer's own site is always free and unlimited. FJ never asks you to pay for a job or an application.</p>
<p><strong>Are the listings verified?</strong> We collect public listings and point you to the original posting. We do not verify or endorse employers or clients. Always check the official website and confirm the work there.</p>
<p><strong>How do I spot a job scam?</strong> Never pay to apply, and never share your BVN or bank details with a "recruiter". See our guide to spotting job scams.</p>
<p><strong>How often does FJ refresh?</strong> Listings are recollected automatically throughout the day; publishers can add or remove roles at any time.</p>
<p><strong>Why do I see fewer non-English jobs?</strong> The default feed is English-first for Nigerian users. Turn on Worldwide in the More filter to see every language.</p>
<p><strong>Why do I need an account to see listings?</strong> So we can save your jobs, gigs, alerts and applications and show them to you on any device. The account is free, and applying on the original site is always free.</p>
<p><strong>Are all tools free?</strong> Yes, for now. CV checks, FJ Match Intelligence, prepared applications, advert checks, best matches, smart alerts, application stages, skills to learn, interview practice and pay checks are available with a free account. Payments are paused and no trial is required.</p>
<p><strong>What are Problems and product ideas?</strong> This public section combines dated official indicators with physical and software product hypotheses. It shows exact values and years. Live trends are separate search-attention signals. Neither proves demand or business success.</p>
<p><strong>Does FJ save my CV?</strong> Only with separate permission for detailed analysis. Basic import stays on your device; saved readable text can be downloaded or deleted.</p>
<p><strong>How do I save jobs and track applications?</strong> Tap the bookmark on any job. When you apply through the original listing, mark the job as applied. Your Progress page counts what you confirm each month.</p>`,
    '/scams': `<p>Real employers do not charge you to apply or to get hired. Watch for these warning signs:</p>
<ul>
<li>Anyone asking for a registration fee, training fee, "processing" fee or deposit.</li>
<li>"Pay small token", "send your details to" a personal WhatsApp, or "refundable deposit".</li>
<li>Requests for your BVN, bank details or ID documents before a real interview.</li>
<li>Offers made only over WhatsApp or SMS, with no verifiable company website.</li>
<li>"Urgent", "immediate", "no experience needed", "earn daily", "daily payment".</li>
<li>Salary that is far above the market for the role.</li>
</ul>
<p>If a listing asks you for money, stop and report it from the job page. You do not need an account. Check the employer on their official website and confirm the vacancy there before you share anything.</p>`,
    '/contact': `<p>Questions, feedback or a listing to report? Reach the FJ team through the contact options in the app.</p>
<p>You can report a bad job at any time. You do not need an account.</p>`,
    '/pricing': `<p>Every current FJ tool is free for now. Payments are paused, so there is no checkout and no card is needed.</p>
<p>Your free account includes job search, saved listings, alerts, CV checks, FJ Match Intelligence, prepared applications, advert checks, best matches, application stages, skills to learn, interview practice and pay checks. Normal privacy, fair-use and safety limits still apply.</p>
<p>Historical payment records remain protected. If paid plans return, FJ will explain the current price and terms before you choose. FJ does not apply for you, verify employers or clients, or guarantee a job or gig.</p>`,
    '/ideas': `<p>Explore physical and software product ideas for Nigeria, other countries and a worldwide view. Each idea has a problem context, target buyer, first testable version, business model, skills, risks and validation steps.</p>
<p>Official evidence shows the exact value, unit, observation year, dataset release time, attribution and source link. The figure is labelled “Latest official value”; annual observations are not real-time measurements. Evidence supports a broad problem context; it does not prove affected population, market size, demand or willingness to pay.</p>
<p>Live trends are a separate view of current search attention. Approximate traffic labels are not exact search volume or proof of a business opportunity. Save ideas and validation checklists on your device for free.</p>`,
    '/employers': `<p>FJ collects real vacancies from employer career pages and established job boards, cleans them up, and puts them in front of people who are actively looking across Nigeria and beyond.</p>
<p>Employer accounts and direct job posting are paused. There is no employer price and no way to publish a job directly on FJ today.</p>
<p>Today, automatic collection from your public listings is free: if your vacancies are on your public careers page or an established board, FJ may collect them and link applicants to your original posting. You can record employer interest on this page in case posting is opened carefully in future.</p>
<p>FJ never asks any person to pay to apply for a job.</p>`,
  }
  return bodies[pathname] ?? `<p>${esc(pageMeta(pathname).description)}</p>`
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
  // Himalayas' API terms allow display on FJ with its application link and
  // source credit, but not redistribution through Google Jobs/JobPosting
  // structured data or other aggregators.
  if (job.sourcePlatform === 'himalayas' || job.sourceName === 'Himalayas') return null
  // RemoteJobs.org permits display in FJ with credit and its application
  // link. Its listings are third-party content, so FJ does not redistribute
  // them as JobPosting structured data.
  if (job.sourcePlatform === 'remotejobs' || job.sourceName?.includes('RemoteJobs.org')) return null

  const { title } = jobMeta(job, origin)
  const opportunity = opportunityOf(job)
  const employmentType =
    opportunity.engagementType === 'internship' || job.seniority === 'intern'
      ? 'INTERN'
      : opportunity.engagementType === 'part-time'
        ? 'PART_TIME'
        : opportunity.engagementType === 'temporary'
          ? 'TEMPORARY'
          : opportunity.opportunityType === 'gig'
            ? 'CONTRACTOR'
            : opportunity.engagementType === 'full-time' ||
                opportunity.engagementType === 'permanent'
              ? 'FULL_TIME'
              : 'OTHER'
  const salaryUnit =
    job.salaryPeriod === 'year'
      ? 'YEAR'
      : job.salaryPeriod === 'month'
        ? 'MONTH'
        : job.salaryPeriod === 'week'
          ? 'WEEK'
          : job.salaryPeriod === 'hour'
            ? 'HOUR'
            : null
  const structured: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: (job.description || title).slice(0, 4000),
    identifier: { '@type': 'PropertyValue', name: 'FJ', value: job.id },
    datePosted: job.postedAt,
    validThrough: new Date(Date.parse(job.postedAt) + 30 * 86_400_000).toISOString(),
    employmentType,
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
  // Zero means "not stated" in our data, Google forbids zero-salary postings.
  if (job.salaryMin > 0 && job.salaryMax > 0 && job.salaryCurrency && salaryUnit) {
    structured.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency,
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.salaryMin,
        maxValue: job.salaryMax,
        unitText: salaryUnit,
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
    '/ideas',
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
