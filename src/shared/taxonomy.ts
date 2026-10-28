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
  'sales',
  'marketing',
  'customer-service',
  'administration',
  'finance',
  'healthcare',
  'education',
  'hospitality',
  'logistics',
  'human-resources',
  'legal',
  'engineering',
  'agriculture',
  'construction',
  'creative',
  'video',
  'data-engineering',
  'technical-writing',
  'social-impact',
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
  sales: 'Sales & business development',
  marketing: 'Marketing & communications',
  'customer-service': 'Customer service',
  administration: 'Administration & office support',
  finance: 'Finance & accounting',
  healthcare: 'Healthcare',
  education: 'Education & training',
  hospitality: 'Hospitality & tourism',
  logistics: 'Logistics & transport',
  'human-resources': 'Human resources',
  legal: 'Legal & compliance',
  engineering: 'Engineering & manufacturing',
  agriculture: 'Agriculture',
  construction: 'Construction & trades',
  creative: 'Creative & media',
  'social-impact': 'NGO & community work',
  unknown: 'Other roles',
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Full-stack',
  data: 'Data analytics & analysis',
  ml: 'Machine learning',
  platform: 'Platform',
  devops: 'DevOps',
  security: 'Cybersecurity & information security',
  video: 'Video editing & production',
  'data-engineering': 'Data engineering',
  'technical-writing': 'Technical writing & documentation',
  product: 'Product',
  design: 'Design',
  qa: 'Quality assurance',
  mobile: 'Mobile',
}

export const SENIORITY_LABELS: Record<Seniority, string> = {
  unknown: 'Level not stated',
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  staff: 'Staff',
  lead: 'Lead',
  principal: 'Principal',
}

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  unknown: 'Work arrangement not stated',
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
