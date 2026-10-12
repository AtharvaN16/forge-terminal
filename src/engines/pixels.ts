import type { Pixels } from '../core/colour/palette.js'
import { corruptSource, heicDecoderUnavailable, isForgeError, notAnImage } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { ImageInfo } from '../core/types.js'
import { decodeHeic, heicDecodable } from './heic.js'
import { loadSharp } from './libs.js'
import { probe } from './registry.js'

/**
 * The pixels colour mode works on: the image shrunk to `longest` on its
 * longest side (192 is measured to keep a palette well under 0.1 s, colour
 * spec §2.2), upright, RGBA. Not an Engine: it plans no jobs and writes
 * nothing. It lives here so sharp never enters core (invariant 1).
 */
export async function samplePixels(
  path: string,
  longest = 192,
): Promise<{ source: ImageInfo; pixels: Pixels }> {
  const source = await probe(path)
  if (source.kind !== 'image') throw notAnImage(path, `a ${FORMATS[source.format].label}`)
  const heic = source.format === 'heic'
  if (heic && !(await heicDecodable())) throw heicDecoderUnavailable(path)
  const decoded = heic ? await decodeHeic(path) : undefined
  try {
    const sharp = await loadSharp()
    // sips already uprights HEIC; everything else is rotated first (invariant 4).
    const input = sharp(decoded?.path ?? path, { animated: false })
    const { data, info } = await (heic ? input : input.rotate())
      .resize(longest, longest, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      source,
      pixels: {
        width: info.width,
        height: info.height,
        rgba: new Uint8Array(data.buffer, data.byteOffset, data.length),
      },
    }
  } catch (e) {
    if (isForgeError(e)) throw e
    throw corruptSource(path, e)
  } finally {
    await decoded?.cleanup()
  }
}
