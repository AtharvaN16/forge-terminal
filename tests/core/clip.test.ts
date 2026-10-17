import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lastOriginal, putBack, saveCopy, takeImage, undoClip } from '../../src/core/clip.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'
import { memoryPasteboard } from '../helpers/pasteboard.js'

/** A run that must have read an image. */
async function take(pb: Parameters<typeof takeImage>[0], root: string) {
  const taken = await takeImage(pb, root)
  if (!taken) throw new Error('no image was read')
  return taken
}

async function holding(path: string | null) {
  const clip = memoryPasteboard()
  if (path) await clip.copyImage(path)
  return clip
}

describe('takeImage', () => {
  it('stages the copied image as a file and keeps the original aside', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const { pb } = await holding(png)

    const taken = await takeImage(pb, root)

    expect(taken).not.toBeNull()
    expect(basename(taken?.source as string)).toBe('Copied image')
    expect(await readFile(taken?.source as string)).toEqual(await readFile(png))
    expect(await readFile((await lastOriginal(root))?.path as string)).toEqual(await readFile(png))
  })

  it('gives null when there is no image, and keeps the last original', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const first = await holding(png)
    await takeImage(first.pb, root)

    expect(await takeImage((await holding(null)).pb, root)).toBeNull()
    expect(await lastOriginal(root)).not.toBeNull()
  })

  it('names each result folder apart, so two runs never share a path', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const a = await takeImage((await holding(png)).pb, root)
    const b = await takeImage((await holding(png)).pb, root)
    expect(a?.outDir).not.toBe(b?.outDir)
    expect(dirname(a?.source as string)).not.toBe(a?.outDir)
  })
})

describe('putBack', () => {
  it('puts the result on the clipboard when nothing else was copied', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const clip = await holding(png)
    const taken = await take(clip.pb, root)
    const result = join(taken.outDir, 'Copied image.jpg')
    await copyFile(await makeJpeg(await makeTempDir(), 'r.jpg'), result)

    expect(await putBack(clip.pb, taken, result, 'jpeg')).toBe('placed')
    const held = clip.held()
    expect(held?.kind === 'image' && held.format).toBe('jpeg')
  })

  it('leaves a newer copy alone', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const clip = await holding(png)
    const taken = await take(clip.pb, root)
    clip.copyText()

    expect(await putBack(clip.pb, taken, taken.source, 'png')).toBe('changed')
    expect(clip.held()?.kind).toBe('text')
  })
})

describe('undoClip', () => {
  it('puts the original back, even from a later process', async () => {
    const root = await makeTempDir()
    const png = await makePng(await makeTempDir(), 'shot.png')
    const clip = await holding(png)
    const taken = await take(clip.pb, root)
    const result = join(taken.outDir, 'Copied image.jpg')
    await copyFile(await makeJpeg(await makeTempDir(), 'r.jpg'), result)
    await putBack(clip.pb, taken, result, 'jpeg')

    expect(await undoClip(clip.pb, root)).toBe(true)
    const held = clip.held()
    expect(held?.kind === 'image' && held.format).toBe('png')
    expect(held?.kind === 'image' && held.bytes).toEqual(await readFile(png))
  })

  it('says so when there is nothing to put back', async () => {
    expect(await undoClip((await holding(null)).pb, await makeTempDir())).toBe(false)
  })
})

describe('saveCopy', () => {
  it('copies the result into the folder without replacing a file there', async () => {
    const folder = await makeTempDir()
    const result = await makePng(await makeTempDir(), 'Copied image.png')
    await writeFile(join(folder, 'Copied image.png'), 'already here')

    const saved = await saveCopy(result, folder)

    expect(saved).toBe(join(folder, 'Copied image (1).png'))
    expect(await readFile(saved)).toEqual(await readFile(result))
    expect(await readFile(join(folder, 'Copied image.png'), 'utf8')).toBe('already here')
  })
})
