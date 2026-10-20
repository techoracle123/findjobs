import { strFromU8, unzipSync } from 'fflate'

function decodeEntities(xml: string): string {
  return xml
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A .docx file is a zip archive. We only need the main document part, so we
 * unzip, pull `word/document.xml` and flatten the paragraph structure to text.
 */
export async function extractDocxText(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  const archive = unzipSync(buffer)
  const document = archive['word/document.xml']
  if (!document) {
    throw new Error('This file does not look like a readable .docx document.')
  }

  const xml = decodeEntities(strFromU8(document))

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:p\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
