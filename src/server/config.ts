import type { Env } from './env'
import type { BillingProviderId } from './billing/types'
import { hasConfiguredEmailProvider } from './email/provider'

export interface TelegramConfig {
  botToken: string | null
  botUsername: string | null
}

export interface StripeConfig {
  secretKey: string | null
  webhookSecret: string | null
  pricePro: string | null
}

export interface PaystackConfig {
  secretKey: string | null
}

export interface FlutterwaveConfig {
  secretKey: string | null
  /** The secret hash Flutterwave echoes back in `verif-hash`. */
  webhookSecret: string | null
}

export interface BachsConfig {
  secretKey: string | null
  webhookSecret: string | null
}

export interface BillingConfig {
  /**
   * Which gateway to use. Set it explicitly with `BILLING_PROVIDER`; when it
   * is not set the provider is inferred from whichever credentials are
   * present, and when none are it the fake provider, which never charges.
   */
  provider: BillingProviderId
  /** The currency the plan is priced and settled in. */
  currency: string
  /** The price of the paid plan, in major units. */
  pricePro: number
  /** Graduate-tier monthly price, in major units. */
  priceGraduate: number
  /** Annual price, in major units. */
  priceAnnual: number
  stripe: StripeConfig
  paystack: PaystackConfig
  flutterwave: FlutterwaveConfig
  bachs: BachsConfig
}

export interface AppConfig {
  appMode: string
  isProduction: boolean
  isStaging: boolean
  isTest: boolean
  isLocal: boolean
  /** True when a real email provider can send password reset emails. */
  emailConfigured: boolean
  telegram: TelegramConfig
  billing: BillingConfig
  /** True only when a Workers AI binding is actually present. */
  aiEnabled: boolean
  /** How many AI calls one account may make in a day. */
  aiDailyLimit: number
  /** How many AI calls the whole deployment may make in a day. */
  aiGlobalDailyLimit: number
  /**
   * Whether ingestion may make outbound calls to job sources. Disabled by
   * default in test and local modes so runs are deterministic and offline.
   */
  allowLiveSourceFetch: boolean
}

function flag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * API keys never contain whitespace. Remove accidental spaces or line breaks
 * copied into a secret before the key is sent in an Authorization header.
 */
function cleanApiKey(value: string | undefined): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, '')
  return cleaned ? cleaned : null
}

/** Webhook signing secrets are only end-trimmed; their middle is left alone. */
function cleanSecret(value: string | undefined): string | null {
  const cleaned = (value ?? '').trim()
  return cleaned ? cleaned : null
}

const PROVIDERS: BillingProviderId[] = ['fake', 'stripe', 'paystack', 'flutterwave', 'bachs']

/**
 * Works out which gateway to use.
 *
 * An explicit `BILLING_PROVIDER` always wins. Without one, the provider is
 * inferred from the credentials that are present, so dropping a Paystack key
 * into the environment is enough to switch over.
 */
export function resolveProvider(env: Env): BillingProviderId {
  const requested = (env.BILLING_PROVIDER ?? '').trim().toLowerCase()
  if (requested && (PROVIDERS as string[]).includes(requested)) {
    return requested as BillingProviderId
  }
  if (cleanApiKey(env.BACHS_SECRET_KEY) && cleanSecret(env.BACHS_WEBHOOK_SECRET)) return 'bachs'
  if (cleanApiKey(env.PAYSTACK_SECRET_KEY)) return 'paystack'
  if (cleanApiKey(env.FLUTTERWAVE_SECRET_KEY)) return 'flutterwave'
  if (cleanApiKey(env.STRIPE_SECRET_KEY)) return 'stripe'
  return 'fake'
}

/**
 * Reads and normalises the environment once per request. Every integration
 * reports itself as configured or not, so the UI can be honest about what is
 * actually connected rather than guessing.
 */
export function readConfig(env: Env): AppConfig {
  const appMode = env.APP_MODE || 'preview'
  const isTest = appMode === 'test'
  const isLocal = appMode === 'local-preview' || appMode === 'local'

  return {
    appMode,
    isProduction: appMode === 'production',
    isStaging: appMode === 'staging',
    isTest,
    isLocal,
    emailConfigured: hasConfiguredEmailProvider(env),
    telegram: {
      botToken: cleanApiKey(env.TELEGRAM_BOT_TOKEN),
      botUsername: (env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '') || null,
    },
    billing: {
      provider: resolveProvider(env),
      currency: (env.BILLING_CURRENCY || 'NGN').trim().toUpperCase().slice(0, 3),
      pricePro: number(env.BILLING_PRICE_PRO, 5000),
      priceGraduate: number(env.BILLING_PRICE_GRADUATE, 3000),
      priceAnnual: number(env.BILLING_PRICE_ANNUAL, 40000),
      stripe: {
        secretKey: cleanApiKey(env.STRIPE_SECRET_KEY),
        webhookSecret: cleanSecret(env.STRIPE_WEBHOOK_SECRET),
        pricePro: cleanSecret(env.STRIPE_PRICE_PRO),
      },
      paystack: {
        secretKey: cleanApiKey(env.PAYSTACK_SECRET_KEY),
      },
      flutterwave: {
        secretKey: cleanApiKey(env.FLUTTERWAVE_SECRET_KEY),
        webhookSecret: cleanSecret(env.FLUTTERWAVE_WEBHOOK_SECRET),
      },
      bachs: {
        secretKey: cleanApiKey(env.BACHS_SECRET_KEY),
        webhookSecret: cleanSecret(env.BACHS_WEBHOOK_SECRET),
      },
    },
    aiEnabled: Boolean(env.AI || env.OPENROUTER_API_KEY),
    aiDailyLimit: number(env.AI_DAILY_LIMIT, 20),
    aiGlobalDailyLimit: number(env.AI_GLOBAL_DAILY_LIMIT, 1000),
    allowLiveSourceFetch: flag(env.JOB_SOURCE_FETCH) && !isTest,
  }
}

export function emailConfigured(config: AppConfig): boolean {
  return config.emailConfigured
}

export function telegramConfigured(config: AppConfig): boolean {
  return Boolean(config.telegram.botToken && config.telegram.botUsername)
}
