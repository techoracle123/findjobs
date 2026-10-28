import { describe, expect, it } from 'vitest'
import { canonicalSkill, matchSkills, skillsMatch } from '../../src/shared/skills'

describe('canonicalSkill', () => {
  it('normalises case and punctuation', () => {
    expect(canonicalSkill('Node.js')).toBe(canonicalSkill('nodejs'))
    expect(canonicalSkill('  TypeScript ')).toBe(canonicalSkill('typescript'))
  })

  it('maps abbreviations onto their full form', () => {
    expect(canonicalSkill('TS')).toBe(canonicalSkill('TypeScript'))
    expect(canonicalSkill('k8s')).toBe(canonicalSkill('Kubernetes'))
    expect(canonicalSkill('Postgres')).toBe(canonicalSkill('PostgreSQL'))
  })

  it('returns an empty string for empty input', () => {
    expect(canonicalSkill('')).toBe('')
    expect(canonicalSkill('   ')).toBe('')
  })
})

describe('skillsMatch', () => {
  it('matches equivalent spellings', () => {
    expect(skillsMatch('node.js', 'NodeJS')).toBe(true)
    expect(skillsMatch('react', 'React.js')).toBe(true)
    expect(skillsMatch('CI/CD', 'cicd')).toBe(true)
  })

  it('does not match different skills', () => {
    expect(skillsMatch('React', 'Vue')).toBe(false)
    expect(skillsMatch('Go', 'Rust')).toBe(false)
  })

  it('treats a language and its alternative name as one skill', () => {
    expect(skillsMatch('Go', 'Golang')).toBe(true)
  })
})

describe('matchSkills', () => {
  it('splits job skills into matched and missing', () => {
    const { matched, missing } = matchSkills(
      ['Go', 'PostgreSQL', 'Kubernetes'],
      ['go', 'postgres', 'Rust'],
    )
    expect(matched).toEqual(['Go', 'PostgreSQL'])
    expect(missing).toEqual(['Kubernetes'])
  })

  it('returns everything as missing when the profile is empty', () => {
    const { matched, missing } = matchSkills(['Go'], [])
    expect(matched).toEqual([])
    expect(missing).toEqual(['Go'])
  })
})
