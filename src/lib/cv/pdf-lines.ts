export interface PositionedTextItem {
  str: string
  x: number
  y: number
  width?: number
  height?: number
}

interface NormalisedTextItem extends PositionedTextItem {
  height: number
}

interface PositionedLine {
  y: number
  height: number
  pieces: NormalisedTextItem[]
}

/**
 * Rebuilds readable lines from positioned PDF text pieces.
 *
 * PDF.js returns fragments in drawing order, not reading order. Grouping by
 * vertical position preserves headings and bullets far better than joining
 * every fragment with a space. This is still a reading aid, not a promise
 * that a complex two-column layout was understood perfectly; the saved-CV UI
 * shows the extracted text for the owner to check before consenting to save.
 */
export function textFromPositionedItems(items: PositionedTextItem[]): string {
  const pieces = items
    .filter((item) => item.str.length > 0)
    .map((item): NormalisedTextItem => ({
      ...item,
      height: item.height && item.height > 0 ? item.height : 10,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: PositionedLine[] = []
  for (const piece of pieces) {
    let closest: PositionedLine | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    for (const line of lines) {
      const distance = Math.abs(line.y - piece.y)
      const tolerance = Math.max(2.5, Math.min(line.height, piece.height) * 0.55)
      if (distance <= tolerance && distance < closestDistance) {
        closest = line
        closestDistance = distance
      }
    }
    if (closest) closest.pieces.push(piece)
    else lines.push({ y: piece.y, height: piece.height, pieces: [piece] })
  }

  lines.sort((a, b) => b.y - a.y)
  const rendered: string[] = []
  let previous: PositionedLine | null = null

  for (const line of lines) {
    const ordered = [...line.pieces].sort((a, b) => a.x - b.x)
    let text = ''
    let previousEnd = Number.NEGATIVE_INFINITY
    for (const piece of ordered) {
      if (
        text &&
        !/\s$/.test(text) &&
        !/^\s/.test(piece.str) &&
        piece.x - previousEnd > Math.max(1.2, piece.height * 0.22)
      ) {
        text += ' '
      }
      text += piece.str
      previousEnd = piece.x + (piece.width ?? piece.str.length * piece.height * 0.5)
    }
    text = text.replace(/[ \t]{2,}/g, ' ').trim()
    if (!text) continue

    if (previous && previous.y - line.y > Math.max(previous.height, line.height) * 1.75 + 2) {
      rendered.push('')
    }
    rendered.push(text)
    previous = line
  }

  return rendered.join('\n').trim()
}
