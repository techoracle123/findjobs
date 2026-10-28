import type { RatesPayload } from '../shared/types'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
let cached: { payload: RatesPayload; fetchedAt: number } | null = null
let pending: Promise<RatesPayload> | null = null
const unavailable = (): RatesPayload => ({
  base: 'USD',
  date: '',
  source: 'fallback',
  rates: { USD: 1 },
})

export function validateRates(rates: unknown): Record<string, number> {
  if (!rates || typeof rates !== 'object') throw new Error('Invalid rates')
  const valid = Object.fromEntries(
    Object.entries(rates).filter(
      ([code, value]) =>
        /^[A-Z]{3}$/.test(code) && typeof value === 'number' && Number.isFinite(value) && value > 0,
    ),
  ) as Record<string, number>
  if (valid.USD !== 1 || !valid.EUR || !valid.GBP) throw new Error('Incomplete rates')
  return valid
}

/** Provider dates are shown as-is. No invented rates or silently stale conversions. */
export async function getRates(allowNetwork = true, db?: D1Database): Promise<RatesPayload> {
  if (!allowNetwork) return unavailable()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.payload
  if (db) {
    const row = await db
      .prepare('SELECT payload FROM service_cache WHERE key = ?1 AND expires_at > ?2')
      .bind('fx-usd', Date.now())
      .first<{ payload: string }>()
      .catch(() => null)
    if (row) {
      try {
        const payload = JSON.parse(row.payload) as RatesPayload
        validateRates(payload.rates)
        if (payload.source === 'exchangerate-api') throw new Error('Refresh retired provider')
        cached = { payload, fetchedAt: Date.now() }
        return payload
      } catch {
        /* Refresh a malformed cache entry. */
      }
    }
  }
  pending ??= fetchLiveRates()
    .then(async (payload) => {
      if (db && payload.source !== 'fallback')
        await db
          .prepare(
            'INSERT OR REPLACE INTO service_cache (key, payload, expires_at) VALUES (?1, ?2, ?3)',
          )
          .bind('fx-usd', JSON.stringify(payload), Date.now() + CACHE_TTL_MS)
          .run()
          .catch(() => {})
      return payload
    })
    .finally(() => {
      pending = null
    })
  return pending
}

const SUPPORTED = new Set(
  'USD EUR GBP CAD AUD CHF SGD BRL INR JPY NGN ZAR GHS KES AED SEK NOK DKK PLN HKD CNY NZD MXN CZK HUF RON TRY KRW ILS MYR THB PHP IDR VND SAR QAR TWD RUB'.split(
    ' ',
  ),
)

export function parseReferenceRates(
  input: unknown,
  source: 'open-currency' | 'frankfurter',
): RatesPayload {
  if (!input || typeof input !== 'object') throw new Error('Invalid rates payload')
  const body = input as { date?: string; usd?: unknown; rates?: unknown }
  const date = body.date
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid rates date')
  const age = Date.now() - Date.parse(date)
  if (!Number.isFinite(age) || age > 7 * 86400000 || age < -86400000) throw new Error('Stale rates')
  const raw = source === 'open-currency' ? body.usd : body.rates
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid rates')
  const normalized = Object.fromEntries(
    Object.entries(raw).map(([code, value]) => [code.toUpperCase(), value]),
  )
  const rates = validateRates(source === 'frankfurter' ? { ...normalized, USD: 1 } : normalized)
  return {
    base: 'USD',
    date,
    source,
    rates: Object.fromEntries(Object.entries(rates).filter(([code]) => SUPPORTED.has(code))),
  }
}

async function fetchLiveRates(): Promise<RatesPayload> {
  // CC0-licensed data, including NGN. Two independently hosted mirrors, then
  // central-bank reference rates as a fallback. No paid key or branded widget.
  const endpoints = [
    ['https://latest.currency-api.pages.dev/v1/currencies/usd.min.json', 'open-currency'],
    [
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      'open-currency',
    ],
    ['https://api.frankfurter.app/latest?from=USD', 'frankfurter'],
  ] as const
  for (const [url, source] of endpoints) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) continue
      const payload = parseReferenceRates(await response.json(), source)
      cached = { payload, fetchedAt: Date.now() }
      return payload
    } catch {
      /* Keep original salaries if no current reference data is available. */
    } finally {
      clearTimeout(timer)
    }
  }
  return unavailable()
}

export function ratesAreLive(payload: RatesPayload): boolean {
  return payload.source !== 'fallback'
}
