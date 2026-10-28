import { hmacHex, timingSafeEqual } from './crypto'
import type {
  BillingPortalSession,
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  PlanPriceMap,
  ProviderSubscription,
  WebhookEvent,
} from './types'
import { planForAmount } from './pricing'

const API = 'https://api.paystack.co'

/**
 * Paystack takes amounts in the currency's minor unit, so 5,000 naira is
 * sent as 500,000 kobo. Every currency Paystack settles in has two decimal
 * places, so the multiplier is the same for all of them.
 */
const MINOR_UNITS = 100

/** How long a paid period lasts. */
const PERIOD_DAYS = 30

/**
 * Paystack.
 *
 * The webhook is signed with an HMAC-SHA512 over the raw request body using
 * the merchant secret key, and the signature is sent in `x-paystack-signature`.
 * Because the signature covers the body, a webhook that verifies is
 * genuinely from Paystack and genuinely about the payload we read.
 *
 * The payment is still confirmed with `GET /transaction/verify/:reference`
 * before anything is granted, because the signature says the event is
 * genuine but says nothing about how much was paid.
 */
export class PaystackProvider implements PaymentProvider {
  readonly id = 'paystack' as const
  readonly webhookHeaders = ['x-paystack-signature']

  constructor(
    private readonly secretKey: string,
    private readonly plans: PlanPriceMap = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    const text = await response.text().catch(() => '')
    let body: Record<string, unknown> = {}
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }

    if (!response.ok) {
      throw new Error(
        `Paystack request failed (${response.status}): ${String(body.message ?? text).slice(0, 300)}`,
      )
    }
    if (body.status === false) {
      throw new Error(
        `Paystack rejected the request: ${String(body.message ?? 'unknown').slice(0, 300)}`,
      )
    }
    return body
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const reference = `rs_${request.userId}_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`

    const body = await this.request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: request.email,
        amount: Math.round(request.amount * MINOR_UNITS),
        currency: request.currency,
        reference,
        callback_url: `${request.returnUrl}?checkout=success&reference=${encodeURIComponent(reference)}`,
        metadata: { plan: request.plan, user_id: request.userId },
      }),
    })

    const data = (body.data ?? {}) as Record<string, unknown>
    const url = String(data.authorization_url ?? '')
    if (!url) throw new Error('Paystack did not return an authorization URL')
    return { id: String(data.reference ?? reference), url }
  }

  async createPortalSession(_customerId: string, returnUrl: string): Promise<BillingPortalSession> {
    // Paystack has no customer portal. The button points back at our own
    // account page, where the plan and the cancel action live.
    return { url: `${returnUrl}?billing=manage` }
  }

  /**
   * Verifies the signature over the raw body, then confirms the charge with
   * Paystack and checks that what was paid is what the plan costs.
   */
  async parseWebhook(payload: string, headers: Headers): Promise<WebhookEvent | null> {
    const signature = headers.get('x-paystack-signature')
    if (!signature) return null

    const expected = await hmacHex(this.secretKey, payload, 'SHA-512')
    if (!timingSafeEqual(signature.trim().toLowerCase(), expected)) return null

    let parsed: { event?: string; data?: Record<string, unknown> }
    try {
      parsed = JSON.parse(payload) as typeof parsed
    } catch {
      return null
    }

    const type = String(parsed.event ?? '')
    const data = (parsed.data ?? {}) as Record<string, unknown>

    if (type === 'subscription.disable' || type === 'subscription.not_renew') {
      return {
        type,
        eventId: eventIdOf(data, 'subscription_code'),
        providerSubscription: {
          customerId: String(customerIdOf(data) ?? ''),
          subscriptionId: String(data.subscription_code ?? data.reference ?? ''),
          plan: planOf(data) ?? 'pro',
          status: 'canceled',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: true,
        },
        customerEmail: emailOf(data),
      }
    }

    if (
      type !== 'charge.success' &&
      type !== 'subscription.create' &&
      type !== 'subscription.update'
    ) {
      // A genuine event we do not act on.
      return {
        type,
        eventId: eventIdOf(data, 'id'),
        providerSubscription: null,
        customerEmail: null,
      }
    }

    const reference = String(data.reference ?? data.subscription_code ?? '')
    if (!reference) return null

    const verified = await this.verify(reference)
    if (!verified) return null

    const amount = Number(verified.amount) / MINOR_UNITS
    const currency = String(verified.currency ?? '').toUpperCase()
    const plan = planForAmount(this.plans, amount, currency)
    if (!plan) {
      throw new Error(`Paystack charge of ${amount} ${currency} does not match any plan price`)
    }

    const paidAt = verified.paid_at ? new Date(String(verified.paid_at)) : new Date()

    return {
      type,
      eventId: eventIdOf(data, 'id') ?? reference,
      customerEmail: emailOf(verified) ?? emailOf(data),
      providerSubscription: {
        customerId: customerIdOf(verified) ?? '',
        subscriptionId: reference,
        plan,
        status: 'active',
        currentPeriodEnd: new Date(paidAt.getTime() + PERIOD_DAYS * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
      },
    }
  }

  /** Confirms a charge with Paystack. Returns null when it did not settle. */
  private async verify(reference: string): Promise<Record<string, unknown> | null> {
    const body = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
    })
    const data = (body.data ?? {}) as Record<string, unknown>
    if (String(data.status ?? '').toLowerCase() !== 'success') return null
    return data
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}

function emailOf(data: Record<string, unknown>): string | null {
  const customer = data.customer as { email?: string } | undefined
  if (customer && typeof customer.email === 'string') return customer.email
  return typeof data.email === 'string' ? data.email : null
}

function customerIdOf(data: Record<string, unknown>): string | null {
  const customer = data.customer as { customer_code?: string; id?: number } | undefined
  if (customer) {
    if (typeof customer.customer_code === 'string') return customer.customer_code
    if (typeof customer.id === 'number') return String(customer.id)
  }
  return typeof data.customer_code === 'string' ? data.customer_code : null
}

function planOf(data: Record<string, unknown>): string | null {
  const metadata = data.metadata as { plan?: string } | undefined
  if (metadata && typeof metadata.plan === 'string') return metadata.plan
  if (typeof data.plan === 'string') return data.plan
  return null
}

function eventIdOf(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  if (value === undefined || value === null) return null
  return String(value)
}
