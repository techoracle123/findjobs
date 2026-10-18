import { COUNTRY_DATA } from './country-data'

export interface Country {
  code: string
  name: string
}

/**
 * Every ISO 3166-1 alpha-2 region except Antarctica, which is not a place
 * people work. The list is generated — see scripts/generate-countries.mjs.
 */
export const COUNTRIES: Country[] = COUNTRY_DATA.split(';')
  .map((entry) => {
    const separator = entry.indexOf(':')
    return { code: entry.slice(0, separator), name: entry.slice(separator + 1) }
  })
  .filter((country) => country.code.length === 2)
  .sort((a, b) => a.name.localeCompare(b.name))

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country.name]))

export function countryName(code: string): string {
  if (!code) return 'Not set'
  return BY_CODE.get(code.toUpperCase()) ?? code.toUpperCase()
}

export function searchCountries(query: string): Country[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return COUNTRIES
  return COUNTRIES.filter(
    (country) =>
      country.name.toLowerCase().includes(needle) || country.code.toLowerCase() === needle,
  )
}
