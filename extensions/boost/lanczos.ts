/**
 * Separable Lanczos-3 resampling on float planes, edge-clamped.
 *
 * Used twice by the runner: to bring a 4× tile down to 2×, and to upscale the
 * alpha channel, which the model never sees.
 */

interface Taps {
  start: Int32Array
  count: Int32Array
  weights: Float32Array
  width: number
}

function sinc(x: number): number {
  if (x === 0) return 1
  const p = Math.PI * x
  return Math.sin(p) / p
}

function lanczos3(x: number): number {
  return x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0
}

/** Per-output-pixel contributions from the source axis. */
function taps(src: number, dst: number): Taps {
  const scale = src / dst
  const filterScale = Math.max(1, scale)
  const support = 3 * filterScale
  const width = Math.ceil(support) * 2 + 1
  const start = new Int32Array(dst)
  const count = new Int32Array(dst)
  const weights = new Float32Array(dst * width)
  for (let o = 0; o < dst; o++) {
    const centre = (o + 0.5) * scale - 0.5
    const lo = Math.ceil(centre - support)
    const hi = Math.floor(centre + support)
    const n = Math.min(width, hi - lo + 1)
    let sum = 0
    for (let k = 0; k < n; k++) {
      const w = lanczos3((lo + k - centre) / filterScale)
      weights[o * width + k] = w
      sum += w
    }
    for (let k = 0; k < n; k++) weights[o * width + k] = (weights[o * width + k] ?? 0) / sum
    start[o] = lo
    count[o] = n
  }
  return { start, count, weights, width }
}

const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v)

export class Resampler {
  readonly tx: Taps
  readonly ty: Taps

  constructor(
    readonly srcW: number,
    readonly srcH: number,
    readonly dstW: number,
    readonly dstH: number,
  ) {
    this.tx = taps(srcW, dstW)
    this.ty = taps(srcH, dstH)
  }

  /**
   * Output rows [y0, y1) of the resized plane. Only the source rows those
   * output rows reach are touched, so a band costs memory for the band only.
   */
  rows(src: Float32Array, y0: number, y1: number): Float32Array {
    const { srcW, srcH, dstW, tx, ty } = this
    // Tap starts only grow with y, so the band's first and last taps bound it.
    const lo = clamp(ty.start[y0] ?? 0, srcH - 1)
    const last = y1 - 1
    const s1 = clamp((ty.start[last] ?? 0) + (ty.count[last] ?? 0) - 1, srcH - 1)

    // Horizontal pass over the source rows needed.
    const span = s1 - lo + 1
    const mid = new Float32Array(span * dstW)
    for (let r = 0; r < span; r++) {
      const row = (lo + r) * srcW
      for (let x = 0; x < dstW; x++) {
        const st = tx.start[x] ?? 0
        const n = tx.count[x] ?? 0
        let acc = 0
        for (let k = 0; k < n; k++)
          acc += (src[row + clamp(st + k, srcW - 1)] ?? 0) * (tx.weights[x * tx.width + k] ?? 0)
        mid[r * dstW + x] = acc
      }
    }

    // Vertical pass.
    const out = new Float32Array((y1 - y0) * dstW)
    for (let y = y0; y < y1; y++) {
      const st = ty.start[y] ?? 0
      const n = ty.count[y] ?? 0
      const o = (y - y0) * dstW
      for (let k = 0; k < n; k++) {
        const w = ty.weights[y * ty.width + k] ?? 0
        const r = (clamp(st + k, srcH - 1) - lo) * dstW
        for (let x = 0; x < dstW; x++) out[o + x] = (out[o + x] ?? 0) + (mid[r + x] ?? 0) * w
      }
    }
    return out
  }
}
