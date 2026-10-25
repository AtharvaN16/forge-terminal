import { describe, expect, it } from 'vitest'
import {
  COVERAGE_MIN,
  judge,
  MaskScaler,
  modelInput,
  PEAK_MIN,
  SIZE,
  sigmoid,
} from '../../extensions/remove-background-onnx/mask.js'

const N = SIZE * SIZE

function rgba(w: number, h: number, px: (x: number, y: number) => number[]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(px(x, y), (y * w + x) * 4)
  return out
}

describe('modelInput', () => {
  it('is 3 × 768 × 768, scaled by the brightest sample, then ImageNet-normalised', () => {
    // Mid grey everywhere: scaled by its own brightness, every sample is 1.
    const t = modelInput(
      rgba(50, 30, () => [128, 128, 128, 255]),
      50,
      30,
    )
    expect(t.length).toBe(3 * N)
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    for (let c = 0; c < 3; c++) {
      const want = (1 - (mean[c] ?? 0)) / (std[c] ?? 1)
      expect(t[c * N]).toBeCloseTo(want, 4)
      expect(t[c * N + N - 1]).toBeCloseTo(want, 4)
    }
  })

  it('keeps the planes apart and the picture the right way up', () => {
    // Top half red, bottom half blue, on a 4000 × 3200 photo (box-shrunk first).
    const t = modelInput(
      rgba(4000, 3200, (_x, y) => (y < 1600 ? [255, 0, 0, 255] : [0, 0, 255, 255])),
      4000,
      3200,
    )
    const at = (c: number, x: number, y: number) => t[c * N + y * SIZE + x] ?? Number.NaN
    expect(at(0, 384, 40)).toBeGreaterThan(at(0, 384, 700))
    expect(at(2, 384, 700)).toBeGreaterThan(at(2, 384, 40))
  })
})

describe('judge', () => {
  it('asks for a confident pixel (one half) and one percent of the frame', () => {
    expect(PEAK_MIN).toBe(0.5)
    expect(COVERAGE_MIN).toBe(0.01)
  })

  it('finds a subject that is confident and covers enough of the frame', () => {
    const raw = new Float32Array(N)
    raw.fill(0.95, 0, Math.ceil(N * 0.2))
    expect(judge(raw)).toMatchObject({ found: true, peak: expect.closeTo(0.95, 5) })
  })

  it('finds none in a map that never reaches one half (a flat frame)', () => {
    const raw = new Float32Array(N).fill(0.002)
    expect(judge(raw).found).toBe(false)
    raw.fill(PEAK_MIN - 0.01)
    expect(judge(raw).found).toBe(false)
  })

  it('finds none when only a speck is confident', () => {
    const raw = new Float32Array(N)
    raw.fill(0.99, 0, Math.floor(N * COVERAGE_MIN) - 1)
    const v = judge(raw)
    expect(v.peak).toBeCloseTo(0.99, 5)
    expect(v.found).toBe(false)
    raw.fill(0.99, 0, Math.ceil(N * COVERAGE_MIN))
    expect(judge(raw).found).toBe(true)
  })
})

describe('sigmoid', () => {
  it('turns raw scores into 0–1: 0 is one half, large scores are near 1 or 0', () => {
    const out = sigmoid(Float32Array.from([0, 20, -20, Math.log(3)]))
    expect(out[0]).toBeCloseTo(0.5, 6)
    expect(out[1]).toBeGreaterThan(0.999999)
    expect(out[2]).toBeLessThan(0.000001)
    expect(out[3]).toBeCloseTo(0.75, 6)
  })
})

describe('MaskScaler', () => {
  it('brings the 768 px mask to any size, bilinear between pixel centres', () => {
    // Left half 0, right half 1.
    const mask = new Float32Array(N)
    for (let y = 0; y < SIZE; y++) mask.fill(1, y * SIZE + SIZE / 2, (y + 1) * SIZE)
    const s = new MaskScaler(mask, 1000, 7)
    const row = s.row(3, new Float32Array(1000))
    expect(row[0]).toBe(0)
    expect(row[999]).toBe(1)
    // Monotonic across the edge, and soft there.
    for (let x = 1; x < 1000; x++) expect(row[x] ?? 0).toBeGreaterThanOrEqual(row[x - 1] ?? 0)
    expect(row.some((v) => v > 0 && v < 1)).toBe(true)
  })

  it('keeps a 768 px image pixel for pixel', () => {
    const mask = Float32Array.from({ length: N }, (_, i) => (i % 7) / 7)
    const s = new MaskScaler(mask, SIZE, SIZE)
    const row = s.row(5, new Float32Array(SIZE))
    for (let x = 0; x < SIZE; x++) expect(row[x]).toBeCloseTo(mask[5 * SIZE + x] ?? 0, 6)
  })
})
