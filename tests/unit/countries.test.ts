import { describe, expect, it } from 'vitest'
import { COUNTRIES, countryName, searchCountries } from '../../src/shared/countries'

describe('country list', () => {
  it('excludes Antarctica', () => {
    expect(COUNTRIES.some((country) => country.code === 'AQ')).toBe(false)
  })

  it('covers the whole world apart from Antarctica', () => {
    // 249 regions: the 248 assigned ISO 3166-1 codes other than Antarctica,
    // plus the user-assigned Kosovo code.
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(248)
  })

  it('includes every region that was previously hand-written incorrectly', () => {
    // Nigeria was missing from the hand-written list, and a non-existent
    // "BIR" code had crept in. The list is now generated.
    expect(COUNTRIES.some((country) => country.code === 'NG')).toBe(true)
    expect(COUNTRIES.some((country) => country.code === 'BIR')).toBe(false)
  })

  it('has no duplicate codes', () => {
    const codes = new Set(COUNTRIES.map((country) => country.code))
    expect(codes.size).toBe(COUNTRIES.length)
  })

  it('only contains two-letter codes', () => {
    expect(COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country.code))).toBe(true)
  })

  it('resolves a code to a name', () => {
    expect(countryName('NG')).toBe('Nigeria')
    expect(countryName('de')).toBe('Germany')
  })

  it('reports unknown codes honestly', () => {
    expect(countryName('ZZ')).toBe('ZZ')
    expect(countryName('')).toBe('Not set')
  })
})

describe('searchCountries', () => {
  it('returns everything for an empty query', () => {
    expect(searchCountries('')).toHaveLength(COUNTRIES.length)
  })

  it('matches on name', () => {
    const results = searchCountries('nigeria')
    expect(results.map((country) => country.code)).toContain('NG')
  })

  it('matches on code', () => {
    const results = searchCountries('ng')
    expect(results.map((country) => country.code)).toContain('NG')
  })

  it('returns nothing for a non-match', () => {
    expect(searchCountries('zzzzqqq')).toHaveLength(0)
  })
})
