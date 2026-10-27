import { describe, expect, it } from 'vitest'
import { scamScore } from '../../src/server/trust'

const base = {
  title: 'Registered Nurse',
  company: 'Lagoon Hospital',
  companyUrl: 'https://laggonhospital.example',
  description:
    'We are hiring a registered nurse for our hospital in Lagos. Responsibilities include patient care on the ward and working with the clinical team across shifts.',
  salaryMin: 0,
  salaryMax: 0,
  salaryCurrency: '',
  salaryPeriod: 'year' as const,
}

describe('listing trust score', () => {
  it('holds listings that ask for money at or above 30', () => {
    const result = scamScore({
      ...base,
      title: 'Urgent Office Assistant',
      description:
        'Pay NGN 5,000 registration fee to secure this role. Send your details now and we will place you immediately with one of our partner offices.',
    })
    expect(result.score).toBeGreaterThanOrEqual(30)
    expect(result.moderationState).toBe('hold')
    expect(result.signals.some((signal) => signal.label.includes('money'))).toBe(true)
  })

  it('catches Pidgin money phrases', () => {
    const result = scamScore({
      ...base,
      description:
        'No experience needed. Pay small token for registration and earn daily. Send your full name and phone number to get started with the team today.',
    })
    expect(result.score).toBeGreaterThanOrEqual(30)
  })

  it('publishes a plain honest listing with a low score', () => {
    const result = scamScore(base)
    expect(result.score).toBeLessThan(15)
    expect(result.moderationState).toBe('publish')
  })

  it('cautions between 15 and 29 rather than hiding', () => {
    const result = scamScore({
      ...base,
      description:
        'Send your CV to hrteam@gmail.com today. We are a small trading company looking for help in our Lagos office and we review every application carefully before scheduling interviews with the hiring team this week.',
    })
    expect(result.score).toBeGreaterThanOrEqual(15)
    expect(result.score).toBeLessThan(30)
    expect(result.moderationState).toBe('caution')
  })

  it('does not treat a physical security guard role as risky by default', () => {
    // Guard against the earlier mislabelling in the trust signals too.
    const result = scamScore({
      ...base,
      title: 'Security Guard',
      description: 'Guard the premises.',
    })
    expect(result.moderationState).toBe('publish')
  })
})
