import { existsSync } from 'node:fs'
import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import {
  clearDecodedCacheForTests,
  decodedInput,
  idleDecodedCacheForTests,
  limitDecodedCacheForTests,
} from '../../src/engines/decoded.js'
import { encodeToBuffer, loadCropView, measureImage } from '../../src/engines/image.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * A HEIC or RAW is decoded by sips (or an extension) to a temporary PNG. The
 * same photo used to be decoded again for every step that looked at it —
 * measuring, the crop preview, the size search, the run, the close-up — so
 * the decoded bytes are kept, a few at a time, and never served for a file
 * that has changed since.
 *
 * The decoders are stand-ins: each writes a PNG-ish file named after the
 * source's contents and counts itself.
 */
const decodes = vi.hoisted(() => ({
  heic: 0,
  raw: 0,
  fail: false,
  real: false,
  size: 16,
  temps: [] as string[],
}))
async function fakeDecode(source: string, kind: 'heic' | 'raw') {
  const { readFile, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  decodes[kind]++
  await new Promise((r) => setTimeout(r, 5))
  if (decodes.fail) throw new Error('decoder failed')
  const path = `${tmpdir()}/forge-test-decoded-${kind}-${decodes[kind]}-${process.pid}.png`
  if (decodes.real) {
    const sharp = (await import('sharp')).default
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366cc' } })
      .png()
      .toFile(path)
  } else {
    const body = await readFile(source)
    await writeFile(path, Buffer.concat([body, Buffer.alloc(decodes.size)]))
  }
  decodes.temps.push(path)
  return { path, cleanup: () => rm(path, { force: true }) }
}
vi.mock('../../src/engines/heic.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engines/heic.js')>()),
  heicDecodable: async () => true,
  decodeHeic: (source: string) => fakeDecode(source, 'heic'),
}))
vi.mock('../../src/engines/raw.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engines/raw.js')>()),
  decodeRaw: (source: string) => fakeDecode(source, 'raw'),
}))

afterEach(() => {
  clearDecodedCacheForTests()
  limitDecodedCacheForTests(undefined)
  idleDecodedCacheForTests(undefined)
  decodes.heic = 0
  decodes.raw = 0
  decodes.fail = false
  decodes.real = false
  decodes.size = 16
  decodes.temps = []
})

async function photo(dir: string, name: string, body = name): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, body)
  return path
}

describe('decodedInput', () => {
  it('hands Sharp the file itself for a format it reads, decoding nothing', async () => {
    const path = await photo(await makeTempDir(), 'a.jpg')
    expect(await decodedInput(path, 'jpeg')).toBe(path)
    expect(decodes.heic + decodes.raw).toBe(0)
  })

  it('decodes a HEIC once for every step that asks, and leaves no temporary file', async () => {
    const path = await photo(await makeTempDir(), 'a.heic')
    const first = await decodedInput(path, 'heic')
    const second = await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(1)
    expect(Buffer.isBuffer(first)).toBe(true)
    expect(second).toEqual(first)
    expect(decodes.temps.some((t) => existsSync(t))).toBe(false)
  })

  it('lets go of what it kept once nothing has asked for a while', async () => {
    idleDecodedCacheForTests(20)
    const path = await photo(await makeTempDir(), 'a.heic')
    await decodedInput(path, 'heic')
    await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(1)
    await new Promise((r) => setTimeout(r, 80))
    await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(2)
  })

  it('shares one decode between steps that ask at the same time', async () => {
    const path = await photo(await makeTempDir(), 'a.dng')
    await Promise.all([decodedInput(path, 'raw'), decodedInput(path, 'raw')])
    expect(decodes.raw).toBe(1)
  })

  it('decodes again once the file has changed', async () => {
    const dir = await makeTempDir()
    const path = await photo(dir, 'a.heic', 'before')
    const before = await decodedInput(path, 'heic')
    await writeFile(path, 'after, longer')
    const after = await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(2)
    expect(after).not.toEqual(before)
  })

  it('decodes again when only the modified time moved', async () => {
    const path = await photo(await makeTempDir(), 'a.heic')
    await decodedInput(path, 'heic')
    const later = new Date(Date.now() + 60_000)
    await utimes(path, later, later)
    await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(2)
  })

  it('does not keep a failure: the next ask decodes again', async () => {
    const path = await photo(await makeTempDir(), 'a.heic')
    decodes.fail = true
    await expect(decodedInput(path, 'heic')).rejects.toThrow('decoder failed')
    decodes.fail = false
    await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(2)
  })

  it('keeps only a few photos, dropping the least recently used', async () => {
    const dir = await makeTempDir()
    const paths = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => photo(dir, `${n}.heic`)))
    for (const p of paths) await decodedInput(p, 'heic')
    expect(decodes.heic).toBe(5)
    // The newest are still there; the oldest went to make room.
    await decodedInput(paths[4] as string, 'heic')
    expect(decodes.heic).toBe(5)
    await decodedInput(paths[0] as string, 'heic')
    expect(decodes.heic).toBe(6)
  })

  it('never keeps more than its byte limit', async () => {
    const dir = await makeTempDir()
    const a = await photo(dir, 'a.heic')
    const b = await photo(dir, 'b.heic')
    // Each decode a little over half the limit: two cannot both be kept.
    limitDecodedCacheForTests(1000)
    decodes.size = 501
    await decodedInput(a, 'heic')
    await decodedInput(b, 'heic')
    await decodedInput(b, 'heic')
    expect(decodes.heic).toBe(2)
    await decodedInput(a, 'heic')
    expect(decodes.heic).toBe(3)
  })

  it('keeps no decode bigger than the whole limit', async () => {
    const path = await photo(await makeTempDir(), 'a.heic')
    limitDecodedCacheForTests(1000)
    decodes.size = 1001
    await decodedInput(path, 'heic')
    await decodedInput(path, 'heic')
    expect(decodes.heic).toBe(2)
  })

  it('one HEIC measured, previewed and encoded is decoded once', async () => {
    const path = await photo(await makeTempDir(), 'a.heic')
    decodes.real = true
    const source: ImageInfo = {
      kind: 'image',
      path,
      format: 'heic',
      bytes: 1,
      width: 8,
      height: 8,
      hasAlpha: false,
      frames: 1,
    }
    await measureImage(source)
    await loadCropView(source)
    await encodeToBuffer(source, 'jpeg', { background: '#ffffff', keepMetadata: false })
    expect(decodes.heic).toBe(1)
  })
})
