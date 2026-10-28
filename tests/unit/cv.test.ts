import { describe, expect, it } from 'vitest'
import { suggestFromKeywords } from '../../src/server/cv'

const SAMPLE = `Senior Frontend Engineer at a fintech, five years of experience.
Built a React and TypeScript design system used by 12 teams. Wrote unit tests
with Jest and Playwright. Improved Core Web Vitals and accessibility to WCAG AA.
Deployed with Docker on AWS. Worked with GraphQL and a Node.js API.
Looking for remote roles.`

describe('suggestFromKeywords', () => {
  it('detects the skills in the text', () => {
    const suggestion = suggestFromKeywords(SAMPLE)
    expect(suggestion.skills).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'GraphQL', 'AWS', 'Docker']),
    )
  })

  it('does not read the "js" inside "Node.js" as a mention of JavaScript', () => {
    // Regression: a plain word boundary matched "js" inside "Node.js".
    const suggestion = suggestFromKeywords(SAMPLE)
    expect(suggestion.skills).not.toContain('JavaScript')
  })

  it('detects JavaScript when it is actually mentioned', () => {
    const suggestion = suggestFromKeywords('Built web applications in JavaScript and React.')
    expect(suggestion.skills).toContain('JavaScript')
  })

  it('detects the role family', () => {
    expect(suggestFromKeywords(SAMPLE).roleFamilies).toContain('frontend')
  })

  it('detects the seniority', () => {
    expect(suggestFromKeywords(SAMPLE).seniority).toContain('senior')
  })

  it('detects the work mode', () => {
    expect(suggestFromKeywords(SAMPLE).workModes).toContain('remote')
  })

  it('is labelled as on-device keyword matching', () => {
    expect(suggestFromKeywords(SAMPLE).provider).toBe('on-device')
  })

  it('reports honestly when nothing is found', () => {
    const suggestion = suggestFromKeywords('A short note about my interests.')
    expect(suggestion.skills).toEqual([])
    expect(suggestion.notes.length).toBeGreaterThan(0)
  })

  it('never crashes on empty or odd input', () => {
    expect(() => suggestFromKeywords('')).not.toThrow()
    expect(() => suggestFromKeywords('!!! ??? ***')).not.toThrow()
  })
})
