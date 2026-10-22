import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planFolderFile } from '../../src/core/batch.js'
import { defaultAnswer, kindTargets, scanFolder, sniffKind } from '../../src/core/folder.js'
import type { SourceInfo } from '../../src/core/types.js'
import { makeCorruptFile, makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

const names = (paths: { path: string }[]) => paths.map((s) => basename(s.path)).sort()

/** The first bytes of an MP4: a box size, then `ftyp` and an ordinary video brand. */
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])

describe('scanFolder', () => {
  it('reads every file by content and groups them by kind', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'b.png')
    await makePdf(dir, 'c.pdf', 2)
    const scan = await scanFolder(dir)
    expect(names(scan.sources)).toEqual(['a.jpg', 'b.png', 'c.pdf'])
    expect(scan.kinds.map((k) => [k.id, k.count])).toEqual([
      ['images', 2],
      ['pdfs', 1],
    ])
  })

  it('finds an image by its content whatever its name says', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'photo.txt')
    const scan = await scanFolder(dir)
    expect(scan.kinds.map((k) => k.id)).toEqual(['images'])
  })

  it('skips hidden files, unfinished downloads and subfolders', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makePng(dir, '.hidden.png')
    await makePng(dir, 'b.png.crdownload')
    await makePng(dir, 'c.png.part')
    await makePng(dir, 'd.png.download')
    await mkdir(join(dir, 'sub'))
    await makePng(join(dir, 'sub'), 'deep.png')
    const scan = await scanFolder(dir)
    expect(names(scan.sources)).toEqual(['a.png'])
  })

  it('counts what Forge cannot convert as its own kind, with why', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await writeFile(join(dir, 'clip.mp4'), MP4)
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const scan = await scanFolder(dir)
    expect(scan.kinds.map((k) => [k.id, k.count, k.why])).toEqual([
      ['images', 1, undefined],
      ['videos', 1, 'not yet supported'],
      ['other', 1, 'a text file'],
    ])
  })

  it('reports a file that looks like an image but is damaged as a failure', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeCorruptFile(dir, 'broken.png')
    const scan = await scanFolder(dir)
    expect(names(scan.sources)).toEqual(['a.png'])
    expect(names(scan.failures)).toEqual(['broken.png'])
  })

  it('lists the kinds Forge converts first, the largest first', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'a.pdf', 1)
    await makePdf(dir, 'b.pdf', 1)
    await makePng(dir, 'c.png')
    await writeFile(join(dir, 'one.mp4'), MP4)
    await writeFile(join(dir, 'two.mp4'), MP4)
    await writeFile(join(dir, 'three.mp4'), MP4)
    const scan = await scanFolder(dir)
    expect(scan.kinds.map((k) => k.id)).toEqual(['pdfs', 'images', 'videos'])
  })

  it('lists every file it looked at, whatever became of it', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeCorruptFile(dir, 'broken.png')
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    await makePng(dir, '.hidden.png')
    const scan = await scanFolder(dir)
    expect(scan.paths.map((p) => basename(p)).sort()).toEqual(['a.png', 'broken.png', 'notes.txt'])
  })

  it('totals the bytes of everything in it', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    const scan = await scanFolder(dir)
    expect(scan.bytes).toBe((scan.sources[0]?.bytes ?? 0) + 6)
  })
})

describe('sniffKind', () => {
  it('tells a video, a text file and anything else apart', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'a'), MP4)
    await writeFile(join(dir, 'b'), 'plain words\n')
    await writeFile(join(dir, 'c'), Buffer.from([0, 1, 2, 3, 0, 0, 255, 254]))
    expect(await sniffKind(join(dir, 'a'))).toBe('video')
    expect(await sniffKind(join(dir, 'b'))).toBe('text')
    expect(await sniffKind(join(dir, 'c'))).toBe('other')
  })
})

describe('kindTargets', () => {
  it('offers every format any of the kind can become, in the formats’ order', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'b.png')
    const images = (await scanFolder(dir)).kinds[0]
    const targets = kindTargets(images?.sources ?? [])
    // A JPEG can become PNG and a PNG can become JPEG: both are offered.
    expect(targets).toContain('jpeg')
    expect(targets).toContain('png')
    expect(targets).toContain('webp')
    expect(targets.indexOf('jpeg')).toBeLessThan(targets.indexOf('webp'))
  })
})

describe('defaultAnswer', () => {
  it('is WebP at the remembered quality for images', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    const [images] = (await scanFolder(dir)).kinds
    expect(defaultAnswer(images?.sources ?? [], 80)).toEqual({ target: 'webp', quality: 80 })
  })

  it('is PNG at 150 dpi for PDFs', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'a.pdf', 1)
    const [pdfs] = (await scanFolder(dir)).kinds
    expect(defaultAnswer(pdfs?.sources ?? [], 80)).toEqual({ target: 'png', dpi: 150 })
  })
})

describe('planFolderFile', () => {
  const only = async (dir: string): Promise<SourceInfo> => {
    const [source] = (await scanFolder(dir)).sources
    if (!source) throw new Error('nothing scanned')
    return source
  }

  it('converts a file beside itself', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'hero.png')
    const planned = planFolderFile(await only(dir), { target: 'webp', quality: 80 }, new Set())
    expect('job' in planned && planned.job.outputs).toEqual([join(dir, 'hero.webp')])
    expect('job' in planned && planned.job.op === 'convert' && planned.job.options.quality).toBe(80)
  })

  it('writes into another folder when given one', async () => {
    const dir = await makeTempDir()
    const out = join(dir, 'out')
    await makePng(dir, 'hero.png')
    const planned = planFolderFile(await only(dir), { target: 'webp' }, new Set(), out)
    expect('job' in planned && planned.job.outputs).toEqual([join(out, 'hero.webp')])
  })

  it('leaves a file already in the format alone', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'hero.png')
    expect(planFolderFile(await only(dir), { target: 'png' }, new Set())).toEqual({
      left: 'already PNG',
    })
  })

  it('leaves a file alone when its output is already there', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'hero.png')
    const source = await only(dir)
    await writeFile(join(dir, 'hero.webp'), 'converted last time')
    expect(planFolderFile(source, { target: 'webp' }, new Set())).toEqual({
      left: 'already converted',
    })
  })

  it('keeps both when two files in one run would take the same name', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'hero.png')
    await makeJpeg(dir, 'hero.jpg')
    const claimed = new Set<string>()
    const outputs = (await scanFolder(dir)).sources.map((s) => {
      const planned = planFolderFile(s, { target: 'webp' }, claimed)
      return 'job' in planned ? basename(planned.job.outputs[0] ?? '') : planned.left
    })
    expect(outputs.sort()).toEqual(['hero (1).webp', 'hero.webp'])
  })

  it('renders every page of a PDF at the chosen resolution', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'deck.pdf', 2)
    const planned = planFolderFile(await only(dir), { target: 'png', dpi: 300 }, new Set())
    expect('job' in planned && planned.job.outputs.map((o) => basename(o))).toEqual([
      'deck-1.png',
      'deck-2.png',
    ])
    expect('job' in planned && planned.job.op === 'convert' && planned.job.options.dpi).toBe(300)
  })
})
