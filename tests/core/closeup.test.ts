import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { CELL_ASPECT, CHECKER, closeupPictures, findCloseup } from '../../src/core/closeup.js'
import { looksLikeHeic } from '../../src/engines/heic.js'
import { imageEngine } from '../../src/engines/image.js'
import { loadSharp } from '../../src/engines/libs.js'
import { probe } from '../../src/engines/registry.js'
import { makeOrientedJpeg } from '../helpers/fixtures.js'
import { makeDng } from '../helpers/raw.js'

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
  it('cuts a sharpen where it changed, each pixel square: a dot tall, one wide', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    const before = await png(dir, 'a.png', 64, 48, grey)
    const after = await png(dir, 'b.png', 64, 48, (x, y) =>
      inside(x, y, 44, 6, 10) ? [10, 10, 10, 255] : grey(x, y),
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('patch')
    // 16 × 8 cells are 16 × 16 dots, a pixel each.
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

  it('draws a 2× boost as the original in blocks beside the new pixels', async () => {
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

  it('shows a picture whole in its own shape, each pixel square', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    // 2 : 1. Square pixels are a dot each, so 2 : 1 on screen is 2 : 1 in
    // dots: 16 × 8 of the 16 × 16 the box has.
    const before = await png(dir, 'a.png', 64, 32, grey)
    const after = await png(dir, 'b.png', 64, 32, grey)
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1, whole: true })
    expect(c.kind).toBe('whole')
    expect([c.before.width, c.before.height]).toEqual([16, 8])
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
    // Squares are whole cells, two across: 2 × 2 dots, so a cell is one colour.
    const red = (x: number, y: number) => c.after.rgba[(y * c.after.width + x) * 4]
    expect([red(1, 0), red(0, 1), red(1, 1)]).toEqual([red(0, 0), red(0, 0), red(0, 0)])
    expect(red(2, 0)).not.toBe(red(0, 0))
    expect(red(0, 2)).not.toBe(red(0, 0))
  })

  it('knows a cutout of a picture that had transparent corners already (an app icon)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
    // A rounded square: clear at its four corners before anything was removed.
    const corner = (x: number, y: number) => Math.min(x, 39 - x) + Math.min(y, 39 - y) < 6
    const disc = (x: number, y: number) => (x - 20) ** 2 + (y - 20) ** 2 < 64
    const before = await png(dir, 'a.png', 40, 40, (x, y) =>
      corner(x, y) ? [0, 0, 0, 0] : disc(x, y) ? [220, 30, 30, 255] : [30, 30, 160, 255],
    )
    const after = await png(dir, 'b.png', 40, 40, (x, y) =>
      disc(x, y) ? [220, 30, 30, 255] : [0, 0, 0, 0],
    )
    const c = await findCloseup(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(c.kind).toBe('subject')
    const real = await closeupPictures(before, after, { cols: 16, rows: 8, scale: 1 })
    expect(real.kind).toBe('subject')
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

/**
 * A portrait photo's close-up: the before is the camera file, stored on its
 * side with an orientation; the after is what an edit writes, upright, with a
 * dark square at (x, y) in upright pixels. The patch must find the square.
 */
describe.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sips'))(
  'findCloseup on a portrait photo',
  () => {
    async function upright(source: string, dir: string, x: number, y: number) {
      const sharp = await loadSharp()
      const png = join(dir, 'upright.png')
      await imageEngine.run(
        {
          op: 'convert',
          sources: [await probe(source)],
          outputs: [png],
          target: 'png',
          options: { background: '#ffffff', keepMetadata: false },
        },
        () => {},
      )
      const square = await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#000000' },
      })
        .png()
        .toBuffer()
      const after = join(dir, 'after.png')
      await sharp(png)
        .composite([{ input: square, left: x, top: y }])
        .toFile(after)
      return after
    }

    function expectAround(
      box: { x: number; y: number; w: number; h: number },
      x: number,
      y: number,
    ) {
      expect(box.x).toBeLessThanOrEqual(x)
      expect(box.x + box.w).toBeGreaterThanOrEqual(x + 10)
      expect(box.y).toBeLessThanOrEqual(y)
      expect(box.y + box.h).toBeGreaterThanOrEqual(y + 10)
    }

    it('a HEIC', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
      const jpeg = await makeOrientedJpeg(dir, 'p.jpg', 6)
      const heic = join(dir, 'p.heic')
      await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'heic', jpeg, '--out', heic])
      const after = await upright(heic, dir, 60, 20)
      const c = await findCloseup(heic, after, { cols: 16, rows: 8, scale: 1 })
      expect(c.output).toEqual({ width: 80, height: 40 })
      expectAround(c.box, 60, 20)
    })

    it('a RAW photo', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'forge-closeup-'))
      const dng = await makeDng(dir, 'p.dng', { orientation: 6 })
      const after = await upright(dng, dir, 200, 40)
      const c = await findCloseup(dng, after, { cols: 16, rows: 8, scale: 1 })
      expect(c.output).toEqual({ width: 240, height: 320 })
      expectAround(c.box, 200, 40)
    }, 30_000)
  },
)
