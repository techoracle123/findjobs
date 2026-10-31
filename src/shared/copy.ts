/**
 * Message hygiene: every user-facing status, error and action string lives
 * here, with the class of failure it belongs to. Internal failures never
 * render; degraded state is quiet; only what the user can act on is loud.
 */

export type MessageClass = 'USER_ACTION' | 'DEGRADED' | 'INTERNAL'

/** USER_ACTION: the user can fix it now, show inline with a next step. */
export const USER_ACTION: MessageClass = 'USER_ACTION'
/** DEGRADED: the app still works; something is stale. Quiet and dismissible. */
export const DEGRADED: MessageClass = 'DEGRADED'
/** INTERNAL: our failure. Log it. Render nothing. Ever. */
export const INTERNAL: MessageClass = 'INTERNAL'

export interface CopyEntry {
  id: string
  text: string
  className: MessageClass
  where: string
  /** Legal or mandated disclosure, named parties are allowed here only. */
  legal?: boolean
}

const entries: CopyEntry[] = [
  // ── Sync (USER_ACTION at the element, never a page-top alert) ──
  {
    id: 'sync.pending',
    text: 'Not saved yet. We will keep trying.',
    className: USER_ACTION,
    where: 'Save/apply controls',
  },
  {
    id: 'sync.failed',
    text: 'We couldn’t save that. Try again.',
    className: USER_ACTION,
    where: 'Save/apply controls',
  },
  // ── Stale data (DEGRADED: quiet, near the data) ──
  {
    id: 'stale.24h',
    text: 'Some listings may be more than 1 day old.',
    className: DEGRADED,
    where: 'Results meta row',
  },
  // ── Auth (DEGRADED: no vendor, no empty promises) ──
  {
    id: 'auth.unavailable',
    text: 'Sign-in is temporarily unavailable. Please try again in a few minutes.',
    className: DEGRADED,
    where: 'Auth pages',
  },
  {
    id: 'auth.sendFailed',
    text: 'We couldn’t send the code. Please try again in a minute.',
    className: USER_ACTION,
    where: 'Auth pages',
  },
  {
    id: 'auth.rateLimited',
    text: 'Too many codes requested. Wait about 10 minutes, then try again. Check your spam folder for the last one.',
    className: USER_ACTION,
    where: 'Auth pages',
  },
  {
    id: 'auth.codeInvalid',
    text: 'That code doesn’t match. Check the latest email and try again.',
    className: USER_ACTION,
    where: 'Auth pages',
  },
  {
    id: 'auth.codeExpired',
    text: 'That code has expired. Request a new one.',
    className: USER_ACTION,
    where: 'Auth pages',
  },
  {
    id: 'auth.codeUsed',
    text: 'That code was already used. Request a new one.',
    className: USER_ACTION,
    where: 'Auth pages',
  },
  {
    id: 'auth.signedOut',
    text: 'You are signed out. Your saved jobs stay on this device.',
    className: DEGRADED,
    where: 'Auth pages',
  },
  // ── Caution banner: suppressed until the model improves (see C4) ──
  {
    id: 'trust.caution',
    text: 'We can’t confirm this employer yet. Never pay to apply. Report anything that asks you for money.',
    className: USER_ACTION,
    where: 'Job cards and detail (suppressed until caution share < 20%)',
  },
  {
    id: 'trust.thirdParty',
    text: 'This listing is published by a third party. Verify before you apply.',
    className: DEGRADED,
    where: 'External apply point',
  },
  {
    id: 'trust.neverPay',
    text: 'FJ never asks you to pay for a job or an application.',
    className: USER_ACTION,
    where: 'External apply interstitial',
  },
  // ── Reads and writes (USER_ACTION with a retry) ──
  {
    id: 'jobs.unavailable',
    text: 'We couldn’t load jobs. Please try again.',
    className: USER_ACTION,
    where: 'Browse page',
  },
  {
    id: 'jobs.empty',
    text: 'No roles match. Try loosening a filter or clearing your search.',
    className: USER_ACTION,
    where: 'Browse page',
  },
  {
    id: 'jobs.moreFailed',
    text: 'We couldn’t load more jobs. Please try again.',
    className: USER_ACTION,
    where: 'Browse page',
  },
  {
    id: 'cv.unreadable',
    text: 'We couldn’t read that file. Try a PDF, DOCX or plain text CV.',
    className: USER_ACTION,
    where: 'CV import',
  },
  {
    id: 'cv.needsNotice',
    text: 'Please confirm the AI notice below before uploading.',
    className: USER_ACTION,
    where: 'CV import',
  },
  {
    id: 'cv.suggestFailed',
    text: 'We couldn’t prepare suggestions. Please try again.',
    className: USER_ACTION,
    where: 'CV import',
  },
  {
    id: 'advice.failed',
    text: 'We couldn’t prepare advice. Please try again.',
    className: USER_ACTION,
    where: 'Job detail',
  },
  {
    id: 'translation.failed',
    text: 'Translation is unavailable right now. The original description is shown.',
    className: DEGRADED,
    where: 'Job detail',
  },
  {
    id: 'apply.failed',
    text: 'Your application could not be sent. Try again.',
    className: USER_ACTION,
    where: 'Job detail',
  },
  {
    id: 'apply.sent',
    text: 'Your application has been sent to the employer.',
    className: USER_ACTION,
    where: 'Job detail',
  },
  {
    id: 'report.failed',
    text: 'We couldn’t send the report. Please try again.',
    className: USER_ACTION,
    where: 'Report dialog',
  },
  {
    id: 'report.received',
    text: 'Thank you. Your report is with our review team.',
    className: USER_ACTION,
    where: 'Report dialog',
  },
  {
    id: 'telegram.failed',
    text: 'We couldn’t open Telegram. Please try again.',
    className: USER_ACTION,
    where: 'Alerts panel',
  },
  {
    id: 'plan.failed',
    text: 'We couldn’t complete that request. Please try again.',
    className: USER_ACTION,
    where: 'Plan panel',
  },
  {
    id: 'admin.unavailable',
    text: 'This page could not load. Please try again.',
    className: USER_ACTION,
    where: 'Admin pages',
  },
  // ── Legally mandated disclosures: the only named-party copy. ──
  // (Empty today. Free CV matching runs on-device; optional saved-CV
  // analysis is handled inside FJ after explicit consent, so no additional
  // third-party processor is named here.)
]

export const COPY: Record<string, CopyEntry> = Object.fromEntries(
  entries.map((entry) => [entry.id, entry]),
)

export function copy(id: string): string {
  const entry = COPY[id]
  if (!entry) {
    // Unknown ids are an internal defect: log-shaped fallback, never a raw id.
    return 'Something went wrong. Please try again.'
  }
  return entry.text
}

export function copyEntry(id: string): CopyEntry | undefined {
  return COPY[id]
}
