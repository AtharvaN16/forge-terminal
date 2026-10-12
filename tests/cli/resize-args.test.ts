import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { isForgeError } from '../../src/core/errors.js'
import { makeTempDir } from '../helpers/fixtures.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('--trim, --resize, --width, --height', () => {
  it.each([
    [['photo.jpg', '--resize', '50%'], { trim: false, resize: { percent: 50 } }],
    [['photo.jpg', '--resize', '150'], { trim: false, resize: { percent: 150 } }],
    [['photo.jpg', '--width', '1200'], { trim: false, resize: { width: 1200 } }],
    [['photo.jpg', '--height', '900'], { trim: false, resize: { height: 900 } }],
    [['photo.jpg', '--trim'], { trim: true }],
    [
      ['photo.jpg', '--trim', '--width', '1200', '--to', 'webp', '-q', '80'],
      { trim: true, resize: { width: 1200 }, target: 'webp', options: { quality: 80 } },
    ],
  ])('%j becomes an edit intent', (argv, expected) => {
    const intent = parseArgs(argv)
    expect(intent).toMatchObject({ kind: 'edit', inputs: ['photo.jpg'], ...expected })
    // No --to: the format is kept, so no target is asked for.
    if (!argv.includes('--to')) expect(intent).not.toHaveProperty('target')
  })

  it.each([
    ['two of --resize, --width, --height', ['a.jpg', '--resize', '50%', '--width', '100']],
    ['--max-size', ['a.jpg', '--trim', '--max-size', '500kb']],
    ['--sharpen', ['a.jpg', '--resize', '50%', '--sharpen']],
    ['--merge', ['a.pdf', 'b.pdf', '--trim', '--merge']],
    ['--resize 0', ['a.jpg', '--resize', '0']],
    ['--resize 201', ['a.jpg', '--resize', '201']],
    ['--resize abc', ['a.jpg', '--resize', 'abc']],
    ['--width 0', ['a.jpg', '--width', '0']],
    ['--height 1.5', ['a.jpg', '--height', '1.5']],
    ['no files', ['--trim']],
  ])('refuses %s', (_name, argv) => {
    expect(codeOf(argv)).toBe('invalid-arguments')
  })

  it('--width keeps the format and names the result by its size', async () => {
    const dir = await makeTempDir()
    const src = join(dir, 'photo.jpg')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } })
      .jpeg()
      .toFile(src)

    const out = await execute(parseArgs([src, '--width', '100']))

    expect(out.exitCode).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['photo-100x75.jpg', 'photo.jpg'])
    const meta = await sharp(join(dir, 'photo-100x75.jpg')).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 100, 75])
  })

  it('refuses a --to only another engine writes, before writing anything', async () => {
    const dir = await makeTempDir()
    const src = join(dir, 'photo.png')
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } })
      .png()
      .toFile(src)
    for (const flags of [['--trim'], ['--width', '20']]) {
      const out = await execute(parseArgs([src, ...flags, '--to', 'pdf']))
      expect(out.exitCode).toBe(2)
      expect(out.stderr.join('\n')).toContain('only an image format')
    }
    expect(await readdir(dir)).toEqual(['photo.png'])
  })
})
