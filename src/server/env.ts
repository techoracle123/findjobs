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
  APP_MODE?: string
  TELEGRAM_BOT_USERNAME?: string
}

export const DEFAULT_APP_MODE = 'preview'
