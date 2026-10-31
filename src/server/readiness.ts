import type { Env } from './env'
import { emailConfigured, readConfig, telegramConfigured } from './config'
import { hasRealProvider, providerFor } from './billing/provider'
import { planCatalogue } from './billing/pricing'
import { getRates } from './rates'

export type CheckStatus = 'ok' | 'missing' | 'warn'

export interface ReadinessCheck {
  id: string
  name: string
  status: CheckStatus
  /** Whether the deployment is not fit to run without this. */
  required: boolean
  detail: string
  /** What to do about it, in the words of whoever has to do it. */
  action: string | null
}

export interface ReadinessReport {
  ready: boolean
  appMode: string
  provider: string
  currency: string
  price: string
  checks: ReadinessCheck[]
  generatedAt: string
}

/**
 * The tables the application reads and writes. If one of them is missing the
 * deployment is running against an out-of-date database, which is worth
 * saying out loud rather than failing on the first request that needs it.
 */
const REQUIRED_TABLES = [
  'users',
  'profiles',
  'saved_jobs',
  'alerts',
  'subscriptions',
  'entitlements',
  'jobs',
  'sources',
  'source_postings',
  'ingestion_runs',
  'billing_events',
  'ai_usage',
  'job_translations',
  'job_advice_cache',
  'application_answers',
  'prepared_applications',
  'service_cache',
]

/**
 * A single place that says what is working and what is not.
 *
 * Every integration reports itself honestly: a missing key is reported as
 * missing rather than assumed to work, and the report says exactly which
 * environment variable to set. It is what the `doctor` command prints and
 * what an operator looks at before trusting a deployment.
 */
