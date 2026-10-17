import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import type { ConvertOptions, FormatId, ImageInfo, Job } from '../../src/core/types.js'
import { encodeToBuffer, imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { countColours, makeGradientPng, makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const base = { background: '#ffffff', keepMetadata: false }
const compress = (quality: number, dither = false): ConvertOptions => ({
  ...base,
  quality,
  compress: { dither },
})

let dir: string

beforeAll(async () => {
  dir = await makeTempDir()
})

/** A smooth animation: each frame the gradient shifted a little, so most pixels barely change. */
async function makeDriftingGif(name: string, frames = 6): Promise<string> {
  const path = join(dir, name)
  const w = 96
  const h = 64
  const strip = Buffer.alloc(w * h * frames * 3)
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((f * h + y) * w + x) * 3
        strip[i] = (x * 2 + f) % 256
        strip[i + 1] = (y * 3 + f) % 256
        strip[i + 2] = (x + y + f * 2) % 256
      }
    }
  }
  await sharp(strip, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } })
    .gif({ dither: 0, delay: Array.from({ length: frames }, () => 100) })
    .toFile(path)
  return path
}

/** Something like a photo: noise blurred into soft patches, far more than 256 colours. */
async function makeSoftPng(name: string): Promise<string> {
  const path = join(dir, name)
  const noise = { type: 'gaussian' as const, mean: 128, sigma: 80 }
  await sharp({ create: { width: 160, height: 120, channels: 3, background: '#808080', noise } })
    .blur(4)
    .png()
    .toFile(path)
  return path
}

const jobFor = (
  source: ImageInfo,
  target: FormatId,
  options: ConvertOptions,
  output: string,
): Job => ({
  op: 'convert',
  sources: [source],
  outputs: [output],
  target,
  options,
})

describe('/compress on a PNG', () => {
  it('cuts it to a palette, which a lossless encode never does', async () => {
    const source = (await probe(await makeSoftPng('soft.png'))) as ImageInfo
    const lossless = await encodeToBuffer(source, 'png', base)
    const squeezed = await encodeToBuffer(source, 'png', compress(65))

    expect(squeezed.length).toBeLessThan(lossless.length / 2)
    const meta = await sharp(squeezed).metadata()
    expect(meta.format).toBe('png')
    expect(meta.isPalette).toBe(true)
  })

  it('keeps PNG lossless for a conversion: only /compress may cut colours', async () => {
    const source = (await probe(await makeGradientPng(dir, 'grad-convert.png', 128))) as ImageInfo
    const out = join(dir, 'grad-convert-out.png')
    await imageEngine.run(jobFor(source, 'png', { ...base, quality: 30 }, out), () => {})
    expect(await countColours(out)).toBe(await countColours(source.path))
  })

  it('a lower point gives fewer bytes', async () => {
    const source = (await probe(await makeSoftPng('soft-points.png'))) as ImageInfo
    const at100 = (await encodeToBuffer(source, 'png', compress(100))).length
    const at30 = (await encodeToBuffer(source, 'png', compress(30))).length
    expect(at30).toBeLessThan(at100)
  })

  it('dithers only when asked: flat colours are the default', async () => {
    const source = (await probe(await makeSoftPng('soft-dither.png'))) as ImageInfo
    const flat = (await encodeToBuffer(source, 'png', compress(30))).length
    const dithered = (await encodeToBuffer(source, 'png', compress(30, true))).length
    // Dithering scatters dots, which compress worse.
    expect(dithered).toBeGreaterThan(flat)
  })
})

describe('/compress on a GIF', () => {
  it('lets each frame differ a little from the last, and gets smaller for it', async () => {
    const source = (await probe(await makeDriftingGif('drift.gif'))) as ImageInfo
    expect(source.frames).toBeGreaterThan(1)
    const at100 = (await encodeToBuffer(source, 'gif', compress(100))).length
    const at30 = (await encodeToBuffer(source, 'gif', compress(30))).length
    expect(at30).toBeLessThan(at100)
  })

  it("keeps the animation's timing", async () => {
    // A frame that comes out the same as the one before is merged into it,
    // its time added on, so the animation plays exactly as long.
    const source = (await probe(await makeDriftingGif('drift-frames.gif'))) as ImageInfo
    const out = await encodeToBuffer(source, 'gif', compress(30))
    const sum = (d: number[] | undefined) => (d ?? []).reduce((a, b) => a + b, 0)
    expect(sum((await sharp(out).metadata()).delay)).toBe(600)
    expect((await sharp(out).metadata()).pages).toBeGreaterThan(1)
  })
})

describe('never a bigger file', () => {
  it('writes nothing when the result would not be smaller', async () => {
    const source = (await probe(await makeJpeg(dir, 'tiny.jpg'))) as ImageInfo
    const out = join(dir, 'tiny-small.jpg')
    // A 40×20 flat JPEG at 100 comes out bigger than it went in.
    const run = imageEngine.run(jobFor(source, 'jpeg', compress(100), out), () => {})
    const error = await run.catch((e: unknown) => e)
    expect(isForgeError(error) && error.code).toBe('cannot-compress-more')
    expect(isForgeError(error) && error.title).toBe('Cannot compress more')
    expect(existsSync(out)).toBe(false)
  })

  it('still lets a conversion grow: a format change can be the right answer', async () => {
    const source = (await probe(await makeJpeg(dir, 'grow.jpg'))) as ImageInfo
    const out = join(dir, 'grow-out.jpg')
    const result = await imageEngine.run(
      jobFor(source, 'jpeg', { ...base, quality: 100 }, out),
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(source.bytes)
  })
})

describe('the size search on a PNG or GIF', () => {
  it('measures a PNG when compressing', async () => {
    const source = (await probe(await makeSoftPng('soft-search.png'))) as ImageInfo
    const m = await imageEngine.measurer?.(
      jobFor(source, 'png', { ...base, compress: { dither: false } }, '/unused.png'),
    )
    expect(m).toBeDefined()
    const high = await m?.measure({ ...base, compress: { dither: false }, quality: 100 })
    const low = await m?.measure({ ...base, compress: { dither: false }, quality: 30 })
    expect(low).toBeLessThan(high ?? 0)
  })

  it('still declines a PNG conversion, which has no quality to search', async () => {
    const source = (await probe(await makeGradientPng(dir, 'grad-nosearch.png', 64))) as ImageInfo
    expect(await imageEngine.measurer?.(jobFor(source, 'png', base, '/unused.png'))).toBeUndefined()
  })
})
