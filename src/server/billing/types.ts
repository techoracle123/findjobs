import type { Subscription } from '../auth/accounts'

export interface CheckoutRequest {
  userId: string
  email: string
  plan: string
  /** The provider's price identifier for the chosen plan. */
  priceId: string
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
  providerSubscription: ProviderSubscription | null
  customerEmail: string | null
}

/**
 * A payment provider. The rest of the system only knows this interface, so
 * swapping Stripe for a merchant-of-record provider does not reach the rest
 * of the code.
 */
export interface PaymentProvider {
  readonly id: string
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>
  createPortalSession(customerId: string, returnUrl: string): Promise<BillingPortalSession>
  parseWebhook(payload: string, signature: string | null): Promise<WebhookEvent | null>
  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null
}

export const PLANS = {
  free: {
    id: 'free',
    label: 'Desk',
    entitlements: [] as string[],
  },
  pro: {
    id: 'pro',
    label: 'Desk+',
    entitlements: ['alerts', 'weekly_digest', 'verified_source_badges'],
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
  if (subscription.cancelAtPeriodEnd) return false
  return entitlements.includes(feature)
}
