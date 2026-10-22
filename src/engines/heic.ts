import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { heicDecoderUnavailable } from '../core/errors.js'
import { loadSharp } from './libs.js'

const run = promisify(execFile)

/**
 * Why this file exists.
 *
 * Sharp's prebuilt binary bundles libheif *without* an HEVC decoder. That is
 * a licensing decision, not an oversight: HEVC sits in a patent pool, so the
 * upstream position is that HEIC support requires a globally installed
 * libvips built against libheif, libde265 and x265, and "the prebuilt
 * binaries will not include any support for HEIC". AVIF works in the same
 * container because AV1 is royalty-free.
 *
 * Measured on this machine: `sharp(heic).metadata()` succeeds and reports
 * `compression: 'hevc'`, so a HEIC file probes cleanly — and then decoding
 * fails with "Support for this compression format has not been built in".
 * That is the worst shape a limitation can take: the format list advertises
 * HEIC as readable, the picker offers targets for it, and the failure lands
 * at the final step with a generic message.
 *
 * Forge is a macOS tool, and macOS ships `sips`, which decodes HEIC through
 * Apple's own system codec. So HEIC is decoded to a temporary PNG first and
 * the ordinary Sharp pipeline runs on that. No new dependency, no build
 * step, and the fidelity comes from the same decoder Preview uses.
 *
 * Windows has no sips, so there HEIC is decoded by the optional `heic`
 * extension: libheif-js — a WASM build of libheif — run as a child process
 * (extensions/heic/runner.ts), which writes raw RGBA that Sharp wraps into
 * the same temporary PNG. Everything downstream is unchanged.
 */

/**
 * src/extensions is imported only on Windows, when HEIC is asked about: a
 * plain conversion must not load it (tests/cli/lazy-load.test.ts).
 */
const extensions = async () => ({
  ...(await import('../extensions/paths.js')),
  ...(await import('../extensions/run.js')),
})

let cached: boolean | undefined

/**
 * Whether HEIC can be decoded here. Cached on macOS: this shells out, and the
 * answer cannot change while the process is running. Not cached on Windows,
 * where it is a couple of file reads and an extension installed mid-session
 * must take effect at once.
 */
export async function heicDecodable(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform === 'win32') return (await (await extensions()).installed('heic')) !== undefined
  return sipsRuns()
}

/** Whether macOS's `sips` runs here. Cached; HEIC and camera RAW both decode through it. */
export async function sipsRuns(): Promise<boolean> {
  if (cached !== undefined) return cached
  try {
    await run('/usr/bin/sips', ['--help'], { timeout: 5000 })
    cached = true
  } catch {
    cached = false
  }
  return cached
}

/** Only for tests, which need to exercise both the available and missing paths. */
export function resetHeicSupportCache(): void {
  cached = undefined
}

export interface DecodedHeic {
  /** A PNG holding the decoded pixels. */
  path: string
  /** Deletes the temporary file. Always call it, including on failure. */
  cleanup: () => Promise<void>
}

/**
 * Decodes a HEIC file to a temporary PNG.
 *
 * PNG rather than JPEG on purpose: this is an intermediate, and a lossy hop
 * in the middle of a conversion would throw away quality the user never
 * agreed to lose. `sips` applies the file's EXIF orientation as it decodes,
 * so the PNG is already upright — which is why the caller must not rotate it
 * a second time.
 */
