import type { RatesPayload } from '../shared/types'

const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.app/latest?from=USD'
const REQUEST_TIMEOUT_MS = 3500

/**
 * Indicative offline reference rates, quoted per 1 USD. These exist so the
 * preview still shows a converted figure when the network is unavailable; the
 * UI labels them as a fallback and shows their vintage. Currencies published
 * outside the ECB set (for example NGN) are deliberately absent, which is what
 * triggers the "keep the original currency" behaviour.
 */
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  CHF: 0.88,
  JPY: 152.4,
  CAD: 1.36,
  AUD: 1.52,
  SGD: 1.34,
  HKD: 7.82,
  CNY: 7.15,
  NZD: 1.64,
  SEK: 10.48,
  NOK: 10.82,
  DKK: 6.87,
  PLN: 3.96,
  CZK: 23.1,
  HUF: 361.2,
  RON: 4.58,
  TRY: 32.6,
  ZAR: 18.1,
  BRL: 5.42,
  MXN: 17.6,
  INR: 83.4,
  KRW: 1345,
  ILS: 3.68,
  MYR: 4.72,
  THB: 35.8,
  PHP: 56.2,
  IDR: 15700,
  VND: 24800,
  TWD: 31.4,
  RUB: 92.4,
}

const FALLBACK_DATE = '2026-10-15'

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
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload
  }

  const payload = allowNetwork
    ? await fetchLiveRates()
    : {
        base: 'USD',
        date: FALLBACK_DATE,
        source: 'fallback' as const,
        rates: { ...FALLBACK_RATES },
      }

  cached = { payload, fetchedAt: Date.now() }
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
    if (!body.rates || typeof body.rates !== 'object') throw new Error('unexpected payload')
    return {
      base: 'USD',
      date: body.date ?? FALLBACK_DATE,
      source: 'frankfurter',
      rates: { USD: 1, ...body.rates },
    }
  } catch {
    return {
      base: 'USD',
      date: FALLBACK_DATE,
      source: 'fallback',
      rates: { ...FALLBACK_RATES },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Exposed for the preview banner: are we showing live or indicative rates? */
export function ratesAreLive(payload: RatesPayload): boolean {
  return payload.source === 'frankfurter'
}
