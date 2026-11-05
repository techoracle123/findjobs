import { describe, expect, it } from 'vitest'
import { getIdeaGuidance } from '../../src/shared/idea-guidance'

describe('plain-language idea build guides', () => {
  it('starts software ideas with a simple website before a native app', () => {
    const guide = getIdeaGuidance('software')
    expect(guide.intro).toContain('simple website')
    expect(guide.intro).toContain('Android or iPhone')
    expect(guide.steps).toHaveLength(4)
    expect(guide.costs).toContain('Website hosting and internet data')
  })

  it('starts physical products with one sample and clear costs', () => {
    const guide = getIdeaGuidance('physical')
    expect(guide.intro).toContain('one sample')
    expect(guide.tools).toContain('A safe place to test it')
    expect(guide.costs).toContain('Transport and delivery')
  })

  it('tests the physical and software parts of a hybrid product separately', () => {
    const guide = getIdeaGuidance('hybrid')
    expect(guide.intro).toContain('separately')
    expect(guide.steps.join(' ')).toContain('physical product on its own')
    expect(guide.steps.join(' ')).toContain('one simple software feature')
  })
})
