import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

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
 * If Forge ever leaves macOS, the portable substitute is `libheif-js` — a
 * WASM build of libheif — at the cost of an npm dependency and a slower,
 * in-process decode.
 */

let cached: boolean | undefined

/**
 * Whether HEIC can be decoded here. Cached: this shells out, and the answer
 * cannot change while the process is running.
 */
export async function heicDecodable(): Promise<boolean> {
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
export async function decodeHeic(source: string): Promise<DecodedHeic> {
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

/**
 * Whether the file is HEIC, decided by its own bytes.
 *
 * Needed because Sharp cannot be asked. A real photo is stored as a tiled
 * grid — a 12MP iPhone HEIC is dozens of tiles cross-referenced through the
 * ISO-BMFF `iref` box — and libheif refuses more than 16 references by
 * default:
 *
 *   heif: Security limit exceeded: Number of references in iref box (48)
 *   exceeds the security limits of 16 references
 *
 * So `sharp(photo).metadata()` throws for exactly the files people actually
 * have, while succeeding on the small single-tile fixtures a test suite
 * tends to generate. Detection therefore reads the container directly, which
 * is content-based and never consults the extension (invariant 3).
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
 * Dimensions straight from `sips`, for the files libheif will not parse.
 *
 * Known limitation: these are the dimensions `sips` reports, which for a
 * HEIC carrying an EXIF rotation are the stored ones, not the displayed
 * ones. `sips` exposes no orientation field for HEIC (`-g orientation`
 * returns nil, and Spotlight has nothing either), so there is no cheap way
 * to correct them without decoding the file — which at probe time would cost
 * a second per photo for a number shown on one line.
 *
 * The conversion itself is unaffected: the decoded intermediate carries the
 * orientation and `.rotate()` applies it, so the written file is always the
 * right way up. Only the dimensions in the file card can read transposed,
 * and only for a rotated source.
 * `hasAlpha` is asked for too rather than assumed: a photo never has an alpha
 * channel, but a HEIC exported from a graphics tool can, and guessing would
 * silently skip the flatten step that keeps transparency from going black.
 */
export async function heicInfo(path: string): Promise<HeicInfo> {
  const { stdout } = await run(
    '/usr/bin/sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', path],
    { timeout: 30_000 },
  )
  return {
    width: Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0),
    height: Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0),
    hasAlpha: /hasAlpha:\s*yes/i.test(stdout),
  }
}
