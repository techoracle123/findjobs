import type { Subscription } from '../auth/accounts'

/** The payment providers this build knows how to talk to. */
export type BillingProviderId = 'fake' | 'stripe' | 'paystack' | 'flutterwave' | 'bachs'

/** A price quoted in major units: 5000 means 5,000 naira, not 50 naira. */
export interface PlanPrice {
  amount: number
  currency: string
}

/** The prices of every plan, keyed by plan id. */
export type PlanPriceMap = Record<string, PlanPrice>

export interface CheckoutRequest {
  userId: string
  email: string
  plan: string
  /** The provider's own price identifier, when it has one. */
  priceId: string
  /** The amount to charge, in major units. */
  amount: number
  /** An ISO 4217 currency code. */
  currency: string
  returnUrl: string
}

export interface CheckoutSession {
  id: string
  url: string
}

export interface BillingPortalSession {
  url: string
}

export interface ProviderSubscription {
  customerId: string
  subscriptionId: string
  plan: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface WebhookEvent {
  type: string
  /** A stable identifier for the event, used to ignore a replay. */
  eventId: string | null
  providerSubscription: ProviderSubscription | null
  customerEmail: string | null
}

/**
 * A payment provider. The rest of the system only knows this interface, so
 * the choice of gateway never reaches the rest of the code.
 *
 * Two things differ between providers and are handled inside the adapter:
 * how the webhook is signed, and whether the signature covers the body. A
 * signature that does not bind the body proves only that the caller knows a
 * secret, so the adapter confirms the payment with the provider's own API
 * before it reports anything as paid.
 */
export interface PaymentProvider {
  readonly id: BillingProviderId
  /** The request headers the provider signs its webhooks with. */
  readonly webhookHeaders: string[]
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>
  createPortalSession(customerId: string, returnUrl: string): Promise<BillingPortalSession>
  /**
   * Verifies the signature and, where the signature does not cover the body,
   * confirms the event with the provider's API. Returns null when the event
   * cannot be trusted, and throws when the event looks genuine but could not
   * be confirmed — the caller answers that with a retryable status.
   */
  parseWebhook(payload: string, headers: Headers): Promise<WebhookEvent | null>
  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null
}

export const PLANS = {
  free: {
    id: 'free',
    label: 'Desk',
    // Alerts are free for everyone; they were never meant to sit behind a
    // paywall, and the server has never charged for them.
    entitlements: ['alerts'] as string[],
  },
  pro_graduate: {
    id: 'pro_graduate',
    label: 'Desk+ Graduate',
    entitlements: ['alerts', 'weekly_digest', 'verified_source_badges'],
  },
  pro: {
    id: 'pro',
    label: 'Desk+',
    entitlements: ['alerts', 'weekly_digest', 'verified_source_badges'],
  },
  pro_annual: {
    id: 'pro_annual',
    label: 'Desk+ Annual',
    entitlements: ['alerts', 'weekly_digest', 'verified_source_badges'],
  },
  employer: {
    id: 'employer',
    label: 'Employers',
    entitlements: ['employer_waitlist'],
  },
} as const

export type PlanId = keyof typeof PLANS

export function planEntitlements(plan: string): string[] {
  const entry = PLANS[plan as PlanId]
  return entry ? [...entry.entitlements] : []
}

export function subscriptionHasFeature(
  subscription: Subscription | null,
  entitlements: string[],
  feature: string,
): boolean {
  if (!subscription) return false
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false
  if (subscription.cancelAtPeriodEnd) {
    // Cancelling does not take away time that has already been paid for, so
    // the feature stands until the period it was bought for has ended.
    const endsAt = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : 0
    if (!endsAt || endsAt <= Date.now()) return false
  }
  return entitlements.includes(feature)
}
