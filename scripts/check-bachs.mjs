/**
 * Safe Bachs readiness check for the deployment job.
 *
 * Read-only checks run whenever a Bachs secret is present. Creating one
 * unpaid checkout is opt-in because it creates a real, expiring checkout and
 * may create a Bachs customer record. This script prints only HTTP status,
 * stable error codes, field names, request ids and checkout-setting flags.
 * It never prints the API key, a request body or a raw provider response.
 */

const secret = (process.env.BACHS_SECRET_KEY ?? '').replace(/\s+/g, '')
const createProbe = process.env.BACHS_DIAGNOSTIC_CREATE_CHECKOUT === '1'
const environment = secret.startsWith('sk_live_')
  ? 'production'
  : secret.startsWith('sk_sandbox_')
    ? 'sandbox'
    : null
const baseUrl =
  environment === 'production'
    ? 'https://api.bachs.io'
    : environment === 'sandbox'
      ? 'https://sandbox-api.bachs.io'
      : null

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeCode(value) {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9_.-]{1,100}$/.test(code) ? code : null
}

function safeRequestId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(id) ? id : null
}

function safeFieldNames(value) {
  if (!Array.isArray(value)) return []
  const names = []
  for (const item of value) {
    const candidate = isRecord(item) ? (item.field ?? item.path ?? item.param ?? item.name) : item
    if (typeof candidate !== 'string') continue
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(candidate)) continue
    if (!names.includes(candidate)) names.push(candidate)
    if (names.length >= 10) break
  }
  return names
}

function unwrap(body) {
  return isRecord(body) && isRecord(body.data) ? body.data : body
}

async function bachs(path, init = {}) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    return {
      ok: response.ok,
      status: response.status,
      requestId: safeRequestId(response.headers.get('x-request-id')),
      body,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      requestId: null,
      body: null,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }
  }
}

function printFailure(label, result) {
  const body = isRecord(result.body) ? result.body : {}
  console.log(
    `${label}: ${JSON.stringify({
      ok: false,
      httpStatus: result.status || null,
      errorCode: safeCode(body.error_code ?? body.errorCode ?? body.code),
      fieldNames: safeFieldNames(body.errors ?? body.fieldErrors),
      requestId: result.requestId,
      errorName: result.errorName ?? null,
    })}`,
  )
}

function methodEnabled(settings, method) {
  const methods = isRecord(settings.enabled_payment_methods) ? settings.enabled_payment_methods : {}
  const entry = methods[method]
  if (typeof entry === 'boolean') return entry
  if (isRecord(entry) && typeof entry.enabled === 'boolean') return entry.enabled
  return null
}

function methodCurrencies(settings, method) {
  const currencies = isRecord(settings.available_currencies) ? settings.available_currencies : {}
  const values = currencies[method]
  if (!Array.isArray(values)) return []
  return values.filter((value) => typeof value === 'string' && /^[A-Z0-9_]{2,20}$/.test(value))
}

function safeFeePreference(value) {
  return value === 'customer_pays' || value === 'org_pays' ? value : null
}

if (!secret || !environment || !baseUrl) {
  console.log('Bachs diagnostic skipped: no usable Bachs secret key is configured.')
  if (createProbe) process.exitCode = 1
} else {
  console.log(`Bachs diagnostic environment: ${environment}`)

  const settingsResult = await bachs('/v1/accounts/checkout/settings')
  if (settingsResult.ok) {
    const settings = unwrap(settingsResult.body)
    const summary = isRecord(settings)
      ? {
          ok: true,
          organizationPresent: typeof settings.organization_id === 'string',
          ngnCardEnabled: methodEnabled(settings, 'NGN_CARD'),
          ngnBankTransferEnabled: methodEnabled(settings, 'NGN_BANK_TRANSFER'),
          ngnCardCurrencies: methodCurrencies(settings, 'NGN_CARD'),
          ngnBankTransferCurrencies: methodCurrencies(settings, 'NGN_BANK_TRANSFER'),
          feePreference: safeFeePreference(settings.fee_preference),
        }
      : { ok: false, reason: 'unexpected_response_shape' }
    console.log(`Bachs checkout settings: ${JSON.stringify(summary)}`)
    if (summary.ok && summary.ngnCardEnabled !== true && summary.ngnBankTransferEnabled !== true) {
      console.log(
        '::error title=Bachs NGN checkout::Neither NGN_CARD nor NGN_BANK_TRANSFER is enabled in Bachs checkout settings.',
      )
    }
    if (summary.ok && summary.feePreference === 'customer_pays') {
      console.log(
        '::warning title=Bachs fee preference::Bachs is set to customer_pays, so its processing fee is added on top of the FJ price. Use org_pays if the FJ price must be the final customer amount.',
      )
    }
  } else {
    printFailure('Bachs checkout settings', settingsResult)
  }

  const paymentsResult = await bachs('/v1/payments?limit=1')
  if (paymentsResult.ok) {
    const payments = unwrap(paymentsResult.body)
    const pagination = isRecord(payments?.pagination) ? payments.pagination : {}
    console.log(
      `Bachs payments read: ${JSON.stringify({
        ok: true,
        returned: Number.isFinite(pagination.returned) ? pagination.returned : null,
        total: Number.isFinite(pagination.total) ? pagination.total : null,
      })}`,
    )
  } else {
    printFailure('Bachs payments read', paymentsResult)
  }

  if (createProbe) {
    const origin = (process.env.FJ_ORIGIN || 'https://fj-find-jobs.pages.dev').replace(/\/$/, '')
    const reference = `fj_diagnostic_${Date.now()}_${crypto.randomUUID().replaceAll('-', '')}`
    const checkoutResult = await bachs('/v1/checkout-sessions', {
      method: 'POST',
      headers: { 'idempotency-key': reference },
      body: JSON.stringify({
        pricing: { currency: 'NGN', amount: '3000.00' },
        reference,
        customer: { email: 'checkout-diagnostic@example.com', name: 'FJ diagnostic' },
        payment_method_types: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
        success_url: `${origin}/dashboard?tab=plan&billing=checking`,
        cancel_url: `${origin}/pricing?billing=cancelled`,
        metadata: { diagnostic: 'fj_checkout_probe' },
        expires_in_minutes: 5,
      }),
    })
    if (checkoutResult.ok) {
      const checkout = unwrap(checkoutResult.body)
      let checkoutHost = null
      try {
        checkoutHost = new URL(String(checkout?.checkout_url ?? '')).hostname
      } catch {
        checkoutHost = null
      }
      const summary = {
        ok: true,
        checkoutIdPresent: typeof checkout?.checkout_id === 'string',
        checkoutHost,
        referenceMatches: checkout?.reference === reference,
        status: typeof checkout?.status === 'string' ? checkout.status : null,
        expiresAt: typeof checkout?.expires_at === 'string' ? checkout.expires_at : null,
      }
      console.log(`Bachs unpaid checkout probe: ${JSON.stringify(summary)}`)
      if (!summary.checkoutIdPresent || !summary.checkoutHost || !summary.referenceMatches) {
        process.exitCode = 1
      }
    } else {
      printFailure('Bachs unpaid checkout probe', checkoutResult)
      process.exitCode = 1
    }
  } else {
    console.log('Bachs unpaid checkout probe skipped: it was not explicitly enabled.')
  }
}
