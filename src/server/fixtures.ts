import demoData from './demo-jobs.json'
import type { EligibilityTier, Job, SalaryPeriod, Seniority, Sponsorship, WorkMode } from '../shared/types'

interface DemoJobRecord {
  id: string
  title: string
  company: string
  roleFamily: string
  seniority: Seniority
  workMode: WorkMode
  locationCountry: string
  locationLabel: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string
  salaryPeriod: SalaryPeriod
  description: string
  requiredSkills: string[]
  usefulSkills: string[]
  eligibleCountries: string[]
  sponsorship: Sponsorship
  sourceName: string
  sourceUrl: string
  postedDaysAgo: number
  isDemo: boolean
}

const records = (demoData as { jobs: DemoJobRecord[] }).jobs

const DAY_MS = 86_400_000

/**
 * Demo postings carry a relative age rather than a fixed timestamp, so the
 * freshness labels stay meaningful however long the preview has been running.
 */
export function demoPostedAt(daysAgo: number, now: number = Date.now()): string {
  return new Date(now - daysAgo * DAY_MS).toISOString()
}

export function toJob(record: DemoJobRecord, now: number = Date.now()): Job {
  return {
    id: record.id,
    title: record.title,
    company: record.company,
    roleFamily: record.roleFamily,
    seniority: record.seniority,
    workMode: record.workMode,
    locationCountry: record.locationCountry,
    locationLabel: record.locationLabel,
    salaryMin: record.salaryMin ?? 0,
    salaryMax: record.salaryMax ?? 0,
    salaryCurrency: record.salaryCurrency,
    salaryPeriod: record.salaryPeriod,
    description: record.description,
    requiredSkills: record.requiredSkills ?? [],
    usefulSkills: record.usefulSkills ?? [],
    eligibleCountries: record.eligibleCountries ?? [],
    sponsorship: record.sponsorship,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    postedAt: demoPostedAt(record.postedDaysAgo, now),
    isDemo: record.isDemo,
  }
}

export function demoJobs(now: number = Date.now()): Job[] {
  return records.map((record) => toJob(record, now))
}

export function demoJobCount(): number {
  return records.length
}

export const ELIGIBILITY_TIERS: EligibilityTier[] = ['eligible', 'unknown', 'restricted']
