import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ImageInfo, Job } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

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
