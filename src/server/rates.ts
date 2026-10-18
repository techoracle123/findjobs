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

async function fetchLiveRates(): Promise<RatesPayload> {
  for (const provider of ['exchangerate-api', 'frankfurter'] as const) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)
    try {
      const response = await fetch(
        provider === 'exchangerate-api'
          ? 'https://open.er-api.com/v6/latest/USD'
          : 'https://api.frankfurter.app/latest?from=USD',
        { signal: controller.signal, headers: { accept: 'application/json' } },
      )
      if (!response.ok) continue
      const body = (await response.json()) as {
        result?: string
        base_code?: string
        time_last_update_unix?: number
        date?: string
        rates?: unknown
      }
      if (
        provider === 'exchangerate-api' &&
        (body.result !== 'success' || body.base_code !== 'USD')
      )
        continue
      const date =
        provider === 'exchangerate-api' && body.time_last_update_unix
          ? new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10)
          : body.date
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const age = Date.now() - Date.parse(date)
      if (age > 7 * 24 * 60 * 60 * 1000 || age < -24 * 60 * 60 * 1000) continue
      const rates = validateRates({ ...(body.rates as Record<string, number>), USD: 1 })
      const supported = new Set(
        'USD EUR GBP CAD AUD CHF SGD BRL INR JPY NGN ZAR GHS KES AED SEK NOK DKK PLN HKD CNY NZD MXN CZK HUF RON TRY KRW ILS MYR THB PHP IDR VND SAR QAR TWD RUB'.split(
          ' ',
        ),
      )
      const appRates = Object.fromEntries(
        Object.entries(rates).filter(([code]) => supported.has(code)),
      )
      const payload: RatesPayload = { base: 'USD', date, source: provider, rates: appRates }
      cached = { payload, fetchedAt: Date.now() }
      return payload
    } catch {
      /* Try the next provider; keep original salaries if both fail. */
    } finally {
      clearTimeout(timer)
    }
  }
  return unavailable()
}

export function ratesAreLive(payload: RatesPayload): boolean {
  return payload.source !== 'fallback'
}
