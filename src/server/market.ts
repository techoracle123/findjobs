import type { Job } from '../shared/types'

/**
 * In-market definition (Prompt 16): a listing is in-market when it is either
 *
 *  1. based in Nigeria (any work mode), or
 *  2. remote work that is open to Nigeria — remote with no country restriction
 *     or with a restriction that includes Nigeria.
 *
 * A remote listing that names only other countries is NOT in-market. This is
 * the definition every count, filter and health metric uses.
 */

const NG = 'NG'

function countryOf(job: Job): string {
  return (job.locationCountry ?? '').toUpperCase()
}

/** True when a remote listing's country restriction includes Nigeria. */
export function remoteOpenToNigeria(job: Job): boolean {
  const country = countryOf(job)
  if (!country) return true // no restriction stated → open
  if (country === 'WORLDWIDE' || country === 'ANY' || country === 'WW') return true
  // A restriction is a comma-separated allowlist in the country field when set.
  return country
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .includes(NG)
}

export function isInMarket(job: Job): boolean {
  if (countryOf(job) === NG) return true
  return job.workMode === 'remote' && remoteOpenToNigeria(job)
}

/** Measurement helper: share of a list that is in-market. */
export function inMarketShare(jobs: Job[]): number {
  if (!jobs.length) return 0
  return jobs.filter(isInMarket).length / jobs.length
}
