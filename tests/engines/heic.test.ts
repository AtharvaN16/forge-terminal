import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { heicDecodable } from '../../src/engines/heic.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

const run = promisify(execFile)

/** A real HEVC-in-HEIF file, made with the same system codec Preview uses. */
async function makeHeic(dir: string, name: string, from?: string): Promise<string | undefined> {
  const source = from ?? (await makeJpeg(dir, 'seed.jpg'))
  const path = join(dir, name)
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'heic', source, '--out', path])
    return path
  } catch {
    return undefined
  }
}

describe('HEIC decoding', () => {
  it('sharp alone cannot decode HEVC — the reason this path exists', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeHeic(dir, 'shot.heic')
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }

    // Metadata succeeds, which is why a HEIC probes cleanly and then fails at
    // the last step. Pinning this so the workaround is never quietly dropped
    // on the assumption that sharp has started supporting it.
    const meta = await sharp(heic).metadata()
    expect(meta.compression).toBe('hevc')

    await expect(sharp(heic).png().toBuffer()).rejects.toThrow()
  })

  it('reports whether this machine can decode HEIC at all', async () => {
    expect(typeof (await heicDecodable())).toBe('boolean')
  })
})

describe('HEIC conversion', () => {
  for (const target of ['png', 'jpeg', 'webp'] as const) {
    it(`converts HEIC to ${target} and produces real pixels`, async (ctx) => {
      const dir = await makeTempDir()
      const heic = await makeHeic(dir, 'shot.heic')
      if (heic === undefined) {
        ctx.skip('sips unavailable — HEIC fixture cannot be generated')
        return
      }

      const source = await probe(heic)
      expect(source.format).toBe('heic')

      const output = join(dir, `out.${target === 'jpeg' ? 'jpg' : target}`)
      const result = await imageEngine.convert(
        {
          source,
          target,
          output,
          options: { background: '#ffffff', keepMetadata: false },
        },
        () => {},
      )

      expect(result.outputBytes).toBeGreaterThan(0)
      const meta = await sharp(output).metadata()
      expect(meta.format).toBe(target)
      expect(meta.width).toBe(source.width)
      expect(meta.height).toBe(source.height)
    })
  }

  it('leaves no temporary decode behind', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeHeic(dir, 'shot.heic')
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }

    const before = (await readdir(tmpdir())).filter((f) => f.startsWith('forge-heic-'))
    const source = await probe(heic)
    await imageEngine.convert(
      {
        source,
        target: 'png',
        output: join(dir, 'out.png'),
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith('forge-heic-'))
    expect(after.length).toBe(before.length)
  })

  it('does not double-rotate an oriented source', async (ctx) => {
    // sips applies EXIF orientation while decoding and writes a PNG with no
    // orientation tag. Rotating again would put a correct image on its side,
    // so the pipeline skips .rotate() for a decoded HEIC — this pins it.
    const dir = await makeTempDir()
    const oriented = await makeOrientedJpeg(dir, 'tall.jpg', 6)
    const heic = await makeHeic(dir, 'tall.heic', oriented)
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }

    const source = await probe(heic)
    const output = join(dir, 'tall.png')
    await imageEngine.convert(
      {
        source,
        target: 'png',
        output,
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )

    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(source.width)
    expect(meta.height).toBe(source.height)
  })
})
