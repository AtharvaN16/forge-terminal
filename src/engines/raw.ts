import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { rawDecoderUnavailable } from '../core/errors.js'
import { boxes, sipsRuns } from './heic.js'

const run = promisify(execFile)

/**
 * Why this file exists.
 *
 * Every camera maker has its own RAW format — Canon CR2 and CR3, Nikon NEF,
 * Sony ARW, Fujifilm RAF, Olympus ORF, Panasonic RW2 and more — and each
 * changes with the camera model. Sharp has no RAW decoder. Worse, most of
 * these are TIFF files underneath, whose first directory holds a small
 * preview, so a TIFF reader opens them without complaint and converts the
 * preview: measured, a Nikon D2H NEF reads as 160×120, an iPhone DNG as
 * 852×640.
 *
 * macOS decodes them all — the RAW support Preview and Photos use, kept up to
 * date with new cameras by Apple — and `sips` reaches it. So a RAW file is
 * decoded to a temporary PNG and the ordinary Sharp pipeline runs on that,
 * exactly as HEIC is (engines/heic.ts).
 *
 * One catch decides the shape of this file: macOS picks the reader for a
 * TIFF-based RAW (NEF, ARW, PEF, DNG) by the file's *name*. The same NEF
 * renamed `.tif`, or with no extension, is read as a TIFF and decodes to its
 * preview. Forge never trusts a name (invariant 3), so the bytes say which
 * format a file is, and `sips` is shown it under the extension that format
 * needs: the file itself when its name already fits, else a copy.
 */

export interface RawKind {
  /** The extension macOS needs to see to read this file as RAW. */
  ext: string
  /** EXIF orientation from the file's own header; 1 when it has none. */
  orientation: number
}

/** Extensions that already read as each kind; anything else is shown to sips as a copy. */
const NAMES: Record<string, readonly string[]> = {
  '.nef': ['.nef', '.nrw'],
  '.arw': ['.arw', '.srf', '.sr2'],
  '.rw2': ['.rw2', '.rwl'],
  '.3fr': ['.3fr', '.fff'],
  '.dcr': ['.dcr', '.kdc'],
}

/**
 * TIFF-based RAW formats with no mark of their own, known by the maker
 * written in the first directory. Lower case, matched as a prefix.
 */
const MAKERS: readonly (readonly [maker: string, ext: string])[] = [
  ['nikon', '.nef'],
  ['sony', '.arw'],
  ['pentax', '.pef'],
  ['ricoh', '.pef'],
  ['samsung', '.srw'],
  ['hasselblad', '.3fr'],
  ['seiko epson', '.erf'],
  ['epson', '.erf'],
  ['kodak', '.dcr'],
  ['eastman kodak', '.dcr'],
  ['leaf', '.mos'],
]

/**
 * What marks a directory as sensor data rather than a picture: a colour
 * mosaic or linear raw photometric, or a maker's own compression. A camera
 * that also saves ordinary TIFFs writes its name into those too; this is what
 * tells the two apart.
 */
const MOSAIC = new Set([32803, 34892])
const MAKER_COMPRESSION = new Set([32767, 32769, 32770, 34316, 34713, 65000, 65535])

/** Canon's uuid box in a CR3's moov, which holds the TIFF directories. */
const CANON_UUID = '85c0b687820f11e08111f4ce462b6a48'

type Read = (at: number, length: number) => Promise<Buffer>

interface Entry {
  type: number
  count: number
  /** The value's bytes when they fit in the entry, else where they are. */
  inline: Buffer
  offset: number
}

interface Directory {
  entries: Map<number, Entry>
  next: number
}

