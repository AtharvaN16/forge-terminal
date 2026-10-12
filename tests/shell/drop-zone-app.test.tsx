import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

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

/**
 * A drop is a paste: `stdin.write` hands the whole string to the app as one
 * input chunk, which is exactly what a terminal does with a dragged file
 * (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md).
 */
describe('dropping onto home', () => {
  it('reads a pasted path at once and keeps it on home, until ↵ takes it on', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write(png)
    await settle(400)
    let frame = plain(app.lastFrame())
    expect(frame).toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')

    app.stdin.write(ENTER)
    await settle(400)
    frame = plain(app.lastFrame())
    expect(frame).toContain('Convert PNG to')
  }, 20_000)

  it('adds a second drop to the first, and ↵ waits for batch', async () => {
    const dir = await makeTempDir()
    const a = await makePng(dir, 'a.png')
    const b = await makePng(dir, 'b.png')
    const app = home(dir)
    await settle()

    app.stdin.write(a)
    await settle(400)
    app.stdin.write(b)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('2 images')

    app.stdin.write(ENTER)
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).not.toContain('Convert PNG to')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('leaves a paste that names nothing on disk in the field, as typed', async () => {
    const dir = await makeTempDir()
    const app = home(dir)
    await settle()

    // Half a path, to be finished by hand.
    app.stdin.write('~/Desktop/half-of-a-na')
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(fieldLine(frame)).toBe('    › ~/Desktop/half-of-a-na')
    expect(frame).not.toContain('✕')
    expect(frame).not.toContain('not found')
  }, 20_000)

  it('treats a pasted path ending in a line break as a drop, not a submit', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const app = home(dir)
    await settle()

    app.stdin.write(`${png}\r`)
    await settle(400)
    const frame = plain(app.lastFrame())
    expect(frame).not.toContain('Convert PNG to')
    expect(fieldLine(frame)).toBe('    › drop more, or type a path')
  }, 20_000)

  it('makes ↵ wait for a drop still being read, rather than going on without it', async () => {
    const dir = await makeTempDir()
    const a = await makePng(dir, 'a.png')
    const folder = join(dir, 'shots')
    await mkdir(folder)
    await makePng(folder, 'b.png')
    await makePng(folder, 'c.png')
    const app = home(dir)
    await settle()

    app.stdin.write(a)
    await settle(400)
    // The folder's read cannot finish between these two writes.
    app.stdin.write(`${folder}\r`)
    app.stdin.write(ENTER)
    await settle(600)
    const frame = plain(app.lastFrame())
    expect(frame).not.toContain('Convert PNG to')
    expect(frame).toContain('3 images')
  }, 20_000)

  it('says what it left out, and esc clears the stage and the line', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'photo.png')
    const notes = join(dir, 'notes.txt')
    await writeFile(notes, 'not an image')
    const app = home(dir)
    await settle()

    app.stdin.write(`${png} ${notes}`)
    await settle(400)
    let frame = plain(app.lastFrame())
    expect(frame).toContain('1 file left out')
    expect(frame).toContain('notes.txt')

    app.stdin.write(ESC)
    await settle(400)
    frame = plain(app.lastFrame())
    expect(frame).not.toContain('left out')
    expect(frame).not.toContain('photo.png')
    expect(fieldLine(frame)).toBe('    › or type a path')
  }, 20_000)
})
