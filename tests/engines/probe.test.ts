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
    expect(info.format).toBe('png')
    expect(info.width).toBe(32)
    expect(info.height).toBe(32)
    expect(info.hasAlpha).toBe(true)
    expect(info.bytes).toBeGreaterThan(0)
  })

  it('defaults frames to 1 for a still and counts them for an animation', async () => {
    const dir = await makeTempDir()
    expect((await probe(await makeJpeg(dir, 'a.jpg'))).frames).toBe(1)
    expect((await probe(await makeAnimatedGif(dir, 'a.gif', 3))).frames).toBe(3)
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
})
