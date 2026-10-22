import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { rawDecoderUnavailable } from '../../src/core/errors.js'
import { imageEngine } from '../../src/engines/image.js'
import { rawDecodable, sniffRaw } from '../../src/engines/raw.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeTempDir, makeTiff, pixelAt } from '../helpers/fixtures.js'
import {
  cameraTiffBytes,
  cr2Bytes,
  cr3Bytes,
  makeDng,
  nefBytes,
  orfBytes,
  rafBytes,
  rw2Bytes,
} from '../helpers/raw.js'

const mac = process.platform === 'darwin' && existsSync('/usr/bin/sips')

async function file(name: string, bytes: Buffer): Promise<string> {
  const path = join(await makeTempDir(), name)
  await writeFile(path, bytes)
  return path
}

describe('RAW detection, from the bytes', () => {
  it('knows a DNG, and reads its orientation', async () => {
    const dir = await makeTempDir()
    expect(await sniffRaw(await makeDng(dir, 'a.dng'))).toEqual({ ext: '.dng', orientation: 1 })
    expect(await sniffRaw(await makeDng(dir, 'b.dng', { orientation: 6 }))).toEqual({
      ext: '.dng',
      orientation: 6,
    })
  })

  it('knows a DNG whatever it is called', async () => {
    const dir = await makeTempDir()
    expect(await sniffRaw(await makeDng(dir, 'photo.tif'))).toMatchObject({ ext: '.dng' })
    expect(await sniffRaw(await makeDng(dir, 'photo'))).toMatchObject({ ext: '.dng' })
  })

  it('knows each maker by its own header', async () => {
    expect(await sniffRaw(await file('a', cr2Bytes(8)))).toEqual({ ext: '.cr2', orientation: 8 })
    expect(await sniffRaw(await file('b', cr3Bytes(8)))).toEqual({ ext: '.cr3', orientation: 8 })
    expect(await sniffRaw(await file('c', nefBytes(6)))).toEqual({ ext: '.nef', orientation: 6 })
    expect(await sniffRaw(await file('d', orfBytes(3)))).toEqual({ ext: '.orf', orientation: 3 })
    expect(await sniffRaw(await file('e', rw2Bytes(6)))).toEqual({ ext: '.rw2', orientation: 6 })
    expect(await sniffRaw(await file('f', await rafBytes(6)))).toEqual({
      ext: '.raf',
      orientation: 6,
    })
  })

  it('a camera maker on an ordinary TIFF does not make it RAW', async () => {
    expect(await sniffRaw(await file('scan.nef', cameraTiffBytes()))).toBeUndefined()
  })

  it('leaves ordinary images alone', async () => {
    const dir = await makeTempDir()
    expect(await sniffRaw(await makeTiff(dir, 'a.tif'))).toBeUndefined()
    expect(await sniffRaw(await makeJpeg(dir, 'a.jpg'))).toBeUndefined()
    expect(await sniffRaw(join(dir, 'missing.dng'))).toBeUndefined()
  })
})

describe.skipIf(!mac)('RAW probing', () => {
  it('measures the photo, not the preview a TIFF reader sees', async () => {
    const dng = await makeDng(await makeTempDir(), 'shot.dng')
    // What Sharp alone makes of it: the 16×12 preview. The reason RAW goes through sips.
    expect(await sharp(dng).metadata()).toMatchObject({ format: 'tiff', width: 16, height: 12 })

    expect(await probe(dng)).toMatchObject({
      kind: 'image',
      format: 'raw',
      width: 320,
      height: 240,
      hasAlpha: false,
      frames: 1,
    })
  })

  it('reports the upright size of a portrait photo', async () => {
    const dng = await makeDng(await makeTempDir(), 'shot.dng', { orientation: 6 })
    expect(await probe(dng)).toMatchObject({ format: 'raw', width: 240, height: 320 })
  })

  it('reads a RAW photo misnamed as a TIFF as RAW', async () => {
    const dng = await makeDng(await makeTempDir(), 'shot.tif')
    expect(await probe(dng)).toMatchObject({ format: 'raw', width: 320, height: 240 })
  })

  it('becomes any image Forge writes, never RAW or HEIC', async () => {
    const source = await probe(await makeDng(await makeTempDir(), 'shot.dng'))
    const targets = targetIdsFor(source)
    expect(targets).toEqual(expect.arrayContaining(['jpeg', 'png', 'webp', 'avif', 'tiff']))
    expect(targets).not.toContain('raw')
    expect(targets).not.toContain('heic')
  })
})

describe.skipIf(!mac)('RAW conversion', () => {
  async function convert(dng: string, name: string) {
    const source = await probe(dng)
    const output = join(await makeTempDir(), name)
    await imageEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'jpeg',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    return output
  }

  it('converts the photo itself to JPEG', async () => {
    const dir = await makeTempDir()
    const out = await convert(await makeDng(dir, 'shot.dng'), 'shot.jpg')
    expect(await sharp(out).metadata()).toMatchObject({ format: 'jpeg', width: 320, height: 240 })
    // The gradient, not the all-green preview: red rises to the right, green downwards.
    const [r1, g1] = await pixelAt(out, 310, 10)
    const [r2, g2] = await pixelAt(out, 10, 230)
    expect(r1).toBeGreaterThan(g1 + 100)
    expect(g2).toBeGreaterThan(r2 + 100)
  }, 30_000)

  it('turns a portrait photo upright', async () => {
    const dir = await makeTempDir()
    const out = await convert(await makeDng(dir, 'shot.dng', { orientation: 6 }), 'shot.jpg')
    expect(await sharp(out).metadata()).toMatchObject({ width: 240, height: 320 })
  }, 30_000)

  it('converts a RAW photo misnamed as a TIFF', async () => {
    const dir = await makeTempDir()
    const out = await convert(await makeDng(dir, 'shot.tif'), 'shot.jpg')
    expect(await sharp(out).metadata()).toMatchObject({ width: 320, height: 240 })
  }, 30_000)
})

describe('RAW off macOS', () => {
  it('is not decodable on Windows', async () => {
    expect(await rawDecodable('win32')).toBe(false)
  })

  it('says it needs a Mac', () => {
    expect(rawDecoderUnavailable('/tmp/a.nef', 'win32')).toMatchObject({
      code: 'raw-decoder-unavailable',
      title: 'Cannot read RAW here',
      short: 'RAW photos open on a Mac only.',
    })
  })
})
