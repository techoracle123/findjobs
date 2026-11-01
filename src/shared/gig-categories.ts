import type { Job } from './types'

/**
 * Detailed gig categories.
 *
 * The broad profession taxonomy is useful for jobs, but it is too coarse for
 * short-term work: "Creative" does not tell a video editor, photo retoucher or
 * penetration tester whether a gig is for them. These labels are derived only
 * from wording and skills already present in the advert. They add a clearer
 * label and search shortcut; they never turn an ordinary job into a gig.
 */

export interface GigCategory {
  id: string
  label: string
  /** Query used by the public search when a person chooses this category. */
  search: string
  pattern: RegExp
}

export const GIG_CATEGORIES: GigCategory[] = [
  {
    id: 'web-development',
    label: 'Web development',
    search: 'web developer',
    pattern:
      /\b(web\s+(?:developer|development|designer|app|application)|website\s+(?:developer|development|designer|build)|front[- ]?end|full[- ]?stack|wordpress|shopify|webflow|react(?:\.js)?|next\.js|vue(?:\.js)?|angular|landing page developer)\b/i,
  },
  {
    id: 'software-apps',
    label: 'Software and apps',
    search: 'software developer',
    pattern:
      /\b(software\s+(?:developer|engineer|development)|mobile\s+(?:app\s+)?(?:developer|engineer)|ios developer|android developer|flutter developer|react native|back[- ]?end\s+(?:developer|engineer)|api developer|devops|site reliability|qa engineer|test automation|programmer|app developer)\b/i,
  },
  {
    id: 'cybersecurity',
    label: 'Cybersecurity',
    search: 'cybersecurity',
    pattern:
      /\b(cyber\s?security|information security|infosec|security\s+(?:engineer|analyst|architect|consultant|specialist|operations)|soc analyst|application security|appsec|cloud security|network security|siem|incident response|threat\s+(?:hunting|intelligence)|security operations)\b/i,
  },
  {
    id: 'penetration-testing',
    label: 'Penetration testing',
    search: 'penetration testing',
    pattern:
      /\b(penetration test(?:ing|er)?|pentest(?:ing|er)?|pen test(?:ing|er)?|red team|offensive security|vulnerability assessment|ethical hack(?:ing|er)?)\b/i,
  },
  {
    id: 'video-editing',
    label: 'Video editing',
    search: 'video editing',
    pattern:
      /\b(video\s+(?:editor|editing|producer|production|content creator)|videograph(?:er|y)|motion\s+(?:graphics|designer)|premiere pro|after effects|final cut|capcut|short-form video|reels editor)\b/i,
  },
  {
    id: 'photo-editing',
    label: 'Photo editing',
    search: 'photo editing',
    pattern:
      /\b(photo\s+(?:editor|editing|retoucher|retouching)|photograph(?:er|y)|image\s+(?:editor|editing|retouching)|lightroom|photo manipulation)\b/i,
  },
  {
    id: 'design',
    label: 'Design',
    search: 'designer',
    pattern:
      /\b(graphic designer|brand designer|visual designer|ui\/?ux|ux designer|ui designer|product designer|illustrat(?:or|ion)|logo designer|presentation designer|figma designer|canva designer|designer)\b/i,
  },
  {
    id: 'data-analytics',
    label: 'Data and analytics',
    search: 'data analyst',
    pattern:
      /\b(data\s+(?:analyst|analytics|scientist|science|engineer|engineering|visualization|visualisation)|business intelligence|power bi|tableau|looker|sql analyst|machine learning|statistical analyst)\b/i,
  },
  {
    id: 'writing-content',
    label: 'Writing and content',
    search: 'writer',
    pattern:
      /\b(copywriter|content\s+(?:writer|writing|creator|editor|strategist)|technical writer|grant writer|script\s?writer|ghostwriter|blog writer|seo writer|proofreader|editorial)\b/i,
  },
  {
    id: 'marketing-social',
    label: 'Marketing and social media',
    search: 'marketing',
    pattern:
      /\b(social media\s+(?:manager|marketer|specialist|coordinator)|digital marketing|marketing\s+(?:specialist|consultant|manager|coordinator)|seo specialist|search engine optimization|paid\s+(?:media|social|search)|\bppc\b|email marketing|growth marketer|community manager|brand ambassador)\b/i,
  },
  {
    id: 'business-support',
    label: 'Business support',
    search: 'virtual assistant',
    pattern:
      /\b(virtual assistant|administrative\s+(?:assistant|support)|admin support|data entry|bookkeep(?:er|ing)|customer\s+(?:support|service)|operations\s+(?:assistant|support|coordinator)|project\s+(?:coordinator|support)|research assistant|executive assistant|online business manager|personal assistant)\b/i,
  },
]

const BY_ID = new Map(GIG_CATEGORIES.map((category) => [category.id, category]))

// More specific work wins over a broader neighbouring label. A penetration
// tester is not merely "cybersecurity" here, and a video editor is not merely
// "design" if the advert also asks for thumbnails or graphics.
const DETECTION_ORDER = [
  'penetration-testing',
  'cybersecurity',
  'video-editing',
  'photo-editing',
  'web-development',
  'data-analytics',
  'design',
  'software-apps',
  'writing-content',
  'marketing-social',
  'business-support',
]

const ROLE_FALLBACK: Record<string, string> = {
  video: 'video-editing',
  security: 'cybersecurity',
  data: 'data-analytics',
  'data-engineering': 'data-analytics',
  ml: 'data-analytics',
  design: 'design',
  frontend: 'web-development',
  fullstack: 'web-development',
  backend: 'software-apps',
  mobile: 'software-apps',
  platform: 'software-apps',
  devops: 'software-apps',
  qa: 'software-apps',
  'technical-writing': 'writing-content',
  marketing: 'marketing-social',
  administration: 'business-support',
  'customer-service': 'business-support',
}

export interface GigCategoryInput {
  title?: string
  description?: string
  roleFamily?: string
  requiredSkills?: string[]
  usefulSkills?: string[]
  tags?: string[]
}

function firstMatch(text: string): GigCategory | null {
  if (!text.trim()) return null
  for (const id of DETECTION_ORDER) {
    const category = BY_ID.get(id)
    if (category && category.pattern.test(text)) return category
  }
  return null
}

export function gigCategoryFor(input: GigCategoryInput | Job): GigCategory | null {
  const titleMatch = firstMatch(input.title ?? '')
  if (titleMatch) return titleMatch

  const skillText = [
    ...('requiredSkills' in input ? (input.requiredSkills ?? []) : []),
    ...('usefulSkills' in input ? (input.usefulSkills ?? []) : []),
    ...('tags' in input ? (input.tags ?? []) : []),
  ].join(' ')
  const skillMatch = firstMatch(skillText)
  if (skillMatch) return skillMatch

  const descriptionMatch = firstMatch((input.description ?? '').slice(0, 5000))
  if (descriptionMatch) return descriptionMatch

  const fallback = input.roleFamily ? BY_ID.get(ROLE_FALLBACK[input.roleFamily] ?? '') : undefined
  return fallback ?? null
}

export function gigCategoryLabel(input: GigCategoryInput | Job): string {
  return gigCategoryFor(input)?.label ?? ''
}
