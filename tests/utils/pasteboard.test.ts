import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import {
  clipboardSupported,
  fingerprint,
  imageTypeIn,
  linuxBackends,
  linuxPasteboard,
  macPasteboard,
  type Osascript,
  systemPasteboard,
  utiFor,
  WIN_READ,
  WIN_WRITE,
  windowsPasteboard,
} from '../../src/utils/pasteboard.js'
import { fakeLinuxDesktop, fakeWindowsClipboard } from '../helpers/desktop-clipboard.js'
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
    expect(imageTypeIn(['public.tiff', 'public.png'], 'darwin')).toBe('public.png')
  })

  it('takes TIFF when that is all there is, as Preview and Safari copy', () => {
    expect(imageTypeIn(['public.tiff', 'NeXT TIFF v4.0 pasteboard type'], 'darwin')).toBe(
      'public.tiff',
    )
  })

  it('finds nothing in text', () => {
    expect(imageTypeIn(['public.utf8-plain-text', 'NSStringPboardType'], 'darwin')).toBeNull()
  })

  it('takes a picture put on with its file, as Forge puts a result back', () => {
    expect(imageTypeIn(['public.jpeg', 'public.file-url', 'NSFilenamesPboardType'], 'darwin')).toBe(
      'public.jpeg',
    )
  })

  it('ignores the icon Finder puts beside a copied file', () => {
    expect(
      imageTypeIn(['public.file-url', 'public.tiff', 'public.utf8-plain-text'], 'darwin'),
    ).toBeNull()
  })

  it('on Windows prefers the PNG a browser puts beside its bitmap', () => {
    expect(imageTypeIn(['DeviceIndependentBitmap', 'Bitmap', 'PNG', 'HTML Format'], 'win32')).toBe(
      'PNG',
    )
    expect(imageTypeIn(['JFIF', 'Bitmap'], 'win32')).toBe('JFIF')
  })

  it('on Windows takes a bare bitmap, as a screenshot is copied', () => {
    expect(
      imageTypeIn(
        ['DeviceIndependentBitmap', 'Bitmap', 'System.Drawing.Bitmap', 'Format17'],
        'win32',
      ),
    ).toBe('Bitmap')
  })

  it('on Windows a copied file is not an image, its picture taken only beside real data', () => {
    expect(imageTypeIn(['FileDrop', 'FileNameW', 'Shell IDList Array'], 'win32')).toBeNull()
    expect(imageTypeIn(['FileDrop', 'Bitmap'], 'win32')).toBeNull()
    expect(imageTypeIn(['FileDrop', 'PNG', 'Bitmap'], 'win32')).toBe('PNG')
    expect(imageTypeIn(['UnicodeText', 'Text'], 'win32')).toBeNull()
  })

  it('on Linux reads MIME types, PNG first', () => {
    expect(imageTypeIn(['TARGETS', 'image/jpeg', 'image/png'], 'linux')).toBe('image/png')
    expect(imageTypeIn(['image/webp'], 'linux')).toBe('image/webp')
    expect(imageTypeIn(['text/uri-list', 'x-special/gnome-copied-files'], 'linux')).toBeNull()
    expect(imageTypeIn(['UTF8_STRING', 'text/plain;charset=utf-8'], 'linux')).toBeNull()
  })
})

