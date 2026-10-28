import type { SavedApplication } from './types'

export interface ApplicationActivity {
  thisMonth: number
  totalApplied: number
  undated: number
  saved: number
  from: string
  to: string
}
export function monthPeriod(now = new Date()): { from: string; to: string } {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  }
}
export function deviceActivity(saved: SavedApplication[], now = new Date()): ApplicationActivity {
  const { from, to } = monthPeriod(now)
  const applied = [
    ...new Map(
      saved.filter((entry) => entry.status === 'applied').map((entry) => [entry.jobId, entry]),
    ).values(),
  ]
  return {
    from,
    to,
    totalApplied: applied.length,
    saved: saved.filter((entry) => entry.status === 'saved').length,
    undated: applied.filter(
      (entry) => !entry.appliedAt || !Number.isFinite(Date.parse(entry.appliedAt)),
    ).length,
    thisMonth: applied.filter(
      (entry) =>
        entry.appliedAt &&
        Date.parse(entry.appliedAt) >= Date.parse(from) &&
        Date.parse(entry.appliedAt) < Date.parse(to),
    ).length,
  }
}
