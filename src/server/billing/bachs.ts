/**
 * Bachs payment adapter. This is the ONLY file in the codebase that imports
 * @bachs/sdk. Every other module talks to the PaymentProvider interface.
 *
 * FJ sells fixed paid time in naira: one month or one year. Bachs hosted
 * checkout collects by NGN card or bank transfer, and a signed Bachs event
 * is matched to FJ's saved checkout before Pro is turned on. Bachs amounts
 * are decimal strings; FJ stores its own money values as kobo integers.
 */
import {
  Bachs,
  type CheckoutSessionCreated,
  type CheckoutSessionResponse,
  type CreateCheckoutSessionRequest,
  type PortalSessionResponse,
  type SubscriptionResponse,
  type WebhookEvent as BachsSdkWebhookEvent,
  type WriteRequestOptions,
} from '@bachs/sdk'
import {
  BillingProviderError,
  type BillingPortalSession,
  type BillingProviderFailure,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type PlanPriceMap,
  type ProviderPayment,
  type ProviderSubscription,
  type WebhookEvent,
} from './types'
import { planForAmount } from './pricing'

/** The part of the Bachs SDK this adapter uses. Tests can supply a fake. */
export interface BachsClientLike {
  checkoutSessions: {
    create(
      input: CreateCheckoutSessionRequest,
      options?: WriteRequestOptions,
    ): Promise<CheckoutSessionCreated>
    get(checkoutId: string): Promise<CheckoutSessionResponse>
  }
  customerPortal: {
    createSession(customerId: string, options?: WriteRequestOptions): Promise<PortalSessionResponse>
  }
  subscriptions: {
    cancel(
      subscriptionId: string,
      input?: { cancel_at_period_end?: boolean; reason?: string | null },
      options?: WriteRequestOptions,
    ): Promise<SubscriptionResponse>
  }
  webhooks: {
    constructEvent(
      rawBody: string | Uint8Array,
      headers: Headers,
      secret: string,
    ): BachsSdkWebhookEvent
  }
}

type RecordValue = Record<string, unknown>

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Major units (naira) to kobo, as an integer. */
export function toKobo(amountMajor: number): number {
  return Math.round(amountMajor * 100)
}

/** Kobo integers to the decimal string Bachs expects. */
export function toDecimalString(kobo: number): string {
  return (kobo / 100).toFixed(2)
}

/** Parses a Bachs decimal string into kobo without binary floating point drift. */
export function parseDecimalToKobo(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null
  }
  if (typeof value !== 'string') return null
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  const whole = Number(match[2])
  const fraction = Number((match[3] ?? '').padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(whole)) return null
  return sign * (whole * 100 + fraction)
}

function amountMajor(value: unknown): number | null {
  const kobo = parseDecimalToKobo(value)
  return kobo === null ? null : kobo / 100
}

function metadataFrom(...candidates: unknown[]): RecordValue {
  for (const candidate of candidates) {
    if (record(candidate) && record(candidate.metadata)) return candidate.metadata
  }
  return {}
}

function customerFrom(data: RecordValue): { id: string | null; email: string | null } {
  const customer = record(data.customer) ? data.customer : {}
  const details = record(data.customer_details) ? data.customer_details : {}
  return {
    id: text(customer.customer_id) ?? text(customer.id),
    email: text(customer.email) ?? text(details.email),
  }
}

function publicHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function cleanCustomerEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/**
 * Bachs should receive a person's name, not an FJ user id, sign-in subject or
 * email address. Older FJ rows could contain those internal values, so the
 * adapter protects the boundary even if a stored name has not been repaired.
 */
export function bachsCustomerName(value: string | null | undefined): string {
  const cleaned = (value ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!cleaned) return 'FJ customer'
  if (/^usr_[0-9a-f]{16,}$/i.test(cleaned)) return 'FJ customer'
  if (/^(dev|email):/i.test(cleaned)) return 'FJ customer'
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return 'FJ customer'
  return cleaned
}

function safeProviderCode(value: unknown): string | null {
  const code = text(value)?.trim().toUpperCase() ?? null
  return code && /^[A-Z0-9_.-]{1,100}$/.test(code) ? code : null
}

function safeProviderRequestId(value: unknown): string | null {
  const id = text(value)?.trim() ?? null
  return id && /^[A-Za-z0-9_.:-]{1,120}$/.test(id) ? id : null
}

function safeFieldNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const candidate = record(item)
      ? (text(item.field) ?? text(item.path) ?? text(item.param) ?? text(item.name))
      : text(item)
    if (!candidate || !/^[A-Za-z0-9_.-]{1,80}$/.test(candidate)) continue
    if (!names.includes(candidate)) names.push(candidate)
    if (names.length >= 10) break
  }
  return names
}

