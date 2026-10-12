import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CELL_ASPECT, CHECKER, closeupPictures, findCloseup } from '../../src/core/closeup.js'
import { looksLikeHeic } from '../../src/engines/heic.js'
import { loadSharp } from '../../src/engines/libs.js'

// Passed through, counted: each file opened for a search is asked about once.
vi.mock('../../src/engines/heic.js', async (orig) => {
  const real = await orig<typeof import('../../src/engines/heic.js')>()
  return { ...real, looksLikeHeic: vi.fn(real.looksLikeHeic) }
})

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
  it('cuts a sharpen where it changed, each pixel square: a dot tall, 4/3 of one wide', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 64, 48, grey)
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 44, 6, 10) ? [10, 10, 10, 255] : grey(x, y),
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('patch')
    // 16 × 8 cells are 32 × 24 dots: 24 pixels across (32 · 3/4), 24 down.
    expect(c.box).toMatchObject({ w: 24, h: 24 })
    expect(c.box.x).toBeLessThanOrEqual(44)
    expect(c.box.x + c.box.w).toBeGreaterThanOrEqual(54)
    expect(c.box.y).toBeLessThanOrEqual(6)
    expect(c.box.y + c.box.h).toBeGreaterThanOrEqual(16)
    expect([c.before.width, c.before.height, c.after.width, c.after.height]).toEqual([
      32, 24, 32, 24,
    ])
    expect(c.output).toEqual({ width: 64, height: 48 })
  })

  it('draws a 2× boost as the original in blocks beside the new pixels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 32, 24, () => [128, 128, 128, 255])
    // The boost changed one patch: before pixels (4..10, 14..20).
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 8, 28, 12) ? [250, 250, 250, 255] : [128, 128, 128, 255],
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 2 })
    expect(c.blocksPerPixel).toBe(2)
    expect(c.box).toMatchObject({ w: 12, h: 12 })
    expect(c.box.x).toBeLessThanOrEqual(4)
    expect(c.box.x + c.box.w).toBeGreaterThanOrEqual(10)
    expect(c.box.y).toBeLessThanOrEqual(14)
    expect(c.box.y + c.box.h).toBeGreaterThanOrEqual(20)
    expect([c.before.width, c.before.height, c.after.width, c.after.height]).toEqual([
      32, 24, 32, 24,
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
    expect([c.after.width, c.after.height]).toEqual([32, 24])
    const alphas = c.after.rgba.filter((_, i) => i % 4 === 3)
    expect(alphas.every((a) => a === 255)).toBe(true)
    // The corner is background: a checker square.
    expect(CHECKER).toContain(c.after.rgba[0])
    // Squares are whole cells, two across: 4 × 3 dots, so a cell is one colour.
    const red = (x: number, y: number) => c.after.rgba[(y * c.after.width + x) * 4]
    expect([red(3, 0), red(0, 2), red(3, 2)]).toEqual([red(0, 0), red(0, 0), red(0, 0)])
    expect(red(4, 0)).not.toBe(red(0, 0))
    expect(red(0, 3)).not.toBe(red(0, 0))
  })

  it('frames a cutout wider than its subject, so what was removed shows', async () => {
    // A card: a rectangle the grid's shape, filling its own box. Framed to
    // that box alone, before and after would be the same opaque card.
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const card = (x: number, y: number) => inside(x, y, 20, 20, 40)
    const before = await png(dir, 'a.png', 80, 80, (x, y) =>
      card(x, y) ? [220, 30, 30, 255] : [30, 120, 30, 255],
    )
    const after = await png(dir, 'b.png', 80, 80, (x, y) =>
      card(x, y) ? [220, 30, 30, 255] : [0, 0, 0, 0],
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('subject')
    // The box holds the whole card and background on every side of it.
    expect(c.box.x).toBeLessThanOrEqual(16)
    expect(c.box.y).toBeLessThanOrEqual(16)
    expect(c.box.x + c.box.w).toBeGreaterThanOrEqual(64)
    expect(c.box.y + c.box.h).toBeGreaterThanOrEqual(64)
    // Before: the green the card stood on. After: the checkerboard.
    expect(Array.from(c.before.rgba.subarray(0, 3))).toEqual([30, 120, 30])
    expect(CHECKER).toContain(c.after.rgba[0])
  })

  it('opens and searches a pair once, however often a resize re-cuts it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 64, 48, grey)
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 20, 20, 8) ? [10, 10, 10, 255] : grey(x, y),
    )
    vi.mocked(looksLikeHeic).mockClear()
    for (const cols of [16, 20, 24]) await findCloseup(before, after, { cols, rows: 8, scale: 1 })
    expect(vi.mocked(looksLikeHeic)).toHaveBeenCalledTimes(2)
  })

  it('sends a 2:3 portrait cutout padded to the box’s shape, so Kitty does not stretch it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'p.png', 40, 60, grey)
    const after = await png(dir, 'p-cutout.png', 40, 60, (x, y) =>
      inside(x, y, 10, 15, 20) ? grey(x, y) : [0, 0, 0, 0],
    )
    const pics = await closeupPictures(before, after, { cols: 36, rows: 16, scale: 1 })
    const sharp = await loadSharp()
    const box = (36 * CELL_ASPECT) / 16
    for (const p of [pics.before, pics.after]) {
      const { width = 0, height = 0 } = await sharp(p).metadata()
      expect(Math.abs(width / height - box)).toBeLessThan(0.02)
    }
  })
})
