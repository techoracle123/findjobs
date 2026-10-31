/**
 * Bindings available to the API. Everything is optional on purpose: the local
 * preview runs with a local D1 database and no AI binding, and the production
 * Pages deployment adds bindings later.
 */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>
}

export interface Env {
  PUBLIC_JOBS?: KVNamespace
  PUBLIC_FEED_ONLY?: string
  DB?: D1Database
  AI?: AiBinding
  /** Encrypted server-side secret; never expose to the client bundle. */
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  /** The queue that ingestion work is spread across. */
  INGEST_QUEUE?: Queue
  APP_MODE?: string
  TELEGRAM_BOT_USERNAME?: string
  /** Comma-separated verified Access emails allowed on /api/admin/*. */
  ADMIN_EMAILS?: string
  /** Password reset emails are sent through Brevo or Resend REST when set. */
  BREVO_API_KEY?: string
  /** Optional Brevo-only sender; EMAIL_FROM is the usual shared secret. */
  BREVO_SENDER_EMAIL?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  /** Alias for EMAIL_FROM, accepted so either secret name works. */
  OTP_FROM?: string
  /** Shared secret for the full /api/health readiness report. */
  HEALTH_CHECK_KEY?: string

  // Cloudflare Access (identity)

  // Telegram
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string

  // Payments
  /** fake | stripe | paystack | flutterwave. Inferred from the keys when unset. */
  BILLING_PROVIDER?: string
  /** Bachs gateway (Prompts 4/7). Secret stays server-side; never in the bundle. */
  BACHS_SECRET_KEY?: string
  BACHS_WEBHOOK_SECRET?: string
  /** Global affiliate payout kill switch: '1' (or unset with no approvals) blocks payouts. */
  PAYOUT_KILL_SWITCH?: string
  /** The currency the plan is priced and settled in. */
  BILLING_CURRENCY?: string
  /** The price of the paid plan, in major units. */
  BILLING_PRICE_PRO?: string
  BILLING_PRICE_GRADUATE?: string
  BILLING_PRICE_ANNUAL?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_PRO?: string
  PAYSTACK_SECRET_KEY?: string
  FLUTTERWAVE_SECRET_KEY?: string
  /** The secret hash Flutterwave echoes back in the verif-hash header. */
  FLUTTERWAVE_WEBHOOK_SECRET?: string

  // AI budget
  /** How many AI calls one account may make in a day. */
  AI_DAILY_LIMIT?: string
  /** How many AI calls the whole deployment may make in a day. */
  AI_GLOBAL_DAILY_LIMIT?: string

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
