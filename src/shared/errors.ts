/**
 * The error taxonomy. Every failure site declares its class; the type system
 * refuses to mix them. INTERNAL failures are logged and rendered as nothing.
 */
import type { MessageClass } from './copy'
import { copy, INTERNAL, USER_ACTION } from './copy'

export interface ClassifiedMessage {
  kind: MessageClass
  /** Registry id, never free text. */
  copyId: string
}

/** The user can act now: inline at the element, with the specific next step. */
export function userAction(copyId: string): ClassifiedMessage {
  return { kind: USER_ACTION, copyId }
}

/** Internal failure: safe text for logs only; nothing is rendered to users. */
export function internal(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Renders a classified message. INTERNAL always renders nothing — there is
 * no code path that shows an internal failure to a user.
 */
export function renderMessage(message: ClassifiedMessage | null): string | null {
  if (!message || message.kind === INTERNAL) return null
  return copy(message.copyId)
}

/**
 * Maps a thrown value to a copy id. Unknown failures are INTERNAL: they are
 * logged and the caller renders nothing — never error.message.
 */
export function classify(error: unknown, fallbackCopyId: string): ClassifiedMessage {
  const payload = error as { error?: unknown; message?: unknown } | null
  // Server-curated copy (e.g. quota notices) is allowed when the payload
  // explicitly names a known class; everything else is internal.
  if (payload && typeof payload.error === 'string' && payload.error === 'quota_exceeded') {
    return userAction('apply.failed')
  }
  void fallbackCopyId
  return { kind: INTERNAL, copyId: 'internal' }
}
