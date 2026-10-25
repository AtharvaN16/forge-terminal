/**
 * Remove banding in /edit: stripes in smooth shading, left by heavy
 * compression or too few colours, blended back into a gradient. Pure pixels
 * in, pixels out: the engine reads the picture and writes the file.
 *
 * ffmpeg's deband, done here so a picture needs no ffmpeg. Each pixel is
 * compared with the average of four others a random distance away (mirrored
 * about it); if they are close — the pixel sits in a stripe, not on an edge —
 * it takes that average. The random distances leave a fine grain, which is
 * what keeps the stripes from coming back when the result is rounded to 8 bits.
 */

import type { DebandPass } from '../core/deband.js'

/** A pseudo-random sequence from a seed, so the same picture always comes out the same. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One pass over `pixels` (`channels` bytes a pixel, `width` × `height`); the
 * colour channels are smoothed and an alpha channel, if any, is kept as it is.
 */
export function deband(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  { threshold, range }: DebandPass,
  seed = 1,
): Buffer {
  const out = Buffer.from(pixels)
  const colours = Math.min(3, channels)
  const next = random(seed)
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x)
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = next() * range
      const angle = next() * 2 * Math.PI
      const dx = Math.round(Math.cos(angle) * distance)
      const dy = Math.round(Math.sin(angle) * distance)
      const a = (clampY(y + dy) * width + clampX(x + dx)) * channels
      const b = (clampY(y - dy) * width + clampX(x - dx)) * channels
      const c = (clampY(y + dy) * width + clampX(x - dx)) * channels
      const d = (clampY(y - dy) * width + clampX(x + dx)) * channels
      const at = (y * width + x) * channels
      for (let k = 0; k < colours; k++) {
        const average =
          ((pixels[a + k] as number) +
            (pixels[b + k] as number) +
            (pixels[c + k] as number) +
            (pixels[d + k] as number)) /
          4
        if (Math.abs((pixels[at + k] as number) - average) < threshold) {
          out[at + k] = Math.round(average)
        }
      }
    }
  }
  return out
}
