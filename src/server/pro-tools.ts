import type {
  ApplicationAnswers,
  CvCheckResult,
  InterviewPrep,
  Job,
  PreparedApplication,
  Profile,
  SalaryGuideResult,
  SalaryPeriod,
  Seniority,
  WorkMode,
} from '../shared/types'
import { scoreJob } from '../shared/scoring'
import { matchSkills } from '../shared/skills'
import { suggestFromKeywords } from '../shared/cv-suggest'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'

export const EMPTY_APPLICATION_ANSWERS: ApplicationAnswers = {
  fullName: '',
  phone: '',
  location: '',
  portfolioUrl: '',
  linkedinUrl: '',
  summary: '',
  whyFit: '',
  achievement: '',
  availability: '',
  salaryExpectation: '',
  workPermission: '',
}

const ANSWER_LIMITS: Record<keyof ApplicationAnswers, number> = {
  fullName: 120,
  phone: 40,
  location: 160,
  portfolioUrl: 300,
  linkedinUrl: 300,
  summary: 1200,
  whyFit: 1200,
  achievement: 1200,
  availability: 300,
  salaryExpectation: 300,
  workPermission: 500,
}

function clean(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

export function normaliseApplicationAnswers(input: unknown): ApplicationAnswers {
  const raw = input && typeof input === 'object' ? (input as Partial<ApplicationAnswers>) : {}
  return {
    fullName: clean(raw.fullName, ANSWER_LIMITS.fullName),
    phone: clean(raw.phone, ANSWER_LIMITS.phone),
    location: clean(raw.location, ANSWER_LIMITS.location),
    portfolioUrl: clean(raw.portfolioUrl, ANSWER_LIMITS.portfolioUrl),
    linkedinUrl: clean(raw.linkedinUrl, ANSWER_LIMITS.linkedinUrl),
    summary: clean(raw.summary, ANSWER_LIMITS.summary),
    whyFit: clean(raw.whyFit, ANSWER_LIMITS.whyFit),
    achievement: clean(raw.achievement, ANSWER_LIMITS.achievement),
    availability: clean(raw.availability, ANSWER_LIMITS.availability),
    salaryExpectation: clean(raw.salaryExpectation, ANSWER_LIMITS.salaryExpectation),
    workPermission: clean(raw.workPermission, ANSWER_LIMITS.workPermission),
  }
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** Finds an apply-by-email address only when the listing itself provides one. */
export function findApplicationEmail(job: Job): string | null {
  const apply = job.applyUrl?.trim() ?? ''
  if (/^mailto:/i.test(apply)) {
    const address = decodeURIComponent(apply.slice(7).split('?')[0]).trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null
  }
  const candidates = [...`${job.description}\n${apply}`.matchAll(EMAIL_PATTERN)].map((match) =>
    match[0].toLowerCase(),
  )
  const placeholders = new Set([
    'example@example.com',
    'name@example.com',
    'email@example.com',
    'you@example.com',
    'yourname@example.com',
  ])
  return candidates.find((email) => !placeholders.has(email)) ?? null
}

function joined(values: string[], fallback: string): string {
  return values.length ? values.join(', ') : fallback
}

export function buildPreparedApplication(
  job: Job,
  profile: Profile,
  answers: ApplicationAnswers,
  accountEmail = '',
  generatedAt = new Date().toISOString(),
  cvText = '',
): PreparedApplication {
  const detectedSkills = cvText.trim().length >= 40 ? suggestFromKeywords(cvText).skills : []
  const effectiveProfile: Profile = {
    ...profile,
    skills: [...new Set([...profile.skills, ...detectedSkills])],
  }
  const scored = scoreJob(job, effectiveProfile)
  const matched = [...new Set(scored.matchedSkills)].slice(0, 6)
  const company = job.company || 'your organisation'
  const missingInfo: string[] = []
  if (!answers.fullName) missingInfo.push('your full name')
  if (!answers.summary) missingInfo.push('a short summary of your experience')
  if (!answers.achievement) missingInfo.push('one relevant result or work example')
  if (!answers.availability) missingInfo.push('when you can start')
  if (!answers.workPermission) missingInfo.push('your work permission or location position')

  const summary =
    answers.summary ||
    (matched.length
      ? `I have hands-on experience with ${joined(matched, 'the work in this role')}. [Add your years of experience, current or most recent role, and the result you are most proud of.]`
      : '[Add a short summary of your experience, the work you do best, and one result you can prove.]')
  const whyFit =
    answers.whyFit ||
    `I am applying for the ${job.title} role at ${company} because the work matches my experience with ${joined(matched, 'the responsibilities in the advert')}. I would bring careful delivery, clear communication and a practical focus on results. [Check this against your real experience before sending.]`
  const achievement =
    answers.achievement ||
    '[Add one real example: the task, what you personally did, and the result. Use numbers only when they are true.]'
  const contact = [
    answers.fullName || '[Your full name]',
    answers.phone,
    accountEmail,
    answers.location,
    answers.portfolioUrl,
    answers.linkedinUrl,
  ].filter(Boolean)

  const coverLetter = [
    `Dear ${company} team,`,
    '',
    `I am writing to apply for the ${job.title} role.`,
    '',
    summary,
    '',
    whyFit,
    '',
    `A relevant example of my work: ${achievement}`,
    '',
    answers.workPermission
      ? `Work and location position: ${answers.workPermission}`
      : '[Add where you are based and whether you can work in the stated location or arrangement.]',
    answers.availability
      ? `Availability: ${answers.availability}`
      : '[Add when you can start or your notice period.]',
    '',
    'My CV is attached. Thank you for considering my application. I would welcome the chance to discuss how my experience fits the role.',
    '',
    'Kind regards,',
    ...contact,
  ].join('\n')

  const subject = answers.fullName
    ? `Application for ${job.title} - ${answers.fullName}`
    : `Application for ${job.title}`
  const recipientEmail = findApplicationEmail(job)
  const emailBody = coverLetter
  const mailtoUrl = recipientEmail
    ? `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody.slice(0, 1800))}`
    : null

  return {
    jobId: job.id,
    generatedAt,
    subject,
    coverLetter,
    emailBody,
    recipientEmail,
    mailtoUrl,
    answers: [
      { question: 'Why are you a good fit for this role?', answer: whyFit },
      { question: 'Tell us about your relevant experience.', answer: summary },
      { question: 'What relevant result are you most proud of?', answer: achievement },
      {
        question: 'Where are you based, and can you work in this arrangement?',
        answer:
          answers.workPermission ||
          answers.location ||
          '[State where you live, whether you can attend the stated location, and any visa or work-permit position honestly.]',
      },
      {
        question: 'When can you start?',
        answer: answers.availability || '[State your earliest start date or notice period.]',
      },
      {
        question: 'What salary do you expect?',
        answer:
          answers.salaryExpectation ||
          'I am open to the approved range for the role and happy to discuss pay once we have covered the responsibilities and full package.',
      },
      {
        question: 'Portfolio or work sample link',
        answer:
          answers.portfolioUrl ||
          answers.linkedinUrl ||
          '[Add a portfolio, profile or work-sample link if you have one. Remove anything confidential first.]',
      },
    ],
    checklist: [
      'Replace every line in square brackets with your own true details.',
      'Attach the current version of your CV before you send.',
      'Check the closing date, location and work arrangement on the original advert.',
      'Never pay a fee to apply, train or be interviewed.',
    ],
    missingInfo,
  }
}

function normalisedText(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `
}

function skillMentioned(text: string, skill: string): boolean {
  const phrase = normalisedText(skill).trim()
  return phrase.length > 1 && text.includes(` ${phrase} `)
}

function compareSkills(jobSkills: string[], knownSkills: string[], cvText: string) {
  const fromLists = matchSkills(jobSkills, knownSkills)
  const matched = new Set(fromLists.matched)
  const haystack = normalisedText(cvText)
  for (const skill of jobSkills) {
    if (skillMentioned(haystack, skill)) matched.add(skill)
  }
  return {
    matched: jobSkills.filter((skill) => matched.has(skill)),
    missing: jobSkills.filter((skill) => !matched.has(skill)),
  }
}

export function buildCvCheck(job: Job, profile: Profile, cvText = ''): CvCheckResult {
  const cv = cvText.trim().slice(0, 30_000)
  const detected = cv.length >= 40 ? suggestFromKeywords(cv).skills : []
  const knownSkills = [...new Set([...profile.skills, ...detected])]
  const required = compareSkills(job.requiredSkills, knownSkills, cv)
  const useful = compareSkills(job.usefulSkills, knownSkills, cv)
  const requiredPercent = job.requiredSkills.length
    ? Math.round((required.matched.length / job.requiredSkills.length) * 100)
    : null
  const usefulPercent = job.usefulSkills.length
    ? Math.round((useful.matched.length / job.usefulSkills.length) * 100)
    : null
  const overallPercent =
    requiredPercent !== null && usefulPercent !== null
      ? Math.round(requiredPercent * 0.8 + usefulPercent * 0.2)
      : (requiredPercent ?? usefulPercent)

  const actions: string[] = []
  if (!cv && profile.skills.length === 0) {
    actions.push(
      'Add skills to your profile or paste your CV text so the check has something true to compare.',
    )
  }
  for (const skill of required.matched.slice(0, 3)) {
    actions.push(
      `Make ${skill} easy to find: keep it in your skills section and show one real result where you used it.`,
    )
  }
  if (required.missing.length) {
    actions.push(
      `Missing from the advert check: ${required.missing.slice(0, 6).join(', ')}. Add any you genuinely have, with where you used them. Do not add a skill only to match the advert.`,
    )
    actions.push(
      `If ${required.missing[0]} is a real gap, use it as your first learning target and be ready to explain what you are doing to close it.`,
    )
  }
  if (useful.missing.length) {
    actions.push(
      `Useful skills not found: ${useful.missing.slice(0, 5).join(', ')}. These matter less than the required skills.`,
    )
  }
  if (!required.missing.length && job.requiredSkills.length) {
    actions.push(
      'Every required skill named in the advert was found. Spend your time making the evidence and results clearer.',
    )
  }

  const scored = scoreJob(job, profile)
  const fitNotes = scored.components
    .filter(
      (component) =>
        component.applicable && !['requiredSkills', 'usefulSkills'].includes(component.key),
    )
    .map((component) => `${component.label}: ${component.detail}.`)
  fitNotes.push(scored.tierReason)

  const cvLines = cv
    .split(/\n+/)
    .map((line) => line.replace(/^[•\-*·\s]+/, '').trim())
    .filter((line) => line.length >= 18)
  const evidence = [...required.matched, ...useful.matched].slice(0, 6).flatMap((skill) => {
    const candidates = cvLines
      .filter((candidate) => candidate.toLowerCase().includes(skill.toLowerCase()))
      .map((candidate) => {
        const lower = candidate.toLowerCase()
        let rank = Math.min(candidate.length, 180) / 18
        if (
          /\b(built|developed|delivered|created|designed|implemented|improved|led|managed|launched|maintained|reduced|increased|automated|supported|trained|sold|processed|analysed|analyzed)\b/.test(
            lower,
          )
        )
          rank += 8
        if (/\d|%|₦|\$|£|€/.test(candidate)) rank += 3
        if (/^(skills?|tools?|technologies|summary|profile|objective)\b/.test(lower)) rank -= 8
        if ((candidate.match(/,/g) ?? []).length >= 3 && candidate.length < 90) rank -= 4
        return { candidate, rank }
      })
      .sort((a, b) => b.rank - a.rank)
    const line = candidates[0]?.candidate
    return line ? [{ skill, line: line.slice(0, 240) }] : []
  })
  const topMatched = [...required.matched, ...useful.matched].slice(0, 4)
  const tailoredSummary = topMatched.length
    ? `Experience relevant to ${job.title}, with evidenced work in ${topMatched.join(', ')}. [Add your role, years of experience and one result you can prove.]`
    : ''

  return {
    basis: cv ? 'cv-and-profile' : 'profile',
    requiredMatched: required.matched,
    requiredMissing: required.missing,
    usefulMatched: useful.matched,
    usefulMissing: useful.missing,
    requiredPercent,
    overallPercent,
    actions: [...new Set(actions)].slice(0, 6),
    fitNotes,
    message:
      overallPercent === null
        ? 'This advert does not name enough skills for a percentage. Use the fit notes and original advert.'
        : 'This is a wording and evidence check against the advert. It is not a hiring prediction.',
    evidence,
    tailoredSummary,
  }
}

const ROLE_TOPICS: Record<string, string> = {
  frontend:
    'building a responsive interface, handling loading and error states, and keeping it accessible',
  backend: 'designing an API, protecting data, and handling failure without losing work',
  fullstack: 'taking one feature from the user interface through the API to stored data',
  data: 'cleaning messy data, checking a result, and explaining it in plain language',
  healthcare: 'safe care, accurate records, escalation, and protecting patient privacy',
  sales: 'finding the right customer, handling an objection, and following up without pressure',
  marketing: 'choosing an audience, making a clear message, and measuring what happened',
  'customer-service':
    'calming an unhappy customer and solving the issue without promising what you cannot deliver',
  administration: 'keeping records accurate when several urgent requests arrive together',
  finance: 'checking figures, spotting a mismatch, and keeping a clear audit trail',
  education: 'planning a lesson, checking understanding, and helping a learner who is behind',
  logistics: 'keeping deliveries moving when a vehicle, route or supplier problem appears',
  engineering:
    'working safely, reading the requirement carefully, and proving the finished work meets it',
  design: 'turning a rough request into a clear design and explaining your choices',
  product: 'choosing what to build first when time and people are limited',
}

export function buildInterviewPrep(
  job: Job,
  profile: Profile,
  answers: ApplicationAnswers,
): InterviewPrep {
  const scored = scoreJob(job, profile)
  const matched = [...new Set(scored.matchedSkills)].slice(0, 4)
  const missing = scored.missingSkills.slice(0, 3)
  const topSkill = matched[0] || job.requiredSkills[0] || 'the main work in this role'
  const topic = ROLE_TOPICS[job.roleFamily] || 'handling the main responsibilities in the advert'
  const intro = [
    answers.summary || `I have experience relevant to ${job.title}.`,
    matched.length ? `My strongest matching skills for this role are ${matched.join(', ')}.` : '',
    answers.achievement
      ? `One example is: ${answers.achievement}`
      : '[Add one short example with the task, your action and the result.]',
    `I am interested in this role because [name one true reason taken from the advert].`,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    intro,
    questions: [
      {
        question: 'Tell me about yourself.',
        prepare:
          'Use the 60-second introduction above. Keep it about relevant work, not your whole life story.',
      },
      {
        question: `Why do you want the ${job.title} role here?`,
        prepare:
          'Name two true points from the original advert. Do not invent facts about the company.',
      },
      {
        question: `Walk me through your work with ${topSkill}.`,
        prepare: 'Use one real example: the situation, your task, what you did, and the result.',
      },
      {
        question: `How would you approach ${topic}?`,
        prepare:
          'Explain your first checks, the order you would work in, and how you would know the job was done well.',
      },
      {
        question: 'Tell me about a difficult problem or disagreement at work.',
        prepare:
          'Show the facts, your own action, what changed, and what you learned. Do not blame the other person.',
      },
      {
        question: missing.length
          ? `What is your experience with ${missing.join(', ')}?`
          : 'What is one area you are still improving?',
        prepare: missing.length
          ? 'Answer honestly. Say what you know now, any related experience, and the exact step you are taking to learn it.'
          : 'Choose a real, non-fatal gap and show the step you are already taking to improve.',
      },
      {
        question:
          job.workMode === 'remote'
            ? 'How do you organise remote work and communication?'
            : 'Can you work at the stated location and pattern?',
        prepare:
          job.workMode === 'remote'
            ? 'Cover your workspace, internet and power backup, daily updates, and time-zone overlap honestly.'
            : `Confirm the location (${job.locationLabel}), travel plan, work pattern and start date before you promise anything.`,
      },
      {
        question: 'What would you do in your first 30 days?',
        prepare:
          'Say what you would learn first, who you would meet, and one small useful result you would aim for.',
      },
    ],
    examplesToPrepare: (matched.length ? matched : job.requiredSkills.slice(0, 3)).map(
      (skill) =>
        `${skill}: prepare one story in this order: situation, your task, your action, result. Use numbers only when they are true.`,
    ),
    questionsToAsk: [
      'What would success in this role look like after three months?',
      'What is the biggest challenge the person in this role will face first?',
      'Who would I work with most closely, and who reviews the work?',
      'What are the next steps and when should I expect to hear from you?',
    ],
    checklist: [
      'Read the original advert again and keep the role title, location and work pattern in front of you.',
      'Confirm the interview invite came through an official channel. Never pay for an interview or training.',
      'Prepare your CV, one work example, and any certificates the advert truly asks for.',
      job.workMode === 'remote'
        ? 'Test your internet, sound, camera and power backup before the call.'
        : 'Plan the route and arrival time for the stated location.',
    ],
  }
}

export interface SalaryGuideFilters {
  roleFamily?: string
  country?: string
  workMode?: WorkMode
  seniority?: Seniority
  currency?: string
  period?: SalaryPeriod
  query?: string
}

function salaryValues(job: Job): { midpoint: number; low: number; high: number } | null {
  if (job.quality && !job.quality.salaryPlausible) return null
  const values = [job.salaryMin, job.salaryMax].filter(
    (value) => Number.isFinite(value) && value > 0,
  )
  if (!values.length || !job.salaryCurrency || job.salaryPeriod === 'unknown') return null
  const low = Math.min(...values)
  const high = Math.max(...values)
  return { midpoint: values.length === 2 ? (low + high) / 2 : low, low, high }
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function matchesSalaryFilters(job: Job, filters: SalaryGuideFilters): boolean {
  if (job.jobStatus === 'closed' || job.isDemo) return false
  if (filters.roleFamily && job.roleFamily !== filters.roleFamily) return false
  if (filters.country && job.locationCountry.toUpperCase() !== filters.country) return false
  if (filters.workMode && job.workMode !== filters.workMode) return false
  if (filters.seniority && job.seniority !== filters.seniority) return false
  if (filters.query) {
    const text = `${job.title} ${job.company} ${job.description}`.toLowerCase()
    if (!text.includes(filters.query.toLowerCase())) return false
  }
  return true
}

function scopeLabel(filters: SalaryGuideFilters): string {
  const parts = [filters.roleFamily ? roleFamilyLabel(filters.roleFamily) : 'All professions']
  if (filters.country) parts.push(filters.country)
  if (filters.workMode) parts.push(workModeLabel(filters.workMode))
  if (filters.seniority) parts.push(seniorityLabel(filters.seniority))
  if (filters.query) parts.push(`matching “${filters.query}”`)
  return parts.join(' · ')
}

export function buildSalaryGuide(
  jobs: Job[],
  filters: SalaryGuideFilters,
  updatedAt: string | null = null,
): SalaryGuideResult {
  const attempts: SalaryGuideFilters[] = [
    filters,
    { ...filters, seniority: undefined },
    { ...filters, seniority: undefined, workMode: undefined },
    { ...filters, seniority: undefined, workMode: undefined, country: undefined },
    {
      roleFamily: filters.roleFamily,
      currency: filters.currency,
      period: filters.period,
    },
  ]
  const seen = new Set<string>()
  let largestSample = 0

  for (const attempt of attempts) {
    const key = JSON.stringify(attempt)
    if (seen.has(key)) continue
    seen.add(key)
    const groups = new Map<string, { jobs: Job[]; currency: string; period: SalaryPeriod }>()
    for (const job of jobs) {
      if (!matchesSalaryFilters(job, attempt)) continue
      const salary = salaryValues(job)
      if (!salary) continue
      const currency = job.salaryCurrency.toUpperCase()
      if (filters.currency && currency !== filters.currency) continue
      if (filters.period && job.salaryPeriod !== filters.period) continue
      const groupKey = `${currency}:${job.salaryPeriod}`
      const group = groups.get(groupKey) ?? { jobs: [], currency, period: job.salaryPeriod }
      group.jobs.push(job)
      groups.set(groupKey, group)
    }
    const group = [...groups.values()].sort((a, b) => b.jobs.length - a.jobs.length)[0]
    if (!group) continue
    largestSample = Math.max(largestSample, group.jobs.length)
    if (group.jobs.length < 3) continue
    const values = group.jobs.flatMap((job) => {
      const salary = salaryValues(job)
      return salary ? [salary] : []
    })
    const midpoints = values.map((value) => value.midpoint).sort((a, b) => a - b)
    return {
      available: true,
      message: 'Based only on live FJ adverts that stated pay. It is a guide, not an offer.',
      sampleCount: group.jobs.length,
      scope: scopeLabel(attempt),
      currency: group.currency,
      period: group.period,
      medianMidpoint: Math.round(percentile(midpoints, 0.5)),
      lowerQuartileMidpoint: Math.round(percentile(midpoints, 0.25)),
      upperQuartileMidpoint: Math.round(percentile(midpoints, 0.75)),
      lowest: Math.round(Math.min(...values.map((value) => value.low))),
      highest: Math.round(Math.max(...values.map((value) => value.high))),
      updatedAt,
    }
  }

  return {
    available: false,
    message:
      largestSample > 0
        ? `Only ${largestSample} matching advert${largestSample === 1 ? '' : 's'} stated pay, so there is not enough real data for a guide yet.`
        : 'No matching live adverts stated pay, so there is no salary guide for this choice yet.',
    sampleCount: largestSample,
    scope: scopeLabel(filters),
    currency: filters.currency ?? null,
    period: filters.period ?? null,
    medianMidpoint: null,
    lowerQuartileMidpoint: null,
    upperQuartileMidpoint: null,
    lowest: null,
    highest: null,
    updatedAt,
  }
}

export { buildBestMatches, buildCvAnalysis, buildSkillPlan } from './pro-analysis'
