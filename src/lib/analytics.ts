/**
 * Product analytics (Prompt 14). Exactly five events, no personal data of any
 * kind: no names, no emails, no user ids, no IP addresses. Payloads carry
 * content ids and search words only, and are batched before sending.
 */

export type AnalyticsEvent = 'search' | 'job_view' | 'save' | 'apply_start' | 'apply_complete'

interface AnalyticsPayload {
  event: AnalyticsEvent
  /** Optional content reference — a job id or search words. Never a person. */
  ref?: string
}

const queue: AnalyticsPayload[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
  if (!queue.length) return
  const batch = queue.splice(0, queue.length)
  void fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: batch }),
    keepalive: true,
  }).catch(() => {
    // Analytics must never break the product; drop silently.
  })
}

export function track(event: AnalyticsEvent, ref?: string): void {
  if (import.meta.env.MODE === 'test') return
  queue.push(ref ? { event, ref: ref.slice(0, 120) } : { event })
  if (queue.length >= 10) {
    flush()
    return
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 5000)
}
