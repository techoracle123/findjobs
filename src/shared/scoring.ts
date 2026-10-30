import type {
  EligibilityTier,
  Job,
  Profile,
  ScoreComponent,
  ScoreComponentKey,
  ScoredJob,
} from './types'
import { matchSkills } from './skills'

/**
 * Score weights, per the product spec. They are intentionally not a flat
 * average: a missing required skill should hurt far more than a missing
 * "useful" one.
 */
export const SCORE_WEIGHTS: Record<ScoreComponentKey, number> = {
  requiredSkills: 48,
  usefulSkills: 14,
  roleFamily: 18,
  seniority: 10,
  workMode: 10,
}

export const ELIGIBILITY_ORDER: Record<EligibilityTier, number> = {
  eligible: 0,
  unknown: 1,
  restricted: 2,
}

export const ELIGIBILITY_LABELS: Record<EligibilityTier, string> = {
  eligible: 'Eligible',
  unknown: 'Needs checking',
  restricted: 'Restricted',
}

/**
 * Eligibility is evaluated separately from the score: it is a gate, not a
 * contribution to fit. When we cannot tell, we say so rather than guessing.
 */
export function evaluateEligibility(
  job: Job,
  workCountry: string,
): { tier: EligibilityTier; reason: string } {
  const country = (workCountry || '').toUpperCase()
  const listed = (job.eligibleCountries || []).map((code) => code.toUpperCase())

  if (!country) {
    return {
      tier: 'unknown',
      reason: 'Set a work country to check eligibility against this role.',
    }
  }

  if (listed.length > 0) {
    if (listed.includes(country)) {
      return {
        tier: 'eligible',
        reason: `${country} is listed as an eligible hiring region.`,
      }
    }
    if (job.sponsorship === 'available') {
      return {
        tier: 'eligible',
        reason: `${country} is not listed, but the employer states it sponsors visas.`,
      }
    }
    if (job.sponsorship === 'unknown') {
      return {
        tier: 'unknown',
        reason: `${country} is not listed and sponsorship is not stated.`,
      }
    }
    return {
      tier: 'restricted',
      reason: `${country} is not listed and the employer does not sponsor.`,
    }
  }

  if (job.sponsorship === 'available') {
    return { tier: 'eligible', reason: 'No region restriction; the employer sponsors.' }
  }
  if (job.sponsorship === 'unavailable') {
    return { tier: 'unknown', reason: 'No region restriction, but sponsorship is not offered.' }
  }
  return { tier: 'unknown', reason: 'The posting does not state region or sponsorship rules.' }
}

/**
 * A component is "applicable" when both sides of the comparison are known.
 * Inapplicable components are excluded from the total rather than counted as
 * a failure, so a posting that omits, say, role family is not penalised for
 * the omission.
 */
