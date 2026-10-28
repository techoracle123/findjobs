/**
 * The bindings the worker tests run against.
 *
 * `Cloudflare.Env` is the hook the Workers types leave for a project to
 * declare its own bindings, and the test runtime exposes `env` with exactly
 * that type.
 */
export {}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      PUBLIC_JOBS?: KVNamespace
      ADMIN_EMAILS?: string
      HEALTH_CHECK_KEY?: string
      APP_MODE?: string
      TELEGRAM_BOT_USERNAME?: string
    }
  }
}
