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

/** A photo-like PNG: soft noise, which a palette cuts far smaller than lossless PNG keeps it. */
async function photo(dir: string): Promise<string> {
  const [w, h] = [400, 300]
  const pixels = Buffer.alloc(w * h * 3)
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = (Math.sin(i / 97) * 60 + 128 + ((i * 7919) % 50)) | 0
  const path = join(dir, 'photo.png')
  await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .blur(1)
    .png()
    .toFile(path)
  return path
}

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

  it('says each pass as it starts, so a run can show which step it is on', async () => {
    const dir = await makeTempDir()
    const source = await image(await framed(dir))
    const started: number[] = []
    const outcome = await runPreset(
      source,
      passesFor({ trim: true, crop: { w: 1, h: 1 } }, 'png'),
      join(dir, 'out.png'),
      { force: false, onPass: (i) => started.push(i) },
    )
    expect(outcome.kind).toBe('done')
    expect(started).toEqual([0, 1])
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

  it('compresses a PNG to a target size, cutting it to a palette as /compress does', async () => {
    const dir = await makeTempDir()
    const source = await image(await photo(dir))
    const output = join(dir, 'out.png')
    const aim = Math.floor(source.bytes / 2)
    const outcome = await runPreset(source, passesFor({ maxBytes: aim }, 'png'), output, {
      force: false,
    })
    expect(outcome.kind).toBe('done')
    expect((await sharp(output).metadata()).format).toBe('png')
    expect((await stat(output)).size).toBeLessThanOrEqual(aim)
  })

  it('keeps a compress by quality: a PNG is cut to a palette, not written lossless again', async () => {
    const dir = await makeTempDir()
    const source = await image(await photo(dir))
    const output = join(dir, 'out.png')
    const outcome = await runPreset(
      source,
      passesFor({ quality: 60, compress: { dither: false } }, 'png'),
      output,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    expect((await stat(output)).size).toBeLessThan(source.bytes * 0.6)
  })

  it('never raises the quality asked for to fill a target size', async () => {
    const dir = await makeTempDir()
    const source = await image(await photo(dir))
    const plain = join(dir, 'plain.jpg')
    await runPreset(source, passesFor({ to: 'jpeg', quality: 50 }, 'png'), plain, { force: false })
    const sized = join(dir, 'sized.jpg')
    const outcome = await runPreset(
      source,
      passesFor({ to: 'jpeg', quality: 50, maxBytes: source.bytes }, 'png'),
      sized,
      { force: false },
    )
    expect(outcome.kind).toBe('done')
    expect((await stat(sized)).size).toBeLessThanOrEqual((await stat(plain)).size)
  })
})
