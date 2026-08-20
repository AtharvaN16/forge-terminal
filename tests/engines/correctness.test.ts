// tests/engines/correctness.test.ts
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { ConvertOptions, FormatId, Job } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeOrientedJpeg, makeTempDir, makeTransparentPng, pixelAt } from '../helpers/fixtures.js'

async function job(
  input: string,
  target: FormatId,
  output: string,
  options: Partial<ConvertOptions> = {},
): Promise<Job> {
  return {
    op: 'convert',
    sources: [await probe(input)],
    outputs: [output],
    target,
    options: { background: '#ffffff', keepMetadata: false, ...options },
  }
}

describe('exif orientation', () => {
  it('rotates a 40x80 orientation-6 jpeg to 80x40, instead of leaving it sideways', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'rot.jpg', 6)
    const out = join(dir, 'rot.png')

    await imageEngine.run(await job(input, 'png', out), () => {})

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(80)
    expect(meta.height).toBe(40)
  })

  it('leaves an unrotated image alone', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'plain.jpg', 1)
    const out = join(dir, 'plain.png')

    await imageEngine.run(await job(input, 'png', out), () => {})

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(40)
    expect(meta.height).toBe(80)
  })
})

describe('alpha flattening', () => {
  it('turns transparency white when converting to jpeg, not black', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't.jpg')

    await imageEngine.run(await job(input, 'jpeg', out), () => {})

    const [r, g, b] = await pixelAt(out, 0, 0)
    expect(r).toBeGreaterThan(250)
    expect(g).toBeGreaterThan(250)
    expect(b).toBeGreaterThan(250)
  })

  it('honours a custom background colour', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't-black.jpg')

    await imageEngine.run(await job(input, 'jpeg', out, { background: '#000000' }), () => {})

    const [r, g, b] = await pixelAt(out, 0, 0)
    expect(r).toBeLessThan(5)
    expect(g).toBeLessThan(5)
    expect(b).toBeLessThan(5)
  })

  it('preserves transparency when the target can carry it', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't.webp')

    await imageEngine.run(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).hasAlpha).toBe(true)
  })
})
