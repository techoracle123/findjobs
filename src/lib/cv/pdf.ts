import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { MAX_CV_PDF_PAGES, MAX_CV_TEXT_CHARS } from './limits'
import { textFromPositionedItems, type PositionedTextItem } from './pdf-lines'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Extracts the text layer of a PDF. Image-only (scanned) PDFs have no text
 * layer and are not supported. Positioned fragments are grouped back into
 * lines so headings and bullets are not flattened into one long paragraph.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise

  try {
    if (document.numPages > MAX_CV_PDF_PAGES) {
      throw new Error(
        `FJ:That PDF has ${document.numPages} pages. FJ can read up to ${MAX_CV_PDF_PAGES} pages. Remove extra certificates or attachments and try again.`,
      )
    }

    const pages: string[] = []
    let totalLength = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items: PositionedTextItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const transform = Array.isArray(item.transform) ? item.transform : []
        items.push({
          str: item.str,
          x: typeof transform[4] === 'number' ? transform[4] : 0,
          y: typeof transform[5] === 'number' ? transform[5] : 0,
          width: typeof item.width === 'number' ? item.width : undefined,
          height:
            typeof item.height === 'number' && item.height > 0
              ? item.height
              : typeof transform[3] === 'number'
                ? Math.abs(transform[3])
                : undefined,
        })
      }
      const text = textFromPositionedItems(items)
      if (text) pages.push(text)
      totalLength += text.length + 2
      if (totalLength > MAX_CV_TEXT_CHARS) {
        throw new Error(
          'FJ:This CV has more than 60,000 characters of readable text. Remove repeated pages or old attachments and try again. FJ will not cut the text without telling you.',
        )
      }
    }

    return pages.join('\n\n').trim()
  } finally {
    await document.destroy()
  }
}
