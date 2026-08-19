// tests/engines/convert.test.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import type { FormatId, Job, Phase } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeCorruptFile, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

async function job(input: string, target: FormatId, output: string): Promise<Job> {
  return {
    source: await probe(input),
    target,
    output,
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
      const result = await imageEngine.convert(await job(input, to, out), () => {})

      const meta = await sharp(out).metadata()
      expect(meta.format).toBe(to)
      expect(result.outputBytes).toBeGreaterThan(0)
      expect(result.outputBytes).toBe((await stat(out)).size)
    })
  }

  it('reports phases in order and never invents a percentage', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const phases: Phase[] = []
    await imageEngine.convert(await job(input, 'webp', join(dir, 'a.webp')), (p) => phases.push(p))
    expect(phases).toEqual(['reading', 'decoding', 'encoding', 'writing'])
  })

  it('creates missing intermediate directories', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const out = join(dir, 'deep', 'nested', 'a.webp')
    await imageEngine.convert(await job(input, 'webp', out), () => {})
    expect((await stat(out)).isFile()).toBe(true)
  })

  it('leaves no temp file behind when encoding fails', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const source = await probe(good)
    const bad = await makeCorruptFile(dir, 'bad.bin')

    const doomed: Job = {
      source: { ...source, path: bad },
      target: 'webp',
      output: join(dir, 'out.webp'),
      options: { background: '#ffffff', keepMetadata: false },
    }

    await expect(imageEngine.convert(doomed, () => {})).rejects.toSatisfy(isForgeError)
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.forge-tmp'))
    expect(leftovers).toEqual([])
  })
})
