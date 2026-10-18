/**
 * Bindings available to the API. Everything is optional on purpose: the local
 * preview runs with a local D1 database and no AI binding, and the production
 * Pages deployment adds bindings later.
 */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>
}

export interface Env {
  DB?: D1Database
  AI?: AiBinding
  /** The queue that ingestion work is spread across. */
  INGEST_QUEUE?: Queue
  APP_MODE?: string
  TELEGRAM_BOT_USERNAME?: string

  // Cloudflare Access (identity)
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string

  // Telegram
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string

  // Payments
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_PRO?: string

  // Ingestion
  JOB_SOURCE_FETCH?: string
}

export const DEFAULT_APP_MODE = 'preview'

/**
 * Request-scoped values the middleware chain attaches to the context.
 */
export interface AppVariables {
  requestId: string
  userId: string
}

export type AppEnv = {
  Bindings: Env
  Variables: AppVariables
}
