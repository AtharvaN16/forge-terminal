import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  clipboardSupported,
  imageTypeIn,
  macPasteboard,
  type Osascript,
  utiFor,
} from '../../src/utils/pasteboard.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

/** A stand-in for osascript: answers by which script it was given. */
function fakeRunner(answer: (script: string, args: string[]) => string | Promise<string>) {
  const calls: { script: string; args: string[] }[] = []
  const run: Osascript = async (script, args) => {
    calls.push({ script, args })
    return answer(script, args)
  }
  return { run, calls }
}

describe('imageTypeIn', () => {
  it('prefers PNG data over the TIFF copy macOS adds beside it', () => {
    expect(imageTypeIn(['public.tiff', 'public.png'])).toBe('public.png')
  })

  it('takes TIFF when that is all there is, as Preview and Safari copy', () => {
    expect(imageTypeIn(['public.tiff', 'NeXT TIFF v4.0 pasteboard type'])).toBe('public.tiff')
  })

  it('finds nothing in text', () => {
    expect(imageTypeIn(['public.utf8-plain-text', 'NSStringPboardType'])).toBeNull()
  })

  it('takes a picture put on with its file, as Forge puts a result back', () => {
    expect(imageTypeIn(['public.jpeg', 'public.file-url', 'NSFilenamesPboardType'])).toBe(
      'public.jpeg',
    )
  })

  it('ignores the icon Finder puts beside a copied file', () => {
    expect(imageTypeIn(['public.file-url', 'public.tiff', 'public.utf8-plain-text'])).toBeNull()
  })
})

describe('clipboardSupported', () => {
  it('is macOS only for now', () => {
    expect(clipboardSupported('darwin', {})).toBe(true)
    expect(clipboardSupported('linux', {})).toBe(false)
    expect(clipboardSupported('win32', {})).toBe(false)
  })

  it('is off over SSH, where the clipboard belongs to another machine', () => {
    expect(clipboardSupported('darwin', { SSH_CONNECTION: '10.0.0.2 51234 10.0.0.1 22' })).toBe(
      false,
    )
    expect(clipboardSupported('darwin', { SSH_TTY: '/dev/ttys004' })).toBe(false)
  })
})

describe('utiFor', () => {
  it('names each image format the way the pasteboard does', () => {
    expect(utiFor('png')).toBe('public.png')
    expect(utiFor('jpeg')).toBe('public.jpeg')
    expect(utiFor('webp')).toBe('org.webmproject.webp')
  })
})

describe('macPasteboard', () => {
  it('peek reports the change count and the image type held', async () => {
    const { run } = fakeRunner(() =>
      JSON.stringify({ types: ['public.png', 'public.tiff'], count: 41 }),
    )
    expect(await macPasteboard(run).peek()).toEqual({
      changeCount: 41,
      image: 'public.png',
      text: false,
    })
  })

  it('peek says when the clipboard holds text', async () => {
    const { run } = fakeRunner(() =>
      JSON.stringify({ types: ['public.utf8-plain-text', 'NSStringPboardType'], count: 9 }),
    )
    expect(await macPasteboard(run).peek()).toEqual({ changeCount: 9, image: null, text: true })
  })

  it('peek says there is no image when osascript fails', async () => {
    const { run } = fakeRunner(() => {
      throw new Error('osascript: not found')
    })
    expect(await macPasteboard(run).peek()).toEqual({ changeCount: -1, image: null, text: false })
  })

  it('read writes the PNG into the folder, named Copied image', async () => {
    const dir = await makeTempDir()
    const png = await readFile(await makePng(dir, 'held.png'))
    const { run, calls } = fakeRunner(async (_script, args) => {
      if (args.length === 0) return JSON.stringify({ types: ['public.png'], count: 7 })
      await writeFile(args[1] as string, png)
      return JSON.stringify({ ok: true, count: 7 })
    })
    const got = await macPasteboard(run).read(join(dir, 'in'))
    expect(got).toEqual({ path: join(dir, 'in', 'Copied image.png'), changeCount: 7 })
    expect(calls[1]?.args[0]).toBe('public.png')
    expect(await readFile(got?.path as string)).toEqual(png)
  })

  // sips, not sharp, makes the TIFF: sharp's TIFF writer drops the alpha
  // channel, and a TIFF from the macOS clipboard keeps it.
  it.skipIf(process.platform !== 'darwin')(
    'read turns TIFF into PNG, transparency kept',
    async () => {
      const dir = await makeTempDir()
      const png = join(dir, 'held.png')
      await sharp({
        create: {
          width: 6,
          height: 4,
          channels: 4,
          background: { r: 59, g: 130, b: 246, alpha: 0.5 },
        },
      }).toFile(png)
      execFileSync('sips', ['-s', 'format', 'tiff', png, '--out', join(dir, 'held.tiff')], {
        stdio: 'ignore',
      })
      const tiff = await readFile(join(dir, 'held.tiff'))
      const { run } = fakeRunner(async (_script, args) => {
        if (args.length === 0) return JSON.stringify({ types: ['public.tiff'], count: 3 })
        await writeFile(args[1] as string, tiff)
        return JSON.stringify({ ok: true, count: 3 })
      })
      const got = await macPasteboard(run).read(join(dir, 'in'))
      expect(got?.path).toBe(join(dir, 'in', 'Copied image.png'))
      const meta = await sharp(got?.path as string).metadata()
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', 6, 4, true])
    },
  )

  it('read gives null when the clipboard holds no image', async () => {
    const dir = await makeTempDir()
    const { run, calls } = fakeRunner(() =>
      JSON.stringify({ types: ['public.utf8-plain-text'], count: 2 }),
    )
    expect(await macPasteboard(run).read(dir)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('write puts the file on under its own type and returns the new change count', async () => {
    const { run, calls } = fakeRunner(() => JSON.stringify({ count: 12 }))
    expect(await macPasteboard(run).write('/tmp/x/Copied image.jpg', 'jpeg')).toBe(12)
    expect(calls[0]?.args).toEqual(['/tmp/x/Copied image.jpg', 'public.jpeg'])
  })
})