/** A TIFF reader over any byte source, little- or big-endian. */
function tiff(read: Read, little: boolean) {
  const u16 = (b: Buffer, at: number) => (little ? b.readUInt16LE(at) : b.readUInt16BE(at))
  const u32 = (b: Buffer, at: number) => (little ? b.readUInt32LE(at) : b.readUInt32BE(at))
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1, 13: 4 }

  async function directory(at: number): Promise<Directory | undefined> {
    if (at <= 0) return undefined
    const head = await read(at, 2)
    if (head.length < 2) return undefined
    const count = u16(head, 0)
    if (count === 0 || count > 1000) return undefined
    const body = await read(at + 2, count * 12 + 4)
    if (body.length < count * 12 + 4) return undefined
    const entries = new Map<number, Entry>()
    for (let i = 0; i < count; i++) {
      const p = i * 12
      entries.set(u16(body, p), {
        type: u16(body, p + 2),
        count: u32(body, p + 4),
        inline: body.subarray(p + 8, p + 12),
        offset: u32(body, p + 8),
      })
    }
    return { entries, next: u32(body, count * 12) }
  }

  /** An entry's numbers (SHORT or LONG), at most `max` of them. */
  async function numbers(entry: Entry | undefined, max = 16): Promise<number[]> {
    if (!entry) return []
    const width = SIZES[entry.type] === 2 ? 2 : 4
    const n = Math.min(entry.count, max)
    const bytes = n * width <= 4 ? entry.inline : await read(entry.offset, n * width)
    const out: number[] = []
    for (let i = 0; i < n && (i + 1) * width <= bytes.length; i++) {
      out.push(width === 2 ? u16(bytes, i * width) : u32(bytes, i * width))
    }
    return out
  }

  async function text(entry: Entry | undefined): Promise<string> {
    if (entry?.type !== 2) return ''
    const n = Math.min(entry.count, 64)
    const bytes = n <= 4 ? entry.inline.subarray(0, n) : await read(entry.offset, n)
    return bytes.toString('latin1').replace(/\0.*$/s, '').trim()
  }

  async function orientation(dir: Directory): Promise<number> {
    const [o] = await numbers(dir.entries.get(274), 1)
    return o !== undefined && o >= 1 && o <= 8 ? o : 1
  }

  /**
   * Whether any directory holds sensor data: the first directory's chain and
   * each one's sub-directories, a dozen at most so a looping file ends.
   */
  async function hasMosaic(first: Directory): Promise<boolean> {
    const queue: Directory[] = [first]
    const seen = new Set<number>()
    for (let visited = 0; queue.length > 0 && visited < 12; visited++) {
      const dir = queue.shift() as Directory
      const [photometric] = await numbers(dir.entries.get(262), 1)
      const [compression] = await numbers(dir.entries.get(259), 1)
      if (photometric !== undefined && MOSAIC.has(photometric)) return true
      if (compression !== undefined && MAKER_COMPRESSION.has(compression)) return true
      for (const at of [...(await numbers(dir.entries.get(330), 8)), dir.next]) {
        if (at === 0 || seen.has(at)) continue
        seen.add(at)
        const sub = await directory(at)
        if (sub) queue.push(sub)
      }
    }
    return false
  }

  return { directory, text, orientation, hasMosaic, u32 }
}

/** The byte order a TIFF-shaped header declares, or undefined for neither. */
function order(head: Buffer): boolean | undefined {
  const mark = head.toString('latin1', 0, 2)
  return mark === 'II' ? true : mark === 'MM' ? false : undefined
}

/** The orientation in a TIFF held in `buf` from `start` (a CR3's CMT1, a JPEG's EXIF). */
async function orientationIn(buf: Buffer, start: number): Promise<number> {
  const little = order(buf.subarray(start, start + 2))
  if (little === undefined) return 1
  const read: Read = async (at, length) => buf.subarray(start + at, start + at + length)
  const t = tiff(read, little)
  const first = await t.directory(t.u32(buf, start + 4))
  return first ? t.orientation(first) : 1
}

/** A JPEG's EXIF orientation: the TIFF in its APP1 segment. */
async function jpegOrientation(jpeg: Buffer): Promise<number> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return 1
  let at = 2
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1]
    const length = jpeg.readUInt16BE(at + 2)
    if (marker === 0xe1 && jpeg.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      return orientationIn(jpeg, at + 10)
    }
    if (marker === 0xda) break
    at += 2 + length
  }
  return 1
}

/** A CR3's orientation, from the TIFF directory in moov → Canon's uuid → CMT1. */
async function cr3Orientation(read: Read, size: number): Promise<number> {
  const head = await read(0, Math.min(size, 1 << 20))
  const moov = [...boxes(head, 0, head.length)].find((b) => b.type === 'moov')
  if (!moov) return 1
  for (const box of boxes(head, moov.start, moov.end)) {
    if (box.type !== 'uuid' || head.toString('hex', box.start, box.start + 16) !== CANON_UUID) {
      continue
    }
    const cmt1 = [...boxes(head, box.start + 16, box.end)].find((b) => b.type === 'CMT1')
    return cmt1 ? orientationIn(head, cmt1.start) : 1
  }
  return 1
}

/** A RAF's orientation: the header says where its JPEG is, and that JPEG's EXIF says. */
async function rafOrientation(read: Read, head: Buffer): Promise<number> {
  if (head.length < 92) return 1
  const at = head.readUInt32BE(84)
  const length = head.readUInt32BE(88)
  if (at === 0 || length === 0) return 1
  return jpegOrientation(await read(at, Math.min(length, 1 << 16)))
}

