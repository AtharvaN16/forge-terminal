/**
 * BiRefNet-lite's pre- and post-processing, as plain functions over typed
 * arrays, so the runner stays a thin shell and tests can check them without a
 * model.
 *
 * The model takes one 768 × 768 RGB image, squashed to that square whatever
 * its aspect (as it was trained and as rembg runs it), scaled by its
 * brightest sample and normalised with ImageNet's mean and deviation. Its
 * output is one 768 × 768 map of raw scores; a sigmoid turns them into 0–1.
 */

import { Resampler } from '../boost/lanczos.js'

export const SIZE = 768
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/**
 * A box shrink first keeps the Lanczos step's cost and memory bound by about
 * 1536 px a side, however large the photo: below that, Lanczos alone does the
 * whole reduction.
 */
const BOX_TARGET = SIZE * 2

/** Averages `kx` × `ky` blocks of the RGB channels (alpha ignored, as rembg does) into float planes. */
function boxShrink(
  rgba: Uint8Array,
  w: number,
  h: number,
  kx: number,
  ky: number,
): { planes: Float32Array[]; bw: number; bh: number } {
  const bw = Math.ceil(w / kx)
  const bh = Math.ceil(h / ky)
  const planes = [0, 1, 2].map(() => new Float32Array(bw * bh))
  const count = new Float32Array(bw * bh)
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / ky) * bw
    for (let x = 0; x < w; x++) {
      const o = row + Math.floor(x / kx)
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const p = planes[c] as Float32Array
        p[o] = (p[o] ?? 0) + (rgba[i + c] ?? 0)
      }
      count[o] = (count[o] ?? 0) + 1
    }
  }
  for (const p of planes) for (let o = 0; o < p.length; o++) p[o] = (p[o] ?? 0) / (count[o] || 1)
  return { planes, bw, bh }
}

/** The model's input tensor data, 1 × 3 × 768 × 768, from 8-bit RGBA. */
export function modelInput(rgba: Uint8Array, w: number, h: number): Float32Array {
  const kx = Math.max(1, Math.floor(w / BOX_TARGET))
  const ky = Math.max(1, Math.floor(h / BOX_TARGET))
  const { planes, bw, bh } = boxShrink(rgba, w, h, kx, ky)
  const resize = new Resampler(bw, bh, SIZE, SIZE)
  const n = SIZE * SIZE
  const out = new Float32Array(3 * n)
  let max = 0
  for (let c = 0; c < 3; c++) {
    const plane = resize.rows(planes[c] as Float32Array, 0, SIZE)
    for (let i = 0; i < n; i++) {
      // Lanczos rings a little past the ends; clamp like an 8-bit image would.
      const v = Math.min(255, Math.max(0, plane[i] ?? 0))
      out[c * n + i] = v
      if (v > max) max = v
    }
  }
  // Scaled by the brightest sample, not by 255: what rembg does with this
  // model, so it sees the input it was tested on.
  const scale = 1 / Math.max(max, 1e-6)
  for (let c = 0; c < 3; c++) {
    const m = MEAN[c] as number
    const s = STD[c] as number
    for (let i = c * n; i < (c + 1) * n; i++) out[i] = ((out[i] ?? 0) * scale - m) / s
  }
  return out
}

/** The raw scores through a sigmoid: 0–1 per pixel, as the model was trained to give them. */
export function sigmoid(raw: Float32Array): Float32Array {
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = 1 / (1 + Math.exp(-(raw[i] ?? 0)))
  return out
}

/**
 * When the model has found nothing, measured on the mask after the sigmoid
 * (and never stretched, which would blow faint noise up to a full mask):
 *
 *   - `peak`: the most confident pixel. The score is almost always near 0 or
 *     near 1 (on 42 test photos, none sat between 0.01 and 0.98), so anything
 *     from 0.01 to 0.98 gives the same answers; one half is the middle.
 *   - `coverage`: the share of the frame at one half or more. A few confident
 *     pixels on a speck are not a subject either. The smallest real subject
 *     in those photos covered 3.5 %, a wall with a few leaf specks 0.2 %, so
 *     anything from 0.3 % to 3.4 % works; one percent is the rule.
 *
 * Found means peak ≥ 0.5 and coverage ≥ 1 % of the frame.
 */
export const PEAK_MIN = 0.5
export const COVERAGE_MIN = 0.01

export interface Verdict {
  found: boolean
  peak: number
  coverage: number
}

export function judge(mask: Float32Array): Verdict {
  let peak = 0
  let over = 0
  for (const v of mask) {
    if (v > peak) peak = v
    if (v >= 0.5) over++
  }
  const coverage = mask.length ? over / mask.length : 0
  return { found: peak >= PEAK_MIN && coverage >= COVERAGE_MIN, peak, coverage }
}

/**
 * The 768 × 768 mask brought to the image's own size, bilinear (pixel
 * centres aligned), one row at a time so no full-size float mask is held.
 */
export class MaskScaler {
  private readonly x0: Int32Array
  private readonly x1: Int32Array
  private readonly fx: Float32Array

  constructor(
    private readonly mask: Float32Array,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.x0 = new Int32Array(width)
    this.x1 = new Int32Array(width)
    this.fx = new Float32Array(width)
    for (let x = 0; x < width; x++) {
      const [a, b, f] = MaskScaler.axis(x, width)
      this.x0[x] = a
      this.x1[x] = b
      this.fx[x] = f
    }
  }

  private static axis(o: number, dst: number): [number, number, number] {
    const s = Math.min(SIZE - 1, Math.max(0, ((o + 0.5) * SIZE) / dst - 0.5))
    const a = Math.floor(s)
    return [a, Math.min(SIZE - 1, a + 1), s - a]
  }

  /** Mask values 0–1 for row `y`, written into `out` (length = width). */
  row(y: number, out: Float32Array): Float32Array {
    const [ya, yb, fy] = MaskScaler.axis(y, this.height)
    const ra = ya * SIZE
    const rb = yb * SIZE
    const m = this.mask
    for (let x = 0; x < this.width; x++) {
      const a = this.x0[x] ?? 0
      const b = this.x1[x] ?? 0
      const f = this.fx[x] ?? 0
      const top = (m[ra + a] ?? 0) * (1 - f) + (m[ra + b] ?? 0) * f
      const bottom = (m[rb + a] ?? 0) * (1 - f) + (m[rb + b] ?? 0) * f
      out[x] = top * (1 - fy) + bottom * fy
    }
    return out
  }
}
