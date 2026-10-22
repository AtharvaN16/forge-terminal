import { heicDecoderUnavailable } from '../core/errors.js'
import type { FormatId } from '../core/types.js'
import { decodeHeic, heicDecodable } from './heic.js'
import { decodeRaw } from './raw.js'

export interface Openable {
  /** The file Sharp opens. */
  path: string
  /** Deletes any temporary decode. Always call it, including on failure. */
  cleanup: () => Promise<void>
}

/**
 * The file Sharp opens for an image at `path`: the file itself, or — for the
 * two formats Sharp cannot decode, HEIC and camera RAW — a temporary PNG the
 * system decoded (engines/heic.ts, engines/raw.ts).
 *
 * Either way the caller rotates first (invariant 4). `sips` keeps a photo's
 * orientation as EXIF in the PNG rather than turning its pixels — measured
 * for both formats — so skipping `.rotate()` because "sips already did it"
 * leaves a portrait photo on its side.
 */
export async function openable(path: string, format: FormatId): Promise<Openable> {
  if (format === 'heic') {
    if (!(await heicDecodable())) throw heicDecoderUnavailable(path)
    return decodeHeic(path)
  }
  if (format === 'raw') return decodeRaw(path)
  return { path, cleanup: async () => {} }
}