/**
 * Whether the file is camera RAW, decided by its own bytes, and if so which
 * extension macOS needs to read it as such. Never decodes; a few small reads.
 */
export async function sniffRaw(path: string): Promise<RawKind | undefined> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    return undefined
  }
  try {
    const { size } = await handle.stat()
    const read: Read = async (at, length) => {
      const n = Math.max(0, Math.min(length, size - at))
      const buf = Buffer.alloc(n)
      if (n > 0) await handle.read(buf, 0, n, at)
      return buf
    }
    const head = await read(0, 96)
    if (head.length < 16) return undefined
    const magic = head.toString('latin1', 0, 4)

    if (head.toString('latin1', 0, 15) === 'FUJIFILMCCD-RAW') {
      return { ext: '.raf', orientation: await rafOrientation(read, head) }
    }
    if (head.toString('latin1', 4, 12) === 'ftypcrx ') {
      return { ext: '.cr3', orientation: await cr3Orientation(read, size) }
    }

    const little = order(head)
    if (little === undefined) return undefined
    const t = tiff(read, little)
    const first = await t.directory(t.u32(head, 4))
    if (!first) return undefined
    const orientation = await t.orientation(first)

    // TIFF-shaped, each with its own mark in place of TIFF's 42.
    if (magic === 'IIRO' || magic === 'IIRS' || magic === 'MMOR')
      return { ext: '.orf', orientation }
    if (magic === 'IIU\0') return { ext: '.rw2', orientation }
    if (magic !== 'II*\0' && magic !== 'MM\0*') return undefined

    if (first.entries.has(50706)) return { ext: '.dng', orientation }
    if (head.toString('latin1', 8, 11) === 'CR\x02') return { ext: '.cr2', orientation }
    const maker = (await t.text(first.entries.get(271))).toLowerCase()
    const known = MAKERS.find(([m]) => maker.startsWith(m))
    if (!known || !(await t.hasMosaic(first))) return undefined
    return { ext: known[1], orientation }
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => {})
  }
}

/** Whether camera RAW can be decoded here: on a Mac, where sips runs. */
export async function rawDecodable(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  return platform === 'darwin' && sipsRuns()
}

/**
 * Runs `use` with a path to the file whose name macOS reads as `kind`: the
 * file itself when its extension already fits, else a temporary copy.
 */
async function named<T>(path: string, kind: RawKind, use: (path: string) => Promise<T>) {
  const ext = extname(path).toLowerCase()
  if ((NAMES[kind.ext] ?? [kind.ext]).includes(ext)) return use(path)
  const dir = await mkdtemp(join(tmpdir(), 'forge-raw-'))
  try {
    const copy = join(dir, `photo${kind.ext}`)
    await copyFile(path, copy)
    return await use(copy)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The photo's upright size, or undefined when macOS does not read the file as
 * RAW — a camera newer than the system, usually. `sips` reports the stored
 * size and no orientation for RAW, so the header's orientation turns it.
 */
export async function rawSize(
  path: string,
  kind: RawKind,
): Promise<{ width: number; height: number } | undefined> {
  const { stdout } = await named(path, kind, (p) =>
    run('/usr/bin/sips', ['-g', 'typeIdentifier', '-g', 'pixelWidth', '-g', 'pixelHeight', p], {
      timeout: 30_000,
    }),
  )
  if (!/typeIdentifier:\s*\S*raw-image/.test(stdout)) return undefined
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  if (width === 0 || height === 0) return undefined
  return kind.orientation >= 5 ? { width: height, height: width } : { width, height }
}

export interface DecodedRaw {
  /** A PNG holding the decoded pixels, as stored: it carries the orientation, so rotate it. */
  path: string
  /** Deletes the temporary file. Always call it, including on failure. */
  cleanup: () => Promise<void>
}

/**
 * Decodes a RAW file to a temporary PNG — lossless, so the only rendering
 * choices made are macOS's own defaults, as Preview shows the photo.
 */
export async function decodeRaw(path: string): Promise<DecodedRaw> {
  if (!(await rawDecodable())) throw rawDecoderUnavailable(path)
  const kind = (await sniffRaw(path)) ?? { ext: extname(path).toLowerCase(), orientation: 1 }
  const out = join(tmpdir(), `forge-raw-${randomBytes(8).toString('hex')}.png`)
  const cleanup = async () => {
    await rm(out, { force: true }).catch(() => {})
  }
  try {
    await named(path, kind, (p) =>
      run('/usr/bin/sips', ['-s', 'format', 'png', p, '--out', out], { timeout: 300_000 }),
    )
    return { path: out, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}
