import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'

const ALLOWED_QUERY = new Set([
  'q',
  'status',
  'country',
  'roles',
  'modes',
  'levels',
  'limit',
  'offset',
])

/** Only anonymous, identical-for-everyone GET data. Never account, AI or writes. */
export function publicDataCache(override?: Cache): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname
    const ttl =
      path === '/api/health' || path === '/api/sources'
        ? 300
        : path === '/api/rates'
          ? 3600
          : /^\/api\/jobs(?:\/[^/]+)?$/.test(path)
            ? 120
            : 0
    if (
      !ttl ||
      c.req.method !== 'GET' ||
      !['production', 'staging'].includes(c.env?.APP_MODE || '')
    )
      return next()
    const cache =
      override ??
      (typeof caches !== 'undefined'
        ? (caches as CacheStorage & { default?: Cache }).default
        : undefined)
    if (!cache) return next()
    const url = new URL(c.req.url)
    for (const key of [...url.searchParams.keys()])
      if (!ALLOWED_QUERY.has(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    const key = new Request(url.href)
    try {
      const hit = await cache.match(key)
      if (hit) {
        c.res = hit
        return
      }
    } catch {
      /* A cache outage must not prevent a database read. */
    }
    await next()
    if (
      c.res.status !== 200 ||
      c.res.headers.has('set-cookie') ||
      /private|no-store/i.test(c.res.headers.get('cache-control') || '') ||
      !c.res.headers.get('content-type')?.includes('application/json')
    )
      return
    const response = new Response(c.res.clone().body, c.res)
    response.headers.set('cache-control', `public, max-age=0, s-maxage=${ttl}`)
    try {
      const write = cache.put(key, response).catch(() => undefined)
      // Cache storage is best effort, not a prerequisite for responding to a
      // visitor. Pages supplies waitUntil on its actual request context.
      try {
        c.executionCtx.waitUntil(write)
      } catch {
        await write
      }
    } catch {
      /* Best effort, never cache an error. */
    }
  }
}
