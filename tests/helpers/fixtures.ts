import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument, rgb } from 'pdf-lib'
import sharp from 'sharp'

const run = promisify(execFile)

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'forge-test-'))
}

export async function makePng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#c86432' } })
    .png()
    .toFile(path)
  return path
}

export async function makeTransparentPng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(path)
  return path
}

export async function makeJpeg(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } })
    .jpeg()
    .toFile(path)
  return path
}

/** Orientation 6 means "rotate 90° clockwise on display" — the classic phone-photo case. */
export async function makeOrientedJpeg(
  dir: string,
  name: string,
  orientation = 6,
): Promise<string> {
  const path = join(dir, name)
  const buffer = await sharp({
    create: { width: 40, height: 80, channels: 3, background: '#0000ff' },
  })
    .jpeg()
    .toBuffer()
  await sharp(buffer).withMetadata({ orientation }).jpeg().toFile(path)
  return path
}

/**
 * A photo-like oriented JPEG: a gradient plus noise, not a solid colour.
 *
 * `makeOrientedJpeg`'s flat background is fine for checking pixel
 * dimensions, but useless for checking output *size* — a solid colour
 * compresses smaller as PNG than as JPEG at fixture scale, exactly backwards
 * from what a real photo does, so it can't tell a lossless re-encode apart
 * from a lossy one by size. This gives PNG-vs-JPEG size the same shape a
 * real rotated photo has.
 */
export async function makeNoisyOrientedJpeg(
  dir: string,
  name: string,
  orientation = 6,
  width = 240,
  height = 180,
): Promise<string> {
  const path = join(dir, name)
  const buffer = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const noise = Math.floor(Math.random() * 40)
      buffer[i] = (x * 255) / width + noise
      buffer[i + 1] = (y * 255) / height + noise
      buffer[i + 2] = ((x + y) * 255) / (width + height) + noise
    }
  }
  await sharp(buffer, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 85, mozjpeg: true })
    .withMetadata({ orientation })
    .toFile(path)
  return path
}

/**
 * Sharp only treats raw input as multi-page when pageHeight sits inside the raw
 * options — the other three plausible spellings silently produce one tall frame.
 */
export async function makeAnimatedGif(dir: string, name: string, frames = 3): Promise<string> {
  const path = join(dir, name)
  const w = 8
  const h = 8
  const strip = Buffer.concat(
    Array.from({ length: frames }, (_, i) => Buffer.alloc(w * h * 3, 40 * (i + 1))),
  )
  await sharp(strip, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } })
    .gif()
    .toFile(path)
  return path
}

export async function makeCorruptFile(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, 'this is definitely not an image')
  return path
}

export async function makeAvif(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 24, height: 24, channels: 3, background: '#22aa55' } })
    .avif()
    .toFile(path)
  return path
}

/**
 * Sharp cannot encode HEIC, so the only way to get a genuine HEVC fixture is
 * macOS's built-in sips. Returns null elsewhere so tests can skip cleanly.
 */
export async function makeHeic(dir: string, name: string): Promise<string | null> {
  const source = await makePng(dir, `${name}.source.png`)
  const path = join(dir, name)
  try {
    await run('sips', ['-s', 'format', 'heic', source, '--out', path])
    return path
  } catch {
    return null
  }
}

/**
 * A HEIC whose container is genuinely identifiable but whose payload is not:
 * a real `makeHeic` file, truncated to just past its `ftyp` box. `ftyp`'s own
 * size is its first big-endian uint32, so the cut point is computed from the
 * real file rather than guessed — sips still reports pixel dimensions of 0
 * (or fails outright) for what remains, but `looksLikeHeic`'s content sniff,
 * which only reads the box itself, still recognises it. Returns null exactly
 * where `makeHeic` does: when `sips` is unavailable to build the source HEIC.
 */
export async function makeCorruptHeic(dir: string, name: string): Promise<string | null> {
  const real = await makeHeic(dir, `${name}.source.heic`)
  if (!real) return null
  const bytes = await readFile(real)
  const ftypBoxSize = bytes.readUInt32BE(0)
  const path = join(dir, name)
  await writeFile(path, bytes.subarray(0, ftypBoxSize + 8))
  return path
}

export async function pixelAt(
  path: string,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]
}

/**
 * A solid-colour fixture cannot detect quantisation — every pixel already
 * shares one colour. This builds a genuine gradient so a lossy re-encode that
 * collapses the palette is visible in a before/after colour count.
 */
export async function makeGradientPng(dir: string, name: string, size = 128): Promise<string> {
  const path = join(dir, name)
  const buffer = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      buffer[i] = (x * 2) % 256
      buffer[i + 1] = (y * 2) % 256
      buffer[i + 2] = ((x + y) * 3) % 256
    }
  }
  await sharp(buffer, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toFile(path)
  return path
}

