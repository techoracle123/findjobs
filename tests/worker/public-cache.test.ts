import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../src/server/env'
import { publicDataCache } from '../../src/server/public-cache'

function setup() {
  const saved = new Map<string, Response>()
  const cache = {
    match: async (r: Request) => saved.get(r.url)?.clone(),
    put: async (r: Request, v: Response) => {
      saved.set(r.url, v.clone())
    },
  } as unknown as Cache
  const app = new Hono<AppEnv>()
  app.use('*', publicDataCache(cache))
  let reads = 0
  app.all('*', (c) => {
    reads++
    if (c.req.path === '/api/jobs/error') return c.json({ error: 'unavailable' }, 503)
    return c.json({ reads })
  })
  const request = (path: string, method = 'GET') =>
    app.request('https://fj-find-jobs.pages.dev' + path, { method }, { APP_MODE: 'production' })
  return { request, count: () => reads }
}
describe('public response caching', () => {
  it('shares public feed results across tracking parameters, but not country filters', async () => {
    const { request, count } = setup()
    await request('/api/jobs?country=NG&utm_source=one')
    await request('/api/jobs?utm_source=two&country=NG')
    expect(count()).toBe(1)
    await request('/api/jobs?country=GB')
    expect(count()).toBe(2)
  })
  it('never caches account data, translation, advice or writes', async () => {
    const { request, count } = setup()
    for (const p of ['/api/account', '/api/jobs/job_1/translation', '/api/jobs/job_1/tips']) {
      await request(p)
      await request(p)
    }
    await request('/api/jobs', 'POST')
    await request('/api/jobs', 'POST')
    expect(count()).toBe(8)
  })
  it('never caches service failures as successful or empty job feeds', async () => {
    const { request, count } = setup()
    expect((await request('/api/jobs/error')).status).toBe(503)
    await request('/api/jobs/error')
    expect(count()).toBe(2)
  })
})

it('reports an exhausted database honestly without exposing internals', async () => {
  const { default: app } = await import('../../src/server/app')
  const db = {
    prepare: () => ({
      all: async () => {
        throw new Error('D1_ERROR: daily row read limit exceeded [7500] private-diagnostic')
      },
    }),
  } as unknown as D1Database
  const response = await app.request(
    'https://fj-find-jobs.pages.dev/api/jobs',
    {},
    { APP_MODE: 'test', DB: db },
  )
  // The unpaged reader intentionally has its own honest empty warning fallback.
  expect(response.status).toBe(200)
  expect(JSON.stringify(await response.json())).not.toContain('private-diagnostic')
  const paged = await app.request(
    'https://fj-find-jobs.pages.dev/api/health',
    { headers: { 'X-Health-Key': 'test-health-key' } },
    {
      APP_MODE: 'test',
      HEALTH_CHECK_KEY: 'test-health-key',
      DB: {
        prepare: () => {
          throw new Error('D1_ERROR: daily row read limit [7500] private-diagnostic')
        },
      } as unknown as D1Database,
    },
  )
  expect(paged.status).toBe(503)
  expect(JSON.stringify(await paged.json())).not.toContain('private-diagnostic')
})
