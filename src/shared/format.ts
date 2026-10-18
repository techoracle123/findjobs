import type { Job, RatesPayload, SalaryPeriod } from './types'

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CHF: 'CHF',
  CAD: 'CA$',
  AUD: 'A$',
  SGD: 'S$',
  HKD: 'HK$',
  CNY: '¥',
  NZD: 'NZ$',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  RON: 'lei',
  TRY: '₺',
  ZAR: 'R',
  BRL: 'R$',
  MXN: 'MX$',
  INR: '₹',
  KRW: '₩',
  ILS: '₪',
  MYR: 'RM',
  THB: '฿',
  PHP: '₱',
  IDR: 'Rp',
  VND: '₫',
  NGN: '₦',
  KES: 'KSh',
  GHS: '₵',
  AED: 'AED',
  SAR: 'SAR',
  QAR: 'QAR',
  TWD: 'NT$',
  RUB: '₽',
}

export const PERIOD_LABELS: Record<SalaryPeriod, string> = {
  hour: '/hr',
  month: '/mo',
  year: '/yr',
}

export function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const symbol = parts.find((part) => part.type === 'currency')?.value
    if (symbol) return symbol
  } catch {
    // Unknown currency code: fall through to the static table.
  }
  return SYMBOLS[code] ?? code
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

export function formatAmount(value: number, currency: string): string {
  const symbol = currencySymbol(currency)
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${symbol}${trimZero(value / 1_000_000)}M`
  if (magnitude >= 10_000) return `${symbol}${trimZero(value / 1000)}k`
  return `${symbol}${Math.round(value).toLocaleString('en-US')}`
}

export function formatRange(min: number, max: number, currency: string): string {
  if (!min && !max) return 'Not disclosed'
  if (!min) return `up to ${formatAmount(max, currency)}`
  if (!max) return `from ${formatAmount(min, currency)}`
  return `${formatAmount(min, currency)} – ${formatAmount(max, currency)}`
}

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export type Freshness = 'fresh' | 'recent' | 'aging' | 'stale'

export function freshnessOf(iso: string, now: number = Date.now()): Freshness {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'stale'
  const days = Math.floor(Math.max(0, now - then) / 86_400_000)
  if (days <= 7) return 'fresh'
  if (days <= 30) return 'recent'
  if (days <= 90) return 'aging'
  return 'stale'
}

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  fresh: 'Fresh',
  recent: 'Recent',
  aging: 'Aging',
  stale: 'Stale',
}

/**
 * Salary comparison is only meaningful between postings that share a pay
 * period, so results are bucketed by period and each bucket is ordered on its
 * own converted values. Periods are never annualised.
 */
export interface BucketedSalary {
  period: SalaryPeriod
  jobs: { job: Job; value: number }[]
}

export function bucketByPeriod(entries: { job: Job; value: number }[]): BucketedSalary[] {
  const buckets = new Map<SalaryPeriod, { job: Job; value: number }[]>()
  for (const entry of entries) {
    const list = buckets.get(entry.job.salaryPeriod) ?? []
    list.push(entry)
    buckets.set(entry.job.salaryPeriod, list)
  }
  return [...buckets.entries()].map(([period, jobs]) => ({
    period,
    jobs: jobs.sort((a, b) => a.value - b.value),
  }))
}

/**
 * Convert an amount into the display currency. Returns null when the rate is
 * unavailable so the caller can keep the employer's original currency.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: RatesPayload | null,
): number | null {
  if (!rates) return null
  if (from === to) return amount
  const fromRate = rates.rates[from]
  const toRate = rates.rates[to]
  if (!fromRate || !toRate) return null
  return (amount / fromRate) * toRate
}

export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (character) => character.toUpperCase())
}
