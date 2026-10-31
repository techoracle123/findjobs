import { suggestFromKeywords } from '../shared/cv-suggest'
import { compareScoredJobs, scoreJob } from '../shared/scoring'
import { matchSkills } from '../shared/skills'
import { roleFamilyLabel } from '../shared/taxonomy'
import type {
  BestMatch,
  CvAnalysisReport,
  CvAnalysisSection,
  CvTargetRole,
  Job,
  Profile,
  SkillPlanResult,
} from '../shared/types'

function cvLinesOf(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function clipLine(line: string, limit = 220): string {
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function findCvLines(lines: string[], pattern: RegExp, limit = 3): string[] {
  const found: string[] = []
  for (const line of lines) {
    pattern.lastIndex = 0
    if (pattern.test(line)) found.push(clipLine(line))
    if (found.length >= limit) break
  }
  return found
}

function sectionRating(present: boolean, strong: boolean): CvAnalysisSection['rating'] {
  if (!present) return 'missing'
  return strong ? 'strong' : 'needs-work'
}

function yearsIn(text: string): number[] {
  return [...new Set([...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => Number(match[1])))]
    .filter((year) => year >= 1970 && year <= 2100)
    .sort((a, b) => b - a)
}

export function buildCvAnalysis(
  rawText: string,
  profile: Profile,
  jobs: Job[] = [],
  fileName = 'CV',
  generatedAt = new Date().toISOString(),
): CvAnalysisReport {
  const text = rawText.slice(0, 60_000)
  const lines = cvLinesOf(text)
  const lower = text.toLowerCase()
  const suggestion = suggestFromKeywords(text)
  const sectionSkills: string[] = []
  const skillsHeadingIndex = lines.findIndex((line) =>
    /^(?:skills|technical skills|core skills|core competencies|tools(?:\s+and\s+technologies)?)(?:\s*[:.-].*)?$/i.test(
      line,
    ),
  )
  if (skillsHeadingIndex >= 0) {
    const heading = lines[skillsHeadingIndex] ?? ''
    const inline = heading.includes(':') ? heading.slice(heading.indexOf(':') + 1) : ''
    const candidates = [inline, ...lines.slice(skillsHeadingIndex + 1, skillsHeadingIndex + 9)]
    for (const candidate of candidates) {
      if (
        /^(?:experience|education|projects?|summary|certifications?|references?|employment|work history)$/i.test(
          candidate.trim(),
        )
      )
        break
      if (!candidate.trim()) continue
      const hasDelimiters = /[,•|;/]/.test(candidate)
      if (!hasDelimiters && candidate.trim().split(/\s+/).length > 5) continue
      for (const rawToken of candidate.split(/[,•|;/]/)) {
        const token = rawToken
          .replace(/^[•\-*·\s]+|[.\s]+$/g, '')
          .replace(/^and\s+/i, '')
          .trim()
        if (
          token.length >= 2 &&
          token.length <= 36 &&
          token.split(/\s+/).length <= 4 &&
          /\p{L}/u.test(token) &&
          !sectionSkills.some((skill) => skill.toLowerCase() === token.toLowerCase())
        )
          sectionSkills.push(token)
      }
      if (sectionSkills.length >= 20) break
    }
  }
  const detectedSkills = [
    ...sectionSkills,
    ...suggestion.skills.filter(
      (skill) => !sectionSkills.some((found) => found.toLowerCase() === skill.toLowerCase()),
    ),
  ].slice(0, 20)
  const knownSkills = [...profile.skills, ...detectedSkills].filter(
    (skill, index, all) =>
      all.findIndex((candidate) => candidate.toLowerCase() === skill.toLowerCase()) === index,
  )
  const wordCount = (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu) ?? []).length
  const estimatedPages = Math.max(1, Math.round(wordCount / 550))

  const hasSummary =
    /\b(?:professional summary|profile summary|summary|objective|about me)\b/i.test(text)
  const hasExperience =
    /\b(?:work experience|professional experience|employment history|experience)\b/i.test(text)
  const hasEducation =
    /\b(?:education|university|polytechnic|college|b\.?sc|b\.?a\.?|hnd|ond|degree)\b/i.test(text)
  const hasSkills =
    /\b(?:skills|technical skills|core competencies|tools)\b/i.test(text) ||
    detectedSkills.length >= 4
  const hasProjects = /\b(?:projects?|portfolio|work samples?)\b/i.test(text)
  const hasCertifications = /\b(?:certifications?|certified|licen[cs]e|training)\b/i.test(text)
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
  const hasPhone = /(?:\+?234[\s-]?|0)[789][01](?:[\s-]?\d){8}|\+(?:[\s-]?\d){7,15}/.test(text)
  const hasProfileLink = /(?:linkedin\.com|github\.com|portfolio|https?:\/\/)/i.test(text)

  let inWorkSection = false
  const bulletLines = lines.flatMap((line) => {
    const cleanLine = line.replace(/^[•\-*·]\s*/, '').trim()
    if (
      /^(?:work experience|professional experience|employment history|work history|experience|projects?|portfolio|internships?|volunteer(?:ing| experience)?|industrial training|siwes|nysc experience)$/i.test(
        cleanLine,
      )
    ) {
      inWorkSection = true
      return []
    }
    if (
      /^(?:professional summary|profile summary|summary|objective|skills|technical skills|education|certifications?|training|references?|contact(?: details)?|languages?|interests?)$/i.test(
        cleanLine,
      )
    ) {
      inWorkSection = false
      return []
    }
    const markedBullet = /^[•\-*·]\s+/.test(line)
    if (!inWorkSection && !markedBullet) return []
    if (cleanLine.length < 18 || cleanLine.length > 360) return []
    // Job-title/date lines are useful CV structure, not weak achievement bullets.
    if (
      /\b(?:19|20)\d{2}\b/.test(cleanLine) &&
      /(?:-|–|—|\bto\b|\bpresent\b|\bcurrent\b)/i.test(cleanLine)
    )
      return []
    return /^[A-Za-z]/.test(cleanLine) ? [cleanLine] : []
  })
  const quantified = bulletLines.filter((line) =>
    /(?:\d|₦|\$|£|€|\bNGN\b|\bUSD\b|\bGBP\b|\bEUR\b|increased|reduced|saved|improved|grew|delivered)/i.test(
      line,
    ),
  )
  const actionVerb =
    /^(?:[•\-*·]\s*)?(?:built|created|developed|designed|delivered|improved|reduced|increased|led|managed|supported|prepared|handled|resolved|trained|wrote|tested|maintained|organised|organized|coordinated|sold|served|analysed|analyzed|recorded|processed)\b/i
  const actionLines = bulletLines.filter((line) => actionVerb.test(line))
  const weakStarts =
    /^(?:[•\-*·]\s*)?(?:responsible for|worked on|helped|assisted|tasked with|duties included|in charge of)\b/i
  const weakBullets = bulletLines
    .filter(
      (line) =>
        weakStarts.test(line) || (!actionVerb.test(line) && !/\d/.test(line) && line.length > 55),
    )
    .slice(0, 5)
    .map((line) => ({
      original: clipLine(line, 240),
      suggestion:
        '[Strong action verb] [the exact task] using [tool or method], which led to [result, amount or outcome you can prove].',
      reason:
        'This line mainly lists a duty. Make your own action and the result clear, using numbers only when they are true.',
    }))

  const allYears = yearsIn(text)
  const educationSegment = (() => {
    const start = lower.search(/\beducation\b/)
    if (start < 0) return ''
    const rest = lower.slice(start, start + 1800)
    const next = rest
      .slice(20)
      .search(/\b(?:experience|skills|projects?|certifications?|references?)\b/)
    return next > 0 ? rest.slice(0, next + 20) : rest
  })()
  const educationYears = yearsIn(educationSegment)
  const timelineNotes: string[] = []
  if (!allYears.length)
    timelineNotes.push('No clear years were found. Add start and end dates for education and work.')
  if (allYears.length && !/(?:present|current|now|\d{4}\s*(?:-|–|—|to)\s*\d{4})/i.test(text))
    timelineNotes.push('Years appear, but clear start-to-end ranges are hard to find.')
  if (educationYears.length)
    timelineNotes.push(`Education year detected: ${educationYears.slice(0, 3).join(', ')}.`)

  const earlyCareerSignals = findCvLines(
    lines,
    /\b(?:NYSC|national youth service|intern(?:ship)?|SIWES|industrial training|final.year project|volunteer|school project)\b/i,
    5,
  )

  const relevantJobs = jobs.filter(
    (job) => !job.isDemo && job.jobStatus !== 'closed' && job.roleFamily !== 'unknown',
  )
  const targetRoleOrder = [...profile.targetRoleFamilies, ...suggestion.roleFamilies]
  const byRole = new Map<string, Job[]>()
  for (const job of relevantJobs) {
    const group = byRole.get(job.roleFamily) ?? []
    group.push(job)
    byRole.set(job.roleFamily, group)
  }
  const targetRoles: CvTargetRole[] = [...byRole.entries()]
    .map(([roleFamily, roleJobs]) => {
      const matchedCounts = new Map<string, number>()
      const missingCounts = new Map<string, number>()
      let matchingJobs = 0
      for (const job of roleJobs) {
        const required = matchSkills(job.requiredSkills, knownSkills)
        for (const skill of required.matched)
          matchedCounts.set(skill, (matchedCounts.get(skill) ?? 0) + 1)
        for (const skill of required.missing)
          missingCounts.set(skill, (missingCounts.get(skill) ?? 0) + 1)
        if (
          required.matched.length > 0 &&
          required.matched.length >= Math.ceil(Math.max(1, job.requiredSkills.length) / 2)
        )
          matchingJobs += 1
        else if (job.requiredSkills.length === 0 && targetRoleOrder.includes(roleFamily))
          matchingJobs += 1
      }
      const byCount = (a: [string, number], b: [string, number]) =>
        b[1] - a[1] || a[0].localeCompare(b[0])
      return {
        roleFamily,
        label: roleFamilyLabel(roleFamily),
        matchingJobs,
        matchedSkills: [...matchedCounts.entries()]
          .sort(byCount)
          .slice(0, 6)
          .map(([skill]) => skill),
        missingSkills: [...missingCounts.entries()]
          .sort(byCount)
          .slice(0, 6)
          .map(([skill]) => skill),
      }
    })
    .filter((role) => role.matchingJobs > 0 || targetRoleOrder.includes(role.roleFamily))
    .sort((a, b) => {
      const aIndex = targetRoleOrder.indexOf(a.roleFamily)
      const bIndex = targetRoleOrder.indexOf(b.roleFamily)
      return (
        (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || b.matchingJobs - a.matchingJobs
      )
    })
    .slice(0, 4)

  const sections: CvAnalysisSection[] = [
    {
      title: 'Contact details',
      rating: sectionRating(emails.length > 0, emails.length > 0 && hasPhone && hasProfileLink),
      summary: emails.length
        ? 'An email address was found. Check that it is current and professional.'
        : 'No email address was found in the readable text.',
      evidence: [
        ...(hasPhone ? ['A phone number pattern was found.'] : []),
        ...(hasProfileLink ? ['A profile, portfolio or web link was found.'] : []),
      ],
      actions: [
        ...(!emails.length ? ['Add a current email address near your name.'] : []),
        ...(!hasPhone ? ['Add the phone number where employers can reach you.'] : []),
        ...(!hasProfileLink
          ? ['Add a professional profile or work-sample link if you have one.']
          : []),
      ],
    },
    {
      title: 'Professional summary',
      rating: sectionRating(hasSummary, hasSummary && detectedSkills.length >= 3),
      summary: hasSummary
        ? 'A summary section was found. It should name your target work, strongest skills and one proof point.'
        : 'No clear summary heading was found.',
      evidence: findCvLines(lines, /\b(?:summary|objective|profile)\b/i, 2),
      actions: hasSummary
        ? ['Keep the summary to three or four lines and tailor the first line to each target role.']
        : [
            'Add three lines: the work you do, your strongest evidenced skills, and one real result.',
          ],
    },
    {
      title: 'Skills and evidence',
      rating: sectionRating(hasSkills, detectedSkills.length >= 7 && quantified.length >= 2),
      summary: detectedSkills.length
        ? `${detectedSkills.length} skills were detected from the wording of your CV. Strong CVs also show where each important skill was used.`
        : 'Few recognised skills were detected in the readable text.',
      evidence: detectedSkills.slice(0, 8),
      actions: [
        'Put your strongest true skills where they are easy to scan.',
        'For each top skill, add one line showing the task, tool and result.',
      ],
    },
    {
      title: 'Experience results',
      rating: sectionRating(
        hasExperience,
        hasExperience && quantified.length >= 2 && actionLines.length >= 3,
      ),
      summary: hasExperience
        ? `${quantified.length} experience line${quantified.length === 1 ? '' : 's'} included a measurable result or outcome word.`
        : 'No clear experience section was found.',
      evidence: quantified.slice(0, 3).map((line) => clipLine(line)),
      actions: [
        'Turn duty-only bullets into action + task + result.',
        'Use numbers for money, people, records, time saved or work completed only when they are true.',
      ],
    },
    {
      title: 'Education and training',
      rating: sectionRating(hasEducation, hasEducation && educationYears.length > 0),
      summary: hasEducation
        ? 'Education information was found.'
        : 'No clear education information was found.',
      evidence: findCvLines(
        lines,
        /\b(?:education|university|polytechnic|college|B\.?Sc|HND|OND|degree)\b/i,
        3,
      ),
      actions: [
        'Show school, qualification and completion year clearly.',
        ...(hasCertifications
          ? []
          : ['Add relevant certifications or training with the year completed.']),
      ],
    },
    {
      title: 'Projects and work samples',
      rating: sectionRating(hasProjects, hasProjects && hasProfileLink),
      summary: hasProjects
        ? 'Project or portfolio wording was found. This is especially useful for early-career applicants.'
        : 'No clear project or work-sample section was found.',
      evidence: findCvLines(lines, /\b(?:project|portfolio|work sample)\b/i, 3),
      actions: hasProjects
        ? ['For each project, state what you personally did, the tools used and the outcome.']
        : [
            'Add school, NYSC, internship, volunteer or personal projects that prove your target skills.',
          ],
    },
    {
      title: 'Dates and timeline',
      rating: sectionRating(allYears.length > 0, allYears.length >= 3 && timelineNotes.length <= 1),
      summary: allYears.length
        ? `${allYears.length} distinct years were found.`
        : 'Dates are hard to follow.',
      evidence: timelineNotes,
      actions: ['Use the same date style throughout, for example Jan 2023 – Mar 2024.'],
    },
    {
      title: 'Length and readability',
      rating:
        wordCount >= 250 && estimatedPages <= 3
          ? 'strong'
          : wordCount >= 120
            ? 'needs-work'
            : 'missing',
      summary: `${wordCount.toLocaleString('en-US')} readable words, roughly ${estimatedPages} page${estimatedPages === 1 ? '' : 's'} of text.`,
      evidence: [],
      actions:
        estimatedPages > 3
          ? ['Remove old or repeated duties so the strongest recent evidence is easy to find.']
          : wordCount < 250
            ? [
                'Add evidence under experience, projects, education and skills rather than general claims.',
              ]
            : ['Keep headings clear and remove repeated phrases before tailoring for a job.'],
    },
  ]

  const strengths: string[] = []
  if (detectedSkills.length >= 5)
    strengths.push(`Clear skill signals: ${detectedSkills.slice(0, 5).join(', ')}.`)
  if (quantified.length >= 2)
    strengths.push('Some experience lines already show outcomes or measurable results.')
  if (hasProjects)
    strengths.push(
      'Projects or work samples are present, giving employers proof beyond job titles.',
    )
  if (earlyCareerSignals.length)
    strengths.push(
      'Early-career experience such as NYSC, internship, SIWES or projects is visible.',
    )
  if (!strengths.length)
    strengths.push(
      'The readable text gives a base to improve. Start with the priority fixes below.',
    )

  const priorityFixes: string[] = []
  if (!emails.length || !hasPhone)
    priorityFixes.push('Make current email and phone details easy to find at the top.')
  if (!hasSummary)
    priorityFixes.push('Add a short target-role summary with your strongest evidenced skills.')
  if (weakBullets.length)
    priorityFixes.push('Rewrite duty-only bullets so each one shows your action and result.')
  if (!quantified.length)
    priorityFixes.push('Add true numbers or outcomes to your strongest work examples.')
  if (!hasProjects && earlyCareerSignals.length)
    priorityFixes.push(
      'Turn NYSC, internship, SIWES or school work into a clear projects/experience section.',
    )
  if (!allYears.length) priorityFixes.push('Add clear dates to education and work history.')
  if (targetRoles[0]?.missingSkills.length)
    priorityFixes.push(
      `For ${targetRoles[0].label}, adverts often ask for ${targetRoles[0].missingSkills.slice(0, 3).join(', ')}. Add only skills you genuinely have, with evidence.`,
    )
  if (!priorityFixes.length)
    priorityFixes.push(
      'Tailor the summary and top bullets to each advert instead of sending the same version everywhere.',
    )

  const missingEvidenceQuestions = [
    'What result can you prove from your most relevant work: money, time, people, records, sales, quality or completion?',
    'Which tool or method did you personally use in your strongest work example?',
    'Do you have a link, sample, certificate or reference that supports your top three skills?',
  ]
  if (earlyCareerSignals.length)
    missingEvidenceQuestions.push(
      'What exactly did you deliver during NYSC, internship, SIWES or your final-year project?',
    )

  return {
    generatedAt,
    fileName,
    wordCount,
    lineCount: lines.length,
    estimatedPages,
    detectedSkills,
    roleFamilies: suggestion.roleFamilies,
    seniority: suggestion.seniority,
    summary: suggestion.summary,
    sections,
    strengths,
    priorityFixes: [...new Set(priorityFixes)].slice(0, 5),
    weakBullets,
    missingEvidenceQuestions,
    targetRoles,
    timeline: {
      years: allYears,
      educationYears,
      latestYear: allYears[0] ?? null,
      notes: timelineNotes,
    },
    earlyCareerSignals,
  }
}

export function buildBestMatches(
  jobs: Job[],
  profile: Profile,
  limit = 12,
  excludedIds: ReadonlySet<string> = new Set(),
): BestMatch[] {
  const scored = jobs
    .filter((job) => !job.isDemo && job.jobStatus !== 'closed' && !excludedIds.has(job.id))
    .map((job) => scoreJob(job, profile))
    .sort(compareScoredJobs)

  return scored.slice(0, Math.max(1, Math.min(30, limit))).map((entry) => {
    const reasons: string[] = []
    if (entry.matchedSkills.length)
      reasons.push(`Matches your skills: ${entry.matchedSkills.slice(0, 4).join(', ')}.`)
    for (const component of entry.components) {
      if (
        component.applicable &&
        component.earned >= component.weight * 0.6 &&
        !['requiredSkills', 'usefulSkills'].includes(component.key)
      )
        reasons.push(`${component.label}: ${component.detail}.`)
    }
    if (entry.job.locationCountry === 'NG') reasons.push('Based in Nigeria.')
    else if (entry.job.workMode === 'remote')
      reasons.push('Remote work. Check the advert evidence for Nigeria before applying.')
    if (entry.job.salaryMin > 0 || entry.job.salaryMax > 0)
      reasons.push('Salary is stated on the advert.')
    if (!reasons.length)
      reasons.push(
        'Closest available match from your current profile. Add more profile details to improve the order.',
      )
    return {
      job: {
        ...entry.job,
        description: entry.job.description.slice(0, 360),
        descriptionPreview: entry.job.description.length > 360,
      },
      score: entry.score,
      tier: entry.tier,
      tierReason: entry.tierReason,
      matchedSkills: entry.matchedSkills,
      missingSkills: entry.missingSkills,
      reasons: [...new Set(reasons)].slice(0, 4),
    }
  })
}

export function buildSkillPlan(
  jobs: Job[],
  profile: Profile,
  extraSkills: string[] = [],
): SkillPlanResult {
  const knownSkills = [...new Set([...profile.skills, ...extraSkills])]
  const openJobs = jobs.filter((job) => !job.isDemo && job.jobStatus !== 'closed')
  const targeted = profile.targetRoleFamilies.length
    ? openJobs.filter((job) => profile.targetRoleFamilies.includes(job.roleFamily))
    : openJobs
  // When the person has chosen target roles, never borrow unrelated roles
  // just to produce a plan. An honest empty result is better than bad advice.
  const sample = targeted.slice(0, 1500)
  if (!knownSkills.length) {
    return {
      available: false,
      message:
        'Add skills to your profile or analyse a CV first, so the plan can tell what is genuinely missing.',
      sampleJobs: sample.length,
      items: [],
    }
  }
  const counts = new Map<string, { label: string; count: number }>()
  for (const job of sample) {
    const missing = matchSkills(job.requiredSkills, knownSkills).missing
    for (const skill of missing) {
      const key = skill.toLowerCase()
      const current = counts.get(key) ?? { label: skill, count: 0 }
      current.count += 1
      counts.set(key, current)
    }
  }
  const items = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((item, index) => ({
      skill: item.label,
      advertsAsking: item.count,
      week: Math.min(4, Math.floor(index / 2) + 1),
      action: `Learn the core tasks involved in ${item.label} and practise them on a small, realistic example.`,
      proofToBuild: `Create one work sample, project note or before-and-after example that proves you can use ${item.label}. Add it to your CV only when you can explain it in an interview.`,
    }))
  return {
    available: items.length > 0,
    message: items.length
      ? 'Built from required skills repeated across live adverts in your target area.'
      : sample.length
        ? 'No repeated required-skill gap was found in the current target adverts. Focus on stronger evidence for the skills you already have.'
        : 'No live adverts in your target area were available for this plan yet. Try again when new matching jobs appear.',
    sampleJobs: sample.length,
    items,
  }
}
