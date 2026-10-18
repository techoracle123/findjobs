import type {
  BillingPortalSession,
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderSubscription,
  WebhookEvent,
} from './types'

/**
 * A provider that does nothing but record intent. It exists so the billing
 * flow can be exercised end to end in local and test environments without a
 * payment account. It never contacts anything and never charges anyone.
 */
export class FakeProvider implements PaymentProvider {
  readonly id = 'fake'

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    return {
      id: `fake_cs_${crypto.randomUUID()}`,
      url: `${request.returnUrl}?checkout=confirm&plan=${request.plan}&user=${request.userId}`,
    }
  }

  async createPortalSession(): Promise<BillingPortalSession> {
    return { url: 'about:blank#fake-billing-portal' }
  }

  async parseWebhook(payload: string): Promise<WebhookEvent | null> {
    try {
      return JSON.parse(payload) as WebhookEvent
    } catch {
      return null
    }
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}