export async function buildReadiness(env: Env): Promise<ReadinessReport> {
  const config = readConfig(env)
  const checks: ReadinessCheck[] = []

  const production = config.isProduction

  /* ---------- storage ---------- */

  if (!env.DB) {
    checks.push({
      id: 'database',
      name: 'Database',
      status: 'missing',
      required: true,
      detail: 'No D1 database is bound to this deployment.',
      action: 'Bind a D1 database to the DB binding in wrangler.jsonc.',
    })
  } else {
    let tables: string[] = []
    let failed = false
    try {
      const result = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(
          () => '?',
        ).join(', ')})`,
      )
        .bind(...REQUIRED_TABLES)
        .all<{ name: string }>()
      tables = (result.results ?? []).map((row) => row.name)
    } catch {
      failed = true
    }

    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table))
    if (failed) {
      checks.push({
        id: 'database',
        name: 'Database',
        status: 'missing',
        required: true,
        detail: 'The bound database could not be queried.',
        action: 'Check that the D1 binding points at a database that exists.',
      })
    } else if (missing.length > 0) {
      checks.push({
        id: 'database',
        name: 'Database',
        status: 'missing',
        required: true,
        detail: `${missing.length} table(s) are missing: ${missing.slice(0, 6).join(', ')}.`,
        action:
          'Run "npm run db:migrate:local" locally, or "wrangler d1 migrations apply" on the account.',
      })
    } else {
      checks.push({
        id: 'database',
        name: 'Database',
        status: 'ok',
        required: true,
        detail: `All ${REQUIRED_TABLES.length} tables are present.`,
        action: null,
      })
    }
  }

  /* ---------- identity ---------- */

  if (emailConfigured(config)) {
    checks.push({
      id: 'identity',
      name: 'Sign-in email delivery',
      status: 'ok',
      required: production,
      detail: 'Password reset emails can be sent.',
      action: null,
    })
  } else {
    checks.push({
      id: 'identity',
      name: 'Sign-in email delivery',
      status: production ? 'missing' : 'warn',
      required: production,
      detail: 'No email provider is configured, so password reset emails cannot be sent yet.',
      action: 'Configure an email sending key and a verified sender address.',
    })
  }

  /* ---------- payments ---------- */

  const provider = providerFor(config)
  const billing = config.billing
  const plan = planCatalogue(config).find((candidate) => candidate.id === 'pro')
  const priceText = plan ? `${plan.price.amount} ${plan.price.currency}` : ''

  if (hasRealProvider(config)) {
    checks.push({
      id: 'billing',
      name: 'Payments',
      status: 'ok',
      required: false,
      detail: `The ${provider.id} provider is configured. The paid plan is ${priceText}.`,
      action: null,
    })
  } else {
    const missingKeys: string[] = []
    switch (billing.provider) {
      case 'paystack':
        if (!billing.paystack.secretKey) missingKeys.push('PAYSTACK_SECRET_KEY')
        break
      case 'flutterwave':
        if (!billing.flutterwave.secretKey) missingKeys.push('FLUTTERWAVE_SECRET_KEY')
        if (!billing.flutterwave.webhookSecret) missingKeys.push('FLUTTERWAVE_WEBHOOK_SECRET')
        break
      case 'stripe':
        if (!billing.stripe.secretKey) missingKeys.push('STRIPE_SECRET_KEY')
        if (!billing.stripe.webhookSecret) missingKeys.push('STRIPE_WEBHOOK_SECRET')
        if (!billing.stripe.pricePro) missingKeys.push('STRIPE_PRICE_PRO')
        break
      case 'fake':
        missingKeys.push('BILLING_PROVIDER (or a provider key)')
        break
    }
    checks.push({
      id: 'billing',
      name: 'Payments',
      status: 'warn',
      required: false,
      detail: `No payment provider is configured, so checkout is disabled and nobody can be charged.`,
      action:
        missingKeys.length > 0
          ? `Set ${missingKeys.join(' and ')}.`
          : 'Set a payment provider key.',
    })
  }

  /* ---------- telegram ---------- */

  if (telegramConfigured(config)) {
    checks.push({
      id: 'telegram',
      name: 'Telegram alerts',
      status: 'ok',
      required: false,
      detail: `The bot @${config.telegram.botUsername} is connected.`,
      action: null,
    })
  } else {
    checks.push({
      id: 'telegram',
      name: 'Telegram alerts',
      status: 'warn',
      required: false,
      detail: 'No Telegram bot is connected, so alerts are recorded but not delivered.',
      action: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME, then register the webhook.',
    })
  }

  /* ---------- sources ---------- */

  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sources WHERE enabled = 1',
      ).first<{ n: number }>()
      const count = Number(row?.n ?? 0)
      checks.push({
        id: 'sources',
        name: 'Job sources',
        status: count > 0 ? 'ok' : 'warn',
        required: false,
        detail:
          count > 0
            ? `${count} source(s) are enabled.`
            : 'No sources are enabled, so the feed will not grow.',
        action: count > 0 ? null : 'Enable the sources you have checked the terms of.',
      })
    } catch {
      checks.push({
        id: 'sources',
        name: 'Job sources',
        status: 'warn',
        required: false,
        detail: 'The source registry could not be read.',
        action: 'Run the migrations and enable the sources.',
      })
    }
  }

  /* ---------- queue ---------- */

  if (env.INGEST_QUEUE) {
    checks.push({
      id: 'queue',
      name: 'Ingestion queue',
      status: 'ok',
      required: false,
      detail: 'Ingestion work is spread across a Cloudflare Queue.',
      action: null,
    })
  } else {
    checks.push({
      id: 'queue',
      name: 'Ingestion queue',
      status: 'warn',
      required: false,
      detail: 'No queue is bound, so ingestion runs inline in the request.',
      action: 'Create a queue and bind it to INGEST_QUEUE to keep refreshes off the request path.',
    })
  }

  /* ---------- ai ---------- */

  if (config.aiEnabled) {
    checks.push({
      id: 'ai',
      name: 'AI extraction',
      status: 'ok',
      required: false,
      detail: `${env.OPENROUTER_API_KEY ? 'OpenRouter is configured' : 'The Workers AI binding is present'}. ${config.aiDailyLimit} analyses per account per day, ${config.aiGlobalDailyLimit} for the service.`,
      action: null,
    })
  } else {
    checks.push({
      id: 'ai',
      name: 'AI extraction',
      status: 'warn',
      required: false,
      detail: 'No AI binding is present, so CV text is read with keyword extraction.',
      action:
        'Set the encrypted OPENROUTER_API_KEY secret to enable translation, tailored tips and AI CV suggestions.',
    })
  }

  /* ---------- rates ---------- */

  const rates = await getRates(config.appMode !== 'test', env.DB)
  if (rates.source !== 'fallback') {
    checks.push({
      id: 'rates',
      name: 'Reference rates',
      status: 'ok',
      required: false,
      detail: `Live rates dated ${rates.date}.`,
      action: null,
    })
  } else {
    checks.push({
      id: 'rates',
      name: 'Reference rates',
      status: 'warn',
      required: false,
      detail:
        'Live exchange rates are unavailable. Salaries remain in the employer’s original currency.',
      action:
        'Check outbound access to open.er-api.com and api.frankfurter.app from this deployment.',
    })
  }

  const ready = checks.filter((check) => check.required).every((check) => check.status === 'ok')

  return {
    ready,
    appMode: config.appMode,
    provider: provider.id,
    currency: billing.currency,
    price: priceText,
    checks,
    generatedAt: new Date().toISOString(),
  }
}
