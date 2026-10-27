/**
 * The crawler surface and static routing for the SPA.
 *
 * Crawlers receive prerendered HTML with metadata and JobPosting structured
 * data; humans receive the app shell for real routes and a real 404 page for
 * anything else. /api/* is handled by functions/api.
 */
import {
  isAppRoute,
  isCrawler,
  jobMeta,
  jobPostingJsonLd,
  pageMeta,
  render404,
  renderJobSitemap,
  renderOgImage,
  renderPagesSitemap,
  renderShell,
  renderSitemapIndex,
  sitemapEligible,
} from '../src/server/seo'
import { publishedPublicJobs } from '../src/server/public-feed'
import type { Job } from '../src/shared/types'

interface Env {
  PUBLIC_JOBS?: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

const PER_SITEMAP = 10_000

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const origin = url.origin
  const nonce = [...crypto.getRandomValues(new Uint8Array(12))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  // Generated routes first; everything file-like falls through to the asset
  // pipeline, which serves static files and the SPA shell.
  const isFile = /\.[a-z0-9]+$/i.test(path)

  // A real robots.txt; the SPA catch-all must never swallow it.
  if (path === '/robots.txt') {
    return new Response(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /auth/\nDisallow: /admin/\nDisallow: /*?q=\n\nSitemap: ${origin}/sitemap.xml\n`,
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      },
    )
  }

  const jobs = async (): Promise<Job[]> => {
    const snapshot = await publishedPublicJobs(ctx.env.PUBLIC_JOBS)
    return snapshot ? sitemapEligible(snapshot.jobs) : []
  }

  if (path === '/sitemap.xml') {
    const eligible = await jobs()
    const pages = Math.max(1, Math.ceil(eligible.length / PER_SITEMAP))
    return new Response(renderSitemapIndex(origin, pages), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
  if (path === '/sitemap-pages.xml') {
    return new Response(renderPagesSitemap(origin), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
  const sitemapMatch = path.match(/^\/sitemap-jobs-(\d+)\.xml$/)
  if (sitemapMatch) {
    const page = Number(sitemapMatch[1])
    const eligible = await jobs()
    const pages = Math.ceil(eligible.length / PER_SITEMAP)
    if (page < 1 || page > pages) return new Response('Not found', { status: 404 })
    return new Response(renderJobSitemap(origin, eligible, page, PER_SITEMAP), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  // Per-job social preview card.
  const ogMatch = path.match(/^\/og\/jobs\/([A-Za-z0-9_-]+)\.svg$/)
  if (ogMatch) {
    const snapshot = await publishedPublicJobs(ctx.env.PUBLIC_JOBS)
    const job = snapshot?.jobs.find((item) => item.id === ogMatch[1])
    if (!job) return new Response('Not found', { status: 404 })
    return new Response(renderOgImage(job), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    })
  }

  if (isFile) return ctx.next()

  const jobMatch = path.match(/^\/jobs\/([A-Za-z0-9_-]+)$/)
  const job = jobMatch
    ? ((await publishedPublicJobs(ctx.env.PUBLIC_JOBS))?.jobs.find(
        (item) => item.id === jobMatch[1],
      ) ?? null)
    : null

  // Unknown routes are 404s, never a soft-200 homepage — for crawlers and
  // humans alike.
  const known = isAppRoute(path) && (!jobMatch || Boolean(job))
  if (!known) {
    return new Response(render404(origin, nonce), {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
      },
    })
  }

  const ua = ctx.request.headers.get('user-agent')
  if (isCrawler(ua, url)) {
    const meta =
      job && jobMatch ? jobMeta(job, origin) : { ...pageMeta(path), canonical: `${origin}${path}` }
    const bodyHtml = job
      ? `<p>${escLite(job.company || 'Employer not stated')} · ${escLite(job.locationLabel || 'Location not stated')}</p>
<p>${escLite((job.description || '').slice(0, 700))}</p>
<p><a href="${job.applyUrl || job.sourceUrl}">Apply on the original listing</a> — always free.</p>`
      : `<p>${escLite(pageMeta(path).description)}</p>`
    const html = renderShell({
      title: meta.title,
      description: meta.description,
      canonical: meta.canonical,
      origin,
      nonce,
      jsonLd: job ? jobPostingJsonLd(job, origin, nonce) : null,
      ogImage: job ? `${origin}/og/jobs/${encodeURIComponent(job.id)}.svg` : undefined,
      bodyHtml,
    })
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Robots-Tag': job ? '' : path === '/' || path === '/jobs' ? '' : 'noindex',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'self'`,
      },
    })
  }

  // Humans: the real app shell comes from the asset pipeline (static assets
  // plus the SPA fallback). ASSETS.fetch is kept only as a last resort.
  try {
    return await ctx.next()
  } catch {
    const assets = (ctx.env as Partial<Env>).ASSETS
    if (assets) return assets.fetch(ctx.request)
    return new Response('Service unavailable', { status: 503 })
  }
}

function escLite(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
