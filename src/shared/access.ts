/**
 * Product-wide early-access policy. Keep this explicit and reversible: the
 * payment provider, reconciliation and paid-period records remain intact,
 * but no new checkout may open while access is free.
 */
export const PAYMENTS_PAUSED = true
export const PRO_FREE_FOR_ALL = true
export const FREE_ACCESS_MESSAGE =
  'Every current FJ tool is free for now. You cannot pay right now, and you do not need a card or a trial.'
