import { describe, expect, it, vi } from 'vitest'
import { IDEA_CATEGORIES } from '../../src/server/ideas/concepts'
import {
  IDEA_EVIDENCE_KEY,
  clearIdeaEvidenceCache,
  readIdeaEvidence,
  refreshIdeaEvidence,
} from '../../src/server/ideas/evidence'
import { makeIdeaSnapshot } from '../fixtures/ideas'

function testKv() {
  const values = new Map<string, string>()
  return {
    values,
    kv: {
      get: vi.fn(async (key: string) => (values.get(key) ? JSON.parse(values.get(key)!) : null)),
      put: vi.fn(async (key: string, value: string) => {
        values.set(key, value)
      }),
    } as unknown as KVNamespace,
  }
}

function worldBankFetcher(countryCount: number) {
  const snapshot = makeIdeaSnapshot(countryCount)
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/country?')) {
      return new Response(
        JSON.stringify([
          { lastupdated: '2026-10-08' },
          snapshot.countries.map((country) => ({
            id: country.iso3,
            iso2Code: country.iso2,
            name: country.name,
            region: { value: country.iso3 === 'WLD' ? 'Aggregates' : 'Africa' },
            incomeLevel: { value: country.incomeLevel },
          })),
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const indicatorId = decodeURIComponent(url.match(/indicator\/([^?]+)/)?.[1] ?? '')
    const category = IDEA_CATEGORIES.find((entry) => entry.indicatorId === indicatorId)
    if (!category) return new Response('not found', { status: 404 })
    return new Response(
      JSON.stringify([
        { lastupdated: '2026-10-08' },
        snapshot.countries.map((country) => ({
          indicator: { id: indicatorId, value: category.label },
          countryiso3code: country.iso3,
          date: '2024',
          value: category.unit === 'per_1000' ? 2 : 20,
        })),
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
}

describe('World Bank idea evidence refresh', () => {
  it('validates observations, preserves source timestamps and computes the real total', async () => {
    const { kv, values } = testKv()
    const fetcher = worldBankFetcher(110)
    const snapshot = await refreshIdeaEvidence(
      kv,
      fetcher as typeof fetch,
      Date.parse('2026-11-05T06:00:00Z'),
    )
    expect(snapshot.catalogTotal).toBe(110 * 144)
    expect(snapshot.sourceLastUpdated).toBe('2026-10-08')
    expect(snapshot.refreshedAt).toBe('2026-11-05T06:00:00.000Z')
    expect(
      snapshot.countries.find((country) => country.iso3 === 'NGA')?.observations['SH.MED.PHYS.ZS']
        .unit,
    ).toBe('per_1000')
    expect(values.has(IDEA_EVIDENCE_KEY)).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(13)
    await expect(readIdeaEvidence(kv)).resolves.toMatchObject({ catalogTotal: 110 * 144 })
  })

  it('refuses to publish a catalogue that does not exceed 15,000 computed ideas', async () => {
    const { kv, values } = testKv()
    await expect(
      refreshIdeaEvidence(
        kv,
        worldBankFetcher(104) as typeof fetch,
        Date.parse('2026-11-05T06:00:00Z'),
      ),
    ).rejects.toThrow('below the required')
    expect(values.size).toBe(0)
  })

  it('rejects malformed source responses rather than storing an empty evidence set', async () => {
    const { kv, values } = testKv()
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }))
    await expect(refreshIdeaEvidence(kv, fetcher as typeof fetch)).rejects.toThrow(
      'unexpected response',
    )
    expect(values.size).toBe(0)
  })

  it('can invalidate its short read cache after a test or operator replacement', async () => {
    const { kv, values } = testKv()
    const snapshot = makeIdeaSnapshot(110)
    values.set(IDEA_EVIDENCE_KEY, JSON.stringify(snapshot))
    await expect(readIdeaEvidence(kv)).resolves.toMatchObject({
      catalogTotal: snapshot.catalogTotal,
    })
    values.set(
      IDEA_EVIDENCE_KEY,
      JSON.stringify({ ...snapshot, refreshedAt: '2026-11-05T07:00:00.000Z' }),
    )
    await expect(readIdeaEvidence(kv)).resolves.toMatchObject({ refreshedAt: snapshot.refreshedAt })
    clearIdeaEvidenceCache()
    await expect(readIdeaEvidence(kv)).resolves.toMatchObject({
      refreshedAt: '2026-11-05T07:00:00.000Z',
    })
  })
})