describe('clipboardSupported', () => {
  it('is there on a Mac and on Windows', () => {
    expect(clipboardSupported('darwin', {})).toBe(true)
    expect(clipboardSupported('win32', {})).toBe(true)
    expect(clipboardSupported('freebsd', {})).toBe(false)
  })

  it('needs a Wayland or X11 desktop on Linux', () => {
    expect(clipboardSupported('linux', {})).toBe(false)
    expect(clipboardSupported('linux', { DISPLAY: ':0' })).toBe(true)
    expect(clipboardSupported('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
  })

  it('is off over SSH, where the clipboard belongs to another machine', () => {
    expect(clipboardSupported('darwin', { SSH_CONNECTION: '10.0.0.2 51234 10.0.0.1 22' })).toBe(
      false,
    )
    expect(clipboardSupported('darwin', { SSH_TTY: '/dev/ttys004' })).toBe(false)
    expect(clipboardSupported('win32', { SSH_CONNECTION: '10.0.0.2 51234 10.0.0.1 22' })).toBe(
      false,
    )
    // A forwarded X11 display is still the far machine's session.
    expect(clipboardSupported('linux', { DISPLAY: 'localhost:10.0', SSH_TTY: '/dev/pts/1' })).toBe(
      false,
    )
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

describe('fingerprint', () => {
  it('is the same for the same contents, different for anything else, and never -1', () => {
    const a = fingerprint(['image/png'], 'ab12')
    expect(fingerprint(['image/png'], 'ab12')).toBe(a)
    expect(fingerprint(['image/png'], 'ab13')).not.toBe(a)
    expect(fingerprint(['image/png', 'text/plain'], 'ab12')).not.toBe(a)
    expect(Number.isSafeInteger(a)).toBe(true)
    expect(a).toBeGreaterThanOrEqual(0)
  })
})

describe('systemPasteboard', () => {
  it('is the one for each system', async () => {
    // Each answers a peek on a machine without its tools as nothing held.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(systemPasteboard(platform, {})).toHaveProperty('peek')
    }
  })
})

describe('windowsPasteboard', () => {
  it('peek reports the image format held, text, and a change count from the contents', async () => {
    const win = fakeWindowsClipboard()
    const png = await readFile(await makePng(await makeTempDir(), 'a.png'))
    win.hold({ DeviceIndependentBitmap: png, Bitmap: png, PNG: png })
    const pb = windowsPasteboard(win.ps)
    const first = await pb.peek()
    expect(first).toMatchObject({ image: 'PNG', text: false })
    expect(first.changeCount).toBeGreaterThanOrEqual(0)
    expect((await pb.peek()).changeCount).toBe(first.changeCount)
    win.hold({ UnicodeText: 'hello', Text: 'hello' })
    const text = await pb.peek()
    expect(text).toMatchObject({ image: null, text: true })
    expect(text.changeCount).not.toBe(first.changeCount)
  })

  it('peek gives the order to choose by, so a look is one PowerShell start', async () => {
    const win = fakeWindowsClipboard()
    await windowsPasteboard(win.ps).peek()
    expect(win.calls).toHaveLength(1)
    expect(win.calls[0]?.script).toBe(WIN_READ)
    expect(win.calls[0]?.env.FORGE_CLIP_ORDER?.split('|')[0]).toBe('PNG')
    expect(win.calls[0]?.env.FORGE_CLIP_ORDER?.split('|').at(-1)).toBe('Bitmap')
    expect(win.calls[0]?.env).toMatchObject({
      FORGE_CLIP_FILE: 'FileDrop',
      FORGE_CLIP_STAND_IN: 'Bitmap',
    })
    expect(win.calls[0]?.env.FORGE_CLIP_PATH).toBeUndefined()
  })

  it('peek says there is no image when PowerShell fails', async () => {
    const pb = windowsPasteboard(async () => {
      throw new Error('spawn powershell.exe ENOENT')
    })
    expect(await pb.peek()).toEqual({ changeCount: -1, image: null, text: false })
  })

  it('read saves the picture in the folder as Copied image, by its type', async () => {
    const win = fakeWindowsClipboard()
    const dir = await makeTempDir()
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
      .jpeg()
      .toBuffer()
    win.hold({ JFIF: jpg, Bitmap: jpg })
    const pb = windowsPasteboard(win.ps)
    const got = await pb.read(join(dir, 'in'))
    expect(got?.path).toBe(join(dir, 'in', 'Copied image.jpg'))
    expect(await readFile(got?.path as string)).toEqual(jpg)
    expect(got?.changeCount).toBe((await pb.peek()).changeCount)
    expect(await readdir(join(dir, 'in'))).toEqual(['Copied image.jpg'])
  })

  it('read takes a bitmap as the PNG it is saved as', async () => {
    const win = fakeWindowsClipboard()
    const png = await readFile(await makePng(await makeTempDir(), 'a.png'))
    win.hold({ Bitmap: png, DeviceIndependentBitmap: png })
    const got = await windowsPasteboard(win.ps).read(await makeTempDir())
    expect(got?.path).toMatch(/Copied image\.png$/)
  })

  it('read gives null for a copied file, leaving nothing behind', async () => {
    const win = fakeWindowsClipboard()
    win.hold({ FileDrop: 'C:\\photo.jpg', FileNameW: 'C:\\photo.jpg' })
    const dir = await makeTempDir()
    expect(await windowsPasteboard(win.ps).read(dir)).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('write puts the bytes on under each name the format has, then the file', async () => {
    const win = fakeWindowsClipboard()
    const path = await makePng(await makeTempDir(), 'Copied image.png')
    const pb = windowsPasteboard(win.ps)
    const count = await pb.write(path, 'png')
    expect(win.calls[0]?.script).toBe(WIN_WRITE)
    expect(win.calls[0]?.env).toEqual({ FORGE_CLIP_PATH: path, FORGE_CLIP_TYPES: 'PNG|image/png' })
    expect(count).toBe((await pb.peek()).changeCount)
    expect((await pb.peek()).image).toBe('PNG')
  })

  it('write names a JPEG as browsers do, and a WebP by its MIME type', async () => {
    const win = fakeWindowsClipboard()
    const pb = windowsPasteboard(win.ps)
    const dir = await makeTempDir()
    await writeFile(join(dir, 'a.jpg'), 'x')
    await pb.write(join(dir, 'a.jpg'), 'jpeg')
    expect(win.calls.at(-2)?.env.FORGE_CLIP_TYPES).toBe('JFIF|image/jpeg')
    await pb.write(join(dir, 'a.jpg'), 'webp')
    expect(win.calls.at(-2)?.env.FORGE_CLIP_TYPES).toBe('image/webp')
  })

  it('the scripts do what the fake does: STA clipboard, data kept after exit', () => {
    expect(WIN_READ).toContain('[Windows.Forms.Clipboard]::GetImage()')
    expect(WIN_READ).toContain('$data.GetData($pick)')
    expect(WIN_READ).toContain('$env:FORGE_CLIP_PATH')
    expect(WIN_WRITE).toContain('SetFileDropList')
    expect(WIN_WRITE).toContain('[Windows.Forms.Clipboard]::SetDataObject($data, $true)')
    // Paths come from the environment, never spliced into the source.
    expect(WIN_WRITE).not.toMatch(/\$\{|`\$/)
  })
})

describe('linuxBackends', () => {
  it('is Wayland’s clipboard first, then X11’s, by what the session sets', () => {
    expect(linuxBackends({}).map((b) => b.name)).toEqual([])
    expect(linuxBackends({ DISPLAY: ':1' }).map((b) => b.name)).toEqual(['x11'])
    expect(linuxBackends({ WAYLAND_DISPLAY: 'wayland-0' }).map((b) => b.name)).toEqual(['wayland'])
    expect(
      linuxBackends({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }).map((b) => b.name),
    ).toEqual(['wayland', 'x11'])
  })
})

describe('linuxPasteboard on X11', () => {
  const X11 = { DISPLAY: ':1' }

  it('peek lists the targets with xclip and says what is held', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const png = await readFile(await makePng(await makeTempDir(), 'a.png'))
    desk.hold({ 'image/png': png })
    const pb = linuxPasteboard(X11, desk.tools)
    const p = await pb.peek()
    expect(p).toMatchObject({ image: 'image/png', text: false })
    expect(p.changeCount).toBeGreaterThanOrEqual(0)
    expect(desk.calls[0]).toEqual(['xclip', '-selection', 'clipboard', '-t', 'TARGETS', '-o'])
    expect(desk.calls[1]).toEqual(['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o'])
  })

  it('peek says text, and an empty clipboard holds nothing', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const pb = linuxPasteboard(X11, desk.tools)
    expect(await pb.peek()).toMatchObject({ image: null, text: false })
    desk.hold({ UTF8_STRING: 'hi', STRING: 'hi' })
    expect(await pb.peek()).toMatchObject({ image: null, text: true })
  })

  it('peek changes its count when another image is copied', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const dir = await makeTempDir()
    desk.hold({ 'image/png': await readFile(await makePng(dir, 'a.png')) })
    const pb = linuxPasteboard(X11, desk.tools)
    const before = (await pb.peek()).changeCount
    expect((await pb.peek()).changeCount).toBe(before)
    desk.hold({ 'image/png': await readFile(await makeNoisePng(dir)) })
    expect((await pb.peek()).changeCount).not.toBe(before)
  })

  it('read writes the copied image into the folder as Copied image', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const png = await readFile(await makePng(await makeTempDir(), 'a.png'))
    desk.hold({ 'image/png': png, 'image/jpeg': 'not taken' })
    const dir = await makeTempDir()
    const pb = linuxPasteboard(X11, desk.tools)
    const got = await pb.read(join(dir, 'in'))
    expect(got?.path).toBe(join(dir, 'in', 'Copied image.png'))
    expect(await readFile(got?.path as string)).toEqual(png)
    expect(got?.changeCount).toBe((await pb.peek()).changeCount)
    // Written atomically: nothing but the image is left in the folder.
    expect(await readdir(join(dir, 'in'))).toEqual(['Copied image.png'])
  })

  it('read turns a TIFF into PNG, as on a Mac', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const tiff = await sharp({
      create: { width: 6, height: 4, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
    })
      .tiff()
      .toBuffer()
    desk.hold({ 'image/tiff': tiff })
    const got = await linuxPasteboard(X11, desk.tools).read(await makeTempDir())
    expect(got?.path).toMatch(/Copied image\.png$/)
    expect((await sharp(got?.path as string).metadata()).format).toBe('png')
  })

  it('read gives null for text or a copied file', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    desk.hold({ 'text/uri-list': 'file:///home/me/a.png', UTF8_STRING: '/home/me/a.png' })
    expect(await linuxPasteboard(X11, desk.tools).read(await makeTempDir())).toBeNull()
  })

  it('write gives xclip the file as its input, under the format’s type', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    const path = await makePng(await makeTempDir(), 'Copied image.png')
    const pb = linuxPasteboard(X11, desk.tools)
    const count = await pb.write(path, 'png')
    expect(desk.calls[0]).toEqual([
      'xclip',
      '-selection',
      'clipboard',
      '-t',
      'image/png',
      '-i',
      `< ${path}`,
    ])
    expect(desk.held().get('image/png')).toEqual(await readFile(path))
    expect(count).toBe((await pb.peek()).changeCount)
  })

  it('write waits for xclip to take the clipboard over', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'], lag: 4 })
    const dir = await makeTempDir()
    desk.hold({ 'image/png': await readFile(await makePng(dir, 'old.png')) })
    const path = await makeNoisePng(dir)
    const pb = linuxPasteboard(X11, desk.tools)
    const count = await pb.write(path, 'png')
    expect(desk.held().get('image/png')).toEqual(await readFile(path))
    expect(count).toBe((await pb.peek()).changeCount)
  })

  it('names the package to install when xclip is not there', async () => {
    const desk = fakeLinuxDesktop({ installed: [] })
    const pb = linuxPasteboard(X11, desk.tools)
    expect(await pb.peek()).toEqual({ changeCount: -1, image: null, text: false })
    const e = await pb.read(await makeTempDir()).catch((x: unknown) => x)
    expect(isForgeError(e) && e.code).toBe('clipboard-tool-missing')
    expect(isForgeError(e) && e.hint).toContain('sudo apt install xclip')
    const w = await pb.write('/tmp/x.png', 'png').catch((x: unknown) => x)
    expect(isForgeError(w) && w.code).toBe('clipboard-tool-missing')
  })
})

describe('linuxPasteboard on Wayland', () => {
  const WAYLAND = { WAYLAND_DISPLAY: 'wayland-0' }

  it('reads with wl-paste and writes with wl-copy', async () => {
    const desk = fakeLinuxDesktop({ installed: ['wl-paste', 'wl-copy'] })
    const png = await readFile(await makePng(await makeTempDir(), 'a.png'))
    desk.hold({ 'image/png': png, 'text/html': '<img>' })
    const pb = linuxPasteboard(WAYLAND, desk.tools)
    const got = await pb.read(await makeTempDir())
    expect(await readFile(got?.path as string)).toEqual(png)
    expect(desk.calls[0]).toEqual(['wl-paste', '--list-types'])
    expect(desk.calls[1]).toEqual(['wl-paste', '--type', 'image/png'])

    const jpg = join(await makeTempDir(), 'Copied image.jpg')
    await writeFile(jpg, 'jpeg bytes')
    await pb.write(jpg, 'jpeg')
    expect(desk.calls.find((c) => c[0] === 'wl-copy')).toEqual([
      'wl-copy',
      '--type',
      'image/jpeg',
      `< ${jpg}`,
    ])
    expect((await pb.peek()).image).toBe('image/jpeg')
  })

  it('falls back to xclip through XWayland when wl-clipboard is not installed', async () => {
    const desk = fakeLinuxDesktop({ installed: ['xclip'] })
    desk.hold({ 'image/png': await readFile(await makePng(await makeTempDir(), 'a.png')) })
    const pb = linuxPasteboard({ ...WAYLAND, DISPLAY: ':0' }, desk.tools)
    expect(await pb.read(await makeTempDir())).not.toBeNull()
    expect(desk.calls[0]?.[0]).toBe('wl-paste')
    expect(desk.calls[1]?.[0]).toBe('xclip')
    // Settled on xclip: wl-paste is not tried again.
    await pb.peek()
    expect(desk.calls.filter((c) => c[0] === 'wl-paste')).toHaveLength(1)
  })

  it('names wl-clipboard when neither is there', async () => {
    const desk = fakeLinuxDesktop({ installed: [] })
    const e = await linuxPasteboard({ ...WAYLAND, DISPLAY: ':0' }, desk.tools)
      .read(await makeTempDir())
      .catch((x: unknown) => x)
    expect(isForgeError(e) && e.title).toBe('Clipboard needs wl-clipboard')
    expect(isForgeError(e) && e.hint).toContain('sudo apt install wl-clipboard')
  })
})

async function makeNoisePng(dir: string): Promise<string> {
  const path = join(dir, 'noise.png')
  await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .png()
    .toFile(path)
  return path
}