export async function countColours(path: string): Promise<number> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  const colours = new Set<number>()
  for (let i = 0; i < data.length; i += info.channels) {
    colours.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0))
  }
  return colours.size
}

/** A plain N-page A4 document. 24 pages builds in about 14 ms. */
export async function makePdf(dir: string, name: string, pages = 3): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

export async function pdfPageCount(path: string): Promise<number> {
  const doc = await PDFDocument.load(await readFile(path), { ignoreEncryption: true })
  return doc.getPageCount()
}

/** Page `n` of a marked document is `MARK_BASE + mark` points wide. */
const MARK_BASE = 600

/**
 * A document whose pages are individually identifiable.
 *
 * Each page gets a distinct width, because that is what survives `copyPages`
 * and reads back through pdf-lib's public API. Drawn text does not: the
 * content stream comes back empty through every accessor pdf-lib exposes,
 * which would make an order assertion pass without testing anything.
 *
 * Merge and split need this: a page-count assertion still passes when an
 * operation silently reorders pages, and order is the whole point of merge.
 */
export async function makeMarkedPdf(dir: string, name: string, marks: number[]): Promise<string> {
  const doc = await PDFDocument.create()
  for (const mark of marks) doc.addPage([MARK_BASE + mark, 842])
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

/** The marks `makeMarkedPdf` wrote, read back in page order. */
export async function pdfPageMarks(path: string): Promise<number[]> {
  const doc = await PDFDocument.load(await readFile(path), { ignoreEncryption: true })
  return doc.getPages().map((p) => Math.round(p.getSize().width) - MARK_BASE)
}

/**
 * A file that starts with the `%PDF-` magic bytes Sharp and pdf-lib both use
 * to notice "this claims to be a PDF", but whose body neither can parse:
 * Sharp doesn't decode PDFs as an image at all, and pdf-lib's xref/trailer
 * parser throws on the garbage that follows. Distinct from `makeCorruptFile`,
 * which writes bytes that don't even look like any recognised format — this
 * exercises the case where content-based probing gets partway to "this looks
 * like a PDF" and then fails to decode it.
 */
export async function makeCorruptPdf(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, '%PDF-1.4\nthis is not a valid PDF body.\n%%EOF')
  return path
}

/** A one-page PDF filled with an asymmetric colour, for channel-order checks. */
export async function makeColouredPdf(
  dir: string,
  name: string,
  c: { r: number; g: number; b: number },
): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    color: rgb(c.r / 255, c.g / 255, c.b / 255),
  })
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

/**
 * A page where only the bottom-left quarter is painted; the rest is left
 * genuinely unpainted, not merely white. Renders (with `transparent: true`)
 * as real transparency there, so sampling far from the painted corner tests
 * what a *background* option actually did, not the page's own content — a
 * fully-painted fixture can't distinguish "flattened onto the requested
 * colour" from "the library's opaque-white default happened to match".
 */
export async function makePartiallyPaintedPdf(
  dir: string,
  name: string,
  c: { r: number; g: number; b: number },
): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    color: rgb(c.r / 255, c.g / 255, c.b / 255),
  })
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

/**
 * A PDF shaped like a scan: one photographic image per page.
 *
 * The image is noise, not a flat colour, so it behaves like a photograph
 * under re-encoding. A flat fill compresses to almost nothing at every
 * quality, which would make a compression test pass without compressing
 * anything — the same trap as a fixture whose page labels are all empty.
 *
 * `filter` chooses how the image is stored: `'jpeg'` embeds as /DCTDecode,
 * which Sharp can decode straight out of the PDF, and `'png'` embeds as
 * /FlateDecode, which it cannot. Real scans are the former.
 */
export async function makeScannedPdf(
  dir: string,
  name: string,
  opts: { pages?: number; filter?: 'jpeg' | 'png' } = {},
): Promise<string> {
  const { pages = 3, filter = 'jpeg' } = opts
  const w = 600
  const h = 450
  const raw = Buffer.alloc(w * h * 3)
  // Deterministic pseudo-noise: a fixed seed keeps fixture bytes stable
  // across runs, so a size assertion is not racing the random number
  // generator.
  let seed = 12_345
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    raw[i] = seed % 256
  }
  const image = sharp(raw, { raw: { width: w, height: h, channels: 3 } })
  const bytes =
    filter === 'jpeg' ? await image.jpeg({ quality: 95 }).toBuffer() : await image.png().toBuffer()

  const doc = await PDFDocument.create()
  const embedded = filter === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842])
    page.drawImage(embedded, { x: 40, y: 300, width: 515, height: 386 })
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}
