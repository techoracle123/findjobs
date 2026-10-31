import { countryName } from '../shared/countries'
import { suggestFromKeywords } from '../shared/cv-suggest'
import { opportunityOf } from '../shared/opportunities'
import { evaluateEligibility, scoreJob } from '../shared/scoring'
import { canonicalSkill, SKILL_CATALOGUE } from '../shared/skills'
import type {
  EligibilityTier,
  Job,
  MatchAlternative,
  MatchIntelligenceResult,
  MatchRequirement,
  MatchRequirementStatus,
  Profile,
} from '../shared/types'
import { buildAdvertCheckForJob } from './advert-check'
import { buildCvAnalysis } from './pro-analysis'

type Importance = 'essential' | 'desirable' | 'unknown'

interface AdvertLine {
  text: string
  section: Importance | 'neutral'
}

interface SkillCandidate {
  label: string
  canonical: string
  fromRequired: boolean
  fromUseful: boolean
  fromAdvert: boolean
}

const RELATED_SKILL_GROUPS: string[][] = [
  ['react', 'next', 'vue', 'angular', 'svelte', 'javascript', 'typescript'],
  ['node', 'express', 'django', 'fastapi', 'spring', 'rest', 'graphql'],
  ['python', 'sql', 'pandas', 'numpy', 'dbt', 'airflow', 'spark', 'kafka', 'ml'],
  ['postgres', 'mysql', 'mongodb', 'redis', 'sql', 'nosql', 'elasticsearch'],
  ['aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'cicd'],
  ['security', 'threatmodeling', 'pentest', 'siem', 'gdpr', 'linux', 'bash'],
  ['pytest', 'cypress', 'jest', 'storybook'],
  ['flutter', 'reactnative', 'android', 'ios', 'swift'],
  ['figma', 'designsystems', 'ux', 'accessibility', 'css', 'html'],
  ['microsoftexcel', 'excel', 'googlesheets', 'powerbi', 'tableau', 'sql', 'dataanalysis'],
  ['wordpress', 'shopify', 'php', 'javascript', 'css', 'html'],
]

const CERTIFICATIONS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'CISSP', pattern: /\bCISSP\b/i },
  { label: 'CEH', pattern: /\bCEH\b|Certified Ethical Hacker/i },
  { label: 'CompTIA Security+', pattern: /CompTIA Security\+|Security\+/i },
  { label: 'CompTIA Network+', pattern: /CompTIA Network\+|Network\+/i },
  { label: 'OSCP', pattern: /\bOSCP\b/i },
  { label: 'CISM', pattern: /\bCISM\b/i },
  { label: 'CISA', pattern: /\bCISA\b/i },
  { label: 'CCNA', pattern: /\bCCNA\b/i },
  { label: 'AWS certification', pattern: /AWS Certified|AWS certification/i },
  { label: 'Azure certification', pattern: /Azure Certified|Microsoft Certified: Azure/i },
  {
    label: 'Google Cloud certification',
    pattern: /Google Cloud Certified|Professional Cloud Architect/i,
  },
  { label: 'PMP', pattern: /\bPMP\b|Project Management Professional/i },
  { label: 'Scrum certification', pattern: /Certified Scrum|PSM\s?I|CSM\b/i },
  { label: 'ACCA', pattern: /\bACCA\b/i },
  { label: 'ICAN', pattern: /\bICAN\b/i },
  { label: 'CPA', pattern: /\bCPA\b|Certified Public Accountant/i },
  { label: 'CIPD', pattern: /\bCIPD\b/i },
  { label: 'SHRM', pattern: /\bSHRM\b/i },
  { label: 'NEBOSH', pattern: /\bNEBOSH\b/i },
]

const LANGUAGES = [
  'English',
  'French',
  'Spanish',
  'German',
  'Portuguese',
  'Arabic',
  'Hausa',
  'Yoruba',
  'Igbo',
  'Swahili',
  'Dutch',
  'Italian',
]

