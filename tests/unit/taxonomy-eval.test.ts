import { describe, expect, it } from 'vitest'
import skillsGolden from '../../eval/golden-skills.jsonl?raw'
import taxonomyGolden from '../../eval/golden-taxonomy.jsonl?raw'
import { extractSkills } from '../../src/shared/skills-dictionary'
import { inferRoleFamily } from '../../src/server/sources/normalize'

function rows(raw: string): Record<string, unknown>[] {
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as Record<string, unknown>)
}

describe('golden taxonomy eval (regression ceiling 2%)', () => {
  it('keeps skill extraction within 2% of the golden labels', () => {
    const golden = rows(skillsGolden)
    let hits = 0
    for (const row of golden) {
      const found = new Set(extractSkills(String(row.text)).map((match) => match.name))
      const expected = [...(row.required as string[]), ...(row.useful as string[])]
      const matched = expected.filter((name) => found.has(name)).length
      hits += matched / Math.max(1, expected.length)
    }
    expect(hits / golden.length).toBeGreaterThanOrEqual(0.9)
  })
  it('keeps profession assignment within 2% of the golden labels', () => {
    const golden = rows(taxonomyGolden)
    const correct = golden.filter(
      (row) => inferRoleFamily(String(row.title), [], '') === row.family,
    ).length
    expect(correct / golden.length).toBeGreaterThanOrEqual(0.9)
  })
})
