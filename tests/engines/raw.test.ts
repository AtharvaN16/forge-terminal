import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { rawDecoderUnavailable } from '../../src/core/errors.js'
import { imageEngine } from '../../src/engines/image.js'
import { decodeRaw, rawDecodable, rawSize, sniffRaw } from '../../src/engines/raw.js'
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
const run = promisify(execFile)

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

/** Points the config dir at an empty temp dir; returns where raw 1.0.0 would install. */
async function emptyConfig(): Promise<string> {
  const config = await makeTempDir()
  process.env.XDG_CONFIG_HOME = config
  return join(config, 'forge', 'extensions', 'raw', '1.0.0')
}

/** The layout `installed()` reads: the built runner, its manifest, and `current`. */
async function installRawExtension(dir: string): Promise<void> {
  await run(process.execPath, [join(process.cwd(), 'extensions', 'raw', 'build.mjs'), '--out', dir])
  const manifest = {
    id: 'raw',
    version: '1.0.0',
    entry: 'runner.mjs',
    kind: 'node',
    files: { 'runner.mjs': '' },
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(dirname(dir), 'current'), '1.0.0')
}

const savedXdg = process.env.XDG_CONFIG_HOME
afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

for (const [platform, os] of [
  ['win32', 'Windows'],
  ['linux', 'Linux'],
] as const) {
  describe(`RAW on ${os} (the raw extension)`, () => {
    it('is decodable once the extension is installed, mid-session, and decodes through it', async () => {
      const dir = await emptyConfig()
      expect(await rawDecodable(platform)).toBe(false)
      await installRawExtension(dir)
      expect(await rawDecodable(platform)).toBe(true)

      // A portrait photo with a maker's crop: upright and cropped, from the header alone.
      const path = await makeDng(await makeTempDir(), 'shot.dng', {
        orientation: 6,
        crop: { left: 40, top: 20, width: 240, height: 200 },
      })
      const kind = await sniffRaw(path)
      if (!kind) throw new Error('a DNG is RAW')
      expect(await rawSize(path, kind, platform)).toEqual({ width: 200, height: 240 })

      const decoded = await decodeRaw(path, platform)
      const meta = await sharp(decoded.path).metadata()
      // Upright already, with no orientation of its own: `.rotate()` leaves it be.
      expect(meta).toMatchObject({ format: 'png', width: 200, height: 240, channels: 3 })
      expect(meta.orientation).toBeUndefined()
      const rotated = await sharp(decoded.path).rotate().toBuffer({ resolveWithObject: true })
      expect(rotated.info).toMatchObject({ width: 200, height: 240 })
      await decoded.cleanup()
      expect(existsSync(dirname(decoded.path))).toBe(false)
    }, 60_000)

    it('decodes the photo, not the preview, and by its bytes whatever it is called', async () => {
      await installRawExtension(await emptyConfig())
      const path = await makeDng(await makeTempDir(), 'shot.tif')
      const decoded = await decodeRaw(path, platform)
      expect(await sharp(decoded.path).metadata()).toMatchObject({ width: 320, height: 240 })
      // The gradient, not the all-green preview.
      const [r1, g1] = await pixelAt(decoded.path, 310, 10)
      const [r2, g2] = await pixelAt(decoded.path, 10, 230)
      expect(r1).toBeGreaterThan(g1 + 100)
      expect(g2).toBeGreaterThan(r2 + 100)
      await decoded.cleanup()
    }, 60_000)

    it('without the extension, refuses with the install hint and names the OS', async () => {
      await emptyConfig()
      const path = await makeDng(await makeTempDir(), 'shot.dng')
      const kind = { ext: '.dng', orientation: 1 }
      const refusal = await decodeRaw(path, platform).catch((e: unknown) => e)
      expect(refusal).toMatchObject({
        code: 'raw-decoder-unavailable',
        short: 'RAW needs the raw extension.',
        hint: 'Install it with: forge extensions add raw',
        shellHint: 'Open /extensions to install it.',
      })
      expect((refusal as Error & { detail: string }).detail).toMatch(
        new RegExp(`free RAW extension on ${os}\\.$`),
      )
      await expect(rawSize(path, kind, platform)).rejects.toMatchObject({
        code: 'raw-decoder-unavailable',
      })
    })

    it('a file LibRaw cannot read is an error, never the Mac’s too-new-camera answer', async () => {
      await installRawExtension(await emptyConfig())
      const path = join(await makeTempDir(), 'broken.nef')
      await writeFile(path, nefBytes())
      await expect(rawSize(path, { ext: '.nef', orientation: 1 }, platform)).rejects.toThrow()
    }, 60_000)
  })
}

describe('RAW on macOS stays with sips', () => {
  it('is decodable exactly when sips runs, extension or not', async () => {
    await installRawExtension(await emptyConfig())
    expect(await rawDecodable('darwin')).toBe(mac)
  }, 60_000)

  it.skipIf(!mac)(
    'measures and decodes with sips even when the extension is installed',
    async () => {
      await installRawExtension(await emptyConfig())
      const path = await makeDng(await makeTempDir(), 'shot.dng', { orientation: 6 })
      const kind = await sniffRaw(path)
      if (!kind) throw new Error('a DNG is RAW')
      expect(await rawSize(path, kind, 'darwin')).toEqual({ width: 240, height: 320 })
      // sips keeps the orientation as EXIF rather than turning the pixels: stored size, flag 6.
      const decoded = await decodeRaw(path, 'darwin')
      expect(await sharp(decoded.path).metadata()).toMatchObject({
        width: 320,
        height: 240,
        orientation: 6,
      })
      await decoded.cleanup()
    },
    60_000,
  )

  it('keeps its sips wording', () => {
    expect(rawDecoderUnavailable('/tmp/a.nef', 'darwin')).toMatchObject({
      code: 'raw-decoder-unavailable',
      short: 'RAW needs sips, which could not be run.',
      hint: 'sips could not be run. It ships with macOS at /usr/bin/sips.',
    })
  })
})
