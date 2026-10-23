import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ForgeError } from '../../src/core/errors.js'
import type { ConvertOptions, FormatId, ImageInfo } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeTempDir } from '../helpers/fixtures.js'

let dir: string
let wide: ImageInfo
let sideways: ImageInfo
let gif: ImageInfo

/** 4 × 2: the left half red, the right half blue. */
async function makeHalves(path: string) {
  const red = { create: { width: 2, height: 2, channels: 3 as const, background: '#ff0000' } }
  const blue = { create: { width: 2, height: 2, channels: 3 as const, background: '#0000ff' } }
  await sharp({ create: { width: 4, height: 2, channels: 3, background: '#000000' } })
    .composite([
      { input: await sharp(red).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp(blue).png().toBuffer(), left: 2, top: 0 },
    ])
    .png()
    .toFile(path)
}

beforeAll(async () => {
  dir = await makeTempDir()
  await makeHalves(join(dir, 'halves.png'))
  // Stored 200x100 with orientation 6: upright, it is 100x200.
  const stored = await sharp({
    create: { width: 200, height: 100, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer()
  await sharp(stored).withMetadata({ orientation: 6 }).jpeg().toFile(join(dir, 'sideways.jpg'))
  wide = (await probe(join(dir, 'halves.png'))) as ImageInfo
  sideways = (await probe(join(dir, 'sideways.jpg'))) as ImageInfo
  gif = (await probe(await makeAnimatedGif(dir, 'anim.gif'))) as ImageInfo
})

async function convert(
  source: ImageInfo,
  name: string,
  target: FormatId,
  extra: Partial<ConvertOptions>,
) {
  const output = join(dir, name)
  await imageEngine.run(
    {
      op: 'convert',
      sources: [source],
      outputs: [output],
      target,
      options: { background: '#ffffff', keepMetadata: false, ...extra },
    },
    () => {},
  )
  return output
}

const pixel = async (path: string, x: number, y: number) => {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 3
  return [data[at], data[at + 1], data[at + 2]]
}

const sizeOf = async (path: string) => {
  const m = await sharp(path).metadata()
  return [m.width, m.height]
}

describe('rotate', () => {
  it('turns 90° right: the left half ends up on top, and the sides swap', async () => {
    const out = await convert(wide, 'right.png', 'png', { rotate: 90 })
    expect(await sizeOf(out)).toEqual([2, 4])
    expect(await pixel(out, 0, 0)).toEqual([255, 0, 0])
    expect(await pixel(out, 0, 3)).toEqual([0, 0, 255])
  })

  it('turns 90° left: the left half ends up at the bottom', async () => {
    const out = await convert(wide, 'left.png', 'png', { rotate: 270 })
    expect(await sizeOf(out)).toEqual([2, 4])
    expect(await pixel(out, 0, 0)).toEqual([0, 0, 255])
    expect(await pixel(out, 0, 3)).toEqual([255, 0, 0])
  })

  it('turns 180°: the size stays and the halves trade places', async () => {
    const out = await convert(wide, 'half-turn.png', 'png', { rotate: 180 })
    expect(await sizeOf(out)).toEqual([4, 2])
    expect(await pixel(out, 0, 0)).toEqual([0, 0, 255])
  })

  it('turns from the upright picture, not the stored one', async () => {
    const out = await convert(sideways, 'sideways-right.jpg', 'jpeg', { rotate: 90 })
    // Upright it is 100x200; a quarter turn makes it 200x100.
    expect(await sizeOf(out)).toEqual([200, 100])
  })

  it('turns after a resize, which is of the upright picture', async () => {
    const out = await convert(sideways, 'sideways-half-right.jpg', 'jpeg', {
      resize: { percent: 50 },
      rotate: 90,
    })
    expect(await sizeOf(out)).toEqual([100, 50])
  })

  it('refuses an animation', async () => {
    const refused = await convert(gif, 'anim-turn.gif', 'gif', { rotate: 90 }).then(
      () => undefined,
      (e: ForgeError) => e.code,
    )
    expect(refused).toBe('animated-rotate')
  })
})
