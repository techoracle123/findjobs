import type { CvSuggestion, Seniority, WorkMode } from './types'
import {
  ROLE_FAMILY_KEYWORDS,
  SENIORITY_KEYWORDS,
  SKILL_CATALOGUE,
  WORK_MODE_KEYWORDS,
} from './skills'

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  lead: 5,
  principal: 6,
}

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const matches = text.match(new RegExp(pattern.source, flags))
    if (matches) count += matches.length
  }
  return count
}

/**
 * Deterministic keyword extraction. This is the fallback used whenever the
 * Workers AI binding is absent, and it is also what the local preview always
 * uses. It is intentionally simple and explainable: it reports which patterns
 * matched rather than inventing a profile.
 */
export function suggestFromKeywords(text: string): CvSuggestion {
  const haystack = text.toLowerCase()

  const scored = SKILL_CATALOGUE.map((entry) => ({
    label: entry.label,
    hits: countMatches(haystack, entry.patterns),
    weight: entry.weight,
  }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits * b.weight - a.hits * a.weight || a.label.localeCompare(b.label))

  const skills = scored.slice(0, 14).map((entry) => entry.label)

  const roleFamilies = ROLE_FAMILY_KEYWORDS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(haystack)),
  ).map((entry) => entry.family)

  const seniority = SENIORITY_KEYWORDS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(haystack)),
  )
    .map((entry) => entry.level)
    .sort((a, b) => (SENIORITY_RANK[b] ?? 0) - (SENIORITY_RANK[a] ?? 0))

  const workModes = WORK_MODE_KEYWORDS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(haystack)),
  ).map((entry) => entry.mode as WorkMode)

  const notes: string[] = []
  if (skills.length === 0) {
    notes.push('No catalogue skills were detected. Try a CV with a skills section.')
  }
  if (roleFamilies.length === 0) {
    notes.push('No role family was detected, so the results are ranked on skills alone.')
  }
  if (workModes.length === 0) {
    notes.push('No work mode was detected, so eligibility filtering stays broad.')
  }

  const top = scored.slice(0, 3).map((entry) => entry.label)
  const summary =
    top.length > 0
      ? `Detected ${skills.length} skills, strongest in ${top.join(', ')}.`
      : 'No skills were detected in the supplied text.'

  return {
    skills,
    roleFamilies,
    seniority: seniority.slice(0, 2) as Seniority[],
    workModes,
    summary,
    provider: 'on-device',
    notes,
  }
}