export async function decodeHeic(
  source: string,
  platform: NodeJS.Platform = process.platform,
): Promise<DecodedHeic> {
  if (platform === 'win32') return decodeWithExtension(source)
  const path = join(tmpdir(), `forge-heic-${randomBytes(8).toString('hex')}.png`)
  const cleanup = async () => {
    await rm(path, { force: true }).catch(() => {})
  }
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', path], {
      timeout: 120_000,
    })
    return { path, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

/** The installed heic extension, or the same refusal a missing sips gets on a Mac. */
async function heicExtension(source: string) {
  const { installed, runExtension } = await extensions()
  const ext = await installed('heic')
  if (ext === undefined) throw heicDecoderUnavailable(source, 'win32')
  return { ext, runExtension }
}

/**
 * Windows: the extension writes raw RGBA, which Sharp wraps into the PNG the
 * rest of the pipeline expects. libheif applies the container's rotation and
 * mirror while decoding, so the pixels are upright and carry no EXIF —
 * `.rotate()` on the PNG is a no-op, as it must be.
 */
async function decodeWithExtension(source: string): Promise<DecodedHeic> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-heic-'))
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  try {
    const { ext, runExtension } = await heicExtension(source)
    const rgba = join(dir, 'decoded.rgba')
    const png = join(dir, 'decoded.png')
    const { width, height } = await runExtension(ext, ['--in', source, '--out', rgba], {
      subject: source,
    })
    const sharp = await loadSharp()
    // A buffer, not the path: Sharp honours `raw` only for buffer input and
    // otherwise sniffs the file for a format, which raw bytes do not have.
    await sharp(await readFile(rgba), { raw: { width, height, channels: 4 } })
      .png()
      .toFile(png)
    await rm(rgba, { force: true })
    return { path: png, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

/**
 * Whether the file is HEIC, decided by its own bytes.
 *
 * Detection reads the container directly rather than asking Sharp, which is
 * content-based and never consults the extension (invariant 3). Sharp could
 * not be asked before 0.35.5: a 12MP iPhone HEIC is dozens of tiles
 * cross-referenced through the ISO-BMFF `iref` box, and older libheif
 * refused more than 16 references ("Security limit exceeded: Number of
 * references in iref box (48)"). It reads the header now, but it still has
 * no HEVC decoder, so the pixels go through sips either way.
 *
 * Layout: a 4-byte big-endian box size, the literal 'ftyp', then a 4-byte
 * major brand, then optional compatible brands. Any HEIF-family brand counts;
 * whether it is decodable is a separate question answered by `heicDecodable`.
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

/**
 * AVIF is the same container with a different codec, and it lists `mif1`
 * among its compatible brands — so a check for HEIF brands alone claims
 * every AVIF as HEIC. An AVIF brand anywhere in the box settles it, because
 * sharp reads AVIF perfectly well and must keep doing so.
 */
const AVIF_BRANDS = new Set(['avif', 'avis'])

export async function looksLikeHeic(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    return false
  }
  try {
    const buffer = Buffer.alloc(64)
    const { bytesRead } = await handle.read(buffer, 0, 64, 0)
    if (bytesRead < 12) return false
    if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false

    // The major brand, plus every compatible brand in the rest of the box.
    const size = Math.min(buffer.readUInt32BE(0), bytesRead)
    const brands: string[] = []
    for (let at = 8; at + 4 <= size; at += 4) {
      brands.push(buffer.toString('latin1', at, at + 4))
    }
    if (brands.some((b) => AVIF_BRANDS.has(b))) return false
    return brands.some((b) => HEIF_BRANDS.has(b))
  } catch {
    return false
  } finally {
    await handle.close().catch(() => {})
  }
}

export interface HeicInfo {
  width: number
  height: number
  hasAlpha: boolean
}

/**
 * Dimensions from `sips`, turned upright.
 *
 * `sips` reports the stored size, and exposes no orientation for HEIC
 * (`-g orientation` is nil, Spotlight has nothing either). A portrait photo
 * is stored sideways with an `irot` property saying so, and the decoded
 * intermediate is turned upright by `.rotate()` — so a stored size here would
 * put Resize's box on its side and squash the photo. The rotation is read
 * from the container instead (`quarterTurned`), a header read, never a decode.
 * `hasAlpha` is asked for too rather than assumed: a photo never has an alpha
 * channel, but a HEIC exported from a graphics tool can, and guessing would
 * silently skip the flatten step that keeps transparency from going black.
 *
 * On Windows the heic extension reads the same three from the container
 * without decoding pixels, and reports dimensions already rotated.
 */
export async function heicInfo(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<HeicInfo> {
  if (platform === 'win32') {
    const { ext, runExtension } = await heicExtension(path)
    const r = await runExtension(ext, ['--info', '--in', path], { subject: path })
    // An absent flag reads as alpha: flattening an opaque image costs nothing.
    return { width: r.width, height: r.height, hasAlpha: r.hasAlpha ?? true }
  }
  const { stdout } = await run(
    '/usr/bin/sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', path],
    { timeout: 30_000 },
  )
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const turned = await quarterTurned(path)
  return {
    width: turned ? height : width,
    height: turned ? width : height,
    hasAlpha: /hasAlpha:\s*yes/i.test(stdout),
  }
}

/** ISO media box type and the bounds of its body, within `buf`. */
export function* boxes(buf: Buffer, from: number, to: number) {
  let at = from
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at)
    let head = 8
    if (size === 1 && at + 16 <= to) {
      size = Number(buf.readBigUInt64BE(at + 8))
      head = 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < head) return
    yield {
      type: buf.toString('latin1', at + 4, at + 8),
      start: at + head,
      end: Math.min(at + size, to),
    }
    at += size
  }
}

