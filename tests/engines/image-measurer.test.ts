import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ImageInfo, Job } from '../../src/core/types.js'
import { encodeToBuffer, imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeHeic,
  makeJpeg,
  makeNoisyOrientedJpeg,
  makeTempDir,
  makeTransparentPng,
} from '../helpers/fixtures.js'

let dir: string
let source: ImageInfo

beforeAll(async () => {
  dir = await makeTempDir()
  source = (await probe(await makeJpeg(dir, 'photo.jpg'))) as ImageInfo
})

const jobFor = (outputs: [string, ...string[]]): Job => ({
  op: 'convert',
  sources: [source],
  outputs,
  target: 'jpeg',
  options: { background: '#ffffff', keepMetadata: false },
})

describe('imageEngine.measurer', () => {
  /**
   * An image has one lever. The dpi ladder belongs to the PDF engine, which is
   * the only module that knows why 150 → 120 → 96 → 72 and not some other
   * sequence.
   */
  it('offers exactly one rung', async () => {
    const m = await imageEngine.measurer?.(jobFor(['/unused.jpg']))

    expect(m?.ladder).toEqual([{}])
  })

  it('declines a lossless target, which has no quality to search', async () => {
    const job: Job = {
      op: 'convert',
      sources: [source],
      outputs: ['/unused.png'],
      target: 'png',
      options: { background: '#ffffff', keepMetadata: false },
    }
    expect(await imageEngine.measurer?.(job)).toBeUndefined()
  })

  it('measures smaller at lower quality', async () => {
    const m = await imageEngine.measurer?.(jobFor(['/unused.jpg']))
    const base = { background: '#ffffff', keepMetadata: false }

    const big = await m?.measure({ ...base, quality: 95 })
    const small = await m?.measure({ ...base, quality: 10 })

    expect(small).toBeLessThan(big as number)
  })

  /** The search runs this up to eight times; none of them may touch the disk. */
  it('writes nothing', async () => {
    const output = join(dir, 'must-not-exist.jpg')
    const m = await imageEngine.measurer?.(jobFor([output]))
    // Without this the test passes while `measurer` is absent — nothing runs,
    // so nothing is written, and the assertion below proves nothing.
    expect(m).toBeDefined()

    await m?.measure({ background: '#ffffff', keepMetadata: false, quality: 50 })

    expect(existsSync(output)).toBe(false)
  })
})

describe('imageEngine.measurer reads its source once', () => {
  const base = { background: '#ffffff', keepMetadata: false }

  async function measurerFor(path: string, target: 'jpeg' | 'webp' | 'avif') {
    const source = (await probe(path)) as ImageInfo
    const job: Job = {
      op: 'convert',
      sources: [source],
      outputs: ['/unused'],
      target,
      options: base,
    }
    const m = await imageEngine.measurer?.(job)
    if (!m) throw new Error('expected a measurer')
    return { m, source }
  }

  it.each([
    ['an oriented photo to JPEG', 'noisy.jpg', 'jpeg', false],
    ['an oriented photo to WebP, keeping metadata', 'noisy.jpg', 'webp', true],
    ['a transparent PNG flattened to JPEG', 'clear.png', 'jpeg', false],
  ] as const)(
    'measures %s exactly as the real encode would',
    async (_label, name, target, keepMetadata) => {
      const d = await makeTempDir()
      const path = name.endsWith('.png')
        ? await makeTransparentPng(d, name)
        : await makeNoisyOrientedJpeg(d, name)
      const { m, source } = await measurerFor(path, target)
      for (const quality of [10, 50, 90]) {
        const options = { ...base, keepMetadata, quality }
        // Byte-identical, so the quality the search settles on cannot move:
        // spec §3, "no conversion's output bytes change".
        expect(await m.measure(options)).toBe(
          (await encodeToBuffer(source, target, options)).length,
        )
      }
    },
  )

  it('keeps measuring after the file is gone, because it never rereads it', async () => {
    const d = await makeTempDir()
    const path = await makeNoisyOrientedJpeg(d, 'gone.jpg')
    const { m } = await measurerFor(path, 'jpeg')
    await rm(path)
    expect(await m.measure({ ...base, quality: 40 })).toBeGreaterThan(0)
  })

  it('decodes a HEIC once, not once per attempt', async (ctx) => {
    const d = await makeTempDir()
    const path = await makeHeic(d, 'photo.heic')
    if (path === null) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    const { m, source } = await measurerFor(path, 'jpeg')
    const expected = (await encodeToBuffer(source, 'jpeg', { ...base, quality: 60 })).length
    await rm(path)
    expect(await m.measure({ ...base, quality: 60 })).toBe(expected)
  })
})
