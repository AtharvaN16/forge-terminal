import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument } from 'pdf-lib'
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
