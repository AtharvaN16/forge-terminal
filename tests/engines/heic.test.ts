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

/**
 * A photo-sized HEIC. This matters more than it looks: sips stores a large
 * image as a tiled grid, and it is only at that size that libheif's iref
 * reference limit is exceeded and sharp stops being able to read the file at
 * all. Every small fixture in this file passes with or without the fix.
 */
async function makeLargeHeic(dir: string): Promise<string | undefined> {
  const jpg = join(dir, 'large.jpg')
  await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#3a7fb5' } })
    .jpeg({ quality: 92 })
    .toFile(jpg)
  return makeHeic(dir, 'IMG_4021.heic', jpg)
}

describe('HEIC at photo size', () => {
  it('sharp cannot even read the metadata — the reason probe does not use it', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeLargeHeic(dir)
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    await expect(sharp(heic).metadata()).rejects.toThrow(/iref|security limit/i)
  }, 60_000)

  it('probes a 12MP photo and reports its real dimensions', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeLargeHeic(dir)
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    const source = await probe(heic)
    if (source.kind !== 'image') throw new Error('expected an image source')
    expect(source.format).toBe('heic')
    expect(source.width).toBe(4032)
    expect(source.height).toBe(3024)
  }, 60_000)

  it('converts a 12MP photo to jpeg', async (ctx) => {
    const dir = await makeTempDir()
    const heic = await makeLargeHeic(dir)
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    const source = await probe(heic)
    const output = join(dir, 'out.jpg')
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
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(4032)
    expect(meta.height).toBe(3024)
  }, 60_000)
})

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
      if (source.kind !== 'image') throw new Error('expected an image source')
      expect(source.format).toBe('heic')

      const output = join(dir, `out.${target === 'jpeg' ? 'jpg' : target}`)
      const result = await imageEngine.run(
        {
          op: 'convert',
          sources: [source],
          outputs: [output],
          target,
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
    await imageEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [join(dir, 'out.png')],
        target: 'png',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith('forge-heic-'))
    expect(after.length).toBe(before.length)
  })

  it('writes an oriented source the right way up', async (ctx) => {
    /**
     * The intermediate PNG carries the source's orientation, so `.rotate()`
     * must run on it exactly as it does for any other input — an earlier
     * draft skipped it and shipped every rotated photo on its side.
     *
     * Asserted on the output's own shape rather than against `probe`:
     * `sips` reports the stored dimensions for a rotated HEIC and offers no
     * orientation field, so the two can legitimately disagree. The written
     * file being upright is the guarantee that matters.
     */
    const dir = await makeTempDir()
    const oriented = await makeOrientedJpeg(dir, 'tall.jpg', 6)
    const heic = await makeHeic(dir, 'tall.heic', oriented)
    if (heic === undefined) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }

    const source = await probe(heic)
    const output = join(dir, 'tall.png')
    await imageEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'png',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )

    const meta = await sharp(output).metadata()
    // The source is a portrait 40x80 rotated to display as 80x40 landscape.
    expect(meta.width).toBe(80)
    expect(meta.height).toBe(40)
  })
})
