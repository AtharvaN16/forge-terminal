import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib'
import sharp from 'sharp'

/**
 * Shrinking a PDF by re-encoding — and optionally shrinking — the images
 * inside it.
 *
 * A PDF is a container, not an image format. Its own structure is lossless,
 * which is why `/compress` used to refuse one outright — but a scan or a photo
 * brochure is mostly JPEG data wrapped in that container, and re-encoding
 * those streams at a lower quality is exactly the trade `/compress` offers
 * everywhere else.
 *
 * Two levers, and the second is far the larger. Measured on a 3-page 300 dpi
 * A4 scan of 5.7 MB: re-encoding alone at q40 reaches 1065 KB, while also
 * reducing to 150 dpi reaches 111 KB — about ten times more saving. They are
 * separate knobs because they cost different things: quality costs fine
 * detail, resolution costs the ability to zoom and to print well.
 *
 * This module holds no engine or UI concerns: bytes in, bytes out, plus counts
 * the caller can report. That keeps it usable by the quality path and by the
 * target-size search, which calls it once per attempt.
 */

/**
 * `/DCTDecode` is a JPEG stream stored verbatim, so Sharp can decode it
 * straight out of the PDF and re-encode it.
 *
 * It may sit behind a text-safe layer — `[/ASCII85Decode /DCTDecode]` is how
 * some exporters write a whole brochure — and those are undone first. A chain
 * with anything else in front of the JPEG is left alone.
 *
 * `/FlateDecode` is raw pixel data under zlib. Reconstructing an image from
 * it means handling colour space (DeviceRGB, DeviceGray, ICCBased, indexed
 * palettes), bits-per-component and decode arrays — getting any of those
 * wrong writes a corrupt page that still opens, which is worse than declining.
 * Those images are left exactly as they are and counted as skipped.
 */
const JPEG = new Set(['/DCTDecode', '/DCT'])
const ASCII85 = new Set(['/ASCII85Decode', '/A85'])
const ASCII_HEX = new Set(['/ASCIIHexDecode', '/AHx'])

/** The filters an image stream is stored under, outermost first. */
function filterChain(stream: PDFRawStream): string[] {
  const filter = stream.dict.get(PDFName.of('Filter'))
  if (filter instanceof PDFArray) return filter.asArray().map(String)
  return filter === undefined ? [] : [String(filter)]
}

/** Whether the stream is a JPEG, possibly wrapped in ASCII85 or hex text. */
function isJpegChain(chain: string[]): boolean {
  const last = chain[chain.length - 1]
  if (last === undefined || !JPEG.has(last)) return false
  return chain.slice(0, -1).every((f) => ASCII85.has(f) || ASCII_HEX.has(f))
}

/**
 * Whether Sharp's output can stand in for this image's pixels.
 *
 * It writes a 3-channel RGB JPEG, or a 1-channel one from a greyscale source.
 * An image declared as CMYK, indexed, Separation or DeviceN would then hold
 * the wrong number of channels for its colour space — a page that opens but
 * renders scrambled, with nothing to say so. A `/Decode` array inverts or
 * remaps channels, which a re-encode would bake in a second time.
 */
function keepsColourUnderSharp(doc: PDFDocument, stream: PDFRawStream): boolean {
  if (stream.dict.has(PDFName.of('Decode'))) return false
  const space = stream.dict.get(PDFName.of('ColorSpace'))
  if (space instanceof PDFName) return ['/DeviceGray', '/DeviceRGB'].includes(String(space))
  if (space instanceof PDFArray && String(space.get(0)) === '/ICCBased') {
    const profile = doc.context.lookup(space.get(1))
    const channels = profile instanceof PDFRawStream ? numberEntry(profile, 'N') : undefined
    return channels === 1 || channels === 3
  }
  return false
}

function decodeAscii85(text: Buffer): Buffer {
  const out: number[] = []
  const group: number[] = []
  const flush = (keep: number) => {
    let n = 0
    for (let i = 0; i < 5; i++) n = n * 85 + (group[i] ?? 84)
    for (let i = 0; i < keep; i++) out.push(Math.floor(n / 256 ** (3 - i)) % 256)
    group.length = 0
  }
  let i = text.toString('latin1').startsWith('<~') ? 2 : 0
  for (; i < text.length; i++) {
    const c = text[i] as number
    if (c === 0x7e) break // "~>"
    if (c <= 0x20) continue
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    group.push(c - 33)
    if (group.length === 5) flush(4)
  }
  if (group.length > 1) {
    const keep = group.length - 1
    flush(keep)
  }
  return Buffer.from(out)
}

