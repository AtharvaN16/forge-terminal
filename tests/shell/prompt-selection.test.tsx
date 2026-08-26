import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/shell/App.js'
import { DARK } from '../../src/shell/theme.js'

/**
 * The clipboard is stubbed rather than exercised for real: a test that ran
 * `pbcopy` would reach outside the process and clobber whatever the person
 * running the suite had copied.
 */
const clipboard = vi.hoisted(() => ({ text: '' }))
vi.mock('../../src/shell/clipboard.js', () => ({
  copy: (text: string) => {
    clipboard.text = text
  },
  paste: () => clipboard.text,
}))

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const SHIFT_LEFT = `${ESC}[1;2D`
const SHIFT_RIGHT = `${ESC}[1;2C`
const LEFT = `${ESC}[D`
const HOME = `${ESC}[H`
const OPT_LEFT = `${ESC}b`
const CTRL_X = '\x18'
const CTRL_Y = '\x19'
const CTRL_K = '\x0b'
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR is the point
const ANSI = /\x1b\[[0-9;]*m/g

const field = (frame: string | undefined) => {
  const line = (frame ?? '').split('\n').find((l) => l.includes('›'))
  return (line ?? '').replace(ANSI, '').replace('›', '').trim()
}

/** The raw prompt line, SGR intact, for asserting on the selection band. */
const rawField = (frame: string | undefined) =>
  (frame ?? '').split('\n').find((l) => l.includes('›')) ?? ''

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

async function typed(text: string) {
  clipboard.text = ''
  const app = render(<App initialWidth={80} />)
  app.stdin.write(text)
  await settle()
  return app
}

describe('drop area — selection', () => {
  it('shift+left selects backwards and draws a band', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    // The band is a background colour, not reverse video: reverse is a flag
    // rather than a toggle, so a caret nested inside it would be invisible.
    expect(rawField(lastFrame())).toContain(rgb(DARK.textSelectionBg))
  })

  it('typing replaces the selection', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('foo X')
    expect(field(lastFrame())).not.toContain('bar')
  })

  it('backspace deletes the selection rather than one more character', async () => {
    const { stdin, lastFrame } = await typed('abcdef')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write('\x7f')
    await settle()
    expect(field(lastFrame())).toContain('abcd')
    expect(field(lastFrame())).not.toContain('abcde')
  })

  /**
   * Anchor-and-head, not start-and-end: the pair remembers which end is
   * moving, so reversing direction shrinks the selection instead of growing
   * it from the other side.
   */
  it('shift+right shrinks a selection made with shift+left', async () => {
    const { stdin, lastFrame } = await typed('abcdef')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_RIGHT)
    await settle()
    stdin.write('X')
    await settle()
    /**
     * Two lefts select "ef", one right shrinks that to "f", and typing
     * replaces just it — so the 'f' is gone. Asserted as an exact match:
     * `toContain('abcdeX')` would also accept "abcdeXf", which is what a
     * field with no selection at all produces.
     */
    expect(field(lastFrame())).toBe('abcdeX')
  })

  it('a plain arrow collapses the selection to its edge', async () => {
    const { stdin, lastFrame } = await typed('abcdef')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(LEFT)
    await settle()
    stdin.write('X')
    await settle()
    // Collapsed to the selection's start (before 'e'), not one step past it.
    expect(field(lastFrame())).toContain('abcdXef')
  })

  it('shift+option+left selects a whole word', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    // Terminal.app sends ESC b for Option+Left; shift is carried on the key.
    stdin.write(`${ESC}[1;10D`)
    await settle()
    const raw = rawField(lastFrame())
    // Either the band appears, or the sequence was not recognised as shifted —
    // assert the band, which is the behaviour under test.
    expect(raw).toContain(rgb(DARK.textSelectionBg))
  })

  it('draws no band when nothing is selected', async () => {
    const { lastFrame } = await typed('foo')
    expect(rawField(lastFrame())).not.toContain(rgb(DARK.textSelectionBg))
  })
})

describe('drop area — clipboard', () => {
  it('ctrl+x cuts the selection to the clipboard', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(CTRL_X)
    await settle()
    expect(clipboard.text).toBe('bar')
    expect(field(lastFrame())).not.toContain('bar')
  })

  it('ctrl+y pastes the clipboard at the caret', async () => {
    const { stdin, lastFrame } = await typed('foo ')
    clipboard.text = 'photo.jpg'
    stdin.write(CTRL_Y)
    await settle()
    expect(field(lastFrame())).toContain('foo photo.jpg')
  })

  it('ctrl+k copies what it kills, so ctrl+y puts it back', async () => {
    const { stdin, lastFrame } = await typed('keep drop')
    stdin.write(OPT_LEFT)
    await settle()
    stdin.write(CTRL_K)
    await settle()
    expect(clipboard.text).toBe('drop')
    expect(field(lastFrame())).not.toContain('drop')

    stdin.write(CTRL_Y)
    await settle()
    expect(field(lastFrame())).toContain('keep drop')
  })

  /**
   * A path is one line. A clipboard holding several would otherwise bake a
   * raw newline into the buffer, which names no file on disk.
   */
  it('pastes only the first line of a multi-line clipboard', async () => {
    const { stdin, lastFrame } = await typed('')
    clipboard.text = 'first.png\nsecond.png'
    stdin.write(CTRL_Y)
    await settle()
    expect(field(lastFrame())).toContain('first.png')
    expect(field(lastFrame())).not.toContain('second.png')
  })

  it('pasting over a selection replaces it', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    stdin.write(SHIFT_LEFT)
    await settle()
    clipboard.text = 'baz'
    stdin.write(CTRL_Y)
    await settle()
    expect(field(lastFrame())).toContain('foo baz')
  })

  it('ctrl+u copies the killed head of the line', async () => {
    const { stdin } = await typed('drop this')
    stdin.write('\x15')
    await settle()
    expect(clipboard.text).toBe('drop this')
  })

  it('leaves the clipboard alone when there is nothing to cut', async () => {
    const { stdin } = await typed('abc')
    clipboard.text = 'untouched'
    stdin.write(CTRL_X)
    await settle()
    expect(clipboard.text).toBe('untouched')
  })

  it('home then ctrl+k clears the line and copies all of it', async () => {
    const { stdin, lastFrame } = await typed('everything')
    stdin.write(HOME)
    await settle()
    stdin.write(CTRL_K)
    await settle()
    expect(clipboard.text).toBe('everything')
    expect(field(lastFrame())).not.toContain('everything')
  })
})