function providerFailure(input: {
  code: string | null
  status: number | null
  name: string
  outcomeUnknown: boolean
  fieldNames: string[]
}): BillingProviderFailure {
  const code = input.code ?? ''
  if (
    input.status === 401 ||
    input.status === 403 ||
    code.includes('ACCOUNT_') ||
    code.includes('PAYMENT_METHOD') ||
    code.includes('CHECKOUT_HAS_NO') ||
    code.includes('CHECKOUT_RESTRICTION') ||
    code.includes('PERMISSION') ||
    code.includes('SCOPE') ||
    code.includes('API_KEY') ||
    code.includes('UNAUTHORIZED') ||
    code.includes('FORBIDDEN') ||
    code.includes('CURRENCY_NOT')
  ) {
    return 'provider_account_attention'
  }
  if (input.outcomeUnknown) return 'outcome_unknown'
  if (
    input.fieldNames.length > 0 ||
    input.status === 400 ||
    input.status === 422 ||
    code.includes('VALIDATION') ||
    code.includes('INVALID_')
  ) {
    return 'provider_validation'
  }
  if (
    input.name.includes('Network') ||
    input.name.includes('Timeout') ||
    input.name.includes('Abort') ||
    (input.status === null && input.name === 'TypeError')
  ) {
    return 'network'
  }
  if (
    input.name.includes('Response') ||
    input.status === 408 ||
    input.status === 425 ||
    input.status === 429 ||
    (input.status !== null && input.status >= 500)
  ) {
    return 'provider_unavailable'
  }
  return 'provider_rejected'
}

/**
 * Converts an SDK or network failure into the small, safe shape FJ may log
 * and classify. The raw provider body and detail are deliberately discarded.
 */
export function toBillingProviderError(error: unknown, message: string): BillingProviderError {
  if (error instanceof BillingProviderError) return error
  const source = (typeof error === 'object' && error !== null ? error : {}) as RecordValue
  const statusValue = source.statusCode ?? source.status ?? source.responseStatusCode
  const status =
    typeof statusValue === 'number' && Number.isFinite(statusValue) ? statusValue : null
  const code = safeProviderCode(
    source.errorCode ?? source.error_code ?? (status !== null ? source.code : null),
  )
  const fieldNames = safeFieldNames(source.fieldErrors ?? source.errors)
  const name = error instanceof Error ? error.name : 'UnknownError'
  const outcomeUnknown = source.outcomeUnknown === true
  return new BillingProviderError({
    failure: providerFailure({ code, status, name, outcomeUnknown, fieldNames }),
    message,
    httpStatus: status,
    providerCode: code,
    providerRequestId: safeProviderRequestId(source.requestId ?? source.request_id),
    fieldNames,
  })
}

const PLAN_IDS = new Set(['free', 'pro', 'pro_graduate', 'pro_annual', 'employer'])

function planFromMetadata(metadata: RecordValue): string | null {
  const plan = text(metadata.plan)
  return plan && PLAN_IDS.has(plan) ? plan : null
}

