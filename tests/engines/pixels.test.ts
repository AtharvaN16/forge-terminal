import { describe, expect, it } from 'vitest'
import { palette } from '../../src/core/colour/palette.js'
import { samplePixels } from '../../src/engines/pixels.js'
import {
  makeAnimatedGif,
  makeCorruptFile,
  makeJpeg,
  makeOrientedJpeg,
  makePdf,
  makeTempDir,
} from '../helpers/fixtures.js'

describe('samplePixels', () => {
  it('shrinks to 192 on the longest side, RGBA', async () => {
    const dir = await makeTempDir()
    const { pixels, source } = await samplePixels(await makeJpeg(dir, 'a.jpg'))
    expect(Math.max(pixels.width, pixels.height)).toBeLessThanOrEqual(192)
    expect(pixels.rgba.length).toBe(pixels.width * pixels.height * 4)
    expect(source.kind).toBe('image')
  })

  it('reads an EXIF-rotated photo upright', async () => {
    const dir = await makeTempDir()
    // Stored 40 × 80 (portrait) with orientation 6: displayed 80 × 40.
    const { pixels } = await samplePixels(await makeOrientedJpeg(dir, 'r.jpg', 6))
    expect(pixels.width).toBeGreaterThan(pixels.height)
  })

  it('takes the first frame of an animation', async () => {
    const dir = await makeTempDir()
    const { pixels } = await samplePixels(await makeAnimatedGif(dir, 'a.gif', 3))
    expect(palette(pixels).length).toBeGreaterThan(0)
  })

  it('refuses a PDF as not an image, by content', async () => {
    const dir = await makeTempDir()
    await expect(samplePixels(await makePdf(dir, 'looks.png'))).rejects.toMatchObject({
      code: 'unsupported-source',
      title: 'Not an image',
      detail: 'looks.png is a PDF, not an image.',
    })
  })

  it('reports a corrupt file as corrupt or unreadable', async () => {
    const dir = await makeTempDir()
    await expect(samplePixels(await makeCorruptFile(dir, 'bad.jpg'))).rejects.toMatchObject({
      code: expect.stringMatching(/corrupt-source|unsupported-source/),
    })
  })
})
