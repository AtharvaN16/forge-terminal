import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { ditherAction } from '../../src/core/actions/resize.js'
import type { ImageInfo } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeTempDir } from '../helpers/fixtures.js'

let dir: string
let ramp: ImageInfo
let jpeg: ImageInfo
let gif: ImageInfo

/** 64 × 16 greys from black to white: a gradient has stripes without dots. */
async function makeRamp(path: string, format: 'png' | 'jpeg') {
  const w = 64
  const h = 16
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.fill(Math.round((x / (w - 1)) * 255), (y * w + x) * 3, (y * w + x) * 3 + 3)
  await sharp(data, { raw: { width: w, height: h, channels: 3 } })
    [format]()
    .toFile(path)
}

beforeAll(async () => {
  dir = await makeTempDir()
  await makeRamp(join(dir, 'ramp.png'), 'png')
  await makeRamp(join(dir, 'ramp.jpg'), 'jpeg')
  ramp = (await probe(join(dir, 'ramp.png'))) as ImageInfo
  jpeg = (await probe(join(dir, 'ramp.jpg'))) as ImageInfo
  gif = (await probe(await makeAnimatedGif(dir, 'anim.gif'))) as ImageInfo
})

const run = async (source: ImageInfo, dither: number) => {
  const [job] = ditherAction.plan([source], { dither, output: dir })
  if (!job) throw new Error('no job')
  await imageEngine.run(job, () => {})
  return { target: job.op === 'convert' ? job.target : undefined, out: job.outputs[0] as string }
}

const colours = async (path: string) => {
  const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return new Set(Array.from({ length: data.length / 3 }, (_, i) => data.readUIntBE(i * 3, 3))).size
}

describe('dither', () => {
  it('cuts a picture to the colours asked for, no more', async () => {
    const { out } = await run(ramp, 4)
    expect(await colours(out)).toBeLessThanOrEqual(4)
    expect(await colours(join(dir, 'ramp.png'))).toBeGreaterThan(32)
  })

  it('scatters dots: a ramp in four greys is not four flat bands', async () => {
    const { out } = await run(ramp, 4)
    const { data, info } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true })
    // Flat bands change value 3 times along a row; error diffusion changes it
    // all along the ramp, and the dots' density follows it (dark left, light right).
    let changes = 0
    for (let x = 1; x < info.width; x++) if (data[x] !== data[x - 1]) changes++
    expect(changes).toBeGreaterThan(12)
    const mean = (from: number, to: number) => {
      let sum = 0
      for (let x = from; x < to; x++) sum += data[x] as number
      return sum / (to - from)
    }
    expect(mean(0, 16)).toBeLessThan(mean(24, 40))
    expect(mean(24, 40)).toBeLessThan(mean(48, 64))
  })

  it('names the file by the colours and writes a JPEG as a PNG', async () => {
    const { target, out } = await run(jpeg, 16)
    expect(target).toBe('png')
    expect(out).toMatch(/ramp-dithered-16\.png$/)
    expect((await sharp(out).metadata()).format).toBe('png')
  })

  it('keeps a GIF a GIF with every frame', async () => {
    const { target, out } = await run(gif, 2)
    expect(target).toBe('gif')
    expect(out).toMatch(/anim-dithered-2\.gif$/)
    expect((await sharp(out, { animated: true }).metadata()).pages).toBe(3)
  })

  it('keeps a transparent picture transparent', async () => {
    const path = join(dir, 'clear.png')
    const rgba = Buffer.alloc(8 * 8 * 4, 255)
    for (let i = 0; i < 8 * 8; i++) if (i % 8 < 4) rgba[i * 4 + 3] = 0
    await sharp(rgba, { raw: { width: 8, height: 8, channels: 4 } })
      .png()
      .toFile(path)
    const { out } = await run((await probe(path)) as ImageInfo, 4)
    const meta = await sharp(out).metadata()
    expect(meta.hasAlpha).toBe(true)
    const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
    expect(data[(4 * 4 + 7) * 4 + 3]).toBe(255)
  })

  it('plans nothing for an animation that is not a GIF, or without a count', () => {
    const webp = { ...ramp, format: 'webp', frames: 4 } as ImageInfo
    expect(ditherAction.plan([webp], { dither: 8 })).toEqual([])
    expect(ditherAction.plan([ramp], {})).toEqual([])
    expect(ditherAction.plan([ramp], { dither: 7 })).toEqual([])
  })
})
