import type { Job, JobStatus, VerificationLevel } from './types'

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  stale: 'Stale',
}

export const VERIFICATION_DESCRIPTIONS: Record<VerificationLevel, string> = {
  verified: "Read from the employer's own careers board, so the employer published it there.",
  unverified:
    'Found through a public listing. We have not been able to confirm it with the employer.',
  stale: 'We have not seen this listing in a recent refresh, so it may no longer be open.',
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  open: 'Open',
  closed: 'Closed',
  unknown: 'Status unknown',
}

export function verificationOf(job: Job): VerificationLevel {
  return job.verification ?? 'unverified'
}

export function statusOf(job: Job): JobStatus {
  return job.jobStatus ?? 'open'
}

export function isClosed(job: Job): boolean {
  return statusOf(job) === 'closed'
}

/** The link a person should follow to apply, when the source gave one. */
export function applyLinkOf(job: Job): string {
  return job.applyUrl || job.sourceUrl
}
