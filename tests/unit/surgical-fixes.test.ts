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
import {
  BrevoProvider,
  emailProviderFromEnv,
  hasConfiguredEmailProvider,
  otpEmail,
  parseSenderAddress,
} from '../../src/server/email/provider'

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

  it('shows founding prices now and the disclosed standard prices later', () => {
    expect(byId('pro')?.price.amount).toBe(5000)
    expect(byId('pro')?.standardAmount).toBe(10000)
    expect(byId('pro')?.founding).toBe(true)
    expect(byId('pro_graduate')?.price.amount).toBe(3000)
    expect(byId('pro_annual')?.price.amount).toBe(40000)
    expect(byId('pro_annual')?.standardAmount).toBe(60000)
    expect(byId('pro_annual')?.monthlyEquivalent).toBe(3333)
    expect(byId('pro_annual')?.interval).toBe('year')
    expect(byId('pro')?.trialDays).toBe(3)
  })

  it('alerts are on the free tier and off the paywall pitch', () => {
    expect(byId('free')?.entitlements).toContain('alerts')
  })

  it('uses plain plan names and gives every Pro plan the same real tools', () => {
    expect(byId('free')?.displayLabel).toBe('Free')
    expect(byId('pro')?.displayLabel).toBe('Pro Monthly')
    expect(byId('pro_annual')?.displayLabel).toBe('Pro Yearly')
    expect(byId('pro_graduate')?.displayLabel).toBe('Pro for Graduates')
    for (const feature of [
      'prepared_applications',
      'cv_check',
      'cv_analysis',
      'interview_prep',
      'salary_guide',
      'advert_check',
      'smart_shortlist',
      'smart_alerts',
      'application_pipeline',
      'skill_plan',
    ]) {
      expect(byId('pro')?.entitlements).toContain(feature)
      expect(byId('pro_annual')?.entitlements).toContain(feature)
      expect(byId('pro_graduate')?.entitlements).toContain(feature)
      expect(byId('free')?.entitlements).not.toContain(feature)
    }
    for (const hollow of ['unlimited_fast_apply', 'weekly_digest', 'verified_source_badges']) {
      expect(byId('pro')?.entitlements).not.toContain(hollow)
    }
  })

  it('lists employer interest only, without inventing a price or posting entitlement', () => {
    expect(byId('employer')?.label).toBe('Employer interest')
    expect(byId('employer')?.interval).toBe('waitlist')
    expect(byId('employer')?.price.amount).toBe(0)
    expect(byId('employer')?.entitlements).toEqual(['employer_interest'])
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

  it('unchanged successes do not burn KV writes (free daily quota)', async () => {
    const { noteSourceHealth } = await import('../../src/server/public-feed')
    let puts = 0
    let deletes = 0
    const store = new Map<string, string>()
    const kv = {
      get: async (key: string, type?: string) => {
        const raw = store.get(key)
        if (raw === undefined) return null
        return type === 'json' ? JSON.parse(raw) : raw
      },
      put: async (key: string, value: string) => {
        puts += 1
        store.set(key, value)
      },
      delete: async (key: string) => {
        deletes += 1
        store.delete(key)
      },
    } as unknown as KVNamespace
    await noteSourceHealth(kv, 's2', true, '', { durationMs: 5, itemCount: 7 })
    await noteSourceHealth(kv, 's2', true, '', { durationMs: 9, itemCount: 7 })
    await noteSourceHealth(kv, 's2', true, '', { durationMs: 4, itemCount: 7 })
    expect(puts).toBe(1)
    expect(deletes).toBe(1)
    // A changed item count is material and is written.
    await noteSourceHealth(kv, 's2', true, '', { durationMs: 4, itemCount: 8 })
    expect(puts).toBe(2)
    // Failures are always written.
    await noteSourceHealth(kv, 's2', false, 'boom')
    expect(puts).toBe(3)
  })
})

