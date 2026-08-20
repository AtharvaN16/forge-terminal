import { readdir } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { encodeToBuffer } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

const opts = { background: '#ffffff', keepMetadata: false }

describe('encodeToBuffer', () => {
  it('returns bytes without writing a file', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const source = await probe(jpg)

    const buffer = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 50 })
    expect(buffer.length).toBeGreaterThan(0)

    // The search calls this once per attempt; a temp file each time would be
    // wasted I/O, and litter if an attempt threw.
    expect(await readdir(dir)).toEqual(['photo.jpg'])
  })

  it('a lower quality yields fewer bytes — the assumption the search rests on', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const source = await probe(jpg)

    const low = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 20 })
    const high = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 95 })
    expect(low.length).toBeLessThan(high.length)
  })

  it('flattens alpha for a target that cannot carry it', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'clear.png')
    const source = await probe(png)

    const buffer = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 80 })
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.hasAlpha).toBeFalsy()
  })

  it('produces the same bytes the writing path would', async () => {
    // Both go through one pipeline, so this pins that they cannot drift —
    // the invariants live in the shared part, not in either caller.
    const { join } = await import('node:path')
    const { stat } = await import('node:fs/promises')
    const { imageEngine } = await import('../../src/engines/image.js')

    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const source = await probe(jpg)
    const output = join(dir, 'out.webp')

    await imageEngine.convert(
      { source, target: 'webp', output, options: { ...opts, quality: 70 } },
      () => {},
    )
    const written = (await stat(output)).size
    const buffered = await encodeToBuffer(source, 'webp', { ...opts, quality: 70 })
    expect(buffered.length).toBe(written)
  })
})
