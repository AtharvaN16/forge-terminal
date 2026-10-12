import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKER, findCloseup } from '../../src/core/closeup.js'
import { loadSharp } from '../../src/engines/libs.js'

/** A PNG of `w` × `h`, each pixel from `at` (RGBA). */
async function png(
  dir: string,
  name: string,
  w: number,
  h: number,
  at: (x: number, y: number) => [number, number, number, number],
): Promise<string> {
  const sharp = await loadSharp()
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4)
  const path = join(dir, name)
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(path)
  return path
}

const grey = (x: number, y: number): [number, number, number, number] => {
  const v = 120 + ((x * 7 + y * 3) % 5)
  return [v, v, v, 255]
}
const inside = (x: number, y: number, x0: number, y0: number, s: number) =>
  x >= x0 && x < x0 + s && y >= y0 && y < y0 + s

describe('findCloseup', () => {
  it('cuts a sharpen where it changed, one pixel a half-block', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 64, 48, grey)
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 44, 6, 10) ? [10, 10, 10, 255] : grey(x, y),
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('patch')
    expect(c.box).toMatchObject({ w: 16, h: 16 })
    expect(c.box.x).toBeLessThanOrEqual(44)
    expect(c.box.x + c.box.w).toBeGreaterThanOrEqual(54)
    expect(c.box.y).toBeLessThanOrEqual(6)
    expect(c.box.y + c.box.h).toBeGreaterThanOrEqual(16)
    expect([c.before.width, c.before.height, c.after.width, c.after.height]).toEqual([
      16, 16, 16, 16,
    ])
    expect(c.output).toEqual({ width: 64, height: 48 })
  })

  it('draws a 2× boost as the original in 2 × 2 blocks beside the new pixels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 32, 24, () => [128, 128, 128, 255])
    // The boost changed one patch: before pixels (4..10, 14..20).
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 8, 28, 12) ? [250, 250, 250, 255] : [128, 128, 128, 255],
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 2 })
    expect(c.blocksPerPixel).toBe(2)
    expect(c.box).toMatchObject({ w: 8, h: 8 })
    expect(c.box.x).toBeLessThanOrEqual(4)
    expect(c.box.x + c.box.w).toBeGreaterThanOrEqual(10)
    expect(c.box.y).toBeLessThanOrEqual(14)
    expect(c.box.y + c.box.h).toBeGreaterThanOrEqual(20)
    expect([c.before.width, c.before.height, c.after.width, c.after.height]).toEqual([
      16, 16, 16, 16,
    ])
    expect(c.output).toEqual({ width: 64, height: 48 })
  })

  it('shows a cutout whole, on the checkerboard', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const disc = (x: number, y: number) => (x - 20) ** 2 + (y - 20) ** 2 < 64
    const before = await png(dir, 'a.png', 40, 40, (x, y) =>
      disc(x, y) ? [220, 30, 30, 255] : [30, 120, 30, 255],
    )
    const after = await png(dir, 'b.png', 40, 40, (x, y) =>
      disc(x, y) ? [220, 30, 30, 255] : [0, 0, 0, 0],
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('subject')
    expect([c.after.width, c.after.height]).toEqual([16, 16])
    const alphas = c.after.rgba.filter((_, i) => i % 4 === 3)
    expect(alphas.every((a) => a === 255)).toBe(true)
    // The corner is background: a checker square.
    expect(CHECKER).toContain(c.after.rgba[0])
  })
})
