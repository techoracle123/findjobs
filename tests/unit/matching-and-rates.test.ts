import { describe, expect, it } from 'vitest'
import { matchLabel } from '../../src/components/MatchRing'
import { parseReferenceRates } from '../../src/server/rates'

const date = new Date().toISOString().slice(0, 10)
describe('quiet match indicators and open currency data', () => {
  it('uses descriptive labels rather than grades or numbers', () => {
    expect([0, 35, 60, 95].map(matchLabel)).toEqual([
      'Little overlap',
      'Some overlap',
      'Promising overlap',
      'Strong overlap',
    ])
    for (const score of [0, 35, 60, 95]) expect(matchLabel(score)).not.toMatch(/\d/)
  })
  it('normalizes fiat currency keys, including NGN, but drops crypto and unsupported units', () => {
    const payload = parseReferenceRates(
      { date, usd: { usd: 1, eur: 0.9, gbp: 0.75, ngn: 1330, btc: 0.00001, eth: 0.0004, xyz: -1 } },
      'open-currency',
    )
    expect(payload.rates).toEqual({ USD: 1, EUR: 0.9, GBP: 0.75, NGN: 1330 })
    expect(payload.source).toBe('open-currency')
    expect(payload.date).toBe(date)
  })
  it('rejects stale, future, incomplete and malformed rate data', () => {
    const usd = { usd: 1, eur: 0.9, gbp: 0.75 }
    for (const bad of [
      { date: '2020-01-01', usd },
      { date: '2099-01-01', usd },
      { date, usd: { usd: 2, eur: 1, gbp: 1 } },
      { date, usd: [] },
      { date },
      null,
    ]) {
      expect(() => parseReferenceRates(bad, 'open-currency')).toThrow()
    }
  })
  it('preserves a central-bank fallback without inventing an NGN quote', () => {
    const payload = parseReferenceRates({ date, rates: { EUR: 0.9, GBP: 0.75 } }, 'frankfurter')
    expect(payload.rates).toEqual({ USD: 1, EUR: 0.9, GBP: 0.75 })
    expect(payload.rates.NGN).toBeUndefined()
  })
})
