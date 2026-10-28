/**
 * Bachs payment adapter (Prompts 4/7). This is the ONLY file in the codebase
 * that imports @bachs/sdk — every other module talks to the PaymentProvider
 * interface, so swapping gateways is a one-file change.
 *
 * Money rules:
 * - Decimal strings go to Bachs ("12000.00"); never floats.
 * - Kobo integers are what our own database stores; conversion happens here.
 */
import { Bachs } from '@bachs/sdk'
import type {
  BillingPortalSession,
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  PlanPriceMap,
  ProviderSubscription,
  WebhookEvent,
} from './types'

/** Major units (naira) to kobo, as an integer. */
export function toKobo(amountMajor: number): number {
  return Math.round(amountMajor * 100)
}

/** Kobo integers to the decimal string Bachs expects. */
export function toDecimalString(kobo: number): string {
  return (kobo / 100).toFixed(2)
}

export class BachsProvider implements PaymentProvider {
  readonly id = 'bachs' as const
  readonly webhookHeaders = ['bachs-signature', 'bachs-timestamp']
  private readonly client: Bachs

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly plans: PlanPriceMap,
  ) {
    this.client = new Bachs({ apiKey: secretKey })
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const price = this.plans[request.plan]
    const kobo = toKobo(price?.amount ?? request.amount)
    const session = (await this.client.checkoutSessions.create({
      pricing: {
        currency: request.currency,
        amount: toDecimalString(kobo), // decimal string, never a float
        price_type: 'fixed',
      },
      reference: `fj_${request.userId}_${request.plan}_${Date.now()}`,
      customer: { email: request.email, name: request.email },
      success_url: request.returnUrl,
      cancel_url: request.returnUrl,
    })) as { checkout_id?: string; checkout_url?: string }
    return {
      id: session.checkout_id ?? 'bachs-session',
      url: session.checkout_url ?? request.returnUrl,
    }
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<BillingPortalSession> {
    const session = (await this.client.customerPortal.createSession(customerId)) as {
      portal_url?: string
      url?: string
    }
    return { url: session.portal_url ?? session.url ?? returnUrl }
  }

  async parseWebhook(payload: string, headers: Headers): Promise<WebhookEvent | null> {
    const signature = headers.get('bachs-signature')
    const timestamp = headers.get('bachs-timestamp')
    if (!signature || !timestamp) return null
    // constructEvent verifies the signature over the raw body; a forged
    // body fails verification and returns null.
    const sdk = this.client as unknown as {
      constructEvent?: (
        body: string,
        sig: string,
        secret: string,
      ) => { type?: string; id?: string; data?: unknown } | null
    }
    const event = sdk.constructEvent
      ? sdk.constructEvent(payload, signature, this.webhookSecret)
      : null
    if (!event) return null
    const data = (event.data ?? {}) as {
      subscription?: Record<string, unknown>
      customer_email?: string
    }
    const sub = data.subscription
    return {
      type: event.type ?? 'unknown',
      eventId: event.id ?? null,
      customerEmail: data.customer_email ?? null,
      providerSubscription: sub
        ? {
            customerId: String(sub.customer ?? ''),
            subscriptionId: String(sub.id ?? ''),
            plan: String(sub.plan ?? 'pro'),
            status: String(sub.status ?? 'active'),
            currentPeriodEnd: sub.current_period_end ? String(sub.current_period_end) : null,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          }
        : null,
    }
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}
