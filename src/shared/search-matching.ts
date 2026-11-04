/**
 * Shared search matching for the browser and the public snapshot.
 *
 * People do not all name the same work in the same way. "Frontend",
 * "front-end" and "front end" should find the same adverts, and a search for
 * data analytics should not miss a role titled Data Analyst. The variants are
 * deliberately narrow: this is spelling and naming help, not a promise that
 * loosely related work is the same job.
 */

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9+# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchTerms(query: string): string[] {
  return normalizeSearchText(query).split(' ').filter(Boolean)
}

const TERM_VARIANTS: Record<string, string[]> = {
  frontend: ['frontend', 'front end'],
  backend: ['backend', 'back end'],
  fullstack: ['fullstack', 'full stack'],
  cybersecurity: ['cybersecurity', 'cyber security', 'information security', 'infosec'],
  infosec: ['infosec', 'information security', 'cybersecurity', 'cyber security'],
  pentest: ['pentest', 'penetration test'],
  pentester: ['pentester', 'penetration test'],
  pentesting: ['pentesting', 'penetration test'],
  penetration: ['penetration', 'pentest'],
  wordpress: ['wordpress', 'word press'],
  woocommerce: ['woocommerce', 'woo commerce'],
  tutor: ['tutor', 'teach', 'instructor'],
  tutors: ['tutor', 'teach', 'instructor'],
  tutoring: ['tutor', 'teach', 'instructor'],
  teacher: ['teacher', 'teach', 'tutor', 'instructor'],
  teachers: ['teacher', 'teach', 'tutor', 'instructor'],
  teaching: ['teaching', 'teach', 'tutor', 'instructor'],
  instructor: ['instructor', 'tutor', 'teach'],
  instructors: ['instructor', 'tutor', 'teach'],
}

interface TermVariants {
  phrases: string[]
  /** Word stems such as "analy" for analyst/analytics. These only match at
   * the start of a word, so "test" finds a tester but not "latest", and
   * "edit" finds an editor but not "credit". */
  stems: string[]
}

function variantsFor(term: string): TermVariants {
  const phrases = [term, ...(TERM_VARIANTS[term] ?? [])]
  const stems: string[] = []

  if (/^analy(?:st|sts|sis|tics|tical|ze|se|zed|sed|zing|sing)?$/.test(term)) stems.push('analy')
  if (/^edit(?:or|ors|ing|ed)?$/.test(term)) stems.push('edit')
  if (/^develop(?:er|ers|ment|ing|ed)?$/.test(term)) stems.push('develop')
  if (/^engineer(?:ing|s)?$/.test(term)) stems.push('engineer')
  if (/^design(?:er|ers|ing|ed)?$/.test(term)) stems.push('design')
  if (/^test(?:er|ers|ing|ed|s)?$/.test(term)) stems.push('test')
  if (/^assist(?:ant|ants|ance|ing|ed)?$/.test(term)) stems.push('assist')
  if (/^writ(?:e|er|ers|ing|ten)$/.test(term)) stems.push('writ')
  if (/^market(?:ing|er|ers|s)?$/.test(term)) stems.push('market')

  return { phrases, stems }
}

export function matchesNormalizedSearchText(normalizedHaystack: string, query: string): boolean {
  const terms = searchTerms(query)
  if (!terms.length) return true
  return terms.every((term) => {
    const { phrases, stems } = variantsFor(term)
    return (
      phrases.some((variant) => normalizedHaystack.includes(variant)) ||
      stems.some(
        (stem) => normalizedHaystack.startsWith(stem) || normalizedHaystack.includes(` ${stem}`),
      )
    )
  })
}

export function matchesSearchText(haystack: string, query: string): boolean {
  return matchesNormalizedSearchText(normalizeSearchText(haystack), query)
}
