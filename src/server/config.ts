import type { Env } from './env'

export interface AccessConfig {
  /** The Access team domain, e.g. "myteam.cloudflareaccess.com". */
  teamDomain: string | null
  /** The Access application AUD tag that tokens must be issued for. */
  aud: string | null
}

export interface TelegramConfig {
  botToken: string | null
  botUsername: string | null
}

export interface StripeConfig {
  secretKey: string | null
  webhookSecret: string | null
  pricePro: string | null
}

export interface AppConfig {
  appMode: string
  isProduction: boolean
  isStaging: boolean
  isTest: boolean
  isLocal: boolean
  access: AccessConfig
  telegram: TelegramConfig
  stripe: StripeConfig
  /** True only when a Workers AI binding is actually present. */
  aiEnabled: boolean
  /**
   * Whether ingestion may make outbound calls to job sources. Disabled by
   * default in test and local modes so runs are deterministic and offline.
   */
  allowLiveSourceFetch: boolean
}

function flag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
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
    access: {
      teamDomain: env.ACCESS_TEAM_DOMAIN ?? null,
      aud: env.ACCESS_AUD ?? null,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? null,
      botUsername: env.TELEGRAM_BOT_USERNAME || null,
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY ?? null,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
      pricePro: env.STRIPE_PRICE_PRO ?? null,
    },
    aiEnabled: Boolean(env.AI),
    allowLiveSourceFetch: flag(env.JOB_SOURCE_FETCH) && !isTest,
  }
}

export function accessConfigured(config: AppConfig): boolean {
  return Boolean(config.access.teamDomain && config.access.aud)
}

export function telegramConfigured(config: AppConfig): boolean {
  return Boolean(config.telegram.botToken && config.telegram.botUsername)
}

export function stripeConfigured(config: AppConfig): boolean {
  return Boolean(config.stripe.secretKey && config.stripe.webhookSecret && config.stripe.pricePro)
}
