import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import './setup'
import {
  assemblePublicSnapshot,
  publishPublicSnapshot,
  type SourceIndex,
} from '../../src/server/public-feed'
import type { QualitySnapshot } from '../../src/shared/quality'

const base = 'http://localhost:8787'

function kvStub() {
  const data = new Map<string, string>()
  const kv = {
    get: async (key: string) => (data.has(key) ? JSON.parse(data.get(key)!) : null),
    put: async (key: string, value: string) => {
      data.set(key, value)
    },
  } as unknown as KVNamespace
  return { kv, data }
}

function rows(count: number): SourceIndex['jobs'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `quality-${i}`,
    title: `Quality Test Role ${i}`,
    company: 'Quality Co',
    roleFamily: 'backend',
    seniority: 'mid',
    workMode: 'remote',
    locationCountry: 'NG',
    locationLabel: 'Lagos, Nigeria',
    salaryMin: 200_000,
    salaryMax: 400_000,
    salaryCurrency: 'NGN',
    salaryPeriod: 'month',
    description: 'Requirements\n- Strong SQL skills',
    requiredSkills: [],
    usefulSkills: [],
    eligibleCountries: [],
    sponsorship: 'unknown',
    sourceName: 'quality-tests',
    sourceUrl: `https://example.org/q/${i}`,
    postedAt: '2026-10-27T00:00:00Z',
    isDemo: false,
    jobStatus: 'open',
    firstSeenAt: '2026-10-27T00:00:00Z',
    lastSeenAt: '2026-10-27T00:00:00Z',
    applyUrl: `https://example.org/q/${i}`,
    detailKey: 'details:test',
  }))
}

it('publishes a quality snapshot with coverage and fires alerts on regression', async () => {
  const { kv, data } = kvStub()
  // A healthy previous snapshot, so today's degraded one must alert.
  const previous: QualitySnapshot = {
    date: '2026-10-26',
    normalizerVersion: 'test',
    total: 3,
    coverage: {
      locationCountry: 1,
      workMode: 1,
      seniority: 1,
      salary: 1,
      requiredSkills: 1,
      roleFamily: 1,
      language: 1,
      eligibleCountries: 1,
    },
    duplicatesDropped: 0,
    nonEnglish: 0,
    implausibleSalaries: 0,
    sources: [],
    alerts: [],
  }
  await kv.put('quality:latest', JSON.stringify(previous))

  const source: SourceIndex = {
    sourceId: 'greenhouse-oneacrefund',
    fetchedAt: Date.now(),
    jobs: rows(3).map((job) => ({ ...job, workMode: 'unknown', seniority: 'unknown' })),
  }
  const snapshot = assemblePublicSnapshot([source], new Set())
  expect(snapshot.jobs).toHaveLength(3)
  await kv.put(`source:greenhouse-oneacrefund`, JSON.stringify(source))
  await publishPublicSnapshot(kv)
  const quality = JSON.parse(data.get('quality:latest')!) as QualitySnapshot
  expect(quality.total).toBe(3)
  expect(quality.coverage.requiredSkills).toBeGreaterThan(0)
  expect(quality.alerts.some((alert) => alert.includes('workMode'))).toBe(true)
})

it('protects the admin wallboard behind identity and an allowlist', async () => {
  const original = (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS
  try {
    ;(env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = 'boss@example.com'
    await env.PUBLIC_JOBS!.put(
      'quality:latest',
      JSON.stringify({
        date: '2026-10-27',
        normalizerVersion: 'test',
        total: 1,
        coverage: {
          locationCountry: 1,
          workMode: 1,
          seniority: 1,
          salary: 1,
          requiredSkills: 1,
          roleFamily: 1,
          language: 1,
          eligibleCountries: 1,
        },
        duplicatesDropped: 0,
        nonEnglish: 0,
        implausibleSalaries: 0,
        sources: [],
        alerts: [],
      }),
    )
    expect((await SELF.fetch(base + '/api/admin/quality')).status).toBe(401)
    const outsider = await SELF.fetch(base + '/api/admin/quality', {
      headers: { 'x-dev-user-email': 'someone@example.com' },
    })
    expect(outsider.status).toBe(403)
    const admin = await SELF.fetch(base + '/api/admin/quality', {
      headers: { 'x-dev-user-email': 'boss@example.com' },
    })
    expect(admin.status).toBe(200)
    expect(((await admin.json()) as { source: string }).source).toBe('kv')
  } finally {
    ;(env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = original
  }
})
