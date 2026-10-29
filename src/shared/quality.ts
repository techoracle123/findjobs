/**
 * Data-quality policy: one place decides which controls may render and what
 * "good enough" means. A control whose backing field is missing on more than
 * 40% of listings cannot return a meaningful answer and must not exist in the
 * interface.
 */

export const NORMALIZER_VERSION = '2026.10.29'
export const FIELD_THRESHOLD = 0.6

/** Fields measured for completeness on every publication. */
export const QUALITY_FIELDS = [
  'locationCountry',
  'workMode',
  'seniority',
  'salary',
  'requiredSkills',
  'roleFamily',
  'language',
  'eligibleCountries',
] as const

export type QualityField = (typeof QUALITY_FIELDS)[number]

export interface FieldCoverage {
  locationCountry: number
  workMode: number
  seniority: number
  salary: number
  requiredSkills: number
  roleFamily: number
  language: number
  eligibleCountries: number
}

/** Launch floors. A regression past any of these must page someone. */
export const QUALITY_FLOORS: Record<string, number> = {
  locationCountry: 0.85,
  workMode: 0.85,
  seniority: 0.8,
  requiredSkills: 0.7,
  duplicateRate: 0.01,
}

export interface QualitySnapshot {
  date: string
  normalizerVersion: string
  total: number
  coverage: FieldCoverage
  duplicatesDropped: number
  nonEnglish: number
  implausibleSalaries: number
  sources: {
    sourceId: string
    total: number
    coverage: Partial<FieldCoverage>
  }[]
  alerts: string[]
}

/** True when the interface may render a control for this field. */
export function controlEnabled(
  coverage: Partial<Record<QualityField, number>> | undefined,
  field: QualityField,
  adminOverride = false,
): boolean {
  if (adminOverride) return true
  return (coverage?.[field] ?? 0) >= FIELD_THRESHOLD
}
