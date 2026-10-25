import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { debandAction } from '../../src/core/actions/resize.js'
import { DEBAND_LEVELS, debandLevel } from '../../src/core/deband.js'
import type { ImageInfo } from '../../src/core/types.js'
import { deband } from '../../src/engines/deband.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeTempDir } from '../helpers/fixtures.js'

const W = 512
const H = 48

/** A ramp from 40 to 160, cut into stripes `step` levels tall: banding of a known size. */
function banded(step: number, channels = 3): Buffer {
  const px = Buffer.alloc(W * H * channels, 255)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.round((40 + (x / (W - 1)) * 120) / step) * step
      px.fill(v, (y * W + x) * channels, (y * W + x) * channels + 3)
    }
  return px
}

/** How far a row strays from the true ramp, on average, away from the picture's edges. */
function error(px: Uint8Array, channels = 3): number {
  let e = 0
  let n = 0
  for (let y = 8; y < H - 8; y++)
    for (let x = 64; x < W - 64; x++) {
      e += Math.abs((px[(y * W + x) * channels] as number) - (40 + (x / (W - 1)) * 120))
      n++
    }
  return e / n
}

const run = (px: Buffer, level: 'light' | 'medium' | 'strong', channels = 3) =>
  debandLevel(level).passes.reduce((out, pass, i) => deband(out, W, H, channels, pass, i + 1), px)

describe('deband (the pixels)', () => {
  it('smooths stripes back towards the ramp, each level further than the one before', () => {
    const src = banded(10)
    const light = error(run(src, 'light'))
    const medium = error(run(src, 'medium'))
    const strong = error(run(src, 'strong'))
    expect(light).toBeLessThan(error(src))
    expect(medium).toBeLessThan(light)
    expect(strong).toBeLessThanOrEqual(medium)
  })

  it('leaves a flat colour flat and a hard edge hard', () => {
    const px = Buffer.alloc(W * H * 3)
    for (let i = 0; i < W * H; i++) px.fill(i % W < W / 2 ? 20 : 230, i * 3, i * 3 + 3)
    const out = run(px, 'strong')
    expect(out[(10 * W + 5) * 3]).toBe(20)
    expect(out[(10 * W + W / 2 - 1) * 3]).toBe(20)
    expect(out[(10 * W + W / 2) * 3]).toBe(230)
  })

  it('keeps an alpha channel as it was', () => {
    const px = banded(10, 4)
    for (let i = 0; i < W * H; i++) px[i * 4 + 3] = i % 3 === 0 ? 0 : 200
    const out = run(px, 'medium', 4)
    for (let i = 0; i < W * H; i++) expect(out[i * 4 + 3]).toBe(i % 3 === 0 ? 0 : 200)
    expect(error(out, 4)).toBeLessThan(error(px, 4))
  })

  it('comes out the same every time', () => {
    const src = banded(10)
    expect(run(src, 'strong').equals(run(src, 'strong'))).toBe(true)
  })

  it('offers Light, Medium and Strong', () => {
    expect(DEBAND_LEVELS.map((l) => l.label)).toEqual(['Light', 'Medium', 'Strong'])
  })
})

describe('Remove banding (the file)', () => {
  let dir: string
  let jpeg: ImageInfo
  beforeAll(async () => {
    dir = await makeTempDir()
    await sharp(banded(12), { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(join(dir, 'sky.jpg'))
    jpeg = (await probe(join(dir, 'sky.jpg'))) as ImageInfo
  })

  it('keeps a JPEG a JPEG, at a quality that keeps the stripes away, named by its level', async () => {
    const [job] = debandAction.plan([jpeg], { deband: 'strong', output: dir })
    if (!job || job.op !== 'convert') throw new Error('no job')
    expect(job.target).toBe('jpeg')
    expect(job.options.quality).toBe(95)
    expect(job.outputs[0]).toMatch(/sky-debanded-strong\.jpg$/)
    await imageEngine.run(job, () => {})
    const { data } = await sharp(job.outputs[0]).raw().toBuffer({ resolveWithObject: true })
    const before = await sharp(join(dir, 'sky.jpg')).raw().toBuffer()
    expect(error(data)).toBeLessThan(error(before))
  })

  it('plans nothing for an animation, or without a level', () => {
    expect(debandAction.plan([{ ...jpeg, frames: 4 }], { deband: 'light' })).toEqual([])
    expect(debandAction.plan([jpeg], {})).toEqual([])
    expect(debandAction.plan([jpeg], { deband: 'huge' })).toEqual([])
  })
})
