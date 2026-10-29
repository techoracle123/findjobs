import { describe, expect, it } from 'vitest'
import app from '../../src/server/app'

/**
 * /api/jobs/stats must be its own route. Before it existed, the request fell
 * into /api/jobs/:id with id="stats" and took the slow detail path (the
 * production 503 / error 1102). These tests pin the route in place.
 */
describe('jobs stats route', () => {
  it('answers 503 available:false (not a job lookup) when no snapshot is published', async () => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/jobs/stats',
      {},
      { APP_MODE: 'test' },
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ available: false })
  })

  it('does not shadow a real job id lookup', async () => {
    const response = await app.request(
      'https://fj-find-jobs.pages.dev/api/jobs/job_doesnotexist',
      {},
      { APP_MODE: 'test' },
    )
    expect(response.status).toBe(404)
  })
})
