import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJobs } from '../../src/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchJobs resilience', () => {
  it('retries a transient 503 before showing the board error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ jobs: [], total: 0, limit: 20, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJobs(0, 'retry-check')).resolves.toMatchObject({ total: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an ended sign-in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJobs(0, 'sign-in-check')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a cached search error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ jobs: [], total: 0, limit: 20, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJobs(0, 'cache-check')).resolves.toMatchObject({ total: 0 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('q=cache-check'),
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ 'cache-control': 'no-cache' }),
      }),
    )
  })
})
