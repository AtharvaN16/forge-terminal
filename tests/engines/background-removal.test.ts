import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Job } from '../../src/core/types.js'
import { createImageEngine, type RemovedBackground } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeOrientedJpeg, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

describe('image background removal', () => {
  it('auto-orients before inference and writes the returned matte as alpha', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'portrait.jpg')
    const source = await probe(input)
    const output = join(dir, 'portrait-no-bg.png')
    let modelInput: { width: number; height: number } | undefined

    const engine = createImageEngine({
      removeBackground: async (image): Promise<RemovedBackground> => {
        const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({
          resolveWithObject: true,
        })
        modelInput = { width: info.width, height: info.height }
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            data[(y * info.width + x) * 4 + 3] = x < info.width / 2 ? 0 : 255
          }
        }
        return { data, width: info.width, height: info.height, channels: 4 }
      },
    })

    const job: Job = {
      op: 'remove-background',
      sources: [
        source.kind === 'image'
          ? source
          : (() => {
              throw new Error('expected image')
            })(),
      ],
      outputs: [output],
      target: 'png',
      options: { keepMetadata: false },
    }
    const phases: string[] = []
    await engine.run(job, (progress) => phases.push(progress.phase))

    expect(modelInput).toEqual({ width: 80, height: 40 })
    expect(phases).toEqual(['reading', 'decoding', 'processing', 'encoding', 'writing'])

    const { data, info } = await sharp(output)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info).toMatchObject({ width: 80, height: 40, channels: 4 })
    expect(data[3]).toBe(0)
    expect(data[(info.width - 1) * 4 + 3]).toBe(255)
  })

  it('leaves no output or temp file when inference fails', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'portrait.jpg')
    const source = await probe(input)
    if (source.kind !== 'image') throw new Error('expected image')

    const engine = createImageEngine({
      removeBackground: async () => {
        throw new Error('model failed')
      },
    })
    const output = join(dir, 'portrait-no-bg.png')
    const job: Job = {
      op: 'remove-background',
      sources: [source],
      outputs: [output],
      target: 'png',
      options: { keepMetadata: false },
    }

    await expect(engine.run(job, () => {})).rejects.toMatchObject({
      code: 'background-removal-failed',
    })
    expect(await readdir(dir)).toEqual(['portrait.jpg'])
  })

  it('does not make already-transparent source pixels opaque', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 'transparent.png')
    const source = await probe(input)
    if (source.kind !== 'image') throw new Error('expected image')

    const engine = createImageEngine({
      removeBackground: async (image) => {
        const { data, info } = await sharp(image)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        data.fill(255)
        return { data, width: info.width, height: info.height, channels: 4 }
      },
    })
    const output = join(dir, 'transparent-no-bg.png')
    await engine.run(
      {
        op: 'remove-background',
        sources: [source],
        outputs: [output],
        target: 'png',
        options: { keepMetadata: false },
      },
      () => {},
    )

    const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
  })
})