function decodeAsciiHex(text: Buffer): Buffer {
  const hex = text.toString('latin1').split('>')[0]?.replace(/\s+/g, '') ?? ''
  return Buffer.from(hex.length % 2 === 1 ? `${hex}0` : hex, 'hex')
}

/** The JPEG bytes inside the stream, with any ASCII layers undone. */
function jpegBytes(stream: PDFRawStream, chain: string[]): Buffer {
  let data: Buffer = Buffer.from(stream.contents)
  for (const f of chain.slice(0, -1))
    data = ASCII85.has(f) ? decodeAscii85(data) : decodeAsciiHex(data)
  return data
}

export interface PdfImageSurvey {
  /** Images this module can re-encode. */
  compressible: number
  /** Images it found but will not touch. */
  skipped: number
  /**
   * The highest effective resolution any compressible image is drawn at, or
   * `undefined` when there is none to measure. Lets a caller say "300 → 150
   * dpi" rather than quoting a pixel count nobody asked about.
   */
  maxDpi?: number
}

export interface PdfCompressOptions {
  /** 1-100, passed to the JPEG encoder. */
  quality: number
  /**
   * Cap on effective resolution. Omitted leaves pixel dimensions alone.
   * An image already below the cap is never enlarged — that would add bytes
   * and no detail, the opposite of what compression promises.
   */
  dpi?: number
}

export interface PdfCompressResult {
  bytes: Uint8Array
  recompressed: number
  skipped: number
  /** Set when at least one image was reduced, for reporting. */
  fromDpi?: number
  toDpi?: number
}

interface ImageRef {
  ref: PDFRef
  stream: PDFRawStream
  chain: string[]
  /** A JPEG this module can re-encode without changing its colour. */
  recompressible: boolean
  /**
   * How wide the image is drawn on its page, in points. `undefined` when the
   * image could not be tied to a page — a rare shape this declines to guess
   * about, leaving resolution untouched rather than inventing a scale.
   */
  drawnWidthPt?: number
}

/**
 * Every image XObject, with the width of the page that references it.
 *
 * The page width stands in for the width the image is drawn at. That is exact
 * for a scan, where one image covers the page, and a scan is the case this
 * feature exists for. Reading the true drawn size would mean parsing each
 * content stream's transformation matrix; the pay-off is a better figure for
 * collages, and the cost is a content-stream parser this does not need.
 */
function imageRefs(doc: PDFDocument): ImageRef[] {
  const drawnWidth = new Map<string, number>()
  for (const page of doc.getPages()) {
    const resources = page.node.Resources()
    const xobjects = resources?.lookup(PDFName.of('XObject')) as
      | { keys?: () => PDFName[]; get?: (k: PDFName) => unknown }
      | undefined
    for (const key of xobjects?.keys?.() ?? []) {
      const entry = xobjects?.get?.(key)
      if (entry !== undefined) drawnWidth.set(String(entry), page.getSize().width)
    }
  }

  const out: ImageRef[] = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    const width = drawnWidth.get(String(ref))
    const chain = filterChain(obj)
    out.push({
      ref,
      stream: obj,
      chain,
      recompressible: isJpegChain(chain) && keepsColourUnderSharp(doc, obj),
      ...(width === undefined ? {} : { drawnWidthPt: width }),
    })
  }
  return out
}

/**
 * A numeric dictionary entry, or `undefined`.
 *
 * `dict.get()` is typed as the `PDFObject` base, which carries no `asNumber`.
 * Narrowing through `PDFNumber` keeps that honest instead of casting: an entry
 * that is an indirect reference, or absent, reads as unknown rather than as a
 * number that happens to be `NaN`.
 */
function numberEntry(stream: PDFRawStream, key: string): number | undefined {
  const value = stream.dict.get(PDFName.of(key))
  return value instanceof PDFNumber ? value.asNumber() : undefined
}

/** Pixels per inch an image is actually shown at. */
function effectiveDpi(pixelWidth: number, drawnWidthPt: number): number {
  return pixelWidth / (drawnWidthPt / 72)
}

