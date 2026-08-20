import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
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
