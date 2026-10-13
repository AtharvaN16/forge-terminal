import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ForgeError } from '../../src/core/errors.js'
import type { ConvertOptions, FormatId, ImageInfo } from '../../src/core/types.js'
import { guessCrop, imageEngine, loadCropView } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeHeic, makeTempDir, pixelAt } from '../helpers/fixtures.js'

let dir: string
let sideways: ImageInfo
let subject: ImageInfo
let padded: ImageInfo
let square: ImageInfo
let gif: ImageInfo
let cutout: ImageInfo

const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60
const isBlue = ([r, g, b]: [number, number, number]) => b > 200 && r < 60 && g < 60

beforeAll(async () => {
  dir = await makeTempDir()
  // Stored 40x80, top half red and bottom half blue, orientation 6 (turn
  // clockwise to show): upright it is 80x40 with the red half on the right.
  const stored = await sharp({
    create: { width: 40, height: 80, channels: 3, background: '#0000ff' },
  })
    .composite([
      {
        input: { create: { width: 40, height: 40, channels: 3, background: '#ff0000' } },
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality: 100 })
    .toBuffer()
  await sharp(stored).withMetadata({ orientation: 6 }).jpeg().toFile(join(dir, 'sideways.jpg'))

  // Grey 1200x600 with a saturated red disc near the right: the subject.
  const disc = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="150" fill="#ff0000"/></svg>',
  )
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#808080' } })
    .composite([{ input: disc, left: 850, top: 150 }])
    .jpeg()
    .toFile(join(dir, 'subject.jpg'))

  // 100x100 transparent with an opaque block in the middle.
  await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: { create: { width: 30, height: 50, channels: 4, background: '#ff0000' } },
        left: 35,
        top: 25,
      },
    ])
    .png()
    .toFile(join(dir, 'padded.png'))

  await sharp({ create: { width: 60, height: 60, channels: 3, background: '#808080' } })
    .png()
    .toFile(join(dir, 'square.png'))

  // A cutout 1000x500: transparent everywhere but a green disc on the right,
  // its transparent left half still holding a removed background's saturated
  // red. Seen, it is the disc; its hidden colours say the left. Under 1024 px,
  // so the thumbnail is not resized (a resize would zero the hidden colours).
  const rgba = Buffer.alloc(1000 * 500 * 4)
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x < 1000; x++) {
      const i = (y * 1000 + x) * 4
      const disc = (x - 800) ** 2 + (y - 250) ** 2 < 100 ** 2
      if (disc) rgba.set([40, 200, 60, 255], i)
      else if (x < 500) rgba.set([255, 0, 0, 0], i)
      else rgba.set([128, 128, 128, 0], i)
    }
  }
  await sharp(rgba, { raw: { width: 1000, height: 500, channels: 4 } })
    .png()
    .toFile(join(dir, 'cutout.png'))

  sideways = (await probe(join(dir, 'sideways.jpg'))) as ImageInfo
  subject = (await probe(join(dir, 'subject.jpg'))) as ImageInfo
  padded = (await probe(join(dir, 'padded.png'))) as ImageInfo
  square = (await probe(join(dir, 'square.png'))) as ImageInfo
  gif = (await probe(await makeAnimatedGif(dir, 'anim.gif'))) as ImageInfo
  cutout = (await probe(join(dir, 'cutout.png'))) as ImageInfo
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

const sizeOf = async (path: string) => {
  const meta = await sharp(path).metadata()
  return [meta.width, meta.height]
}