export function scoreJob(job: Job, profile: Profile): ScoredJob {
  const components: ScoreComponent[] = []
  const hasProfileSkills = profile.skills.length > 0

  const required = matchSkills(job.requiredSkills, profile.skills)
  const requiredApplicable = job.requiredSkills.length > 0 && hasProfileSkills
  components.push({
    key: 'requiredSkills',
    label: 'Required skills',
    weight: SCORE_WEIGHTS.requiredSkills,
    earned: requiredApplicable
      ? (required.matched.length / job.requiredSkills.length) * SCORE_WEIGHTS.requiredSkills
      : 0,
    applicable: requiredApplicable,
    detail: requiredApplicable
      ? `${required.matched.length} of ${job.requiredSkills.length} required skills`
      : job.requiredSkills.length === 0
        ? 'No required skills listed'
        : 'Add skills to your profile',
    matched: required.matched,
    missing: required.missing,
  })

  const useful = matchSkills(job.usefulSkills, profile.skills)
  const usefulApplicable = job.usefulSkills.length > 0 && hasProfileSkills
  components.push({
    key: 'usefulSkills',
    label: 'Useful skills',
    weight: SCORE_WEIGHTS.usefulSkills,
    earned: usefulApplicable
      ? (useful.matched.length / job.usefulSkills.length) * SCORE_WEIGHTS.usefulSkills
      : 0,
    applicable: usefulApplicable,
    detail: usefulApplicable
      ? `${useful.matched.length} of ${job.usefulSkills.length} useful skills`
      : job.usefulSkills.length === 0
        ? 'No useful skills listed'
        : 'Add skills to your profile',
    matched: useful.matched,
    missing: useful.missing,
  })

  const roleApplicable =
    Boolean(job.roleFamily) && job.roleFamily !== 'unknown' && profile.targetRoleFamilies.length > 0
  const roleMatched = roleApplicable && profile.targetRoleFamilies.includes(job.roleFamily)
  components.push({
    key: 'roleFamily',
    label: 'Role family',
    weight: SCORE_WEIGHTS.roleFamily,
    earned: roleMatched ? SCORE_WEIGHTS.roleFamily : 0,
    applicable: roleApplicable,
    detail: roleMatched
      ? `Matches your ${job.roleFamily} focus`
      : roleApplicable
        ? `Outside your target role families`
        : job.roleFamily === 'unknown'
          ? 'Profession not stated in the listing'
          : 'Add a target profession',
    matched: roleMatched ? [job.roleFamily] : [],
    missing: roleApplicable && !roleMatched ? [job.roleFamily] : [],
  })

  const seniorityApplicable =
    Boolean(job.seniority) && job.seniority !== 'unknown' && profile.targetSeniority.length > 0
  const seniorityMatched = seniorityApplicable && profile.targetSeniority.includes(job.seniority)
  components.push({
    key: 'seniority',
    label: 'Seniority',
    weight: SCORE_WEIGHTS.seniority,
    earned: seniorityMatched ? SCORE_WEIGHTS.seniority : 0,
    applicable: seniorityApplicable,
    detail: seniorityMatched
      ? `Matches your target level`
      : seniorityApplicable
        ? `Not a level you are targeting`
        : job.seniority === 'unknown'
          ? 'Experience level not stated in the listing'
          : 'Add a target level',
    matched: seniorityMatched ? [job.seniority] : [],
    missing: seniorityApplicable && !seniorityMatched ? [job.seniority] : [],
  })

  const modeApplicable =
    Boolean(job.workMode) && job.workMode !== 'unknown' && profile.preferredWorkModes.length > 0
  const modeMatched = modeApplicable && profile.preferredWorkModes.includes(job.workMode)
  components.push({
    key: 'workMode',
    label: 'Work mode',
    weight: SCORE_WEIGHTS.workMode,
    earned: modeMatched ? SCORE_WEIGHTS.workMode : 0,
    applicable: modeApplicable,
    detail: modeMatched
      ? `Matches your preferred ${job.workMode} setup`
      : modeApplicable
        ? `Not a work mode you listed`
        : job.workMode === 'unknown'
          ? 'Work arrangement not stated in the listing'
          : 'Add a preferred work mode',
    matched: modeMatched ? [job.workMode] : [],
    missing: modeApplicable && !modeMatched ? [job.workMode] : [],
  })

  const applicableWeight = components
    .filter((component) => component.applicable)
    .reduce((sum, component) => sum + component.weight, 0)
  const earned = components.reduce((sum, component) => sum + component.earned, 0)
  const score = applicableWeight > 0 ? Math.round((earned / applicableWeight) * 100) : 0

  const { tier, reason } = evaluateEligibility(job, profile.workCountry)

  return {
    job,
    score: Math.max(0, Math.min(100, score)),
    tier,
    tierReason: reason,
    components,
    matchedSkills: [...required.matched, ...useful.matched],
    missingSkills: required.missing,
  }
}

/**
 * Eligibility first (eligible, then needs checking, then restricted), then
 * score, then recency. A restricted role is never promoted above an eligible
 * one no matter how well it scores.
 */
/** In-market for FJ's audience: in Nigeria, or remote (open to Nigeria by default). */
export function isInMarket(job: Job): boolean {
  return job.locationCountry === 'NG' || job.workMode === 'remote'
}

/**
 * Default-feed ordering rank: Nigeria first, then remote roles open to
 * Nigeria, then everything else. (Remote alone would bury Nigerian jobs
 * under fresher US-remote listings.)
 */
export function marketRank(job: Job): number {
  if (job.locationCountry === 'NG') return 2
  if (job.workMode === 'remote') return 1
  return 0
}

export function compareScoredJobs(a: ScoredJob, b: ScoredJob): number {
  const tierDelta = ELIGIBILITY_ORDER[a.tier] - ELIGIBILITY_ORDER[b.tier]
  if (tierDelta !== 0) return tierDelta

  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta

  // At equal match, Nigeria and remote roles come first — a Nigeria-first
  // audience should not need a filter to see Nigerian jobs. Personalised
  // scores still outrank this; nothing is hidden, only ordered.
  const marketDelta = marketRank(b.job) - marketRank(a.job)
  if (marketDelta !== 0) return marketDelta

  return Date.parse(b.job.postedAt) - Date.parse(a.job.postedAt)
}
