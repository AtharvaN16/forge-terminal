import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ForgeError } from '../../src/core/errors.js'
import type { ConvertOptions, FormatId, ImageInfo } from '../../src/core/types.js'
import { imageEngine, measureImage } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeTempDir } from '../helpers/fixtures.js'

let dir: string
let sideways: ImageInfo
let padded: ImageInfo
let uniform: ImageInfo
let gif: ImageInfo

/** 100x100 transparent, with a 30x50 opaque block in the middle. */
async function makePaddedPng(path: string) {
  const block = await sharp({
    create: { width: 30, height: 50, channels: 4, background: '#ff0000' },
  })
    .png()
    .toBuffer()
  await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: block, left: 35, top: 25 }])
    .png()
    .toFile(path)
}

beforeAll(async () => {
  dir = await makeTempDir()
  // Stored 200x100 with orientation 6: upright, it is 100x200.
  const stored = await sharp({
    create: { width: 200, height: 100, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer()
  await sharp(stored).withMetadata({ orientation: 6 }).jpeg().toFile(join(dir, 'sideways.jpg'))
  await makePaddedPng(join(dir, 'padded.png'))
  await sharp({ create: { width: 60, height: 40, channels: 3, background: '#808080' } })
    .png()
    .toFile(join(dir, 'uniform.png'))
  sideways = (await probe(join(dir, 'sideways.jpg'))) as ImageInfo
  padded = (await probe(join(dir, 'padded.png'))) as ImageInfo
  uniform = (await probe(join(dir, 'uniform.png'))) as ImageInfo
  gif = (await probe(await makeAnimatedGif(dir, 'anim.gif'))) as ImageInfo
})

async function convert(
  source: ImageInfo,
  name: string,
  target: FormatId,
  extra: Partial<ConvertOptions>,
) {
  const output = join(dir, name)
  const result = await imageEngine.run(
    {
      op: 'convert',
      sources: [source],
      outputs: [output],
      target,
      options: { background: '#ffffff', keepMetadata: false, ...extra },
    },
    () => {},
  )
  return { output, result }
}

const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: ForgeError) => e.code,
  )

describe('resize and trim', () => {
  it('probes a sideways photo at its upright size, and resizes from that', async () => {
    expect([sideways.width, sideways.height]).toEqual([100, 200])
    const { output } = await convert(sideways, 'side-half.jpg', 'jpeg', { resize: { percent: 50 } })
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height]).toEqual([50, 100])
  })

  it('trims transparent edges and keeps the alpha of a PNG', async () => {
    const { output } = await convert(padded, 'padded-trim.png', 'png', { trim: true })
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([30, 50, true])
  })

  it('takes a percentage of the trimmed size, not of the original', async () => {
    const { output } = await convert(padded, 'padded-half.png', 'png', {
      trim: true,
      resize: { percent: 50 },
    })
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height]).toEqual([15, 25])
  })

  it('refuses to trim a uniform image, but only warns when it is also resized', async () => {
    const refused = convert(uniform, 'uniform-trim.png', 'png', { trim: true })
    expect(await codeOf(refused)).toBe('nothing-to-trim')
    expect(existsSync(join(dir, 'uniform-trim.png'))).toBe(false)

    const { output, result } = await convert(uniform, 'uniform-half.png', 'png', {
      trim: true,
      resize: { percent: 50 },
    })
    expect(result.warnings.map((w) => w.code)).toEqual(['nothing-trimmed'])
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height]).toEqual([30, 20])
  })

  it('resizes an animation keeping its frames, and refuses to trim one', async () => {
    const { output } = await convert(gif, 'anim-small.gif', 'gif', { resize: { width: 4 } })
    expect((await sharp(output, { animated: true }).metadata()).pages).toBe(gif.frames)
    expect(await sharp(output).metadata()).toMatchObject({ width: 4 })
    expect(await codeOf(convert(gif, 'anim-trim.gif', 'gif', { trim: true }))).toBe('animated-trim')
  })

  it('flattens alpha when the resized result goes to a format without it', async () => {
    const { output } = await convert(padded, 'padded-small.jpg', 'jpeg', {
      resize: { percent: 50 },
    })
    expect((await sharp(output).metadata()).hasAlpha).toBe(false)
  })

  it('refuses a size over the limit before writing anything', async () => {
    const output = join(dir, 'huge.png')
    expect(await codeOf(convert(padded, 'huge.png', 'png', { resize: { width: 20_000 } }))).toBe(
      'resize-too-large',
    )
    expect(existsSync(output)).toBe(false)
  })

  it('measures the upright size, and what a trim would leave', async () => {
    expect(await measureImage(sideways)).toEqual({
      upright: { width: 100, height: 200 },
      trimmed: 'nothing',
    })
    expect((await measureImage(padded)).trimmed).toEqual({ width: 30, height: 50 })
    expect((await measureImage(uniform)).trimmed).toBe('nothing')
    expect((await measureImage(gif)).trimmed).toBe('animated')
  })
})