/**
 * Whether the primary image carries an `irot` of 90° or 270°, read from the
 * HEIF `meta` box: `pitm` names the primary item, `ipco` lists properties,
 * `ipma` says which belong to which item. Any malformed or missing box means
 * "not turned" — the worst case is the stored size, which is what it was.
 */
async function quarterTurned(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    // The meta box sits at the front of a HEIC; 256 KB is far beyond any real one.
    const buf = Buffer.alloc(1 << 18)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const meta = [...boxes(buf, 0, bytesRead)].find((b) => b.type === 'meta')
    if (!meta) return false
    // `meta` is a FullBox: four bytes of version and flags before its children.
    const children = [...boxes(buf, meta.start + 4, meta.end)]
    const pitm = children.find((b) => b.type === 'pitm')
    const iprp = children.find((b) => b.type === 'iprp')
    if (!pitm || !iprp) return false
    const primary =
      buf.readUInt8(pitm.start) === 0
        ? buf.readUInt16BE(pitm.start + 4)
        : buf.readUInt32BE(pitm.start + 4)

    const props = [...boxes(buf, iprp.start, iprp.end)]
    const ipco = props.find((b) => b.type === 'ipco')
    const ipma = props.find((b) => b.type === 'ipma')
    if (!ipco || !ipma) return false
    // 1-based property index → quarter turns, for every `irot` in the list.
    const turns = new Map<number, number>()
    ;[...boxes(buf, ipco.start, ipco.end)].forEach((b, i) => {
      if (b.type === 'irot') turns.set(i + 1, buf.readUInt8(b.start) & 3)
    })
    if (turns.size === 0) return false

    const version = buf.readUInt8(ipma.start)
    const wide = (buf.readUInt8(ipma.start + 3) & 1) === 1
    let at = ipma.start + 4
    const entries = buf.readUInt32BE(at)
    at += 4
    for (let e = 0; e < entries && at < ipma.end; e++) {
      const item = version < 1 ? buf.readUInt16BE(at) : buf.readUInt32BE(at)
      at += version < 1 ? 2 : 4
      const count = buf.readUInt8(at)
      at += 1
      for (let a = 0; a < count; a++) {
        const index = wide ? buf.readUInt16BE(at) & 0x7fff : buf.readUInt8(at) & 0x7f
        at += wide ? 2 : 1
        if (item === primary && (turns.get(index) ?? 0) % 2 === 1) return true
      }
    }
    return false
  } catch {
    return false
  } finally {
    await handle.close().catch(() => {})
  }
}
