import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readIdeaEvidence } from '../ideas/evidence'
import { findIdea, searchIdeas } from '../ideas/catalog'
import { liveTrends } from '../ideas/trends'
import { enforceRateLimit } from '../ratelimit'

export const ideaRoutes = new Hono<AppEnv>()

ideaRoutes.get('/ideas', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'ideas', limit: 120, windowSeconds: 60 })
  if (limited) return limited
  const snapshot = await readIdeaEvidence(c.env?.PUBLIC_JOBS)
  if (!snapshot) {
    return c.json(
      {
        error: 'idea_evidence_unavailable',
        message: 'The evidence catalogue is being refreshed. Please try again shortly.',
      },
      503,
    )
  }
  const country = (c.req.query('country') || 'NGA').toUpperCase()
  if (!/^(?:ALL|[A-Z]{3})$/.test(country)) return c.json({ error: 'invalid_country' }, 400)
  const category = c.req.query('category') || ''
  const format = c.req.query('format') || ''
  if (format && !['physical', 'software', 'hybrid'].includes(format)) {
    return c.json({ error: 'invalid_format' }, 400)
  }
  const number = (name: string, fallback: number) => {
    const raw = c.req.query(name)
    if (!raw) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  }
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(
    searchIdeas(snapshot, {
      country,
      category: category.slice(0, 60),
      format,
      q: (c.req.query('q') || '').slice(0, 100),
      limit: number('limit', 24),
      offset: number('offset', 0),
      sort: c.req.query('sort') || 'evidence',
    }),
  )
})

ideaRoutes.get('/ideas/:id', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'ideas', limit: 120, windowSeconds: 60 })
  if (limited) return limited
  const snapshot = await readIdeaEvidence(c.env?.PUBLIC_JOBS)
  if (!snapshot) return c.json({ error: 'idea_evidence_unavailable' }, 503)
  const result = findIdea(snapshot, c.req.param('id'))
  if (!result)
    return c.json(
      { error: 'idea_not_found', message: 'That idea is not in the current evidence catalogue.' },
      404,
    )
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(result)
})

ideaRoutes.get('/idea-trends', async (c) => {
  const limited = await enforceRateLimit(c, { bucket: 'idea-trends', limit: 30, windowSeconds: 60 })
  if (limited) return limited
  const geo = (c.req.query('geo') || 'NG').toUpperCase()
  if (!/^[A-Z]{2}$/.test(geo)) return c.json({ error: 'invalid_country' }, 400)
  const snapshot = await readIdeaEvidence(c.env?.PUBLIC_JOBS)
  const countryName =
    snapshot?.countries.find((country) => country.iso2 === geo && country.iso3 !== 'WLD')?.name ??
    geo
  try {
    const result = await liveTrends(c.env?.PUBLIC_JOBS, geo, countryName)
    c.header('Cache-Control', 'public, max-age=60')
    return c.json(result)
  } catch {
    return c.json(
      {
        error: 'trends_unavailable',
        message:
          'Live trends are unavailable for this location right now. Product ideas and dated evidence are still available.',
      },
      503,
    )
  }
})
