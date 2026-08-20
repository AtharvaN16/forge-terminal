import { describe, expect, it, vi } from 'vitest'
import { writableFormats } from '../../src/core/capabilities.js'
import { candidateFor, suggestFormat } from '../../src/core/suggest.js'
import type { ImageInfo, SourceInfo } from '../../src/core/types.js'

const source = (over: Partial<ImageInfo> = {}): SourceInfo => ({
  kind: 'image',
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 100,
  height: 100,
  bytes: 100_000,
  hasAlpha: false,
  frames: 1,
  ...over,
})

describe('candidateFor', () => {
  it('proposes WebP for a JPEG — supported everywhere, and much smaller', () => {
    expect(candidateFor(source({ format: 'jpeg' }))).toBe('webp')
  })

  it('proposes AVIF for a WebP, the only step up left', () => {
    expect(candidateFor(source({ format: 'webp' }))).toBe('avif')
  })

  it('has nothing to suggest when the source is already the strongest', () => {
    expect(candidateFor(source({ format: 'avif' }))).toBeUndefined()
  })

  it('never proposes a format the engine cannot write', () => {
    for (const format of ['jpeg', 'webp', 'avif', 'gif', 'tiff'] as const) {
      const candidate = candidateFor(source({ format }))
      if (candidate) expect(writableFormats()).toContain(candidate)
    }
  })
})

describe('suggestFormat', () => {
  it('offers a candidate that is meaningfully smaller', async () => {
    const encode = vi.fn(async () => 400_000)
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode,
    })
    expect(s?.target).toBe('webp')
    expect(s?.bytes).toBe(400_000)
    expect(s?.saving).toBeCloseTo(0.6, 2)
    // Encoded, not estimated — the number quoted is one that was measured.
    expect(encode).toHaveBeenCalledWith('webp', 70)
  })

  it('stays quiet when the saving is not worth a sentence', async () => {
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode: async () => 900_000, // only 10% better
    })
    expect(s).toBeUndefined()
  })

  it('stays quiet when the candidate is larger', async () => {
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode: async () => 1_200_000,
    })
    expect(s).toBeUndefined()
  })

  it('does not encode at all when there is no candidate', async () => {
    const encode = vi.fn(async () => 1)
    const s = await suggestFormat({
      source: source({ format: 'avif' }),
      resultBytes: 1_000_000,
      quality: 70,
      encode,
    })
    expect(s).toBeUndefined()
    expect(encode).not.toHaveBeenCalled()
  })

  it('says nothing rather than throwing when the candidate will not encode', async () => {
    // A failed extra encode is not a reason to lose a conversion that
    // already succeeded.
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode: async () => {
        throw new Error('encoder said no')
      },
    })
    expect(s).toBeUndefined()
  })
})
