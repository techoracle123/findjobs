import { hmacBase64, hmacHex, matchesAny } from './crypto'
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

const API = 'https://api.flutterwave.com/v3'

/** How long a paid period lasts. */
const PERIOD_DAYS = 30

/**
 * Flutterwave.
 *
 * Flutterwave's webhook authentication is weaker than the other providers'
 * and the difference matters. The `verif-hash` header is a static secret
 * that is set in the dashboard and echoed back on every request: it proves
 * the sender knows the secret, but it does not cover the body, so it proves
 * nothing about the payload. Anyone who has ever seen the header can replay
 * it with a body of their own choosing.
 *
 * So the payload is treated as untrusted, and every payment is confirmed
 * with `GET /transactions/{id}/verify` before anything is granted. The
 * newer `flutterwave-signature` header, which is an HMAC over the body, is
 * accepted as well when the account sends it.
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly id = 'flutterwave' as const
  readonly webhookHeaders = ['verif-hash', 'flutterwave-signature']

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
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
        `Flutterwave request failed (${response.status}): ${String(body.message ?? text).slice(0, 300)}`,
      )
    }
    if (body.status && body.status !== 'success') {
      throw new Error(
        `Flutterwave rejected the request: ${String(body.message ?? 'unknown').slice(0, 300)}`,
      )
    }
    return body
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const txRef = `rs_${request.userId}_${request.plan}_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`

    const body = await this.request('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: txRef,
        amount: request.amount,
        currency: request.currency,
        redirect_url: `${request.returnUrl}?checkout=success`,
        customer: { email: request.email },
        customizations: { title: 'Role Signal' },
        meta: { plan: request.plan, user_id: request.userId },
      }),
    })

    const data = (body.data ?? {}) as Record<string, unknown>
    const url = String(data.link ?? '')
    if (!url) throw new Error('Flutterwave did not return a checkout link')
    return { id: String(data.id ?? txRef), url }
  }

  async createPortalSession(_customerId: string, returnUrl: string): Promise<BillingPortalSession> {
    // Flutterwave has no customer portal. The button points back at our own
    // account page, where the plan and the cancel action live.
    return { url: `${returnUrl}?billing=manage` }
  }

  /**
   * Checks the signature, then confirms the charge with Flutterwave and
   * checks that what was paid is what the plan costs.
   */
  async parseWebhook(payload: string, headers: Headers): Promise<WebhookEvent | null> {
    if (!(await this.verified(payload, headers))) return null

    let parsed: { event?: string; data?: Record<string, unknown> }
    try {
      parsed = JSON.parse(payload) as typeof parsed
    } catch {
      return null
    }

    const type = String(parsed.event ?? '')
    const data = (parsed.data ?? {}) as Record<string, unknown>

    if (type !== 'charge.completed') {
      return { type, eventId: eventIdOf(data), providerSubscription: null, customerEmail: null }
    }

    const transactionId = eventIdOf(data)
    if (!transactionId) return null

    const verified = await this.verify(transactionId)
    if (!verified) return null

    const amount = Number(verified.amount)
    const currency = String(verified.currency ?? '').toUpperCase()
    const plan = planForAmount(this.plans, amount, currency)
    if (!plan) {
      throw new Error(`Flutterwave charge of ${amount} ${currency} does not match any plan price`)
    }

    const customer = (verified.customer ?? {}) as { id?: number; email?: string }
    const createdAt = verified.created_at ? new Date(String(verified.created_at)) : new Date()

    return {
      type,
      eventId: transactionId,
      customerEmail: typeof customer.email === 'string' ? customer.email : null,
      providerSubscription: {
        customerId: customer.id === undefined ? '' : String(customer.id),
        subscriptionId: String(verified.tx_ref ?? transactionId),
        plan,
        status: 'active',
        currentPeriodEnd: new Date(createdAt.getTime() + PERIOD_DAYS * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
      },
    }
  }

  /**
   * The signature check. The static `verif-hash` is accepted in the form the
   * dashboard stores it and in the SHA-256 form some Flutterwave
   * documentation describes. The body-bound `flutterwave-signature` is
   * accepted as hex or base64.
   */
  private async verified(payload: string, headers: Headers): Promise<boolean> {
    const verifHash = headers.get('verif-hash')
    if (verifHash) {
      // The dashboard stores the secret as text, but some Flutterwave
      // documentation describes the header as the SHA-256 of it. Both are
      // accepted so a merchant is not locked out by which one they copied.
      const sha256 = await sha256Hex(this.webhookSecret)
      if (matchesAny(verifHash.trim(), [this.webhookSecret, sha256])) return true
    }

    const signature = headers.get('flutterwave-signature')
    if (signature) {
      const hex = await hmacHex(this.webhookSecret, payload, 'SHA-256')
      const base64 = await hmacBase64(this.webhookSecret, payload, 'SHA-256')
      if (matchesAny(signature.trim(), [hex, base64])) return true
    }

    return false
  }

  /** Confirms a charge with Flutterwave. Returns null when it did not settle. */
  private async verify(transactionId: string): Promise<Record<string, unknown> | null> {
    const body = await this.request(`/transactions/${encodeURIComponent(transactionId)}/verify`, {
      method: 'GET',
    })
    const data = (body.data ?? {}) as Record<string, unknown>
    if (String(data.status ?? '').toLowerCase() !== 'successful') return null
    return data
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function eventIdOf(data: Record<string, unknown>): string | null {
  const value = data.id
  if (value === undefined || value === null) return null
  return String(value)
}