describe('crop to shape', () => {
  it('cuts a given box from the upright image, not the stored one', async () => {
    const aspect = { w: 1, h: 2 }
    const right = await convert(sideways, 'right.png', 'png', {
      crop: { aspect, box: { left: 60, top: 0, width: 20, height: 40 } },
    })
    expect(await sizeOf(right.output)).toEqual([20, 40])
    expect(isRed(await pixelAt(right.output, 10, 20))).toBe(true)
    const left = await convert(sideways, 'left.png', 'png', {
      crop: { aspect, box: { left: 0, top: 0, width: 20, height: 40 } },
    })
    expect(isBlue(await pixelAt(left.output, 10, 20))).toBe(true)
  })

  it('reads an upright thumbnail, at most 1024 px and never enlarged', async () => {
    const small = await loadCropView(sideways)
    expect(small.size).toEqual({ width: 80, height: 40 })
    expect([small.thumb.width, small.thumb.height]).toEqual([80, 40])
    expect(small.thumb.rgb.length).toBe(80 * 40 * 3)
    // Upright: the right half is the red one.
    expect(small.thumb.rgb[(20 * 80 + 70) * 3]).toBeGreaterThan(200)

    const big = await loadCropView(subject)
    expect(big.size).toEqual({ width: 1200, height: 600 })
    expect([big.thumb.width, big.thumb.height]).toEqual([1024, 512])

    // Opaque: no alpha to carry.
    expect(small.thumb.alpha).toBeUndefined()

    // Transparency is carried, not dropped: the corner is see-through, the block red.
    const alpha = await loadCropView(padded)
    expect(alpha.thumb.rgb.length).toBe(100 * 100 * 3)
    expect(alpha.thumb.alpha?.length).toBe(100 * 100)
    expect(alpha.thumb.alpha?.[0]).toBe(0)
    const middle = 50 * 100 + 50
    expect(alpha.thumb.alpha?.[middle]).toBe(255)
    expect(
      isRed([...alpha.thumb.rgb.subarray(middle * 3, middle * 3 + 3)] as [number, number, number]),
    ).toBe(true)
  })

  it('reads a HEIC through sips', async (ctx) => {
    const heic = await makeHeic(dir, 'photo.heic')
    if (!heic) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    const view = await loadCropView((await probe(heic)) as ImageInfo)
    expect(view.size).toEqual({ width: 40, height: 20 })
    expect(view.thumb.rgb.length).toBe(40 * 20 * 3)
  })

  it('guesses the largest box over the subject', async () => {
    const view = await loadCropView(subject)
    expect(await guessCrop(view, { w: 1, h: 1 })).toEqual({
      left: 600,
      top: 0,
      width: 600,
      height: 600,
    })
  })

  it('guesses from what is seen, not the colours hidden under transparency', async () => {
    const box = await guessCrop(await loadCropView(cutout), { w: 1, h: 1 })
    expect(box).toMatchObject({ width: 500, height: 500 })
    // The disc (x 700–900) is inside: the box is on the right, not on the hidden red.
    expect(box.left).toBeGreaterThanOrEqual(400)
  })

  it('places a box-less crop itself before writing, at the largest size', async () => {
    const { output } = await convert(subject, 'guessed.png', 'png', {
      crop: { aspect: { w: 1, h: 1 } },
    })
    expect(await sizeOf(output)).toEqual([600, 600])
    // The disc's centre (1000, 300) lands at (400, 300) in the crop.
    expect(isRed(await pixelAt(output, 400, 300))).toBe(true)
  })

  it('resizes the cropped image, not the source', async () => {
    const { output } = await convert(subject, 'small.jpg', 'jpeg', {
      crop: { aspect: { w: 16, h: 9 }, box: { left: 0, top: 0, width: 160, height: 90 } },
      resize: { percent: 50 },
    })
    expect(await sizeOf(output)).toEqual([80, 45])
  })

  it('flattens alpha when the crop goes to a format without it', async () => {
    const { output } = await convert(padded, 'padded-wide.jpg', 'jpeg', {
      crop: { aspect: { w: 16, h: 9 } },
    })
    expect(await sizeOf(output)).toEqual([100, 56])
    expect((await pixelAt(output, 0, 0)).every((v) => v > 245)).toBe(true)
  })

  it('refuses an animation', async () => {
    expect(
      await codeOf(convert(gif, 'anim-crop.gif', 'gif', { crop: { aspect: { w: 1, h: 1 } } })),
    ).toBe('animated-crop')
  })

  it('refuses an image that already has the shape, but only warns when it is also resized', async () => {
    const refused = convert(square, 'square-crop.png', 'png', { crop: { aspect: { w: 1, h: 1 } } })
    expect(await codeOf(refused)).toBe('nothing-to-crop')
    expect(existsSync(join(dir, 'square-crop.png'))).toBe(false)

    const { output, result } = await convert(square, 'square-half.png', 'png', {
      crop: { aspect: { w: 1, h: 1 } },
      resize: { percent: 50 },
    })
    expect(result.warnings.map((w) => w.code)).toEqual(['nothing-cropped'])
    expect(await sizeOf(output)).toEqual([30, 30])
  })
})
