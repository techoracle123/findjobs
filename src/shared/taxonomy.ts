import type { Seniority, WorkMode } from './types'

export const ROLE_FAMILIES = [
  'frontend',
  'backend',
  'fullstack',
  'data',
  'ml',
  'platform',
  'devops',
  'security',
  'product',
  'design',
  'qa',
  'mobile',
] as const

export type RoleFamily = (typeof ROLE_FAMILIES)[number]

export const SENIORITIES: Seniority[] = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'lead',
  'principal',
]

export const WORK_MODES: WorkMode[] = ['remote', 'hybrid', 'onsite']

export const ROLE_FAMILY_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Full-stack',
  data: 'Data',
  ml: 'Machine learning',
  platform: 'Platform',
  devops: 'DevOps',
  security: 'Security',
  product: 'Product',
  design: 'Design',
  qa: 'Quality assurance',
  mobile: 'Mobile',
}

export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  staff: 'Staff',
  lead: 'Lead',
  principal: 'Principal',
}

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
}

export function roleFamilyLabel(value: string): string {
  return ROLE_FAMILY_LABELS[value] ?? value
}

export function seniorityLabel(value: Seniority): string {
  return SENIORITY_LABELS[value] ?? value
}

export function workModeLabel(value: WorkMode): string {
  return WORK_MODE_LABELS[value] ?? value
}
