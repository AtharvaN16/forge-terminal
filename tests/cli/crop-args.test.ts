import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { type ForgeError, isForgeError } from '../../src/core/errors.js'
import { makeTempDir } from '../helpers/fixtures.js'

function refusalOf(argv: string[]): ForgeError | undefined {
  try {
    parseArgs(argv)
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  return undefined
}

async function photo(dir: string, name: string, width: number, height: number): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .jpeg()
    .toFile(path)
  return path
}

describe('--crop', () => {
  it.each([
    [['photo.jpg', '--crop', '16:9'], { crop: { aspect: { w: 16, h: 9 } } }],
    [
      ['photo.jpg', '--crop', '4:5', '--width', '1080', '--to', 'webp'],
      { crop: { aspect: { w: 4, h: 5 } }, resize: { width: 1080 }, target: 'webp' },
    ],
  ])('%j becomes an edit intent with no box', (argv, expected) => {
    const intent = parseArgs(argv)
    expect(intent).toMatchObject({ kind: 'edit', inputs: ['photo.jpg'], trim: false, ...expected })
    // The engine places the box by attention: the CLI never gives one.
    expect(intent).not.toHaveProperty('crop.box')
    if (!argv.includes('--to')) expect(intent).not.toHaveProperty('target')
  })

  it.each([['0:1'], ['16x9'], ['101:1'], ['1.5:1'], ['square']])(
    'refuses the shape %s',
    (shape) => {
      const e = refusalOf(['photo.jpg', '--crop', shape])
      expect(e?.code).toBe('invalid-arguments')
      expect(e?.hint).toContain('--crop 1:1')
    },
  )

  it('refuses --trim beside it: two cuts whose order would surprise', () => {
    const e = refusalOf(['photo.jpg', '--crop', '1:1', '--trim'])
    expect(e?.code).toBe('invalid-arguments')
    expect(e?.detail).toContain('--crop cannot be combined with --trim')
    expect(e?.hint).toContain('one after the other')
  })

  it.each([
    ['--max-size', ['a.jpg', '--crop', '1:1', '--max-size', '500kb']],
    ['--sharpen', ['a.jpg', '--crop', '1:1', '--sharpen']],
    ['--boost', ['a.jpg', '--crop', '1:1', '--boost']],
    ['--remove-bg', ['a.jpg', '--crop', '1:1', '--remove-bg']],
    ['--merge', ['a.pdf', 'b.pdf', '--crop', '1:1', '--merge']],
    ['--pages', ['a.pdf', '--crop', '1:1', '--to', 'png', '--pages', '1']],
    ['no files', ['--crop', '1:1']],
  ])('refuses %s', (_name, argv) => {
    expect(refusalOf(argv)?.code).toBe('invalid-arguments')
  })

  it('cuts the largest box, keeps the format and names the shape', async () => {
    const dir = await makeTempDir()
    const src = await photo(dir, 'photo.jpg', 400, 300)

    const out = await execute(parseArgs([src, '--crop', '1:1']))

    expect(out.exitCode).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['photo-cropped-1x1.jpg', 'photo.jpg'])
    const meta = await sharp(join(dir, 'photo-cropped-1x1.jpg')).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 300, 300])
  })

  it('resizes the cropped image and names its size', async () => {
    const dir = await makeTempDir()
    const src = await photo(dir, 'photo.jpg', 400, 300)

    const out = await execute(parseArgs([src, '--crop', '16:9', '--width', '160', '--to', 'png']))

    expect(out.exitCode).toBe(0)
    const name = 'photo-cropped-16x9-160x90.png'
    expect((await readdir(dir)).sort()).toEqual([name, 'photo.jpg'])
    const meta = await sharp(join(dir, name)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 160, 90])
  })

  it('refuses a photo that already has the shape, writing nothing', async () => {
    const dir = await makeTempDir()
    const src = await photo(dir, 'square.jpg', 200, 200)

    const out = await execute(parseArgs([src, '--crop', '1:1']), { json: true })

    expect(out.exitCode).not.toBe(0)
    expect(out.stdout.join('\n')).toContain('nothing-to-crop')
    expect(await readdir(dir)).toEqual(['square.jpg'])
  })

  it('with a resize too, only warns and resizes', async () => {
    const dir = await makeTempDir()
    const src = await photo(dir, 'square.jpg', 200, 200)

    const out = await execute(parseArgs([src, '--crop', '1:1', '--width', '100']), { json: true })

    expect(out.exitCode).toBe(0)
    const doc = JSON.parse(out.stdout.join('\n'))
    expect(doc.results[0].warnings.map((w: { code: string }) => w.code)).toEqual([
      'nothing-cropped',
    ])
    const [written] = doc.results[0].outputs
    const meta = await sharp(written).metadata()
    expect([meta.width, meta.height]).toEqual([100, 100])
  })

  it('refuses a --to only another engine writes, before writing anything', async () => {
    const dir = await makeTempDir()
    const src = await photo(dir, 'photo.jpg', 40, 30)
    const out = await execute(parseArgs([src, '--crop', '1:1', '--to', 'pdf']))
    expect(out.exitCode).toBe(2)
    expect(out.stderr.join('\n')).toContain('Cannot crop into')
    expect(await readdir(dir)).toEqual(['photo.jpg'])
  })
})