export class BachsProvider implements PaymentProvider {
  readonly id = 'bachs' as const
  readonly webhookHeaders = ['x-bachs-signature-v2', 'x-bachs-signature', 'x-bachs-timestamp']

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly plans: PlanPriceMap,
    private readonly client: BachsClientLike = new Bachs({
      apiKey: secretKey.replace(/\s+/g, ''),
      logLevel: 'off',
    }),
  ) {}

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const amount = request.amount
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BillingProviderError({
        failure: 'provider_validation',
        message: 'The checkout amount is not valid.',
      })
    }
    const email = cleanCustomerEmail(request.email)
    if (!email) {
      throw new BillingProviderError({
        failure: 'provider_validation',
        message: 'The account email is not valid for checkout.',
      })
    }
    const currency = request.currency.toUpperCase()
    const reference =
      request.reference ?? `fj_${request.userId}_${request.plan}_${crypto.randomUUID()}`
    let session: CheckoutSessionCreated
    try {
      session = await this.client.checkoutSessions.create(
        {
          // Keep this to the documented raw-price shape. When a customer is
          // supplied, customer_creation does not apply, and the checkout
          // currency already comes from pricing.currency.
          pricing: {
            currency,
            amount: toDecimalString(toKobo(amount)), // decimal string, never a float
          },
          reference,
          customer: {
            email,
            name: bachsCustomerName(request.name),
          },
          payment_method_types: currency === 'NGN' ? ['NGN_CARD', 'NGN_BANK_TRANSFER'] : undefined,
          success_url: publicHttpsUrl(request.successUrl ?? request.returnUrl),
          cancel_url: publicHttpsUrl(request.cancelUrl ?? request.returnUrl),
          metadata: {
            ...(request.metadata ?? {}),
            user_id: request.userId,
            plan: request.plan,
          },
          expires_in_minutes: 60,
        },
        { idempotencyKey: request.idempotencyKey ?? reference },
      )
    } catch (error) {
      throw toBillingProviderError(error, 'Bachs could not create the checkout.')
    }
    const checkoutUrl = publicHttpsUrl(session.checkout_url)
    if (!session.checkout_id || !checkoutUrl) {
      throw new BillingProviderError({
        failure: 'outcome_unknown',
        message: 'Bachs returned an unusable checkout response.',
      })
    }
    if (session.reference && session.reference !== reference) {
      throw new BillingProviderError({
        failure: 'outcome_unknown',
        message: 'Bachs returned a checkout for a different reference.',
      })
    }
    return { id: session.checkout_id, url: checkoutUrl }
  }

  async createPortalSession(customerId: string): Promise<BillingPortalSession> {
    let session: PortalSessionResponse
    try {
      session = await this.client.customerPortal.createSession(customerId)
    } catch (error) {
      throw toBillingProviderError(error, 'Bachs could not open the billing portal.')
    }
    const url = publicHttpsUrl(session.url)
    if (!url) {
      throw new BillingProviderError({
        failure: 'provider_unavailable',
        message: 'Bachs did not return a usable portal URL.',
      })
    }
    return { url }
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    // Fixed-time naira payments have no Bachs subscription to cancel. A real
    // Bachs subscription id is cancelled at the end of its paid period.
    if (!providerSubscriptionId.startsWith('sub_')) return
    try {
      await this.client.subscriptions.cancel(providerSubscriptionId, {
        cancel_at_period_end: true,
      })
    } catch (error) {
      throw toBillingProviderError(error, 'Bachs could not cancel the subscription.')
    }
  }

  async fetchCheckout(checkoutId: string): Promise<ProviderPayment | null> {
    let session: CheckoutSessionResponse
    try {
      session = await this.client.checkoutSessions.get(checkoutId)
    } catch (error) {
      throw toBillingProviderError(error, 'Bachs could not read the checkout.')
    }
    const charge = session.charge ?? null
    const chargeStatus = text(charge?.status)?.toLowerCase() ?? null
    const paymentStatus = text(session.payment_status)?.toLowerCase() ?? null
    const succeeded =
      paymentStatus === 'paid' ||
      paymentStatus === 'succeeded' ||
      paymentStatus === 'accepted' ||
      paymentStatus === 'overpaid' ||
      chargeStatus === 'succeeded' ||
      chargeStatus === 'accepted' ||
      chargeStatus === 'overpaid'
    const status: ProviderPayment['status'] = succeeded
      ? 'succeeded'
      : session.status === 'expired'
        ? 'expired'
        : chargeStatus === 'failed' || chargeStatus === 'cancelled'
          ? 'failed'
          : 'unknown'
    const metadata = metadataFrom(session)
    const customer = (session.customer ?? {}) as RecordValue
    return {
      checkoutId: session.checkout_id,
      chargeId: charge?.payment_id ?? text(charge?.id),
      reference: session.reference ?? charge?.reference ?? null,
      status,
      statusDetail: chargeStatus,
      amount: amountMajor(charge?.amount ?? session.amount),
      currency: text(charge?.currency ?? session.currency),
      customerId: text(customer.customer_id) ?? text(customer.id),
      plan: planFromMetadata(metadata),
      paidAt: session.completed_at ?? charge?.completed_at ?? null,
    }
  }

  async parseWebhook(payload: string, headers: Headers): Promise<WebhookEvent | null> {
    let event: BachsSdkWebhookEvent
    try {
      event = this.client.webhooks.constructEvent(payload, headers, this.webhookSecret)
    } catch {
      return null
    }

    const data = record(event.data) ? event.data : {}
    const subscriptionObject = record(data.subscription) ? data.subscription : data
    const metadata = metadataFrom(data, subscriptionObject, data.charge)
    const customer = customerFrom(
      record(subscriptionObject.customer) ? { customer: subscriptionObject.customer } : data,
    )
    const providerSubscription = this.subscriptionFromData(event.type, data, metadata, customer.id)
    const providerPayment = this.paymentFromData(event.type, data, metadata, customer.id)
    const subscriptionCustomer = record(subscriptionObject.customer)
      ? subscriptionObject.customer
      : {}

    return {
      type: event.type,
      eventId: event.id,
      createdAt: event.created_at,
      userId: text(metadata.user_id),
      customerEmail: customer.email ?? text(subscriptionCustomer.email),
      providerSubscription,
      providerPayment,
    }
  }

  private subscriptionFromData(
    type: string,
    data: RecordValue,
    metadata: RecordValue,
    fallbackCustomerId: string | null,
  ): ProviderSubscription | null {
    if (!type.startsWith('customer.subscription.')) return null
    const sub = record(data.subscription) ? data.subscription : data
    const customer = record(sub.customer) ? sub.customer : {}
    const cycle = record(sub.billing_cycle) ? sub.billing_cycle : {}
    const amount = amountMajor(sub.amount)
    const currency = text(sub.currency)
    let plan = planFromMetadata(metadata)
    if (!plan && amount !== null && currency) {
      plan = planForAmount(this.plans, amount, currency)
    }
    if (!plan) plan = cycle.interval === 'year' ? 'pro_annual' : 'pro'
    const rawStatus = text(sub.status) ?? 'active'
    return {
      customerId: text(customer.customer_id) ?? text(customer.id) ?? fallbackCustomerId ?? '',
      subscriptionId: text(sub.subscription_id) ?? text(sub.id) ?? '',
      plan,
      status:
        type === 'customer.subscription.deleted'
          ? 'canceled'
          : rawStatus === 'cancelled'
            ? 'canceled'
            : rawStatus,
      currentPeriodEnd: text(sub.current_period_end),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    }
  }

  private paymentFromData(
    type: string,
    data: RecordValue,
    metadata: RecordValue,
    fallbackCustomerId: string | null,
  ): ProviderPayment | null {
    const plan = planFromMetadata(metadata)
    const checkoutId = text(data.checkout_id)
    const reference = text(data.reference)

    if (type === 'collection.succeeded') {
      const rawStatus = text(data.status)?.toUpperCase() ?? null
      const customer = record(data.customer) ? data.customer : {}
      return {
        checkoutId,
        chargeId: text(data.charge_id),
        reference,
        status:
          rawStatus === 'SUCCEEDED' || rawStatus === 'ACCEPTED' || rawStatus === 'OVERPAID'
            ? 'succeeded'
            : 'unknown',
        statusDetail: rawStatus,
        amount: amountMajor(data.amount),
        currency: text(data.currency),
        customerId: text(customer.customer_id) ?? text(customer.id) ?? fallbackCustomerId,
        plan,
        paidAt: null,
      }
    }

    if (type === 'checkout.completed') {
      if (data.mode === 'subscription' || data.payment_status !== 'paid') return null
      const charge = record(data.charge) ? data.charge : {}
      const chargeStatus = text(charge.status)?.toLowerCase() ?? null
      if (
        chargeStatus &&
        chargeStatus !== 'succeeded' &&
        chargeStatus !== 'accepted' &&
        chargeStatus !== 'overpaid'
      )
        return null
      const customer = record(data.customer) ? data.customer : {}
      return {
        checkoutId,
        chargeId: text(charge.id) ?? text(charge.payment_id),
        reference,
        status: 'succeeded',
        statusDetail: chargeStatus,
        amount: amountMajor(charge.amount ?? data.amount),
        currency: text(charge.currency ?? data.currency),
        customerId:
          text(customer.customer_id) ??
          text(customer.id) ??
          text(charge.customer_id) ??
          fallbackCustomerId,
        plan,
        paidAt: text(data.completed_at),
      }
    }

    if (type === 'collection.failed') {
      const customer = record(data.customer) ? data.customer : {}
      return {
        checkoutId,
        chargeId: text(data.charge_id),
        reference,
        status: 'failed',
        statusDetail: text(data.status),
        amount: amountMajor(data.amount),
        currency: text(data.currency),
        customerId: text(customer.id) ?? text(customer.customer_id) ?? fallbackCustomerId,
        plan,
        paidAt: null,
      }
    }

    if (type === 'checkout.expired') {
      return {
        checkoutId,
        chargeId: null,
        reference,
        status: 'expired',
        statusDetail: text(data.status),
        amount: amountMajor(data.amount),
        currency: text(data.currency),
        customerId: fallbackCustomerId,
        plan,
        paidAt: null,
      }
    }

    if (type === 'refund.paid') {
      return {
        checkoutId: null,
        chargeId: text(data.charge_id),
        reference: null,
        status: 'refunded',
        statusDetail: text(data.status),
        amount: amountMajor(data.refunded_amount ?? data.requested_amount),
        currency: null,
        customerId: null,
        plan: null,
        paidAt: null,
      }
    }

    if (type === 'dispute.created' || type === 'dispute.updated') {
      return {
        checkoutId: null,
        chargeId: text(data.charge_id),
        reference: null,
        status: 'disputed',
        statusDetail: text(data.status),
        amount: amountMajor(data.charge_amount ?? data.amount),
        currency: text(data.charge_currency ?? data.currency),
        customerId: null,
        plan: null,
        paidAt: null,
      }
    }

    return null
  }

  subscriptionFromEvent(event: WebhookEvent): ProviderSubscription | null {
    return event.providerSubscription
  }
}
