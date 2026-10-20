import { extractPdfText } from './pdf'
import { extractDocxText } from './docx'

export type CvKind = 'pdf' | 'docx' | 'txt'

export interface ExtractedCv {
  fileName: string
  kind: CvKind
  text: string
}

export function kindOf(file: File): CvKind | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  if (name.endsWith('.txt') || file.type === 'text/plain' || file.type.startsWith('text/'))
    return 'txt'
  return null
}

/**
 * Parses a CV entirely in the browser. Only the extracted text is sent to the
 * API for suggestions; the file itself is never uploaded or stored.
 */
export async function extractCvText(file: File): Promise<ExtractedCv> {
  const kind = kindOf(file)
  if (!kind) {
    throw new Error('Unsupported file type. Use a PDF, DOCX or TXT file.')
  }

  let text: string
  if (kind === 'pdf') {
    text = await extractPdfText(file)
  } else if (kind === 'docx') {
    text = await extractDocxText(file)
  } else {
    text = await file.text()
  }

  if (!text.trim()) {
    throw new Error(
      kind === 'pdf'
        ? 'No text could be read from this PDF. Scanned or image-only PDFs are not supported.'
        : 'This file appears to be empty.',
    )
  }

  return { fileName: file.name, kind, text }
}
