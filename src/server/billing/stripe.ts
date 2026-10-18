import type {
  BillingPortalSession,
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderSubscription,
  WebhookEvent,
} from './types'

const API = 'https://api.stripe.com/v1'

/**
 * Stripe talks to us over form-encoded bodies and signs webhooks with an
 * HMAC over `timestamp.payload`. Both are implemented directly so there is no
 * SDK to keep up to date and the signature check can be unit tested.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe'

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private async post(
    path: string,
    fields: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Stripe request failed (${response.status}): ${text.slice(0, 300)}`)
    }

    return (await response.json()) as Record<string, unknown>
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = await this.post('/checkout/sessions', {
      mode: 'subscription',
      customer_email: request.email,
      'line_items[0][price]': request.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: request.userId,
      success_url: `${request.returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.returnUrl}?checkout=cancelled`,
      allow_promotion_codes: 'true',
    })

    return { id: String(response.id), url: String(response.url) }
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<BillingPortalSession> {
    const response = await this.post('/billing_portal/sessions', {
      customer: customerId,
      return_url: returnUrl,
    })
    return { url: String(response.url) }
  }

  /**
   * Verifies the `Stripe-Signature` header and parses the event. The header
   * carries a timestamp and one or more HMAC signatures; the timestamp is
   * checked against a tolerance so a captured webhook cannot be replayed.
   */
  async parseWebhook(payload: string, signature: string | null): Promise<WebhookEvent | null> {
    if (!signature) return null

    const parts = signature.split(',').map((part) => part.trim())
    const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2)
    const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3))

    if (!timestamp || signatures.length === 0) return null

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return null

    const expected = await hmacHex(this.webhookSecret, `${timestamp}.${payload}`)
    const matches = signatures.some((candidate) => timingSafeEqual(candidate, expected))
    if (!matches) return null

    let event: { type?: string; data?: { object?: Record<string, unknown> } }
    try {
      event = JSON.parse(payload) as typeof event
    } catch {
      return null
    }

    const object = (event.data?.object ?? {}) as {
      customer_email?: string
      customer?: string | { id?: string }
      subscription?: string
      metadata?: { plan?: string }
      status?: string
      current_period_end?: number
      cancel_at_period_end?: boolean
    }

    const type = event.type ?? ''
    const customerId =
      typeof object.customer === 'string'
        ? object.customer
        : ((object.customer as { id?: string } | undefined)?.id ?? '')

    const providerSubscription: ProviderSubscription | null =
      type === 'checkout.session.completed' || type.startsWith('customer.subscription.')
        ? {
            customerId,
            subscriptionId:
              typeof object.subscription === 'string'
                ? object.subscription
                : ((object.subscription as { id?: string } | undefined)?.id ?? ''),
            plan: typeof object.metadata?.plan === 'string' ? object.metadata.plan : 'pro',
            status:
              type === 'customer.subscription.deleted'
                ? 'canceled'
                : typeof object.status === 'string'
                  ? object.status
                  : 'active',
            currentPeriodEnd:
              typeof object.current_period_end === 'number'
                ? new Date(object.current_period_end * 1000).toISOString()
                : null,
            cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
          }
        : null

    return {
      type,
      customerEmail: typeof object.customer_email === 'string' ? object.customer_email : null,
      providerSubscription,
    }
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares two hex strings without leaking their length through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}
