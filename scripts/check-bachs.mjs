/**
 * Safe Bachs readiness check for the deployment job.
 *
 * Read-only checks run whenever a Bachs secret is present. The unpaid
 * checkout probe is opt-in. It tries the current FJ request first, then
 * narrower variants that separate customer-scope and payment-method
 * restriction failures. It stops at the first checkout Bachs accepts; every
 * accepted probe is a real, expiring, unpaid checkout and customer variants
 * may create a Bachs customer record. This script prints and annotates only
 * HTTP status, stable error codes, field names, request ids and
 * checkout-setting flags. It never prints the API key, a request body or a
 * raw provider response.
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

function annotation(level, title, value) {
  const message = typeof value === 'string' ? value : JSON.stringify(value)
  const safe = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  console.log(`::${level} title=${title}::${safe}`)
}

function safeFailure(result) {
  const body = isRecord(result.body) ? result.body : {}
  return {
    ok: false,
    httpStatus: result.status || null,
    errorCode: safeCode(body.error_code ?? body.errorCode ?? body.code),
    fieldNames: safeFieldNames(body.errors ?? body.fieldErrors),
    requestId: result.requestId,
    errorName: result.errorName ?? null,
  }
}

function printFailure(label, result) {
  const failure = safeFailure(result)
  console.log(`${label}: ${JSON.stringify(failure)}`)
  annotation('warning', label, failure)
  return failure
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

function enabledMethods(settings) {
  const methods = isRecord(settings.enabled_payment_methods) ? settings.enabled_payment_methods : {}
  return Object.entries(methods)
    .filter(([method]) => /^[A-Z0-9_]{2,40}$/.test(method) && methodEnabled(settings, method))
    .map(([method]) => method)
}

function safeTopLevelKeys(value) {
  if (!isRecord(value)) return []
  return Object.keys(value)
    .filter((key) => /^[A-Za-z0-9_.-]{1,80}$/.test(key))
    .slice(0, 30)
}

function listSummary(body) {
  const value = unwrap(body)
  const records = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : Array.isArray(value?.items)
        ? value.items
        : null
  const pagination = isRecord(value?.pagination) ? value.pagination : {}
  return {
    ok: true,
    returned: records
      ? records.length
      : Number.isFinite(pagination.returned)
        ? pagination.returned
        : null,
    total: Number.isFinite(pagination.total) ? pagination.total : null,
    responseKeys: safeTopLevelKeys(isRecord(body) ? body : {}),
  }
}

if (!secret || !environment || !baseUrl) {
  console.log('Bachs diagnostic skipped: no usable Bachs secret key is configured.')
  annotation('warning', 'Bachs diagnostic skipped', {
    reason: 'no_usable_secret_key',
    checkoutProbeRequested: createProbe,
  })
  if (createProbe) process.exitCode = 1
} else {
  console.log(`Bachs diagnostic environment: ${environment}`)
  annotation('notice', 'Bachs diagnostic environment', { environment })

  const settingsResult = await bachs('/v1/accounts/checkout/settings')
  if (settingsResult.ok) {
    const settings = unwrap(settingsResult.body)
    const summary = isRecord(settings)
      ? {
          ok: true,
          organizationPresent: typeof settings.organization_id === 'string',
          enabledMethods: enabledMethods(settings),
          ngnCardEnabled: methodEnabled(settings, 'NGN_CARD'),
          ngnBankTransferEnabled: methodEnabled(settings, 'NGN_BANK_TRANSFER'),
          ngnCardCurrencies: methodCurrencies(settings, 'NGN_CARD'),
          ngnBankTransferCurrencies: methodCurrencies(settings, 'NGN_BANK_TRANSFER'),
          feePreference: safeFeePreference(settings.fee_preference),
          responseKeys: safeTopLevelKeys(settings),
        }
      : { ok: false, reason: 'unexpected_response_shape' }
    console.log(`Bachs checkout settings: ${JSON.stringify(summary)}`)
    annotation('notice', 'Bachs checkout settings', summary)
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
    const summary = listSummary(paymentsResult.body)
    console.log(`Bachs payments read: ${JSON.stringify(summary)}`)
    annotation('notice', 'Bachs payments read', summary)
  } else {
    printFailure('Bachs payments read', paymentsResult)
  }

  const customersResult = await bachs('/v1/customers?limit=1')
  if (customersResult.ok) {
    const summary = listSummary(customersResult.body)
    console.log(`Bachs customers read: ${JSON.stringify(summary)}`)
    annotation('notice', 'Bachs customers read', summary)
  } else {
    printFailure('Bachs customers read', customersResult)
  }

  if (createProbe) {
    const origin = (process.env.FJ_ORIGIN || 'https://fj-find-jobs.pages.dev').replace(/\/$/, '')
    const variants = [
      {
        id: 'fj_current_customer_both_methods',
        customer: true,
        paymentMethodTypes: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
      },
      { id: 'fj_customer_account_default_methods', customer: true },
      {
        id: 'fj_customer_bank_transfer_only',
        customer: true,
        paymentMethodTypes: ['NGN_BANK_TRANSFER'],
      },
      { id: 'fj_customer_card_only', customer: true, paymentMethodTypes: ['NGN_CARD'] },
      {
        id: 'fj_guest_both_methods',
        customer: false,
        paymentMethodTypes: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
      },
      { id: 'fj_guest_account_default_methods', customer: false },
      { id: 'fj_minimal_raw_price', customer: false, minimal: true },
    ]
    const stopCodes = new Set([
      'ACCOUNT_NOT_ACTIVATED',
      'ACCOUNT_PAYMENT_METHODS_RESTRICTED',
      'UNAUTHORIZED',
    ])
    let probeSucceeded = false

    for (const variant of variants) {
      const reference =
        `fj_probe_${variant.id}_${Date.now()}_${crypto.randomUUID().replaceAll('-', '')}`.slice(
          0,
          120,
        )
      const body = variant.minimal
        ? { pricing: { currency: 'NGN', amount: '5000.00' }, reference }
        : {
            pricing: { currency: 'NGN', amount: '5000.00' },
            reference,
            ...(variant.customer
              ? {
                  customer: {
                    email: 'checkout-diagnostic@example.com',
                    name: 'FJ diagnostic',
                  },
                }
              : {}),
            ...(variant.paymentMethodTypes
              ? { payment_method_types: variant.paymentMethodTypes }
              : {}),
            success_url: `${origin}/dashboard?tab=plan&billing=checking`,
            cancel_url: `${origin}/pricing?billing=cancelled`,
            metadata: { diagnostic: 'fj_checkout_probe', variant: variant.id },
            expires_in_minutes: 5,
          }
      const checkoutResult = await bachs('/v1/checkout-sessions', {
        method: 'POST',
        headers: { 'idempotency-key': reference },
        body: JSON.stringify(body),
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
          variant: variant.id,
          checkoutIdPresent: typeof checkout?.checkout_id === 'string',
          checkoutHost,
          referenceMatches: checkout?.reference === reference,
          status: typeof checkout?.status === 'string' ? checkout.status : null,
          expiresAt: typeof checkout?.expires_at === 'string' ? checkout.expires_at : null,
          responseKeys: safeTopLevelKeys(isRecord(checkout) ? checkout : {}),
        }
        console.log(`Bachs unpaid checkout probe: ${JSON.stringify(summary)}`)
        annotation('notice', 'Bachs unpaid checkout probe', summary)
        probeSucceeded =
          summary.checkoutIdPresent && Boolean(summary.checkoutHost) && summary.referenceMatches
        if (!probeSucceeded) {
          annotation('error', 'Bachs unpaid checkout probe response', summary)
        }
        break
      }

      const failure = printFailure('Bachs unpaid checkout probe', checkoutResult)
      annotation('warning', 'Bachs checkout probe variant failed', {
        variant: variant.id,
        ...failure,
      })
      if (failure.errorCode && stopCodes.has(failure.errorCode)) break
    }

    if (!probeSucceeded) {
      annotation('error', 'Bachs unpaid checkout probe failed', {
        ok: false,
        variantsTried: variants.map((variant) => variant.id),
      })
      process.exitCode = 1
    }
  } else {
    console.log('Bachs unpaid checkout probe skipped: it was not explicitly enabled.')
  }
}
