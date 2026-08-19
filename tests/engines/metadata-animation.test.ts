// tests/engines/metadata-animation.test.ts
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { FormatId, Job } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

async function job(
  input: string,
  target: FormatId,
  output: string,
  options: Partial<Job['options']> = {},
): Promise<Job> {
  return {
    source: await probe(input),
    target,
    output,
    options: { background: '#ffffff', keepMetadata: false, ...options },
  }
}

describe('metadata', () => {
  it('strips exif by default, because phone photos carry gps coordinates', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'a.jpg', 6)
    const out = join(dir, 'a.webp')

    await imageEngine.convert(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).exif).toBeUndefined()
  })

  it('preserves exif when asked', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'b.jpg', 6)
    const out = join(dir, 'b.webp')

    await imageEngine.convert(await job(input, 'webp', out, { keepMetadata: true }), () => {})

    expect((await sharp(out).metadata()).exif).toBeDefined()
  })
})

describe('animation', () => {
  it('keeps every frame when the target can animate', async () => {
    const dir = await makeTempDir()
    const input = await makeAnimatedGif(dir, 'a.gif', 3)
    const out = join(dir, 'a.webp')

    const result = await imageEngine.convert(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).pages).toBe(3)
    expect(result.warnings).toEqual([])
  })

  it('warns rather than silently dropping frames when the target cannot animate', async () => {
    const dir = await makeTempDir()
    const input = await makeAnimatedGif(dir, 'b.gif', 3)
    const out = join(dir, 'b.png')

    const result = await imageEngine.convert(await job(input, 'png', out), () => {})

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('animation-flattened')
    expect(result.warnings[0]?.message).toContain('3 frames')
    expect(result.warnings[0]?.message).toContain('PNG')
  })

  it('says nothing about animation for a still image', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'c.jpg', 1)
    const result = await imageEngine.convert(await job(input, 'png', join(dir, 'c.png')), () => {})
    expect(result.warnings).toEqual([])
  })
})
