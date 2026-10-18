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
  readonly id = 'fake' as const
  readonly webhookHeaders = ['x-role-signal-signature']

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    return {
      id: `fake_cs_${crypto.randomUUID()}`,
      url: `${request.returnUrl}?checkout=confirm&plan=${request.plan}&user=${request.userId}`,
    }
  }

  async createPortalSession(): Promise<BillingPortalSession> {
    return { url: 'about:blank#fake-billing-portal' }
  }

  /**
   * The fake provider never accepts a webhook.
   *
   * It has no way to verify one, so accepting an event would mean trusting
   * whatever the body said. A deployment with no payment provider configured
   * must not be a deployment where anyone can post a crafted event and
   * grant themselves the paid plan, so every webhook is refused. The local
   * flow uses the separate confirm route, which is blocked in production.
   */
  async parseWebhook(): Promise<WebhookEvent | null> {
    return null
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}
