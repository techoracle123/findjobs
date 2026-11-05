import { describe, expect, it } from 'vitest'
import { textFromPositionedItems } from '../../src/lib/cv/pdf-lines'

describe('PDF CV line reconstruction', () => {
  it('groups positioned fragments into headings and bullets', () => {
    const text = textFromPositionedItems([
      { str: 'dashboards', x: 82, y: 72, width: 62, height: 10 },
      { str: 'Experience', x: 10, y: 100, width: 62, height: 12 },
      { str: '- Built', x: 10, y: 72, width: 38, height: 10 },
      { str: 'TypeScript', x: 72, y: 72.5, width: 5, height: 10 },
      { str: 'Skills', x: 10, y: 40, width: 34, height: 12 },
    ])

    expect(text).toContain('Experience\n\n- Built TypeScript dashboards')
    expect(text).toContain('\n\nSkills')
  })

  it('does not insert spaces inside tightly spaced fragments', () => {
    const text = textFromPositionedItems([
      { str: 'Type', x: 10, y: 80, width: 24, height: 10 },
      { str: 'Script', x: 34.5, y: 80, width: 34, height: 10 },
    ])
    expect(text).toBe('TypeScript')
  })
})
