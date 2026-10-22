import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
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
import { makeDng } from '../helpers/raw.js'

const mac = process.platform === 'darwin' && existsSync('/usr/bin/sips')

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

  // sips keeps a HEIC's or RAW's orientation as EXIF in the PNG it decodes
  // to, so the decoded pixels need turning like any other photo's.
  it.skipIf(!mac)('reads a portrait HEIC upright', async () => {
    const dir = await makeTempDir()
    const heic = join(dir, 'r.heic')
    const jpeg = await makeOrientedJpeg(dir, 'r.jpg', 6)
    await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'heic', jpeg, '--out', heic])
    const { pixels, source } = await samplePixels(heic)
    expect([source.width, source.height]).toEqual([80, 40])
    expect(pixels.width).toBeGreaterThan(pixels.height)
  })

  it.skipIf(!mac)(
    'reads a RAW photo, upright',
    async () => {
      const dir = await makeTempDir()
      const { pixels, source } = await samplePixels(
        await makeDng(dir, 'r.dng', { orientation: 6 }),
        400,
      )
      expect(source).toMatchObject({ format: 'raw', width: 240, height: 320 })
      expect([pixels.width, pixels.height]).toEqual([240, 320])
    },
    30_000,
  )

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
