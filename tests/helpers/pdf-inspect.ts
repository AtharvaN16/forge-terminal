import { loadPdfLib } from '../../src/engines/libs.js'
import { openPdf } from '../../src/engines/pdfium.js'

/** A page's drawing instructions, as text. */
export async function content(bytes: Uint8Array, page = 0): Promise<string> {
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = await loadPdfLib()
  const pdf = await PDFDocument.load(bytes)
  const stream = pdf.context.lookup(pdf.getPage(page).node.get(PDFName.of('Contents')) as never)
  if (!(stream instanceof PDFRawStream)) throw new Error('no content stream')
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
}

/** Where a page has ink, in points from its top-left corner (rendered, so it is what a reader sees). */
export async function ink(bytes: Uint8Array, page = 0) {
  const pdfium = await openPdf(bytes)
  try {
    const scale = 2
    const r = await pdfium.getPage(page).render({ scale, render: 'bitmap' })
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const at = (y * r.width + x) * 4
        if ((r.data[at] ?? 255) < 160 && (r.data[at + 3] ?? 0) > 0) {
          left = Math.min(left, x)
          right = Math.max(right, x + 1)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y + 1)
        }
      }
    return { left: left / scale, right: right / scale, top: top / scale, bottom: bottom / scale }
  } finally {
    pdfium.destroy()
  }
}

/** The words of every page as one run, so a line break and a space read the same. */
export const words = (pages: string[]) => pages.join(' ').replace(/\s+/g, ' ').trim()

/** The names of the fonts a PDF embeds (`FAAAAA+Name`, less the six letters and the plus). */
export async function fontNames(bytes: Uint8Array): Promise<string[]> {
  const { PDFDocument, PDFDict, PDFName } = await loadPdfLib()
  const pdf = await PDFDocument.load(bytes)
  const names = new Set<string>()
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    const base = obj.get(PDFName.of('BaseFont'))
    const text = base?.toString().replace(/^\//, '')
    if (text) names.add(text.replace(/^[A-Z]{6}\+/, ''))
  }
  return [...names].sort()
}
