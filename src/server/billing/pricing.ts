import type { AppConfig } from '../config'
import { PLANS, type PlanPrice, type PlanPriceMap } from './types'

export interface PlanDefinition {
  id: string
  label: string
  displayLabel: string
  entitlements: string[]
  price: PlanPrice
  /** Billing interval for display; 'waitlist' plans cannot be bought yet. */
  interval: 'free' | 'month' | 'year' | 'waitlist'
  audience: 'seeker' | 'employer'
  monthlyEquivalent: number
  founding: boolean
  standardAmount: number
  trialDays: number
}

/**
 * The plan catalogue.
 *
 * Prices live on the server and are read from the environment, so the price
 * a customer is charged is never something the browser can choose. The
 * currency is the one the payment provider settles in; Paystack and
 * Flutterwave both settle in naira by default and both accept a handful of
 * other African currencies and US dollars.
 */
export function planCatalogue(config: AppConfig): PlanDefinition[] {
  const currency = config.billing.currency
  return [
    {
      id: PLANS.free.id,
      label: PLANS.free.label,
      displayLabel: 'Free',
      entitlements: [...PLANS.free.entitlements],
      price: { amount: 0, currency },
      interval: 'free',
      audience: 'seeker',
      monthlyEquivalent: 0,
      founding: false,
      standardAmount: 0,
      trialDays: 3,
    },
    {
      id: PLANS.pro_graduate.id,
      label: PLANS.pro_graduate.label,
      displayLabel: 'Pro for Graduates',
      entitlements: [...PLANS.pro_graduate.entitlements],
      price: { amount: config.billing.priceGraduate, currency },
      interval: 'month',
      audience: 'seeker',
      monthlyEquivalent: config.billing.priceGraduate,
      // The graduate price is an eligibility discount, not a founding offer.
      founding: false,
      standardAmount: config.billing.priceGraduate,
      trialDays: 3,
    },
    {
      id: PLANS.pro.id,
      label: PLANS.pro.label,
      displayLabel: 'Pro Monthly',
      entitlements: [...PLANS.pro.entitlements],
      price: { amount: config.billing.pricePro, currency },
      interval: 'month',
      audience: 'seeker',
      monthlyEquivalent: config.billing.pricePro,
      founding: true,
      standardAmount: 10000,
      trialDays: 3,
    },
    {
      id: PLANS.pro_annual.id,
      label: PLANS.pro_annual.label,
      displayLabel: 'Pro Yearly',
      entitlements: [...PLANS.pro_annual.entitlements],
      price: { amount: config.billing.priceAnnual, currency },
      interval: 'year',
      audience: 'seeker',
      monthlyEquivalent: Math.round(config.billing.priceAnnual / 12),
      founding: true,
      standardAmount: 60000,
      trialDays: 3,
    },
    {
      id: PLANS.employer.id,
      label: PLANS.employer.label,
      displayLabel: 'Employer interest',
      entitlements: [...PLANS.employer.entitlements],
      // Employer posting is paused; this records interest only, never a charge.
      price: { amount: 0, currency },
      interval: 'waitlist',
      audience: 'employer',
      monthlyEquivalent: 0,
      founding: false,
      standardAmount: 0,
      trialDays: 0,
    },
  ]
}

export function planPrices(config: AppConfig): PlanPriceMap {
  const prices: PlanPriceMap = {}
  for (const plan of planCatalogue(config)) prices[plan.id] = plan.price
  return prices
}

/**
 * The plan a payment of this amount buys.
 *
 * The plan is derived from what was actually charged rather than from
 * anything the payer supplied, so a payment of the wrong size buys nothing
 * and a payment of the right size buys the plan it paid for.
 */
export function planForAmount(
  prices: PlanPriceMap,
  amount: number,
  currency: string,
): string | null {
  const wanted = currency.toUpperCase()
  for (const [id, price] of Object.entries(prices)) {
    if (id === 'free') continue
    if (price.currency.toUpperCase() !== wanted) continue
    if (Math.abs(price.amount - amount) < 0.005) return id
  }
  return null
}

/** A human-readable price, e.g. "₦5,000" or "$9.00". */
export function formatPrice(price: PlanPrice): string {
  if (price.amount <= 0) return 'Free'
  const symbol = price.currency === 'NGN' ? '₦' : price.currency === 'USD' ? '$' : ''
  const digits = Number.isInteger(price.amount) ? 0 : 2
  const formatted = price.amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return symbol ? `${symbol}${formatted}` : `${formatted} ${price.currency}`
}
