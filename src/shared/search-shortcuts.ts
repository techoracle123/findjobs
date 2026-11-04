export interface SearchShortcut {
  id: string
  label: string
  search: string
}

/** Plain-language starting points for work people commonly look for by skill. */
export const POPULAR_SKILL_SEARCHES: SearchShortcut[] = [
  { id: 'wordpress', label: 'WordPress', search: 'WordPress' },
  { id: 'cybersecurity', label: 'Cybersecurity', search: 'cybersecurity' },
  { id: 'data-analytics', label: 'Data analytics', search: 'data analytics' },
  { id: 'video-editing', label: 'Video editing', search: 'video editor' },
  { id: 'frontend', label: 'Front-end development', search: 'front end developer' },
  { id: 'backend', label: 'Back-end development', search: 'back end developer' },
  { id: 'tutoring', label: 'Tutoring and teaching', search: 'tutor' },
  { id: 'web-development', label: 'Web development', search: 'web developer' },
  { id: 'penetration-testing', label: 'Penetration testing', search: 'penetration testing' },
  { id: 'graphic-design', label: 'Graphic design', search: 'graphic designer' },
  { id: 'virtual-assistance', label: 'Virtual assistance', search: 'virtual assistant' },
  { id: 'customer-support', label: 'Customer support', search: 'customer support' },
]