/**
 * What a PDF offers before anything is re-encoded.
 *
 * Separating this from the work itself is what lets `/compress` refuse a
 * text-only PDF up front, and distinguish that from a PDF whose images are
 * simply a kind Forge cannot re-encode — two different answers a user
 * deserves to be told apart.
 */
export function surveyDocument(doc: PDFDocument): PdfImageSurvey {
  let compressible = 0
  let skipped = 0
  let maxDpi: number | undefined
  for (const image of imageRefs(doc)) {
    if (!image.recompressible) {
      skipped++
      continue
    }
    compressible++
    const pixels = numberEntry(image.stream, 'Width')
    if (pixels !== undefined && image.drawnWidthPt !== undefined) {
      const dpi = effectiveDpi(pixels, image.drawnWidthPt)
      if (maxDpi === undefined || dpi > maxDpi) maxDpi = dpi
    }
  }
  return { compressible, skipped, ...(maxDpi === undefined ? {} : { maxDpi: Math.round(maxDpi) }) }
}

/**
 * The same survey from raw bytes.
 *
 * `engines/pdf.ts`'s probe uses {@link surveyDocument} on the document it has
 * already parsed instead — probing happens on every drop, and parsing a large
 * PDF twice to answer one question is a cost the user feels as lag.
 */
export async function surveyPdfImages(bytes: Uint8Array): Promise<PdfImageSurvey> {
  return surveyDocument(await PDFDocument.load(bytes, { ignoreEncryption: true }))
}

/**
 * Re-encodes every JPEG image in `bytes`, optionally reducing resolution, and
 * returns the rebuilt document.
 *
 * Always loads from the original bytes rather than mutating a shared document.
 * The target-size search calls this once per attempt, and a compounding
 * version would make the same settings yield a different size depending on
 * what ran before — the search would then converge on a number that cannot be
 * reproduced.
 *
 * An image is only replaced when the result is actually smaller. Raising the
 * quality above what a stream already carries makes it bigger, and
 * "compressing" a file into a larger one is a promise broken.
 */
export async function compressPdf(
  bytes: Uint8Array,
  options: PdfCompressOptions,
): Promise<PdfCompressResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  let recompressed = 0
  let skipped = 0
  let fromDpi: number | undefined
  let toDpi: number | undefined

  for (const { ref, stream, chain, recompressible, drawnWidthPt } of imageRefs(doc)) {
    if (!recompressible) {
      skipped++
      continue
    }
    const source = jpegBytes(stream, chain)
    const pixelWidth = numberEntry(stream, 'Width')

    // Only downsample when the resolution is both known and above the cap.
    let targetPixels: number | undefined
    if (options.dpi !== undefined && pixelWidth !== undefined && drawnWidthPt !== undefined) {
      const current = effectiveDpi(pixelWidth, drawnWidthPt)
      if (current > options.dpi) {
        targetPixels = Math.max(1, Math.round((drawnWidthPt / 72) * options.dpi))
        if (fromDpi === undefined || current > fromDpi) fromDpi = Math.round(current)
        toDpi = options.dpi
      }
    }

    let encoded: Buffer
    let encodedWidth: number | undefined
    let encodedHeight: number | undefined
    try {
      const pipeline = sharp(source)
      const resized =
        targetPixels === undefined
          ? pipeline
          : pipeline.resize({ width: targetPixels, withoutEnlargement: true })
      const { data, info } = await resized
        .jpeg({ quality: options.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
      encoded = data
      encodedWidth = info.width
      encodedHeight = info.height
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
    // ColorSpace and BitsPerComponent exactly as they were; only the pixel
    // data, its length, and — when resized — the dimensions change.
    stream.dict.set(PDFName.of('Length'), doc.context.obj(encoded.byteLength))
    // The new bytes are a bare JPEG, so any text layer in front of it goes.
    stream.dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    stream.dict.delete(PDFName.of('DecodeParms'))
    if (targetPixels !== undefined && encodedWidth !== undefined && encodedHeight !== undefined) {
      stream.dict.set(PDFName.of('Width'), doc.context.obj(encodedWidth))
      stream.dict.set(PDFName.of('Height'), doc.context.obj(encodedHeight))
    }
    doc.context.assign(ref, PDFRawStream.of(stream.dict, encoded))
    recompressed++
  }

  return {
    bytes: await doc.save(),
    recompressed,
    skipped,
    ...(fromDpi === undefined ? {} : { fromDpi }),
    ...(toDpi === undefined ? {} : { toDpi }),
  }
}
