/**
 * Floyd–Steinberg error diffusion onto a fixed palette. Pure pixels in, pixels
 * out: the engine reads the picture and writes the file.
 *
 * Sharp's own palette dither (libimagequant) only scatters dots where the error
 * is small, so on a smooth gradient it mostly draws bands. This one spreads
 * every pixel's error onto its neighbours, so a gradient becomes dots of the
 * palette's colours whose density follows it, and a colour already in the
 * palette stays flat.
 */

export type Rgb = readonly [number, number, number]

/** The distinct colours of an RGB buffer, at most `limit` of them (more: `undefined`). */
export function distinctColours(rgb: Uint8Array, limit: number): Rgb[] | undefined {
  const seen = new Map<number, Rgb>()
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i] as number
    const g = rgb[i + 1] as number
    const b = rgb[i + 2] as number
    const key = (r << 16) | (g << 8) | b
    if (!seen.has(key)) {
      if (seen.size >= limit) return undefined
      seen.set(key, [r, g, b])
    }
  }
  return [...seen.values()]
}

/** `rgb` (3 bytes a pixel, `width` × `height`) with every pixel one of `palette`, dots and all. */
export function floydSteinberg(
  rgb: Uint8Array,
  width: number,
  height: number,
  palette: readonly Rgb[],
): Buffer {
  const out = Buffer.alloc(rgb.length)
  const pal = Int16Array.from(palette.flatMap((c) => [...c]))
  const n = palette.length
  // The error still to place, two rows: this one and the next, a pixel's three channels each.
  const stride = (width + 2) * 3
  let here = new Float32Array(stride)
  let next = new Float32Array(stride)

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0
    for (let step = 0; step < width; step++) {
      const x = leftToRight ? step : width - 1 - step
      const at = (y * width + x) * 3
      const e = (x + 1) * 3
      const r = Math.min(255, Math.max(0, (rgb[at] as number) + (here[e] as number)))
      const g = Math.min(255, Math.max(0, (rgb[at + 1] as number) + (here[e + 1] as number)))
      const b = Math.min(255, Math.max(0, (rgb[at + 2] as number) + (here[e + 2] as number)))

      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let k = 0; k < n; k++) {
        const dr = r - (pal[k * 3] as number)
        const dg = g - (pal[k * 3 + 1] as number)
        const db = b - (pal[k * 3 + 2] as number)
        const d = dr * dr + dg * dg + db * db
        if (d < bestDistance) {
          bestDistance = d
          best = k
        }
      }
      const pr = pal[best * 3] as number
      const pg = pal[best * 3 + 1] as number
      const pb = pal[best * 3 + 2] as number
      out[at] = pr
      out[at + 1] = pg
      out[at + 2] = pb

      const er = r - pr
      const eg = g - pg
      const eb = b - pb
      // 7/16 ahead, then 3/16 behind, 5/16 below and 1/16 below-ahead (mirrored on a right-to-left row).
      const ahead = leftToRight ? e + 3 : e - 3
      const behind = leftToRight ? e - 3 : e + 3
      here[ahead] = (here[ahead] as number) + (er * 7) / 16
      here[ahead + 1] = (here[ahead + 1] as number) + (eg * 7) / 16
      here[ahead + 2] = (here[ahead + 2] as number) + (eb * 7) / 16
      next[behind] = (next[behind] as number) + (er * 3) / 16
      next[behind + 1] = (next[behind + 1] as number) + (eg * 3) / 16
      next[behind + 2] = (next[behind + 2] as number) + (eb * 3) / 16
      next[e] = (next[e] as number) + (er * 5) / 16
      next[e + 1] = (next[e + 1] as number) + (eg * 5) / 16
      next[e + 2] = (next[e + 2] as number) + (eb * 5) / 16
      next[ahead] = (next[ahead] as number) + er / 16
      next[ahead + 1] = (next[ahead + 1] as number) + eg / 16
      next[ahead + 2] = (next[ahead + 2] as number) + eb / 16
    }
    const swap = here
    here = next
    next = swap
    next.fill(0)
  }
  return out
}
