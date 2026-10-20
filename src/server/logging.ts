export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  userId?: string
  [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const configured =
    (globalThis as { __LOG_LEVEL__?: string }).__LOG_LEVEL__ ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.LOG_LEVEL
  return LEVEL_ORDER[(configured as LogLevel) ?? 'info'] ?? LEVEL_ORDER.info
}

/**
 * Structured, single-line JSON logging. Cloudflare's log tail reads these
 * cleanly, and structured fields can be queried rather than grepped.
 */
export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < threshold()) return

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  })

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
}
