// tests/helpers/fixtures.test.ts
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  makeAnimatedGif,
  makeAvif,
  makeHeic,
  makeNoisyOrientedJpeg,
  makeOrientedJpeg,
  makeTempDir,
  makeTransparentPng,
  pixelAt,
} from './fixtures.js'

describe('fixtures', () => {
  it('builds a genuinely animated gif', async () => {
    const dir = await makeTempDir()
    const gif = await makeAnimatedGif(dir, 'anim.gif', 3)
    expect((await sharp(gif).metadata()).pages).toBe(3)
  })

  it('builds a jpeg carrying exif orientation', async () => {
    const dir = await makeTempDir()
    const jpg = await makeOrientedJpeg(dir, 'rot.jpg', 6)
    expect((await sharp(jpg).metadata()).orientation).toBe(6)
  })

  it('builds a photo-like jpeg that also carries exif orientation, unlike the flat one', async () => {
    const dir = await makeTempDir()
    const jpg = await makeNoisyOrientedJpeg(dir, 'noisy.jpg', 6)
    const meta = await sharp(jpg).metadata()
    expect(meta.orientation).toBe(6)
    // Real entropy, not a flat fill: a PNG re-encode must come out larger
    // than a JPEG one, the way an actual photo does. `makeOrientedJpeg`'s
    // solid colour gets this backwards at fixture scale.
    const raw = await sharp(jpg).toBuffer()
    const png = await sharp(raw).png().toBuffer()
    const jpeg = await sharp(raw).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    expect(png.byteLength).toBeGreaterThan(jpeg.byteLength)
  })

  it('builds a png with a real alpha channel', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 't.png')
    expect((await sharp(png).metadata()).hasAlpha).toBe(true)
  })

  it('builds an avif that sharp reports as heif/av1', async () => {
    const dir = await makeTempDir()
    const avif = await makeAvif(dir, 'x.avif')
    const meta = await sharp(avif).metadata()
    expect(meta.format).toBe('heif')
    expect(meta.compression).toBe('av1')
  })

  it('builds a heic that sharp reports as heif/hevc, or skips off macOS', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeHeic(dir, 'x.heic')
    if (!heic) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated on this platform')
      return
    }
    const meta = await sharp(heic).metadata()
    expect(meta.format).toBe('heif')
    expect(meta.compression).toBe('hevc')
  })

  it('pixelAt correctly reads pixel values using offset arithmetic', async () => {
    const dir = await makeTempDir()
    const raw = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
    const p = join(dir, 'grid.png')
    await sharp(raw, { raw: { width: 2, height: 2, channels: 3 } })
      .png()
      .toFile(p)
    expect(await pixelAt(p, 0, 0)).toEqual([10, 20, 30])
    expect(await pixelAt(p, 1, 0)).toEqual([40, 50, 60])
    expect(await pixelAt(p, 0, 1)).toEqual([70, 80, 90])
    expect(await pixelAt(p, 1, 1)).toEqual([100, 110, 120])
  })
})
