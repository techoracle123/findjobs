import type { AppConfig } from '../config'
import { PLANS, type PlanPrice, type PlanPriceMap } from './types'

export interface PlanDefinition {
  id: string
  label: string
  entitlements: string[]
  price: PlanPrice
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
      entitlements: [...PLANS.free.entitlements],
      price: { amount: 0, currency },
    },
    {
      id: PLANS.pro.id,
      label: PLANS.pro.label,
      entitlements: [...PLANS.pro.entitlements],
      price: { amount: config.billing.pricePro, currency },
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
