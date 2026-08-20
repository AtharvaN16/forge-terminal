// tests/engines/probe.test.ts
import { chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeAnimatedGif,
  makeAvif,
  makeCorruptFile,
  makeHeic,
  makeJpeg,
  makeTempDir,
  makeTransparentPng,
} from '../helpers/fixtures.js'

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('probe', () => {
  it('reads dimensions, size and alpha', async () => {
    const dir = await makeTempDir()
    const info = await probe(await makeTransparentPng(dir, 'a.png'))
    if (info.kind !== 'image') throw new Error('expected an image source')
    expect(info.format).toBe('png')
    expect(info.width).toBe(32)
    expect(info.height).toBe(32)
    expect(info.hasAlpha).toBe(true)
    expect(info.bytes).toBeGreaterThan(0)
  })

  it('defaults frames to 1 for a still and counts them for an animation', async () => {
    const dir = await makeTempDir()
    const still = await probe(await makeJpeg(dir, 'a.jpg'))
    const animated = await probe(await makeAnimatedGif(dir, 'a.gif', 3))
    if (still.kind !== 'image' || animated.kind !== 'image') {
      throw new Error('expected image sources')
    }
    expect(still.frames).toBe(1)
    expect(animated.frames).toBe(3)
  })

  it('identifies by content, not by extension', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'real.png')
    const lying = join(dir, 'lying.jpg')
    await rename(png, lying)
    expect((await probe(lying)).format).toBe('png')
  })

  it('separates avif from heic, which sharp reports identically as heif', async (ctx) => {
    const dir = await makeTempDir()
    expect((await probe(await makeAvif(dir, 'a.avif'))).format).toBe('avif')
    const heic = await makeHeic(dir, 'a.heic')
    if (!heic) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated on this platform')
      return
    }
    expect((await probe(heic)).format).toBe('heic')
  })

  it('reports a missing file as file-not-found', async () => {
    expect(await codeOf(() => probe('/definitely/not/here.jpg'))).toBe('file-not-found')
  })

  it('reports a directory as not-a-file', async () => {
    const dir = await makeTempDir()
    expect(await codeOf(() => probe(dir))).toBe('not-a-file')
  })

  it('reports a corrupt file as corrupt-source', async () => {
    const dir = await makeTempDir()
    const bad = await makeCorruptFile(dir, 'bad.jpg')
    expect(await codeOf(() => probe(bad))).toBe('corrupt-source')
  })

  it('distinguishes unreadable from corrupt, which sharp alone cannot', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'locked.png')
    await chmod(png, 0o000)
    const code = await codeOf(() => probe(png))
    await chmod(png, 0o644)
    expect(code).toBe('permission-denied')
  })

  /**
   * The interactive shell calls `probe` directly on whatever a user types or
   * pastes — unlike the CLI's `resolveInputs`, which only ever hands `probe`
   * a path it has already `stat`ed successfully. A path that runs *through*
   * a file (a plausible typo: an extra `/something` tacked onto a real
   * filename) makes `stat` fail with ENOTDIR, not ENOENT. Before this was
   * mapped, that errno fell through to a raw, unrecognised `Error`, which
   * `codeOf` reports as `unexpected:...` rather than a real error code —
   * this asserts the *type* survives (a `ForgeError`), not any particular
   * wording of the message.
   */
  it('reports a path that runs through a file as not-a-directory, not a raw error', async () => {
    const dir = await makeTempDir()
    const real = await makeJpeg(dir, 'real.jpg')
    expect(await codeOf(() => probe(join(real, 'nope.jpg')))).toBe('not-a-directory')
  })
})
