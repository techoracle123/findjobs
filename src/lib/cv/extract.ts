import { extractPdfText } from './pdf'
import { extractDocxText } from './docx'
import { MAX_CV_FILE_BYTES, MAX_CV_TEXT_CHARS } from './limits'

export { MAX_CV_FILE_BYTES, MAX_CV_PDF_PAGES, MAX_CV_TEXT_CHARS } from './limits'

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

function normaliseExtractedText(text: string): string {
  return text
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parses a CV entirely in the browser. The returned text stays local unless
 * a later, separate saved-CV action sends it with the user's explicit
 * consent. Oversized files and overlong text are rejected in plain language;
 * FJ never trims the end of a CV without telling the owner.
 *
 * User-safe errors are prefixed with `FJ:` so the UI can show them without
 * exposing parser or vendor error details.
 */
export async function extractCvText(file: File): Promise<ExtractedCv> {
  const kind = kindOf(file)
  if (!kind) {
    throw new Error('FJ:That file type is not supported. Use a PDF, DOCX or TXT file.')
  }
  if (file.size > MAX_CV_FILE_BYTES) {
    throw new Error(
      'FJ:That CV file is too large. FJ can read a file up to 10 MB. Remove scanned pages or attachments and try again.',
    )
  }

  let rawText: string
  if (kind === 'pdf') {
    rawText = await extractPdfText(file)
  } else if (kind === 'docx') {
    rawText = await extractDocxText(file)
  } else {
    rawText = await file.text()
  }

  const text = normaliseExtractedText(rawText)
  if (text.length > MAX_CV_TEXT_CHARS) {
    throw new Error(
      'FJ:This CV has more than 60,000 characters of readable text. Remove repeated pages or old attachments and try again. FJ will not cut the text without telling you.',
    )
  }

  if (!text.trim()) {
    throw new Error(
      kind === 'pdf'
        ? 'FJ:No readable text could be found in this PDF. It may be a scanned picture. Use a text-readable PDF or paste the CV text.'
        : 'FJ:This file appears to be empty. Choose another CV file or paste the text.',
    )
  }

  return { fileName: file.name, kind, text }
}
