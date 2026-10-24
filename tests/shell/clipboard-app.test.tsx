import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App, pasteKey } from '../../src/shell/App.js'
import { revealLabel } from '../../src/shell/reveal.js'
import { DARK } from '../../src/shell/theme.js'
import { makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'
import { memoryPasteboard } from '../helpers/pasteboard.js'
import { pinPlatform } from '../helpers/platform.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/** A copied image as a source and the clipboard as its destination (2026-10-16). */

const ESC = String.fromCharCode(27)
const EMPTY_PASTE = `${ESC}[200~${ESC}[201~`
const CTRL_V = '\x16'
const FOCUS_IN = `${ESC}[I`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

type Clip = ReturnType<typeof memoryPasteboard>

async function open(clip: Clip) {
  const desktop = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: desktop }}
      pasteboard={clip.pb}
      clipRoot={await makeTempDir()}
    />,
  )
  await settle()
  return { app, desktop }
}

/** A noisy JPEG, which compresses well, on the clipboard. */
async function holdingJpeg(opts: { onRead?: () => void } = {}) {
  const clip = memoryPasteboard(opts)
  await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
  return clip
}

const held = (clip: Clip) => {
  const h = clip.held()
  if (h?.kind !== 'image') throw new Error('no image held')
  return h
}

/** The key the hint names is this computer's; `pasteKey` is pinned per platform below. */
const HINT = `${pasteKey()}  to paste from clipboard`

describe('the hint on home', () => {
  it('says the paste key, on a chip in the mode’s colour at the field’s far end', async () => {
    const { app } = await open(await holdingJpeg())
    await waitFor(() => plain(app.lastFrame()).includes(HINT))
    const line = (app.lastFrame() ?? '').split('\n').find((l) => plain(l).includes(HINT)) ?? ''
    expect(plain(line)).toContain('› OR search or enter a file path…')
    const cells = ansiRow(line)
    const at = cells
      .map((c) => c.ch)
      .join('')
      .indexOf(HINT)
    const key = [...pasteKey()]
    expect(cells[at]).toMatchObject({ ch: key[0], fg: DARK.ink, bg: DARK.modeConvert, b: true })
    expect(cells[at + key.length + 2]).toMatchObject({ ch: 't', fg: DARK.modeConvert })
    // Two cells short of the shelf's edge, as colour's hints end.
    const end = at + [...HINT].length
    expect(cells[end]?.bg).toBe(DARK.shelf)
    expect(cells[end + 1]?.bg).toBe(DARK.shelf)
    expect(cells[end + 2]?.bg).not.toBe(DARK.shelf)
  })

  it('is not there for text, so there is nothing to refuse', async () => {
    const clip = memoryPasteboard()
    clip.copyText()
    const { app } = await open(clip)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('OR search or enter a file path…')
    expect(plain(app.lastFrame())).not.toContain('paste from clipboard')
  })

  it('goes once you type', async () => {
    const { app } = await open(await holdingJpeg())
    await waitFor(() => plain(app.lastFrame()).includes(HINT))
    app.stdin.write('x')
    await settle()
    expect(plain(app.lastFrame())).not.toContain('paste from clipboard')
  })

  it('appears when you come back to the window having copied an image', async () => {
    const clip = memoryPasteboard()
    clip.copyText()
    const { app } = await open(clip)
    await settle(300)
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 32, 'jpeg'))
    app.stdin.write(FOCUS_IN)
    await waitFor(() => plain(app.lastFrame()).includes(HINT))
    expect(plain(app.lastFrame())).toContain(HINT)
    // The focus report itself is never typed into the field.
    expect(plain(app.lastFrame())).toContain('› OR search or enter a file path…')
  })
})

describe('the key the hint names', () => {
  it('is ⌘V on a Mac, Ctrl+V on Windows and Linux', () => {
    expect(pasteKey('darwin')).toBe('⌘V')
    expect(pasteKey('win32')).toBe('Ctrl+V')
    expect(pasteKey('linux')).toBe('Ctrl+V')
  })

  describe('on Linux', () => {
    pinPlatform('linux')

    it('says Ctrl+V, and Ctrl+V lands the image', async () => {
      const { app } = await open(await holdingJpeg())
      await waitFor(() => plain(app.lastFrame()).includes('Ctrl+V  to paste from clipboard'))
      expect(plain(app.lastFrame())).toContain('Ctrl+V  to paste from clipboard')
      app.stdin.write(CTRL_V)
      await waitFor(() => plain(app.lastFrame()).includes('Copied image'))
      expect(plain(app.lastFrame())).toContain('JPEG')
    })
  })

  describe('on Windows', () => {
    pinPlatform('win32')

    it('says Ctrl+V', async () => {
      const { app } = await open(await holdingJpeg())
      await waitFor(() => plain(app.lastFrame()).includes('Ctrl+V  to paste from clipboard'))
      expect(plain(app.lastFrame())).toContain('Ctrl+V  to paste from clipboard')
    })
  })
})