describe('Nigeria visibility end to end', () => {
  const raw = {
    externalId: 'x1',
    title: 'Account Officer',
    company: 'Lagos Ventures',
    description: 'We are hiring an account officer for our Ikeja office. Apply today.',
    url: 'https://example.ng/job/1',
    location: 'Ikeja',
    remote: false,
    tags: [],
    jobType: 'full-time',
    publishedAt: null,
    validThrough: null,
    closed: false,
    salary: null,
  }

  it('a Nigerian board stamps NG when the listing only names a city', async () => {
    const { normalizePosting } = await import('../../src/server/sources/normalize')
    const job = normalizePosting(raw, {
      verification: 'unverified',
      verificationReason: 'test',
      sourceKind: 'rss',
      sourceCountry: 'NG',
      now: Date.now(),
    })
    expect(job.locationCountry).toBe('NG')
  })

  it('without a board country, no country is invented', async () => {
    const { normalizePosting } = await import('../../src/server/sources/normalize')
    const job = normalizePosting(
      { ...raw, location: 'Springfield' },
      {
        verification: 'unverified',
        verificationReason: 'test',
        sourceKind: 'ats',
        now: Date.now(),
      },
    )
    expect(job.locationCountry).toBe('')
  })

  it('in-market roles win the default ordering at equal score', async () => {
    const { compareScoredJobs, isInMarket } = await import('../../src/shared/scoring')
    const base = {
      score: 0,
      tier: 'unknown' as const,
      breakdown: { skills: 0, role: 0, location: 0, seniority: 0, freshness: 0 },
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
    }
    const us = {
      ...base,
      job: { locationCountry: 'US', workMode: 'onsite', postedAt: '2026-10-30T00:00:00Z' },
    } as never
    const ng = {
      ...base,
      job: { locationCountry: 'NG', workMode: 'onsite', postedAt: '2026-10-29T00:00:00Z' },
    } as never
    expect(compareScoredJobs(us, ng)).toBeGreaterThan(0)
    // Nigeria outranks foreign remote, which outranks foreign on-site.
    const remoteUs = {
      ...base,
      job: { locationCountry: 'US', workMode: 'remote', postedAt: '2026-10-30T00:00:00Z' },
    } as never
    expect(compareScoredJobs(remoteUs, ng)).toBeGreaterThan(0)
    expect(compareScoredJobs(us, remoteUs)).toBeGreaterThan(0)
    expect(isInMarket({ locationCountry: 'NG', workMode: 'onsite' } as never)).toBe(true)
    expect(isInMarket({ locationCountry: 'US', workMode: 'remote' } as never)).toBe(true)
    expect(isInMarket({ locationCountry: 'US', workMode: 'onsite' } as never)).toBe(false)
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

  it('uses Brevo with a verified Gmail sender and no domain setup', async () => {
    expect(parseSenderAddress('fjfindjobs@gmail.com')).toEqual({
      name: 'FJ - Find Jobs',
      email: 'fjfindjobs@gmail.com',
    })
    expect(parseSenderAddress('FJ - Find Jobs <fjfindjobs@gmail.com>')).toEqual({
      name: 'FJ - Find Jobs',
      email: 'fjfindjobs@gmail.com',
    })
    expect(
      hasConfiguredEmailProvider({
        BREVO_API_KEY: 'brevo-test',
        EMAIL_FROM: 'fjfindjobs@gmail.com',
      }),
    ).toBe(true)
    expect(hasConfiguredEmailProvider({ BREVO_API_KEY: 'brevo-test' })).toBe(false)
    expect(
      emailProviderFromEnv({ BREVO_API_KEY: 'brevo-test', EMAIL_FROM: 'fjfindjobs@gmail.com' })
        .name,
    ).toBe('brevo')
    expect(
      readConfig({ BREVO_API_KEY: 'brevo-test', EMAIL_FROM: 'fjfindjobs@gmail.com' }),
    ).toMatchObject({ emailConfigured: true })

    const captured: { request: { url: string; init: RequestInit } | null } = { request: null }
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.request = { url, init }
      return new Response(JSON.stringify({ messageId: 'brevo-123' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const provider = new BrevoProvider(
      'brevo-test',
      { name: 'FJ - Find Jobs', email: 'fjfindjobs@gmail.com' },
      fetchFn,
    )
    await expect(
      provider.send({ to: 'user@example.com', subject: 'Reset', text: 'Reset link' }),
    ).resolves.toEqual({ id: 'brevo-123' })
    expect(captured.request?.url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(captured.request?.init.headers).toMatchObject({ 'api-key': 'brevo-test' })
    expect(JSON.parse(String(captured.request?.init.body))).toMatchObject({
      sender: { name: 'FJ - Find Jobs', email: 'fjfindjobs@gmail.com' },
      to: [{ email: 'user@example.com' }],
      subject: 'Reset',
      textContent: 'Reset link',
    })
  })

  it('calls a receiver-sensitive platform fetch as a plain function', async () => {
    const receiverSensitiveFetch = function (
      this: unknown,
      _url: string,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== undefined) throw new TypeError('Illegal invocation')
      return Promise.resolve(
        new Response(JSON.stringify({ messageId: 'brevo-plain-fetch' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
    } as unknown as typeof fetch
    const provider = new BrevoProvider(
      'brevo-test',
      { name: 'FJ - Find Jobs', email: 'fjfindjobs@gmail.com' },
      receiverSensitiveFetch,
    )

    await expect(
      provider.send({ to: 'user@example.com', subject: 'Reset', text: 'Reset link' }),
    ).resolves.toEqual({ id: 'brevo-plain-fetch' })
  })

  it('keeps the safe provider error detail without leaking addresses or the key', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          code: 'unauthorized',
          message: 'Key not found brevo-test for user@example.com from fjfindjobs@gmail.com',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    const provider = new BrevoProvider(
      'brevo-test',
      { name: 'FJ - Find Jobs', email: 'fjfindjobs@gmail.com' },
      fetchFn,
    )

    await expect(
      provider.send({ to: 'user@example.com', subject: 'Reset', text: 'Reset link' }),
    ).rejects.toThrow('email_send_failed_401:unauthorized:Key not found [redacted]')
    await expect(
      provider.send({ to: 'user@example.com', subject: 'Reset', text: 'Reset link' }),
    ).rejects.not.toThrow('user@example.com')
  })
})
