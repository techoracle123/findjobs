import { describe, expect, it } from 'vitest'
import { loadRobots } from '../../src/server/sources/robots'
import { robotsGatedKind } from '../../src/server/sources/polite'
import {
  inferSeniorityQuality,
  inferWorkModeQuality,
  parseLocation,
  workModeFromLocation,
  yearsOfExperience,
} from '../../src/server/quality'
import { extractSkills } from '../../src/shared/skills-dictionary'
import { scamScore } from '../../src/server/trust'
import { planCatalogue } from '../../src/server/billing/pricing'
import { readConfig } from '../../src/server/config'
import { pageBody } from '../../src/server/seo'
import { emailProviderFromEnv, otpEmail } from '../../src/server/email/provider'

describe('robots.txt handling (2b)', () => {
  const fetchWith = (status: number) =>
    (async () => new Response('', { status })) as unknown as typeof fetch

  it('treats a 401 robots.txt as "no restrictions" (api.ashbyhq.com case)', async () => {
    const policy = await loadRobots('https://api.ashbyhq.com', fetchWith(401))
    expect(policy.allowed).toBe(true)
    expect(policy.rules).toBe('')
  })

  it('still backs off on 429 and 5xx', async () => {
    expect((await loadRobots('https://x.example', fetchWith(429))).allowed).toBe(false)
    expect((await loadRobots('https://x.example', fetchWith(500))).allowed).toBe(false)
  })

  it('gates only HTML-scraping adapters, never documented APIs or feeds', () => {
    expect(robotsGatedKind('jsonld')).toBe(true)
    expect(robotsGatedKind('api')).toBe(false)
    expect(robotsGatedKind('ats')).toBe(false)
    expect(robotsGatedKind('rss')).toBe(false)
  })
})

describe('work mode and seniority inference (3.6, 3.7)', () => {
  it('reads the mode out of board location labels', () => {
    expect(workModeFromLocation('Remote')).toBe('remote')
    expect(workModeFromLocation('Remote — Europe')).toBe('remote')
    expect(workModeFromLocation('Berlin · Hybrid')).toBe('hybrid')
    expect(workModeFromLocation('Lagos, Nigeria')).toBe('unknown')
  })

  it('prefers hybrid over a passing remote mention', () => {
    expect(
      inferWorkModeQuality(
        'Hybrid role, remote-friendly team, 2 days per week in office',
        'unknown',
      ).mode,
    ).toBe('hybrid')
  })

  it('parses stated years of experience', () => {
    expect(yearsOfExperience('You have 5+ years of experience building APIs.')).toBe(5)
    expect(yearsOfExperience('We need 3–5 years experience in support.')).toBe(3)
    expect(yearsOfExperience('At least 7 years of relevant experience required.')).toBe(7)
    expect(yearsOfExperience('No numbers here at all.')).toBeNull()
  })

  it('derives seniority from the description when the title is silent', () => {
    expect(
      inferSeniorityQuality('Software Engineer', 'unknown', 'Bring 6+ years of experience.').level,
    ).toBe('senior')
    expect(
      inferSeniorityQuality('Software Engineer', 'unknown', 'Bring 3 years of experience.').level,
    ).toBe('mid')
    expect(inferSeniorityQuality('Sr. Designer', 'unknown').level).toBe('senior')
    expect(inferSeniorityQuality('Engineering Manager', 'unknown').level).toBe('lead')
  })
})

describe('location parsing beyond Nigeria (3.8)', () => {
  it('resolves country names and the city before them', () => {
    expect(parseLocation('Berlin, Germany', '')).toEqual({
      city: 'Berlin',
      state: null,
      country: 'DE',
    })
    expect(parseLocation('Toronto, Canada', '').country).toBe('CA')
  })

  it('resolves trailing US state codes', () => {
    const parsed = parseLocation('Austin, TX', '')
    expect(parsed.country).toBe('US')
    expect(parsed.city).toBe('Austin')
    expect(parsed.state).toBe('TX')
  })

  it('keeps Nigerian parsing Nigeria-first', () => {
    expect(parseLocation('Ikeja, Lagos', '').country).toBe('NG')
  })
})

describe('skill required vs useful (3.5)', () => {
  it('marks cue-sentence skills required without any heading', () => {
    const skills = extractSkills(
      'We are hiring. You must have strong experience with Python and SQL. Our office has a table tennis table.',
    )
    const python = skills.find((skill) => skill.name === 'Python')
    expect(python?.required).toBe(true)
  })

  it('keeps plain mentions not-required', () => {
    const skills = extractSkills('Our stack includes Python somewhere in the building.')
    const python = skills.find((skill) => skill.name === 'Python')
    expect(python?.required).toBe(false)
  })
})