describe('pasting the image', () => {
  it('⌘V lands it like a dropped file, named Copied image', async () => {
    const { app } = await open(await holdingJpeg())
    await waitFor(() => plain(app.lastFrame()).includes(HINT))
    app.stdin.write(EMPTY_PASTE)
    await waitFor(() => plain(app.lastFrame()).includes('Copied image'))
    const frame = plain(app.lastFrame())
    expect(frame).toContain('JPEG')
    expect(frame).toMatch(/Copied image\s/)
    expect(frame).not.toContain('Copied image.jpg')
    expect(frame).not.toContain('paste from clipboard')
  })

  it('ctrl-v does the same, for a terminal that sends nothing on ⌘V', async () => {
    const { app } = await open(await holdingJpeg())
    await waitFor(() => plain(app.lastFrame()).includes(HINT))
    app.stdin.write(CTRL_V)
    await waitFor(() => plain(app.lastFrame()).includes('Copied image'))
    expect(plain(app.lastFrame())).toContain('JPEG')
  })
})

/** Home → ⌘V → compress → By quality → Quality, at `quality`. */
async function compressToQuality(clip: Clip, quality?: 'lower') {
  const opened = await open(clip)
  const { app } = opened
  await waitFor(() => plain(app.lastFrame()).includes(HINT))
  app.stdin.write(EMPTY_PASTE)
  await waitFor(() => plain(app.lastFrame()).includes('Copied image'))
  app.stdin.write('2')
  await settle()
  app.stdin.write('\r')
  await waitFor(() => plain(app.lastFrame()).includes('By quality'))
  app.stdin.write('\r')
  await waitFor(() => plain(app.lastFrame()).includes('smaller'))
  if (quality === 'lower') {
    for (let i = 0; i < 4; i++) app.stdin.write(`${ESC}[D`)
    await settle(600)
  }
  return opened
}

describe('compressing a copied image', () => {
  it('skips Save as and puts the result on the clipboard', async () => {
    const clip = await holdingJpeg()
    const before = held(clip).bytes.byteLength
    const { app } = await compressToQuality(clip, 'lower')
    await waitFor(() => /\d+% smaller/.test(plain(app.lastFrame())))
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('On the clipboard'), 15_000)

    const frame = app.lastFrame()
    expect(plain(frame)).not.toContain('Save as')
    expect(plain(frame)).toMatch(/Clipboard ╱ Done/)
    expect(plain(frame)).toMatch(/o Open +u Undo +s Save a copy +↵ Home/)
    expect(held(clip).format).toBe('jpeg')
    expect(held(clip).bytes.byteLength).toBeLessThan(before)
  }, 30_000)

  it('u puts the original back', async () => {
    const clip = await holdingJpeg()
    const original = held(clip).bytes
    const { app } = await compressToQuality(clip, 'lower')
    await waitFor(() => /\d+% smaller/.test(plain(app.lastFrame())))
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('On the clipboard'), 15_000)

    await settle()
    app.stdin.write('u')
    await waitFor(() => held(clip).bytes.equals(original))
    expect(held(clip).bytes).toEqual(original)
  }, 30_000)

  it('s saves a copy to the default folder', async () => {
    const clip = await holdingJpeg()
    const { app, desktop } = await compressToQuality(clip, 'lower')
    await waitFor(() => /\d+% smaller/.test(plain(app.lastFrame())))
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('On the clipboard'), 15_000)

    await settle()
    app.stdin.write('s')
    const start = Date.now()
    while ((await readdir(desktop)).length === 0 && Date.now() - start < 10_000) await settle(30)
    const saved = await readdir(desktop)
    expect(saved).toEqual(['Copied image.jpg'])
    expect(await readFile(join(desktop, 'Copied image.jpg'))).toEqual(held(clip).bytes)
  }, 30_000)

  it('saves to the default folder and says so when something else was copied meanwhile', async () => {
    const clip = await holdingJpeg({ onRead: () => clip.copyText() })
    const { app, desktop } = await compressToQuality(clip, 'lower')
    await waitFor(() => /\d+% smaller/.test(plain(app.lastFrame())))
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('Clipboard changed'), 15_000)

    const frame = plain(app.lastFrame())
    expect(frame).toContain('The file you uploaded is no longer in the clipboard.')
    expect(frame).toMatch(/The compressed image is saved to [^.]+\./)
    // The reveal button says this OS's own word: Finder, Explorer or Files.
    const where = revealLabel().replace(/^Show in /, '')
    expect(plain(app.lastFrame())).toMatch(new RegExp(`o Open +f ${where} +↵ Home`))
    expect(clip.held()?.kind).toBe('text')
    expect(await readdir(desktop)).toEqual(['Copied image.jpg'])
  }, 30_000)

  it('↵ does nothing at a quality that would make it larger', async () => {
    const clip = memoryPasteboard()
    const small = join(await makeTempDir(), 'small.jpg')
    await sharp(await readFile(await makeNoiseImage(await makeTempDir(), 'n.jpg', 96, 'jpeg')))
      .jpeg({ quality: 30 })
      .toFile(small)
    await clip.copyImage(small)
    const { app } = await compressToQuality(clip)
    // The default quality is above 30: the size shown is larger.
    await waitFor(() => /larger/.test(plain(app.lastFrame())))
    app.stdin.write('\r')
    await settle(800)
    expect(plain(app.lastFrame())).toContain('Quality')
    expect(plain(app.lastFrame())).not.toContain('Done')
    expect(held(clip).format).toBeUndefined()
  }, 30_000)
})
