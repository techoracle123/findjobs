import { describe, expect, it } from 'vitest'
import {
  FREE_FAST_APPLY_PER_DAY,
  FREE_FAST_APPLY_PER_WEEK,
  lagosDayKey,
  lagosWeekKeys,
  nextLagosMidnight,
} from '../../src/shared/apply'

describe('Africa/Lagos Fast Apply windows', () => {
  it('uses the Lagos calendar date, not the UTC one', () => {
    // 23:30 UTC is already tomorrow in Lagos (UTC+1).
    expect(lagosDayKey(Date.parse('2026-10-27T23:30:00Z'))).toBe('2026-10-28')
    expect(lagosDayKey(Date.parse('2026-10-27T22:30:00Z'))).toBe('2026-10-27')
  })

  it('resets at the next Lagos midnight', () => {
    const now = Date.parse('2026-10-27T23:30:00Z') // 00:30 Lagos on the 28th
    const reset = nextLagosMidnight(lagosDayKey(now), now)
    expect(new Date(reset).toISOString()).toBe('2026-10-28T23:00:00.000Z') // 00:00 Lagos 29th
    expect(reset).toBeGreaterThan(now)
    expect(reset - now).toBeLessThan(24 * 3600_000)
  })

  it('rolls the week window over seven Lagos days including today', () => {
    const keys = lagosWeekKeys(Date.parse('2026-10-27T12:00:00Z'))
    expect(keys).toHaveLength(7)
    expect(keys[6]).toBe('2026-10-27')
    expect(keys[0]).toBe('2026-10-21')
  })

  it('locks the free limits at 5 per day and 15 per rolling week', () => {
    expect(FREE_FAST_APPLY_PER_DAY).toBe(5)
    expect(FREE_FAST_APPLY_PER_WEEK).toBe(15)
  })
})