describe('scam model spread (3.10)', () => {
  const base = {
    title: 'Security Engineer',
    description:
      'We are hiring a security engineer to work on cloud posture. You will partner with product teams, review designs, and improve detection coverage across the platform. The role works closely with engineering, support and customers to keep systems safe and reliable every day.',
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: '',
    salaryPeriod: 'year',
  }

  it('scores a known company on a mainstream ATS below caution', () => {
    const result = scamScore({
      ...base,
      company: 'Wiz',
      applyUrl: 'https://boards.greenhouse.io/wiz/jobs/123',
    })
    expect(result.score).toBeLessThan(15)
    expect(result.moderationState).toBe('publish')
  })

  it('missing website alone never reaches caution', () => {
    const result = scamScore({ ...base, company: 'Small Unknown Ventures' })
    expect(result.score).toBeLessThan(15)
    expect(result.moderationState).toBe('publish')
  })

  it('still escalates stacked red flags', () => {
    const result = scamScore({
      ...base,
      company: 'Quick Cash Agency',
      title: 'Urgent! Earn daily, no experience',
      description:
        'Pay a small registration fee to start. Send your BVN and account number to apply@gmail.com today.',
    })
    expect(result.score).toBeGreaterThanOrEqual(30)
  })
})

describe('plan catalogue (3.2, 3.3, 3.4)', () => {
  const plans = planCatalogue(readConfig({}))
  const byId = (id: string) => plans.find((plan) => plan.id === id)

  it('prices pro at 10000, graduate at 3000, annual at 100000', () => {
    expect(byId('pro')?.price.amount).toBe(10000)
    expect(byId('pro_graduate')?.price.amount).toBe(3000)
    expect(byId('pro_annual')?.price.amount).toBe(100000)
    expect(byId('pro_annual')?.interval).toBe('year')
  })

  it('alerts are on the free tier and off the paywall pitch', () => {
    expect(byId('free')?.entitlements).toContain('alerts')
  })

  it('lists an employer waitlist plan without inventing a price', () => {
    expect(byId('employer')?.interval).toBe('waitlist')
    expect(byId('employer')?.price.amount).toBe(0)
  })
})

describe('disabled-source cooldown (stage 2 follow-through)', () => {
  function fakeKv(initial: Record<string, string>) {
    const store = new Map(Object.entries(initial))
    return {
      get: async (key: string, type?: string) => {
        const raw = store.get(key)
        if (raw === undefined) return null
        return type === 'json' ? JSON.parse(raw) : raw
      },
      put: async (key: string, value: string) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
    } as unknown as KVNamespace
  }

  it('keeps a freshly disabled source off, but retries after 24 hours', async () => {
    const { isSourceDisabled } = await import('../../src/server/public-feed')
    const fresh = fakeKv({
      'source:disabled:ashby-x': JSON.stringify({ at: Date.now(), error: 'boom' }),
    })
    expect(await isSourceDisabled(fresh, 'ashby-x')).toBe(true)
    const stale = fakeKv({
      'source:disabled:ashby-x': JSON.stringify({ at: Date.now() - 25 * 3600_000, error: 'boom' }),
    })
    expect(await isSourceDisabled(stale, 'ashby-x')).toBe(false)
    expect(await isSourceDisabled(stale, 'never-disabled')).toBe(false)
  })

  it('a success clears the disable outright', async () => {
    const { isSourceDisabled, noteSourceHealth } = await import('../../src/server/public-feed')
    const kv = fakeKv({
      'source:disabled:s1': JSON.stringify({ at: Date.now(), error: 'boom' }),
      'source:health:s1': JSON.stringify({ fails: 3 }),
    })
    await noteSourceHealth(kv, 's1', true, '', { durationMs: 5, itemCount: 3 })
    expect(await isSourceDisabled(kv, 's1')).toBe(false)
  })
})

describe('crawler bodies (3.1) and email (1)', () => {
  it('serves real content, not a meta-description stub', () => {
    expect(pageBody('/privacy').length).toBeGreaterThan(1200)
    expect(pageBody('/privacy')).toContain('What we collect')
    expect(pageBody('/pricing')).toContain('₦10,000')
  })

  it('builds the branded OTP email with the code in the subject', () => {
    const mail = otpEmail('482910')
    expect(mail.subject).toContain('482910')
    expect(mail.html).toContain('482910')
    expect(mail.text).toContain('expires in 10 minutes')
  })

  it('accepts OTP_FROM as the sender alias and stays console without a key', () => {
    expect(emailProviderFromEnv({}).name).toBe('console')
    expect(
      emailProviderFromEnv({ RESEND_API_KEY: 're_test', OTP_FROM: 'FJ <no-reply@x.dev>' }).name,
    ).toBe('resend')
  })
})
