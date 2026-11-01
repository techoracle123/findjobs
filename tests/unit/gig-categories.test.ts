import { describe, expect, it } from 'vitest'
import { gigCategoryFor } from '../../src/shared/gig-categories'

describe('detailed gig categories', () => {
  it('gives specific creative and security work its own label', () => {
    expect(gigCategoryFor({ title: 'Freelance Video Editor for YouTube' })?.id).toBe(
      'video-editing',
    )
    expect(gigCategoryFor({ title: 'Photo Retoucher and Image Editor' })?.id).toBe('photo-editing')
    expect(gigCategoryFor({ title: 'Penetration Tester, 3 month contract' })?.id).toBe(
      'penetration-testing',
    )
    expect(gigCategoryFor({ title: 'SOC Analyst, Cybersecurity' })?.id).toBe('cybersecurity')
  })

  it('uses skills and advert wording when the title is broad', () => {
    expect(
      gigCategoryFor({ title: 'Contract Developer', requiredSkills: ['React', 'TypeScript'] })?.id,
    ).toBe('web-development')
    expect(
      gigCategoryFor({
        title: 'Contract Analyst',
        description: 'Build Power BI dashboards and SQL reports for the finance team.',
      })?.id,
    ).toBe('data-analytics')
    expect(gigCategoryFor({ title: 'Virtual Assistant for an online store' })?.id).toBe(
      'business-support',
    )
  })

  it('does not force a detailed label when the advert gives no evidence', () => {
    expect(gigCategoryFor({ title: 'Temporary Worker', roleFamily: 'unknown' })).toBeNull()
  })
})
