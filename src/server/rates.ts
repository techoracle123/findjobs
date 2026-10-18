import type { RatesPayload } from '../shared/types'

const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.app/latest?from=USD'
const REQUEST_TIMEOUT_MS = 3500

let cached: { payload: RatesPayload; fetchedAt: number } | null = null
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * The reference rates.
 *
 * `allowNetwork` is false in the test environment, where a live request is
 * neither possible nor useful: the offline table is used, which also makes
 * the tests deterministic.
 */
export async function getRates(allowNetwork = true): Promise<RatesPayload> {
  if (allowNetwork && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload
  }

  const payload = allowNetwork
    ? await fetchLiveRates()
    : {
        base: 'USD',
        date: '',
        source: 'fallback' as const,
        rates: { USD: 1 },
      }

  if (allowNetwork && payload.source === 'frankfurter') cached = { payload, fetchedAt: Date.now() }
  return payload
}

async function fetchLiveRates(): Promise<RatesPayload> {
  // An explicit controller with a cleared timer, rather than
  // AbortSignal.timeout: a timeout that is still pending when the request
  // has already settled can surface as an unhandled rejection.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(FRANKFURTER_ENDPOINT, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const body = (await response.json()) as { date?: string; rates?: Record<string, number> }
    if (!body.date || !body.rates || typeof body.rates !== 'object')
      throw new Error('unexpected payload')
    return {
      base: 'USD',
      date: body.date ?? '',
      source: 'frankfurter',
      rates: { USD: 1, ...body.rates },
    }
  } catch {
    return {
      base: 'USD',
      date: '',
      source: 'fallback',
      rates: { USD: 1 },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Exposed for the preview banner: are we showing live or indicative rates? */
export function ratesAreLive(payload: RatesPayload): boolean {
  return payload.source === 'frankfurter'
}
