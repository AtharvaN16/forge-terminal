import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { isForgeError } from '../../src/core/errors.js'
import { displayPath } from '../../src/utils/display-path.js'
import { linuxPasteboard, windowsPasteboard } from '../../src/utils/pasteboard.js'
import { fakeLinuxDesktop, fakeWindowsClipboard } from '../helpers/desktop-clipboard.js'
import { makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'
import { memoryPasteboard } from '../helpers/pasteboard.js'

function parseError(argv: string[]) {
  try {
    parseArgs(argv)
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  throw new Error(`parsed: ${argv.join(' ')}`)
}

describe('parseArgs clip', () => {
  it('takes no flags at all', () => {
    expect(parseArgs(['clip'])).toEqual({ kind: 'clip', undo: false, debug: false })
  })

  it('takes the flags a compression or conversion takes', () => {
    expect(parseArgs(['clip', '--to', 'jpg', '--quality', '70'])).toEqual({
      kind: 'clip',
      undo: false,
      debug: false,
      target: 'jpeg',
      quality: 70,
    })
    expect(parseArgs(['clip', '--max-size', '1mb'])).toMatchObject({ maxBytes: 1_000_000 })
  })

  it('--save takes a folder, or the default folder without one', () => {
    expect(parseArgs(['clip', '--save', '~/Downloads'])).toMatchObject({ save: '~/Downloads' })
    expect(parseArgs(['clip', '--save'])).toMatchObject({ save: true })
    expect(parseArgs(['clip', '--save', '--to', 'webp'])).toMatchObject({
      save: true,
      target: 'webp',
    })
  })

  it('--undo stands alone', () => {
    expect(parseArgs(['clip', '--undo'])).toEqual({ kind: 'clip', undo: true, debug: false })
    expect(parseError(['clip', '--undo', '--to', 'png']).code).toBe('invalid-arguments')
  })

  it('refuses --quality with --max-size, as compression does', () => {
    expect(parseError(['clip', '--quality', '70', '--max-size', '1mb']).code).toBe(
      'invalid-arguments',
    )
  })

  it('refuses a file: it reads the clipboard', () => {
    expect(parseError(['clip', 'photo.jpg']).detail).toMatch(/clipboard/)
  })
})

/** A clipboard holding a noisy JPEG, which compresses well, and a run folder. */
async function setUp() {
  const clip = memoryPasteboard()
  await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
  const root = await makeTempDir()
  const fallback = await makeTempDir()
  return { clip, opts: { clip: { pasteboard: clip.pb, root, fallback } }, fallback }
}

const held = (clip: ReturnType<typeof memoryPasteboard>) => {
  const h = clip.held()
  if (h?.kind !== 'image') throw new Error('no image held')
  return h
}

describe('forge clip', () => {
  it('compresses the copied image and puts it back', async () => {
    const { clip, opts } = await setUp()
    const before = held(clip).bytes.byteLength

    const out = await execute(parseArgs(['clip', '--quality', '40']), opts)

    expect(out.exitCode).toBe(0)
    expect(out.stdout[0]).toBe('✓ Copied image → clipboard')
    expect(out.stdout[1]).toMatch(/^ {2}.+ → .+ · [\d.]+% smaller$/)
    expect(held(clip).format).toBe('jpeg')
    expect(held(clip).bytes.byteLength).toBeLessThan(before)
  })

  it('--to converts on the clipboard and says so', async () => {
    const { clip, opts } = await setUp()

    const out = await execute(parseArgs(['clip', '--to', 'webp']), opts)

    expect(out.exitCode).toBe(0)
    expect(out.stdout[0]).toBe('✓ Copied image → clipboard  as WebP')
    expect(held(clip).format).toBe('webp')
    expect((await sharp(held(clip).bytes).metadata()).format).toBe('webp')
  })

  it('--save also writes a file', async () => {
    const { clip, opts } = await setUp()
    const folder = await makeTempDir()

    const out = await execute(parseArgs(['clip', '--quality', '40', '--save', folder]), opts)

    expect(out.exitCode).toBe(0)
    expect(out.stdout[0]).toBe(
      `✓ Copied image → clipboard + ${displayPath(join(folder, 'Copied image.jpg'))}`,
    )
    expect(await readFile(join(folder, 'Copied image.jpg'))).toEqual(held(clip).bytes)
  })

  it('leaves the clipboard alone when the result would be larger', async () => {
    const clip = memoryPasteboard()
    // Saved at 40, asked for at 100: the result can only grow.
    const small = join(await makeTempDir(), 'small.jpg')
    await sharp(await readFile(await makeNoiseImage(await makeTempDir(), 'n.jpg', 96, 'jpeg')))
      .jpeg({ quality: 40 })
      .toFile(small)
    await clip.copyImage(small)
    const bytes = held(clip).bytes

    const out = await execute(parseArgs(['clip', '--quality', '100']), {
      clip: { pasteboard: clip.pb, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toMatch(/Cannot compress more/)
    expect(held(clip).bytes).toEqual(bytes)
  })

  it('saves to the default folder when something else was copied meanwhile', async () => {
    const clip = memoryPasteboard({ onRead: () => clip.copyText() })
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
    const fallback = await makeTempDir()

    const out = await execute(parseArgs(['clip', '--quality', '40']), {
      clip: { pasteboard: clip.pb, root: await makeTempDir(), fallback },
    })

    expect(out.exitCode).toBe(0)
    expect(clip.held()?.kind).toBe('text')
    expect(await readdir(fallback)).toEqual(['Copied image.jpg'])
    expect(out.stdout.join('\n')).toContain('Clipboard changed')
  })

  it('says why when no image is copied', async () => {
    const clip = memoryPasteboard()
    clip.copyText()

    const out = await execute(parseArgs(['clip']), {
      clip: { pasteboard: clip.pb, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(1)
    expect(out.stderr[0]).toBe('✕ No image')
    expect(out.stderr.join('\n')).toContain('The clipboard holds text, not a picture.')
  })

  it('compresses a copied PNG and puts it back as a PNG', async () => {
    const clip = memoryPasteboard()
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'shot.png', 96))
    const before = held(clip).bytes.length

    const out = await execute(parseArgs(['clip']), {
      clip: { pasteboard: clip.pb, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(0)
    expect((await sharp(held(clip).bytes).metadata()).format).toBe('png')
    expect(held(clip).bytes.length).toBeLessThan(before)
  })

  it('--undo puts the original back', async () => {
    const { clip, opts } = await setUp()
    const original = held(clip).bytes
    await execute(parseArgs(['clip', '--quality', '40']), opts)

    const out = await execute(parseArgs(['clip', '--undo']), opts)

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toEqual(['✓ The original is back on the clipboard'])
    expect(held(clip).bytes).toEqual(original)
  })

  it('--undo with nothing kept says so', async () => {
    const clip = memoryPasteboard()
    const out = await execute(parseArgs(['clip', '--undo']), {
      clip: { pasteboard: clip.pb, root: await makeTempDir(), fallback: await makeTempDir() },
    })
    expect(out.exitCode).toBe(1)
    expect(out.stderr[0]).toBe('✕ Nothing to undo')
  })

  it('--json reports the run and where the result went', async () => {
    const { opts } = await setUp()

    const out = await execute(parseArgs(['clip', '--quality', '40', '--json']), {
      ...opts,
      json: true,
    })

    const doc = JSON.parse(out.stdout[0] as string)
    expect(doc).toMatchObject({ ok: true, clipboard: 'placed' })
    expect(doc.results[0].outputs[0]).toMatch(/Copied image\.jpg$/)
    expect((await stat(doc.results[0].outputs[0])).isFile()).toBe(true)
  })
})

/** The same command through each system's own clipboard, with its commands stood in for. */
describe('forge clip on Linux and Windows', () => {
  it('compresses a PNG copied on X11 and puts it back with xclip', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const shot = await readFile(await makeNoiseImage(await makeTempDir(), 'shot.png', 96))
    desk.hold({ 'image/png': shot })
    const pasteboard = linuxPasteboard({ DISPLAY: ':1' }, desk.tools)

    const out = await execute(parseArgs(['clip']), {
      clip: { pasteboard, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(0)
    expect(out.stdout[0]).toBe('✓ Copied image → clipboard')
    const back = desk.held().get('image/png') as Buffer
    expect((await sharp(back).metadata()).format).toBe('png')
    expect(back.length).toBeLessThan(shot.length)
  })

  it('--to converts on Wayland, under the new type', async () => {
    const desk = fakeLinuxDesktop({ installed: ['wl-paste', 'wl-copy'] })
    desk.hold({
      'image/png': await readFile(await makeNoiseImage(await makeTempDir(), 's.png', 48)),
    })
    const pasteboard = linuxPasteboard({ WAYLAND_DISPLAY: 'wayland-0' }, desk.tools)

    const out = await execute(parseArgs(['clip', '--to', 'webp']), {
      clip: { pasteboard, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.stdout[0]).toBe('✓ Copied image → clipboard  as WebP')
    expect([...desk.held().keys()]).toEqual(['image/webp'])
  })

  it('saves to the default folder when something else was copied on X11 meanwhile', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    desk.hold({
      'image/jpeg': await readFile(await makeNoiseImage(await makeTempDir(), 'h.jpg', 96, 'jpeg')),
    })
    const linux = linuxPasteboard({ DISPLAY: ':1' }, desk.tools)
    const pasteboard = {
      ...linux,
      async read(dir: string) {
        const got = await linux.read(dir)
        desk.hold({ UTF8_STRING: 'copied meanwhile' })
        return got
      },
    }
    const fallback = await makeTempDir()

    const out = await execute(parseArgs(['clip', '--quality', '40']), {
      clip: { pasteboard, root: await makeTempDir(), fallback },
    })

    expect(out.stdout.join('\n')).toContain('Clipboard changed')
    expect(await readdir(fallback)).toEqual(['Copied image.jpg'])
    expect(desk.held().get('UTF8_STRING')?.toString()).toBe('copied meanwhile')
  })

  it('tells a Linux user which package to install', async () => {
    const desk = fakeLinuxDesktop({ installed: [] })
    const pasteboard = linuxPasteboard({ DISPLAY: ':1' }, desk.tools)

    const out = await execute(parseArgs(['clip']), {
      clip: { pasteboard, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(1)
    expect(out.stderr[0]).toBe('✕ Clipboard needs xclip')
    expect(out.stderr.join('\n')).toContain('sudo apt install xclip')
  })

  it('compresses a screenshot copied on Windows and puts it back with its file', async () => {
    const win = fakeWindowsClipboard()
    const shot = await readFile(await makeNoiseImage(await makeTempDir(), 'shot.png', 96))
    win.hold({ DeviceIndependentBitmap: shot, Bitmap: shot })
    const pasteboard = windowsPasteboard(win.ps)

    const out = await execute(parseArgs(['clip']), {
      clip: { pasteboard, root: await makeTempDir(), fallback: await makeTempDir() },
    })

    expect(out.exitCode).toBe(0)
    expect(out.stdout[0]).toBe('✓ Copied image → clipboard')
    expect([...win.formats().keys()]).toEqual(['PNG', 'image/png', 'FileDrop'])
    expect((win.formats().get('PNG') as Buffer).length).toBeLessThan(shot.length)
  })

  it('--undo puts the original back on Windows', async () => {
    const win = fakeWindowsClipboard()
    const shot = await readFile(await makeNoiseImage(await makeTempDir(), 'shot.png', 96))
    win.hold({ PNG: shot })
    const opts = {
      clip: {
        pasteboard: windowsPasteboard(win.ps),
        root: await makeTempDir(),
        fallback: await makeTempDir(),
      },
    }
    await execute(parseArgs(['clip']), opts)

    const out = await execute(parseArgs(['clip', '--undo']), opts)

    expect(out.exitCode).toBe(0)
    expect(win.formats().get('PNG')).toEqual(shot)
  })
})
