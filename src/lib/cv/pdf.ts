import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Extracts the text layer of a PDF. Image-only (scanned) PDFs have no text
 * layer and are not supported in the preview.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise

  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
    pages.push(text)
  }

  return pages.join('\n\n').trim()
}
