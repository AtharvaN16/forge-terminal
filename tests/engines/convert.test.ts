// tests/engines/convert.test.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import type { FormatId, Job, Progress } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import {
  countColours,
  makeCorruptFile,
  makeGradientPng,
  makeJpeg,
  makePng,
  makeTempDir,
} from '../helpers/fixtures.js'

async function job(input: string, target: FormatId, output: string): Promise<Job> {
  return {
    op: 'convert',
    sources: [await probe(input)],
    outputs: [output],
    target,
    options: { background: '#ffffff', keepMetadata: false },
  }
}

describe('convert — format pairs', () => {
  const pairs: Array<[string, FormatId, FormatId]> = [
    ['jpeg->png', 'jpeg', 'png'],
    ['jpeg->webp', 'jpeg', 'webp'],
    ['png->jpeg', 'png', 'jpeg'],
    ['png->webp', 'png', 'webp'],
    ['webp->jpeg', 'webp', 'jpeg'],
    ['webp->png', 'webp', 'png'],
  ]

  for (const [name, from, to] of pairs) {
    it(`converts ${name}`, async () => {
      const dir = await makeTempDir()
      const seed =
        from === 'jpeg' ? await makeJpeg(dir, 'seed.jpg') : await makePng(dir, 'seed.png')
      const input = from === 'webp' ? join(dir, 'seed.webp') : seed
      if (from === 'webp') await sharp(seed).webp().toFile(input)

      const out = join(dir, `out.${to}`)
      const result = await imageEngine.run(await job(input, to, out), () => {})

      const meta = await sharp(out).metadata()
      expect(meta.format).toBe(to)
      expect(result.outputBytes).toBeGreaterThan(0)
      expect(result.outputBytes).toBe((await stat(out)).size)
    })
  }

  it('reports phases in order and never invents a percentage', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const phases: Progress[] = []
    await imageEngine.run(await job(input, 'webp', join(dir, 'a.webp')), (p) => phases.push(p))
    expect(phases).toEqual([
      { phase: 'reading' },
      { phase: 'decoding' },
      { phase: 'encoding' },
      { phase: 'writing' },
    ])
  })

  it('creates missing intermediate directories', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const out = join(dir, 'deep', 'nested', 'a.webp')
    await imageEngine.run(await job(input, 'webp', out), () => {})
    expect((await stat(out)).isFile()).toBe(true)
  })

  it('does not quantise PNG output and does not lossy-compress TIFF output', async () => {
    const dir = await makeTempDir()
    const input = await makeGradientPng(dir, 'gradient.png')
    const sourceColours = await countColours(input)
    // Sanity check on the fixture itself: it must actually be many-coloured,
    // or a quantisation regression here would go undetected.
    expect(sourceColours).toBeGreaterThan(10_000)

    const pngOut = join(dir, 'out.png')
    await imageEngine.run(await job(input, 'png', pngOut), () => {})
    const pngMeta = await sharp(pngOut).metadata()
    expect(pngMeta.isPalette).toBeFalsy()
    expect(await countColours(pngOut)).toBe(sourceColours)

    const tiffOut = join(dir, 'out.tiff')
    await imageEngine.run(await job(input, 'tiff', tiffOut), () => {})
    expect(await countColours(tiffOut)).toBe(sourceColours)
  })

  it('leaves no temp file behind when encoding fails', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const source = await probe(good)
    const bad = await makeCorruptFile(dir, 'bad.bin')

    const doomed: Job = {
      op: 'convert',
      sources: [{ ...source, path: bad }],
      outputs: [join(dir, 'out.webp')],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    }

    await expect(imageEngine.run(doomed, () => {})).rejects.toSatisfy(isForgeError)
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.forge-tmp'))
    expect(leftovers).toEqual([])
  })

  /**
   * `writeAtomic` already raises a well-worded `outputInvalid` ("Cannot write
   * there / Check that the path is valid and that you have permission") when
   * the destination directory cannot be created. `convert`'s catch used to
   * wrap *everything*, including that, replacing it with "Conversion failed /
   * Run again with `--debug`" — a hint that names a CLI flag the interactive
   * shell does not have, so in the shell it is a dead end. `run.ts` has
   * always preserved a `ForgeError` this way; the engine now does too.
   */
  it('preserves the specific error writeAtomic already raised', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    // A path *through* a regular file: mkdir -p fails with ENOTDIR.
    const doomed = await job(jpg, 'webp', join(jpg, 'nested', 'out.webp'))

    await expect(imageEngine.run(doomed, () => {})).rejects.toSatisfy(
      (e: unknown) => isForgeError(e) && e.code === 'output-invalid',
    )
  })

  it('still wraps an encode failure it has no better name for', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const source = await probe(good)
    const bad = await makeCorruptFile(dir, 'bad.bin')

    const doomed: Job = {
      op: 'convert',
      sources: [{ ...source, path: bad }],
      outputs: [join(dir, 'out.webp')],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    }

    await expect(imageEngine.run(doomed, () => {})).rejects.toSatisfy(
      (e: unknown) => isForgeError(e) && e.code === 'conversion-failed',
    )
  })
})
