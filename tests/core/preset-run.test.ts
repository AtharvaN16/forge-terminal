import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { passesFor } from '../../src/core/preset.js'
import { runPreset } from '../../src/core/preset-run.js'
import type { ImageInfo } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

/** A 200 × 120 picture on a 20-pixel white border: something to trim, something to crop. */
async function framed(dir: string): Promise<string> {
  const path = join(dir, 'framed.png')
  const inner = await sharp({
    create: { width: 160, height: 80, channels: 3, background: '#2a6fd0' },
  })
    .png()
    .toBuffer()
  await sharp({ create: { width: 200, height: 120, channels: 3, background: '#ffffff' } })
    .composite([{ input: inner, left: 20, top: 20 }])
    .png()
    .toFile(path)
  return path
}

const image = async (path: string) => (await probe(path)) as ImageInfo

const fake = fakeExtensions()
afterEach(() => fake.restore())

describe('runPreset', () => {
  it('writes the file a plain preset makes', async () => {
    const dir = await makeTempDir()
    const source = await image(await framed(dir))
    const output = join(dir, 'out.webp')
    const outcome = await runPreset(
      source,
      passesFor({ to: 'webp', quality: 80, resize: { width: 100 } }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    const meta = await sharp(output).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 100, 60])
  })

  it('trims, then crops, in two passes, and leaves nothing behind but the file', async () => {
    const dir = await makeTempDir()
    const source = await image(await framed(dir))
    const output = join(dir, 'out.png')
    const outcome = await runPreset(
      source,
      passesFor({ trim: true, crop: { w: 1, h: 1 } }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    const meta = await sharp(output).metadata()
    // Trimmed to 160 × 80, then the largest square in that.
    expect([meta.width, meta.height]).toEqual([80, 80])
    expect((await readdir(dir)).sort()).toEqual(['framed.png', 'out.png'])
  })

  it('reaches a target size after a resize', async () => {
    const dir = await makeTempDir()
    const source = await image(await makeGradientPng(dir, 'g.png', 600))
    const output = join(dir, 'out.webp')
    const outcome = await runPreset(
      source,
      passesFor({ to: 'webp', maxBytes: 6_000, resize: { width: 300 } }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(300)
    expect((await stat(output)).size).toBeLessThanOrEqual(6_000)
  })

  it('runs an on-device model between the cut and the encode', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const source = await image(await framed(dir))
    const output = join(dir, 'out.png')
    const outcome = await runPreset(
      source,
      passesFor({ trim: true, boost: 2, resize: { width: 100 } }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height]).toEqual([100, 50])
  })

  it('says which pass failed and writes nothing', async () => {
    const home = await fake.home() // no extension installed: Sharpen cannot run
    expect(home).toBeTruthy()
    const dir = await makeTempDir()
    const source = await image(await framed(dir))
    const output = join(dir, 'out.png')
    const outcome = await runPreset(
      source,
      passesFor({ trim: true, sharpen: true }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.pass).toEqual({ kind: 'boost', scale: 1 })
    expect((await readdir(dir)).sort()).toEqual(['framed.png'])
  })
})
