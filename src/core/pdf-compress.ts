import { PDFDocument, PDFName, PDFRawStream, type PDFRef } from 'pdf-lib'
import sharp from 'sharp'

/**
 * Shrinking a PDF by re-encoding the images inside it.
 *
 * A PDF is a container, not an image format. Its own structure is lossless,
 * which is why `/compress` used to refuse one outright — but a scan or a photo
 * brochure is mostly JPEG data wrapped in that container, and re-encoding
 * those streams at a lower quality is exactly the trade `/compress` offers
 * everywhere else. Measured on a photo brochure: 429 KB to 91 KB.
 *
 * This module holds no engine or UI concerns: bytes in, bytes out, plus counts
 * the caller can report. That keeps it usable by the quality path and by the
 * target-size search, which calls it once per attempt.
 */

/**
 * `/DCTDecode` is a JPEG stream stored verbatim, so Sharp can decode it
 * straight out of the PDF and re-encode it.
 *
 * `/FlateDecode` is raw pixel data under zlib. Reconstructing an image from
 * it means handling colour space (DeviceRGB, DeviceGray, ICCBased, indexed
 * palettes), bits-per-component and decode arrays — getting any of those
 * wrong writes a corrupt page that still opens, which is worse than declining.
 * Those images are left exactly as they are and counted as skipped.
 */
const RECOMPRESSABLE = '/DCTDecode'

export interface PdfImageSurvey {
  /** Images this module can re-encode. */
  compressible: number
  /** Images it found but will not touch. */
  skipped: number
}

export interface PdfCompressResult {
  bytes: Uint8Array
  recompressed: number
  skipped: number
}

/** Every image XObject in the document, with the ref needed to replace it. */
function imageStreams(doc: PDFDocument): { ref: PDFRef; stream: PDFRawStream; filter: string }[] {
  const out: { ref: PDFRef; stream: PDFRawStream; filter: string }[] = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    out.push({ ref, stream: obj, filter: String(obj.dict.get(PDFName.of('Filter'))) })
  }
  return out
}

/**
 * What a PDF offers before anything is re-encoded.
 *
 * Separating this from the work itself is what lets `/compress` refuse a
 * text-only PDF up front, and distinguish that from a PDF whose images are
 * simply a kind Forge cannot re-encode — two different answers a user
 * deserves to be told apart.
 */
export async function surveyPdfImages(bytes: Uint8Array): Promise<PdfImageSurvey> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  let compressible = 0
  let skipped = 0
  for (const { filter } of imageStreams(doc)) {
    if (filter === RECOMPRESSABLE) compressible++
    else skipped++
  }
  return { compressible, skipped }
}

/**
 * Re-encodes every JPEG image in `bytes` at `quality` and returns the rebuilt
 * document.
 *
 * Always loads from the original bytes rather than mutating a shared document.
 * The target-size search calls this once per attempt, and a compounding
 * version would make the same quality yield a different size depending on what
 * ran before it — the bisection would then converge on a number that cannot be
 * reproduced.
 *
 * An image is only replaced when the re-encode is actually smaller. Raising
 * the quality above what a stream already carries makes it bigger, and
 * "compressing" a file into a larger one is a promise broken.
 */
export async function compressPdf(bytes: Uint8Array, quality: number): Promise<PdfCompressResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  let recompressed = 0
  let skipped = 0

  for (const { ref, stream, filter } of imageStreams(doc)) {
    if (filter !== RECOMPRESSABLE) {
      skipped++
      continue
    }
    const source = Buffer.from(stream.contents)
    let encoded: Buffer
    try {
      encoded = await sharp(source).jpeg({ quality, mozjpeg: true }).toBuffer()
    } catch {
      // A stream Sharp cannot read — a JPEG variant it declines, most
      // likely CMYK or a damaged scan. Left untouched rather than dropped.
      skipped++
      continue
    }
    if (encoded.byteLength >= source.byteLength) {
      skipped++
      continue
    }
    // A whole replacement object rather than writing through `contents`,
    // which pdf-lib declares read-only. Reusing the original dictionary keeps
    // Width, Height, ColorSpace and BitsPerComponent exactly as they were —
    // only the pixel data and its length change.
    stream.dict.set(PDFName.of('Length'), doc.context.obj(encoded.byteLength))
    doc.context.assign(ref, PDFRawStream.of(stream.dict, encoded))
    recompressed++
  }

  return { bytes: await doc.save(), recompressed, skipped }
}