function cleanSnippet(value: string, max = 230): string | null {
  const clean = value
    .replace(/^\s*[#>*•·-]+\s*/, '')
    .replace(/[#>*`]/g, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/https?:\/\/\S+/gi, '[link removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length < 8) return null
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termPattern(term: string): RegExp {
  const catalogue = SKILL_CATALOGUE.find(
    (entry) => entry.label.toLowerCase() === term.trim().toLowerCase(),
  )
  if (catalogue) {
    return new RegExp(catalogue.patterns.map((pattern) => `(?:${pattern.source})`).join('|'), 'i')
  }
  const variants = [term]
  if (/\.js$/i.test(term)) variants.push(term.replace(/\.js$/i, 'js'), term.replace(/\.js$/i, ''))
  if (/^microsoft\s+/i.test(term)) variants.push(term.replace(/^microsoft\s+/i, ''))
  return new RegExp(
    variants.map((variant) => `(?<![a-z0-9+#])${escapeRegExp(variant)}(?![a-z0-9+#])`).join('|'),
    'i',
  )
}

function lineEvidence(text: string, pattern: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    pattern.lastIndex = 0
    if (pattern.test(line)) return cleanSnippet(line)
  }
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    pattern.lastIndex = 0
    if (pattern.test(sentence)) return cleanSnippet(sentence)
  }
  return null
}

function labelledEvidence(advert: string | null, candidate: string | null): string[] {
  return [...(advert ? [`Advert: ${advert}`] : []), ...(candidate ? [`Your CV: ${candidate}`] : [])]
}

function sectionForHeading(text: string): AdvertLine['section'] | null {
  const heading = text
    .replace(/[#:*_]/g, '')
    .trim()
    .toLowerCase()
  if (heading.length < 3 || heading.length > 110) return null
  if (
    /(nice to have|desirable|preferred qualifications|preferred skills|bonus points|would be a plus|advantageous)/.test(
      heading,
    )
  ) {
    return 'desirable'
  }
  if (
    /(requirements|qualifications|must have|must-have|essential|minimum qualifications|what you(?:'|’)?ll need|what we need|skills and experience|your profile|about you|who you are)/.test(
      heading,
    )
  ) {
    return 'essential'
  }
  if (
    /(responsibilities|what you(?:'|’)?ll do|the role|about the (?:role|job|project)|benefits|perks|how to apply|about us|company)/.test(
      heading,
    )
  ) {
    return 'neutral'
  }
  return null
}

function advertLines(description: string): AdvertLine[] {
  let section: AdvertLine['section'] = 'unknown'
  return description
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const nextSection = sectionForHeading(text)
      if (nextSection) section = nextSection
      return { text, section }
    })
}

function explicitImportance(line: AdvertLine | undefined): Importance | null {
  if (!line) return null
  const text = line.text.toLowerCase()
  if (/(nice to have|nice-to-have|desirable|preferred|a plus|bonus|advantageous)/.test(text)) {
    return 'desirable'
  }
  if (/(must|required|essential|minimum|at least|mandatory|you will need|you'll need)/.test(text)) {
    return 'essential'
  }
  if (line.section === 'essential' || line.section === 'desirable') return line.section
  return null
}

function importanceFromLine(line: AdvertLine | undefined, fallback: Importance): Importance {
  return explicitImportance(line) ?? fallback
}

function advertSkillEvidence(
  lines: AdvertLine[],
  description: string,
  skill: string,
  includeEvidence = true,
): { evidence: string | null; line?: AdvertLine } {
  const pattern = termPattern(skill)
  const line = lines.find((entry) => {
    pattern.lastIndex = 0
    return pattern.test(entry.text)
  })
  if (line) return { evidence: includeEvidence ? cleanSnippet(line.text) : null, line }
  return { evidence: includeEvidence ? lineEvidence(description, pattern) : null }
}

function relatedSkillLabel(canonical: string, cvSkills: Map<string, string>): string | null {
  for (const group of RELATED_SKILL_GROUPS) {
    if (!group.includes(canonical)) continue
    for (const member of group) {
      if (member !== canonical && cvSkills.has(member)) return cvSkills.get(member) ?? null
    }
  }
  return null
}

function actionForSkill(label: string, status: MatchRequirementStatus): string {
  if (status === 'met') return `Keep the ${label} example easy to find near the top of your CV.`
  if (status === 'partial') {
    return `Add a precise work example for ${label} if you have one. Name the task, tool and result.`
  }
  return `Do not claim ${label} unless you can support it. If it matters for several target adverts, build one small work sample that uses it.`
}

function skillCandidates(job: Job): SkillCandidate[] {
  const byCanonical = new Map<string, SkillCandidate>()
  const add = (
    label: string,
    flags: Partial<Pick<SkillCandidate, 'fromRequired' | 'fromUseful' | 'fromAdvert'>>,
  ) => {
    const canonical = canonicalSkill(label)
    if (!canonical) return
    const current = byCanonical.get(canonical)
    if (current) {
      Object.assign(current, flags)
      return
    }
    byCanonical.set(canonical, {
      label,
      canonical,
      fromRequired: Boolean(flags.fromRequired),
      fromUseful: Boolean(flags.fromUseful),
      fromAdvert: Boolean(flags.fromAdvert),
    })
  }

  for (const skill of job.requiredSkills) add(skill, { fromRequired: true })
  for (const skill of suggestFromKeywords(job.description).skills) add(skill, { fromAdvert: true })
  for (const skill of job.usefulSkills) add(skill, { fromUseful: true })
  return [...byCanonical.values()].slice(0, 20)
}

function skillRequirements(
  job: Job,
  cvText: string,
  cvSkills: Map<string, string>,
  profileSkillKeys: Map<string, string>,
  includeEvidence = true,
): MatchRequirement[] {
  const lines = advertLines(job.description)
  const requirements: MatchRequirement[] = []

  for (const candidate of skillCandidates(job)) {
    const { evidence, line } = advertSkillEvidence(
      lines,
      job.description,
      candidate.label,
      includeEvidence,
    )
    const fallback: Importance = candidate.fromRequired
      ? 'essential'
      : candidate.fromUseful
        ? 'desirable'
        : 'essential'
    // A skill found only somewhere in the prose is not automatically an
    // employer requirement. Tools named in duties, benefits or company
    // background stay out unless the line or its section says the candidate
    // needs them. Source-classified required/useful skills keep their lane.
    const importance =
      !candidate.fromRequired && !candidate.fromUseful
        ? explicitImportance(line)
        : importanceFromLine(line, fallback)
    if (!importance) continue
    const group = importance === 'desirable' ? 'desirable' : 'essential'

    let status: MatchRequirementStatus = 'missing'
    let detail = `Your CV does not clearly show ${candidate.label}.`
    let candidateEvidence: string | null = null

    if (cvText.trim() && cvSkills.has(candidate.canonical)) {
      const pattern = termPattern(candidate.label)
      candidateEvidence = includeEvidence ? lineEvidence(cvText, pattern) : null
      if (includeEvidence ? candidateEvidence : pattern.test(cvText)) {
        status = 'met'
        detail = `Your CV names ${candidate.label} and gives a supporting line.`
      } else {
        status = 'partial'
        detail = `Your CV appears to name ${candidate.label}, but no clear example was found.`
      }
    } else if (!cvText.trim() && cvSkills.has(candidate.canonical)) {
      status = 'partial'
      detail = `Your profile lists ${candidate.label}. Add a CV or work example to make the evidence stronger.`
    } else if (cvText.trim() && profileSkillKeys.has(candidate.canonical)) {
      status = 'partial'
      detail = `Your profile lists ${candidate.label}, but your CV does not show a clear example.`
    } else {
      const related = relatedSkillLabel(candidate.canonical, cvSkills)
      if (related) {
        candidateEvidence =
          includeEvidence && cvText.trim() ? lineEvidence(cvText, termPattern(related)) : null
        status = 'partial'
        detail = `Related experience with ${related} is shown, but ${candidate.label} is not named.`
      }
    }

    requirements.push({
      label: candidate.label,
      group,
      status,
      detail,
      evidence: labelledEvidence(evidence, candidateEvidence),
      action: actionForSkill(candidate.label, status),
    })
  }

  return [
    ...requirements.filter((item) => item.group === 'essential').slice(0, 12),
    ...requirements.filter((item) => item.group === 'desirable').slice(0, 8),
  ]
}

function parseCandidateYears(text: string): number | null {
  const explicit = [
    ...text.matchAll(/\b(\d{1,2}(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b[^.!?\n]{0,60}?\bexperience\b/gi),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 50)
  if (explicit.length) return Math.max(...explicit)

  const roleRanges = [
    ...text.matchAll(
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)?\.?\s*(20\d{2}|19\d{2})\s*(?:-|–|to)\s*(?:Present|Current|Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)?\.?\s*(20\d{2}|19\d{2}))\b/gi,
    ),
  ]
  const durations = roleRanges
    .map((match) => {
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : new Date().getFullYear()
      return end >= start ? end - start : 0
    })
    .filter((value) => value > 0 && value <= 50)
  return durations.length ? Math.max(...durations) : null
}

function experienceRequirement(job: Job, cvText: string): MatchRequirement | null {
  const patterns = [
    /\b(?:at least|minimum(?: of)?|min\.?|over|more than)?\s*(\d{1,2})\+?\s*(?:years?|yrs?)\b[^.!?]{0,70}?\bexperience\b/i,
    /\bexperience\b[^.!?]{0,45}?\b(?:of\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)\b/i,
  ]
  const candidates = advertLines(job.description)
    .map((line) => {
      const match = patterns.map((pattern) => line.text.match(pattern)).find(Boolean)
      if (!match) return null
      const lower = line.text.toLowerCase()
      let score = 0
      if (line.section === 'essential') score += 3
      if (
        /(required|must|at least|minimum|you|candidate|applicant|experience with|experience in|experience using|experience building)/.test(
          lower,
        )
      )
        score += 2
      if (/^(?:we|our company|our team|the company)\b/.test(lower)) score -= 4
      return { line, match, score }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.score > 0)
    .sort((a, b) => b.score - a.score)
  const selected = candidates[0]
  const match = selected?.match ?? null
  if (!match) return null
  const requiredYears = Number(match[1])
  if (!Number.isFinite(requiredYears) || requiredYears < 1 || requiredYears > 40) return null

  const candidateYears = cvText.trim() ? parseCandidateYears(cvText) : null
  const advertEvidence = lineEvidence(
    job.description,
    new RegExp(`\\b${requiredYears}\\+?\\s*(?:years?|yrs?)\\b`, 'i'),
  )
  let status: MatchRequirementStatus = 'needs-check'
  let detail = `The advert asks for about ${requiredYears} years of experience. The information supplied does not make your total clear.`
  let candidateEvidence: string | null = null

  if (candidateYears !== null) {
    candidateEvidence = lineEvidence(
      cvText,
      /\b\d{1,2}\+?\s*(?:years?|yrs?)\b[^\n]{0,60}?\bexperience\b/i,
    )
    if (candidateYears >= requiredYears) {
      status = 'met'
      detail = `Your CV states about ${candidateYears} years of experience.`
    } else if (
      candidateYears >= Math.max(1, requiredYears - 2) &&
      candidateYears >= requiredYears / 2
    ) {
      status = 'partial'
      detail = `Your CV states about ${candidateYears} years. The advert asks for about ${requiredYears} years, so relevant results matter more.`
    } else {
      status = 'missing'
      detail = `Your CV states about ${candidateYears} years. The advert asks for about ${requiredYears} years.`
    }
  }

  return {
    label: `${requiredYears}+ years of relevant experience`,
    group: 'essential',
    status,
    detail,
    evidence: labelledEvidence(advertEvidence, candidateEvidence),
    action:
      status === 'met'
        ? 'Show the most relevant years first and connect them to results.'
        : 'Make your dates and total relevant experience easy to verify. Add project, NYSC, internship or freelance work where it is genuinely relevant.',
  }
}

function degreeLevel(text: string): { level: number; label: string } | null {
  if (/\b(ph\.?d|doctorate)\b/i.test(text)) return { level: 4, label: 'doctorate' }
  if (/\b(master'?s|m\.?sc|m\.?a\.|mba|mph|meng)\b/i.test(text)) {
    return { level: 3, label: "master's degree" }
  }
  if (/\b(bachelor'?s|b\.?sc|b\.?a\.|beng|b\.?tech|undergraduate degree)\b/i.test(text)) {
    return { level: 2, label: "bachelor's degree" }
  }
  if (/\b(hnd|higher national diploma|associate degree|ond|national diploma)\b/i.test(text)) {
    return { level: 1, label: 'diploma' }
  }
  if (/\bdegree\b/i.test(text)) return { level: 2, label: 'degree' }
  return null
}

function educationRequirement(job: Job, cvText: string): MatchRequirement | null {
  const degreePattern =
    /\b(bachelor'?s|master'?s|ph\.?d|doctorate|degree|b\.?sc|b\.?a\.|beng|b\.?tech|m\.?sc|m\.?a\.|mba|mph|meng|hnd|higher national diploma|associate degree|ond|national diploma|diploma)\b/i
  const line = advertLines(job.description).find(
    (entry) =>
      degreePattern.test(entry.text) &&
      (entry.section === 'essential' ||
        entry.section === 'desirable' ||
        /(required|must|minimum|mandatory|preferred|desirable|nice to have|qualification|degree in|degree or)/i.test(
          entry.text,
        )),
  )
  const required = line ? degreeLevel(line.text) : null
  if (!required) return null
  const candidate = cvText.trim() ? degreeLevel(cvText) : null
  const group = explicitImportance(line) === 'desirable' ? 'desirable' : 'essential'
  const advertEvidence = line ? cleanSnippet(line.text) : null
  const candidateEvidence = candidate
    ? lineEvidence(
        cvText,
        /\b(bachelor|master|ph\.?d|doctorate|degree|b\.?sc|m\.?sc|hnd|diploma)\b/i,
      )
    : null

  let status: MatchRequirementStatus = 'needs-check'
  let detail = `The advert mentions a ${required.label}. Your supplied information does not state your education clearly.`
  if (candidate && candidate.level >= required.level) {
    status = 'met'
    detail = `Your CV mentions a ${candidate.label}.`
  } else if (candidate && candidate.level === required.level - 1) {
    status = 'partial'
    detail = `Your CV mentions a ${candidate.label}. The advert asks for a ${required.label}. Check whether experience can stand in for it.`
  } else if (candidate) {
    status = 'missing'
    detail = `Your CV mentions a ${candidate.label}. The advert asks for a ${required.label}.`
  }

  return {
    label: required.label[0].toUpperCase() + required.label.slice(1),
    group,
    status,
    detail,
    evidence: labelledEvidence(advertEvidence, candidateEvidence),
    action:
      status === 'met'
        ? 'Keep the qualification, institution and year easy to find.'
        : 'State your highest relevant qualification clearly. Do not upgrade or invent a qualification.',
  }
}

function certificationRequirements(job: Job, cvText: string): MatchRequirement[] {
  const lines = advertLines(job.description)
  const requirements: MatchRequirement[] = []
  for (const certification of CERTIFICATIONS) {
    certification.pattern.lastIndex = 0
    if (!certification.pattern.test(job.description)) continue
    const advertEvidence = lineEvidence(job.description, certification.pattern)
    const line = lines.find((entry) => {
      certification.pattern.lastIndex = 0
      return certification.pattern.test(entry.text)
    })
    // A certification mentioned in company background is not necessarily a
    // candidate requirement. Require requirement wording or a requirement
    // section before treating it as one.
    const importance = explicitImportance(line)
    if (!importance) continue
    const candidateEvidence = cvText.trim() ? lineEvidence(cvText, certification.pattern) : null
    requirements.push({
      label: certification.label,
      group: importance === 'desirable' ? 'desirable' : 'essential',
      status: candidateEvidence ? 'met' : 'missing',
      detail: candidateEvidence
        ? `Your CV names ${certification.label}.`
        : `Your supplied information does not name ${certification.label}.`,
      evidence: labelledEvidence(advertEvidence, candidateEvidence),
      action: candidateEvidence
        ? 'Keep the certification and its date visible.'
        : `Add ${certification.label} only if you hold it. Otherwise treat it as a gap for this advert.`,
    })
    if (requirements.length >= 4) break
  }
  return requirements
}

function languageRequirements(job: Job, cvText: string): MatchRequirement[] {
  const requirements: MatchRequirement[] = []
  for (const language of LANGUAGES) {
    const languagePattern = new RegExp(
      `\\b(?:fluent|fluency|proficient|proficiency|speak|spoken|written|language)\\b[^.!?\\n]{0,45}\\b${escapeRegExp(language)}\\b|\\b${escapeRegExp(language)}\\b[^.!?\\n]{0,45}\\b(?:fluent|fluency|proficient|proficiency|speaker|language)\\b`,
      'i',
    )
    if (!languagePattern.test(job.description)) continue
    const candidateEvidence = cvText.trim()
      ? lineEvidence(cvText, new RegExp(`\\b${escapeRegExp(language)}\\b`, 'i'))
      : null
    requirements.push({
      label: `${language} language`,
      group: 'practical',
      status: candidateEvidence ? 'met' : 'needs-check',
      detail: candidateEvidence
        ? `Your CV mentions ${language}.`
        : `The advert asks for ${language}. Your supplied information does not state your level.`,
      evidence: labelledEvidence(lineEvidence(job.description, languagePattern), candidateEvidence),
      action: `State your ${language} speaking and writing level honestly if you apply.`,
    })
    if (requirements.length >= 3) break
  }
  return requirements
}

function eligibilityFor(job: Job, profile: Profile) {
  const base = evaluateEligibility(job, profile.workCountry)
  const check = buildAdvertCheckForJob(job)
  const explicitSentence = lineEvidence(
    job.description,
    /\b(right to work|work authorization|work authorisation|eligible to work|must be (?:based|located)|based in|citizens?|residents?|visa sponsorship|sponsorship|worldwide|anywhere)\b/i,
  )
  const evidence = [
    ...(explicitSentence ? [`Advert: ${explicitSentence}`] : []),
    ...(profile.workCountry?.toUpperCase() === 'NG' ? check.nigeria.evidence : []),
    ...(job.locationLabel ? [`Advert location: ${job.locationLabel}`] : []),
  ].slice(0, 5)

  let tier: EligibilityTier = base.tier
  const notes = [
    base.reason,
    ...(profile.workCountry?.toUpperCase() === 'NG' ? check.nigeria.notes : []),
  ]
  if (profile.workCountry?.toUpperCase() === 'NG') {
    if (
      tier === 'unknown' &&
      (check.nigeria.status === 'nigeria-named' || check.nigeria.status === 'worldwide-stated')
    ) {
      tier = 'eligible'
    }
    if (check.nigeria.status === 'nigeria-not-named' && job.sponsorship === 'unavailable') {
      tier = 'restricted'
      notes.push('Nigeria was not named in the advert and sponsorship is recorded as unavailable.')
    }
  }

  return { tier, reason: base.reason, evidence: [...new Set(evidence)], notes: [...new Set(notes)] }
}

function eligibilityRequirement(job: Job, profile: Profile): MatchRequirement {
  const eligibility = eligibilityFor(job, profile)
  const country = profile.workCountry ? countryName(profile.workCountry) : null
  const status: MatchRequirementStatus =
    eligibility.tier === 'eligible'
      ? 'met'
      : eligibility.tier === 'restricted'
        ? 'missing'
        : 'needs-check'
  const detail =
    eligibility.tier === 'eligible'
      ? country
        ? `The advert gives a positive signal for ${country}. Still confirm the final terms before applying.`
        : 'The advert gives a positive eligibility signal. Still confirm the final terms before applying.'
      : eligibility.tier === 'restricted'
        ? 'The location and sponsorship signals look like a blocker for your profile country.'
        : eligibility.reason

  return {
    label: 'Location and work eligibility',
    group: 'eligibility',
    status,
    detail,
    evidence: [
      ...eligibility.evidence,
      ...(country ? [`Your profile: Work country is ${country}.`] : []),
    ],
    action:
      status === 'met'
        ? 'Confirm the accepted locations again on the final application page.'
        : 'Confirm accepted work locations and sponsorship before spending time on a long application.',
  }
}

function practicalRequirements(
  job: Job,
  cvRoleFamilies: string[],
  profile: Profile,
): MatchRequirement[] {
  const requirements: MatchRequirement[] = []
  const opportunity = opportunityOf(job)

  if (job.roleFamily && job.roleFamily !== 'unknown') {
    const matchesTarget = profile.targetRoleFamilies.includes(job.roleFamily)
    const matchesCv = cvRoleFamilies.includes(job.roleFamily)
    requirements.push({
      label: 'Role focus',
      group: 'practical',
      status:
        matchesTarget || matchesCv
          ? 'met'
          : profile.targetRoleFamilies.length || cvRoleFamilies.length
            ? 'partial'
            : 'needs-check',
      detail:
        matchesTarget || matchesCv
          ? 'This work matches the role focus shown by your CV or profile.'
          : 'This role focus is not one of the main targets in your profile. Check whether your strongest work transfers well.',
      evidence: [`Advert: ${job.title} at ${job.company}`],
      action:
        matchesTarget || matchesCv
          ? 'Lead with your most relevant role example.'
          : 'Only apply if you can show transferable results for this kind of work.',
    })
  }

  if (profile.preferredWorkModes.length && job.workMode !== 'unknown') {
    const matched = profile.preferredWorkModes.includes(job.workMode)
    requirements.push({
      label: 'Work location type',
      group: 'practical',
      status: matched ? 'met' : job.workMode === 'hybrid' ? 'partial' : 'missing',
      detail: matched
        ? `This is ${job.workMode}, which matches your profile choices.`
        : `This is ${job.workMode}. Your profile choices are ${profile.preferredWorkModes.join(', ')}.`,
      evidence: job.locationLabel ? [`Advert location: ${job.locationLabel}`] : [],
      action: 'Confirm the working pattern and time zone expectations before applying.',
    })
  }

  const chosenTypes = (profile.opportunityTypes ?? []).filter(
    (type) => type === 'job' || type === 'gig',
  )
  const matchesType =
    chosenTypes.length !== 1 ||
    (chosenTypes[0] === 'gig'
      ? opportunity.opportunityType === 'gig'
      : opportunity.opportunityType !== 'gig')
  requirements.push({
    label: 'Type of work',
    group: 'practical',
    status: chosenTypes.length === 0 ? 'needs-check' : matchesType ? 'met' : 'partial',
    detail:
      chosenTypes.length === 0
        ? 'Choose jobs, gigs and contracts, or both in your profile if you want this check to reflect your preference.'
        : matchesType
          ? 'This matches your work type choice.'
          : 'This is outside the single work type selected in your profile.',
    evidence: [
      ...(opportunity.engagementLabel
        ? [
            `Advert: ${opportunity.engagementLabel}${opportunity.projectDuration ? `, ${opportunity.projectDuration}` : ''}`,
          ]
        : []),
    ],
    action:
      opportunity.opportunityType === 'gig'
        ? 'Confirm scope, duration, deadline and payment terms before committing.'
        : 'Confirm whether the role is permanent, full time or another arrangement if the advert is unclear.',
  })

  return requirements
}

function groupPercentage(requirements: MatchRequirement[]): number | null {
  const scored = requirements.filter((item) => item.status !== 'needs-check')
  if (!scored.length) return null
  const points = scored.reduce(
    (sum, item) => sum + (item.status === 'met' ? 1 : item.status === 'partial' ? 0.5 : 0),
    0,
  )
  return Math.round((points / scored.length) * 100)
}

function quickSummary(
  job: Job,
  cvText: string,
  cvSkills: Map<string, string>,
  profileSkillKeys: Map<string, string>,
  profile: Profile,
  scoredJob?: { score: number; tier: EligibilityTier },
) {
  const requirements = skillRequirements(job, cvText, cvSkills, profileSkillKeys, false).filter(
    (item) => item.group === 'essential',
  )
  const scored = scoredJob ?? scoreJob(job, profile)
  return {
    score: scored.score,
    tier: scored.tier,
    essentialPercent: groupPercentage(requirements),
    requirements,
  }
}

function buildAlternatives(
  job: Job,
  pool: Job[],
  cvText: string,
  cvSkills: Map<string, string>,
  profileSkillKeys: Map<string, string>,
  profile: Profile,
  currentEssentialPercent: number | null,
  currentScore: number,
  currentTier: EligibilityTier,
): MatchAlternative[] {
  const currentPercent = currentEssentialPercent ?? 0
  const currentSkills = new Set(job.requiredSkills.map(canonicalSkill))
  const tierRank = (tier: EligibilityTier) => (tier === 'eligible' ? 2 : tier === 'unknown' ? 1 : 0)
  const ranked: Array<{ alternative: MatchAlternative; rank: number }> = []
  const preliminary: Array<{
    candidate: Job
    sharedSkills: number
    scored: { score: number; tier: EligibilityTier }
    rank: number
  }> = []

  // A broad profession can contain thousands of live listings. Detailed
  // essential-requirement parsing reads advert wording, so do that only for
  // the strongest related candidates found by this cheap first pass. Running
  // it for every related listing made Match Intelligence time out in
  // production even though only three alternatives can ever be returned.
  for (const candidate of pool) {
    if (
      !candidate ||
      candidate.id === job.id ||
      candidate.jobStatus === 'closed' ||
      candidate.isDemo
    ) {
      continue
    }
    const sharedSkills = candidate.requiredSkills.filter((skill) =>
      currentSkills.has(canonicalSkill(skill)),
    ).length
    const related =
      (job.roleFamily !== 'unknown' && candidate.roleFamily === job.roleFamily) || sharedSkills >= 2
    if (!related) continue

    const scored = scoreJob(candidate, profile)
    const requiredKeys = candidate.requiredSkills.map(canonicalSkill).filter(Boolean)
    const coveredKeys = requiredKeys.filter(
      (skill) => cvSkills.has(skill) || profileSkillKeys.has(skill),
    ).length
    const requiredCoverage = requiredKeys.length ? coveredKeys / requiredKeys.length : 0
    preliminary.push({
      candidate,
      sharedSkills,
      scored: { score: scored.score, tier: scored.tier },
      rank: scored.score + tierRank(scored.tier) * 20 + requiredCoverage * 60 + sharedSkills * 3,
    })
  }

  preliminary.sort((a, b) => b.rank - a.rank)
  for (const { candidate, sharedSkills, scored } of preliminary.slice(0, 60)) {
    const summary = quickSummary(candidate, cvText, cvSkills, profileSkillKeys, profile, scored)
    const candidatePercent = summary.essentialPercent ?? 0
    const essentialImprovement = candidatePercent - currentPercent
    const scoreImprovement = summary.score - currentScore
    const tierImprovement = tierRank(summary.tier) - tierRank(currentTier)
    const stronger =
      essentialImprovement >= 10 ||
      scoreImprovement >= 8 ||
      (tierImprovement > 0 && essentialImprovement >= -5 && scoreImprovement >= -5)
    if (!stronger) continue

    const matchedSkills = summary.requirements
      .filter((item) => item.status === 'met')
      .map((item) => item.label)
    const missingEssential = summary.requirements
      .filter((item) => item.status === 'missing')
      .map((item) => item.label)
      .slice(0, 5)
    const reasons: string[] = []
    if (essentialImprovement > 0) {
      reasons.push(
        `Essential fit is ${candidatePercent}% here, compared with ${currentPercent}% for the current advert.`,
      )
    }
    if (tierImprovement > 0) {
      reasons.push('The location and eligibility signals look clearer for your work country.')
    }
    if (matchedSkills.length)
      reasons.push(`Your evidence covers ${matchedSkills.slice(0, 3).join(', ')}.`)
    if (opportunityOf(candidate).opportunityType === 'gig') {
      reasons.push('It is classified as gig or contract work from the advert wording.')
    }
    if (!reasons.length) reasons.push('It has a higher overall match score for your profile.')

    ranked.push({
      alternative: {
        job: {
          ...candidate,
          description: candidate.description.slice(0, 360),
          descriptionPreview: candidate.description.length > 360,
        },
        score: summary.score,
        essentialPercent: summary.essentialPercent,
        missingEssential,
        reasons: reasons.slice(0, 3),
      },
      rank: candidatePercent * 2 + summary.score + tierRank(summary.tier) * 20 + sharedSkills * 3,
    })
  }

  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((entry) => entry.alternative)
}

export function analyzeMatchIntelligence(
  job: Job,
  cvText: string,
  profile: Profile,
  alternativesPool: Job[] = [],
): MatchIntelligenceResult {
  const cleanCv = cvText.trim()
  const cvReport = cleanCv ? buildCvAnalysis(cleanCv, profile) : null
  const suggestion = cleanCv ? suggestFromKeywords(cleanCv) : null
  const detectedCvSkills = cvReport?.detectedSkills ?? suggestion?.skills ?? []
  const basis: MatchIntelligenceResult['basis'] = cleanCv ? 'cv-and-profile' : 'profile'

  const cvSkills = new Map(
    (cleanCv ? detectedCvSkills : profile.skills).map(
      (skill) => [canonicalSkill(skill), skill] as const,
    ),
  )
  const profileSkillKeys = new Map(
    profile.skills.map((skill) => [canonicalSkill(skill), skill] as const),
  )
  const enhancedProfile: Profile = {
    ...profile,
    skills: [...new Set([...profile.skills, ...detectedCvSkills])],
    targetRoleFamilies: [
      ...new Set([...profile.targetRoleFamilies, ...(suggestion?.roleFamilies ?? [])]),
    ],
  }
  const score = scoreJob(job, enhancedProfile)
  const opportunity = opportunityOf(job)
  const eligibility = eligibilityFor(job, enhancedProfile)

  const requirements = [
    ...skillRequirements(job, cleanCv, cvSkills, profileSkillKeys),
    experienceRequirement(job, cleanCv),
    educationRequirement(job, cleanCv),
    ...certificationRequirements(job, cleanCv),
    eligibilityRequirement(job, enhancedProfile),
    ...practicalRequirements(job, suggestion?.roleFamilies ?? [], enhancedProfile),
    ...languageRequirements(job, cleanCv),
  ].filter((item): item is MatchRequirement => Boolean(item))

  const dedupedRequirements = requirements.filter(
    (item, index, list) =>
      list.findIndex(
        (entry) =>
          entry.group === item.group && entry.label.toLowerCase() === item.label.toLowerCase(),
      ) === index,
  )

  const essential = dedupedRequirements.filter((item) => item.group === 'essential')
  const desirable = dedupedRequirements.filter((item) => item.group === 'desirable')
  const practical = dedupedRequirements.filter((item) => item.group === 'practical')
  const essentialPercent = groupPercentage(essential)
  const desirablePercent = groupPercentage(desirable)
  const practicalPercent = groupPercentage(practical)
  const evidencePercent = dedupedRequirements.length
    ? Math.round(
        (dedupedRequirements.filter((item) =>
          item.evidence.some(
            (line) => line.startsWith('Your CV:') || line.startsWith('Your profile:'),
          ),
        ).length /
          dedupedRequirements.length) *
          100,
      )
    : null

  const eligibilityScore =
    eligibility.tier === 'eligible' ? 100 : eligibility.tier === 'restricted' ? 0 : 45
  let fitScore =
    essentialPercent === null
      ? Math.round(score.score * 0.7 + eligibilityScore * 0.3)
      : Math.round(
          essentialPercent * 0.45 +
            score.score * 0.25 +
            (desirablePercent ?? essentialPercent) * 0.15 +
            eligibilityScore * 0.1 +
            (practicalPercent ?? 50) * 0.05,
        )
  if (eligibility.tier === 'restricted') fitScore = Math.min(fitScore, 35)
  if (essentialPercent !== null && essentialPercent < 25) fitScore = Math.min(fitScore, 55)
  fitScore = Math.max(0, Math.min(100, fitScore))

  let confidenceScore = 0
  if (job.description.trim().length >= 2500) confidenceScore += 2
  else if (job.description.trim().length >= 1000) confidenceScore += 1
  if (dedupedRequirements.length >= 8) confidenceScore += 2
  else if (dedupedRequirements.length >= 4) confidenceScore += 1
  if (
    dedupedRequirements.filter((item) => item.evidence.some((line) => line.startsWith('Advert:')))
      .length >= Math.ceil(dedupedRequirements.length * 0.6)
  ) {
    confidenceScore += 2
  }
  if (cleanCv.length >= 2500) confidenceScore += 1
  if (detectedCvSkills.length >= 5 || profile.skills.length >= 5) confidenceScore += 1
  if (eligibility.tier !== 'unknown') confidenceScore += 1
  const confidence: MatchIntelligenceResult['confidence'] =
    confidenceScore >= 7 ? 'high' : confidenceScore >= 4 ? 'medium' : 'low'

  const missingEssential = essential.filter((item) => item.status === 'missing')
  let verdict: MatchIntelligenceResult['verdict'] = 'possible-match'
  if (!cleanCv && profile.skills.length < 3) verdict = 'not-enough-evidence'
  else if (essentialPercent === null && confidence === 'low') verdict = 'not-enough-evidence'
  else if (eligibility.tier !== 'eligible') verdict = 'check-location-first'
  else if (essentialPercent !== null && essentialPercent >= 75 && missingEssential.length <= 1) {
    verdict = 'strong-match'
  } else if (essentialPercent !== null && essentialPercent >= 55) verdict = 'possible-match'
  else verdict = 'stretch'

  const headline =
    verdict === 'strong-match'
      ? 'Strong match on the evidence supplied'
      : verdict === 'possible-match'
        ? 'A realistic match with some gaps to address'
        : verdict === 'stretch'
          ? 'A stretch based on the evidence supplied'
          : verdict === 'check-location-first'
            ? eligibility.tier === 'restricted'
              ? 'Check eligibility before spending time on this'
              : 'Check location and eligibility before you decide'
            : 'Not enough evidence for a firm decision yet'

  const summaryParts: string[] = []
  if (essentialPercent !== null) {
    summaryParts.push(
      `Your evidence clearly covers ${essentialPercent}% of the essential requirements that could be scored.`,
    )
  }
  if (desirablePercent !== null) {
    summaryParts.push(`It covers ${desirablePercent}% of the desirable requirements.`)
  }
  if (eligibility.tier === 'restricted')
    summaryParts.push('The location signals are the main blocker.')
  else if (eligibility.tier === 'unknown') {
    summaryParts.push('Eligibility is not clear enough from the advert.')
  }
  if (opportunity.opportunityType === 'gig') {
    summaryParts.push(
      `This looks like ${opportunity.engagementLabel.toLowerCase()} work${opportunity.projectDuration ? ` for ${opportunity.projectDuration}` : ''}.`,
    )
  }
  if (!cleanCv)
    summaryParts.push('This view used your profile because no saved CV text was supplied.')
  const summary =
    summaryParts.join(' ') ||
    'The advert does not contain enough scored requirements for a firm view.'

  const strengths = dedupedRequirements
    .filter((item) => item.status === 'met')
    .slice(0, 6)
    .map((item) => `${item.label}: ${item.detail}`)
  const gaps = [
    ...essential.filter((item) => item.status === 'missing'),
    ...essential.filter((item) => item.status === 'partial'),
    ...dedupedRequirements.filter((item) => item.group === 'eligibility' && item.status !== 'met'),
    ...desirable.filter((item) => item.status === 'missing'),
  ]
    .filter(
      (item, index, list) =>
        list.findIndex((entry) => entry.group === item.group && entry.label === item.label) ===
        index,
    )
    .slice(0, 8)
    .map((item) => `${item.label}: ${item.detail}`)

  const actions: string[] = []
  if (missingEssential.length) {
    actions.push(
      `If you have used ${missingEssential
        .slice(0, 3)
        .map((item) => item.label)
        .join(', ')}, add the work and result to your CV. Do not add a skill you cannot support.`,
    )
  }
  const firstPartial = essential.find((item) => item.status === 'partial')
  if (firstPartial) {
    actions.push(
      `Add a clear project example for ${firstPartial.label}. State what you delivered and the result.`,
    )
  }
  if (eligibility.tier !== 'eligible') {
    actions.push('Confirm the accepted work locations before writing a long application.')
  }
  if (opportunity.opportunityType === 'gig') {
    actions.push(
      'Before you commit, confirm the scope, deadline, milestones, revisions, who owns the work, and when payment is released.',
    )
  }
  if (strengths.length) {
    actions.push(
      'Put your strongest matching result near the top of your CV summary and use the advert skill names where they are truthful.',
    )
  }
  if (job.sponsorship === 'available') {
    actions.push(
      'The advert records sponsorship as available. Confirm whether it covers your country and this exact role.',
    )
  }
  if (!actions.length) {
    actions.push(
      'Review the gaps below, then compare this advert with the stronger alternatives before applying.',
    )
  }

  const alternatives = buildAlternatives(
    job,
    alternativesPool,
    cleanCv,
    cvSkills,
    profileSkillKeys,
    enhancedProfile,
    essentialPercent,
    score.score,
    eligibility.tier,
  )
  if (alternatives.length) {
    actions.push(
      'Compare the stronger alternatives below before spending more time on this advert.',
    )
  }

  const limitations = [
    'This checks words and evidence in the advert and your CV or profile. It cannot judge the quality of your work.',
    'A skill missing from your CV may still be a skill you have.',
    'The employer or client makes the final decision.',
  ]
  if (job.description.trim().length < 1000) {
    limitations.push(
      'The available advert text is short, so some requirements may be missing from this check.',
    )
  }
  if (!cleanCv) {
    limitations.push(
      'Add your CV text for a stronger check based on work evidence, not profile skills alone.',
    )
  }

  return {
    jobId: job.id,
    generatedAt: new Date().toISOString(),
    basis,
    verdict,
    headline,
    summary,
    fitScore,
    essentialPercent,
    desirablePercent,
    evidencePercent,
    confidence,
    requirements: dedupedRequirements,
    strengths,
    gaps,
    actions: [...new Set(actions)].slice(0, 6),
    eligibility: {
      status:
        eligibility.tier === 'eligible'
          ? 'clear-signal'
          : eligibility.tier === 'restricted'
            ? 'possible-blocker'
            : 'needs-check',
      headline:
        eligibility.tier === 'eligible'
          ? 'Positive eligibility signal found'
          : eligibility.tier === 'restricted'
            ? 'Possible eligibility blocker found'
            : 'Eligibility needs checking',
      evidence: eligibility.evidence,
      notes: eligibility.notes,
    },
    alternatives,
    limitations,
  }
}
