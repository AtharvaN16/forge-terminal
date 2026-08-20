import { describe, expect, it, vi } from 'vitest'
import { findQuality, maxAttempts } from '../../src/core/compress.js'

/**
 * A stand-in encoder: size rises with quality, the way a real one does. The
 * search only relies on that monotonicity, so it can be tested with
 * arithmetic rather than images — which is the point of `encode` being a
 * parameter rather than an import.
 */
const curve = (bytesAtQ1: number, bytesAtQ100: number) => async (q: number) =>
  Math.round(bytesAtQ1 + ((bytesAtQ100 - bytesAtQ1) * (q - 1)) / 99)

describe('findQuality', () => {
  it('returns the highest quality whose output fits', async () => {
    const encode = curve(100_000, 1_000_000)
    const { quality, bytes, missed } = await findQuality({
      encode,
      targetBytes: 500_000,
    })
    expect(missed).toBe(false)
    expect(bytes).toBeLessThanOrEqual(500_000)
    // One step higher must not fit, or it was not the highest that does.
    expect(await encode(quality + 1)).toBeGreaterThan(500_000)
  })

  it('reports a bounded, honest attempt count', async () => {
    const onAttempt = vi.fn()
    await findQuality({ encode: curve(100_000, 1_000_000), targetBytes: 500_000, onAttempt })

    const calls = onAttempt.mock.calls
    expect(calls.length).toBeLessThanOrEqual(maxAttempts())
    // Every call names a real position in a sequence whose length was known
    // before the search started — never a fabricated denominator.
    for (const [attempt, of] of calls) {
      expect(of).toBe(maxAttempts())
      expect(attempt).toBeGreaterThanOrEqual(1)
      expect(attempt).toBeLessThanOrEqual(of)
    }
    expect(calls.map(([a]) => a)).toEqual(calls.map((_, i) => i + 1))
  })

  it('bounds attempts at the probe plus the bisection steps', () => {
    // ceil(log2(100)) = 7 bisections, plus the one probe at max that always
    // runs first. The design doc said 7 and had forgotten the probe.
    expect(maxAttempts(1, 100)).toBe(8)
    expect(maxAttempts(1, 2)).toBe(2)
  })

  it('never reports an attempt beyond the bound it promised', async () => {
    const seen: number[] = []
    await findQuality({
      encode: curve(100_000, 1_000_000),
      targetBytes: 500_000,
      onAttempt: (n, of) => {
        expect(n).toBeLessThanOrEqual(of)
        seen.push(n)
      },
    })
    expect(seen.length).toBeGreaterThan(0)
  })

  it('flags a target nothing can reach, and reports the smallest achievable', async () => {
    const encode = curve(900_000, 1_000_000)
    const { missed, bytes, quality } = await findQuality({ encode, targetBytes: 100_000 })
    expect(missed).toBe(true)
    expect(quality).toBe(1)
    expect(bytes).toBe(await encode(1))
  })

  it('returns max without searching when the target is already generous', async () => {
    const encode = vi.fn(curve(100_000, 200_000))
    const { quality, missed } = await findQuality({ encode, targetBytes: 10_000_000 })
    expect(quality).toBe(100)
    expect(missed).toBe(false)
    // One probe at max is enough to know; there is nothing to search for.
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('honours a narrowed range', async () => {
    const { quality } = await findQuality({
      encode: curve(100_000, 1_000_000),
      targetBytes: 500_000,
      min: 40,
      max: 60,
    })
    expect(quality).toBeGreaterThanOrEqual(40)
    expect(quality).toBeLessThanOrEqual(60)
  })

  it('does far fewer encodes than trying every quality', async () => {
    const encode = vi.fn(curve(100_000, 1_000_000))
    await findQuality({ encode, targetBytes: 500_000 })
    // A linear scan would be up to 100. This is why the search is affordable.
    expect(encode.mock.calls.length).toBeLessThanOrEqual(maxAttempts())
  })
})
