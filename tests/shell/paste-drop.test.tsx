import { EventEmitter } from 'node:events'
import { render as inkRender } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
const bracketed = (text: string) => `${ESC}[200~${text}${ESC}[201~`

function home(dir: string) {
  return render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
}

/** The line the field is drawn on. */
const fieldLine = (frame: string) => frame.split('\n').find((l) => l.startsWith('    › ')) ?? ''

/** The field lines drawn from frame `from` on that show anything but a placeholder. */
const typedSince = (frames: string[], from: number) =>
  frames
    .slice(from)
    .map((f) => fieldLine(plain(f)).trimEnd())
    .filter((l) => l !== '' && !/^ {4}› (drop more, )?or type a path$/.test(l))

describe('a paste or drop on home', () => {
  it('asks the terminal to bracket pastes, so a drop arrives whole', async () => {
    const out = Object.assign(new EventEmitter(), {
      isTTY: true,
      columns: 80,
      rows: 24,
      written: [] as string[],
      write(chunk: string) {
        out.written.push(String(chunk))
        return true
      },
    })
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: () => {},
      setEncoding: () => {},
      ref: () => {},
      unref: () => {},
      read: () => null,
    })
    const app = inkRender(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
      />,
      { stdout: out as never, stdin: stdin as never, patchConsole: false },
    )
    await settle()
    expect(out.written).toContain(`${ESC}[?2004h`)
    app.unmount()
    expect(out.written).toContain(`${ESC}[?2004l`)
  })

  it('never shows a dropped path in the field before the card', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    const from = app.frames.length
    app.stdin.write(bracketed(png))
    await settle(400)
    expect(plain(app.lastFrame())).toContain('photo.png')
    expect(typedSince(app.frames, from)).toEqual([])
  }, 20_000)

  it('never shows it either from a terminal that does not bracket', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    const from = app.frames.length
    app.stdin.write(png)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('photo.png')
    expect(typedSince(app.frames, from)).toEqual([])
  }, 20_000)

  it('reads a bracketed drop that arrives in pieces as one drop', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    const cut = Math.floor(png.length / 2)
    app.stdin.write(`${ESC}[200~${png.slice(0, cut)}`)
    await settle(10)
    app.stdin.write(`${png.slice(cut)}${ESC}[201~`)
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('joins the pieces of an unbracketed drop that arrive together', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    const cut = Math.floor(png.length / 2)
    // Two reads, back to back, as a terminal sends them.
    app.stdin.write(png.slice(0, cut))
    app.stdin.write(png.slice(cut))
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('joins a last piece that is one character long', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write(png.slice(0, -1))
    app.stdin.write(png.slice(-1))
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('reads a key pressed the moment a drop lands as a key, not more of it', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write(png)
    const start = Date.now()
    while (!plain(app.lastFrame()).includes('drop more') && Date.now() - start < 5000) {
      await settle(5)
    }
    app.stdin.write('2')
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('reads a dropped file:// URL as the file it names', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'my photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write(bracketed(`file://${png.replaceAll(' ', '%20')}`))
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).toContain('my photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('puts a bracketed paste that names nothing on disk in the field', async () => {
    const dir = await makeTempDir()
    const app = home(dir)
    await settle()

    app.stdin.write(bracketed('~/Desktop/half-of-a-na'))
    await settle(400)
    expect(fieldLine(plain(app.lastFrame()))).toBe('    › ~/Desktop/half-of-a-na')
  }, 20_000)

  it('pastes into a field already being typed in at the caret, never as a drop', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write('x')
    await settle(100)
    app.stdin.write(bracketed(png))
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(fieldLine(frame)).toMatch(/^ {4}› x\/./)
    // Nothing staged: the field still leads and the panel offers no "drop more".
    expect(frame).not.toContain('drop more')
  }, 20_000)
})
