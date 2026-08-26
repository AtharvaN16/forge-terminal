import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/shell/App.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

const ESC = String.fromCharCode(27)
/**
 * The byte sequences a real macOS terminal sends, measured rather than
 * assumed. Terminal.app's shipped `keyMappings.plist` maps Option+Left/Right
 * to `ESC b` / `ESC f`; iTerm2 and xterm send the CSI form instead, so both
 * are exercised. Ink strips the leading ESC before a handler sees it, which
 * is why the component matches on `key.meta` plus a bare letter — never on
 * the raw `\x1b…` string, which can never arrive.
 */
const OPT_LEFT_TERMINAL = `${ESC}b`
const OPT_RIGHT_TERMINAL = `${ESC}f`
const OPT_LEFT_CSI = `${ESC}[1;3D`
const OPT_RIGHT_CSI = `${ESC}[1;3C`
const CTRL_LEFT = `${ESC}[1;5D`
const CTRL_RIGHT = `${ESC}[1;5C`
const OPT_BACKSPACE = `${ESC}\x7f`
const FORWARD_DELETE = `${ESC}[3~`
const HOME = `${ESC}[H`
const END = `${ESC}[F`
const LEFT = `${ESC}[D`
const CTRL_K = '\x0b'
const MOUSE_PRESS = `${ESC}[<0;12;34M`

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR is the point
const ANSI = /\x1b\[[0-9;]*m/g

/**
 * The drop area's text, with the caret's inverse-video run removed. The caret
 * is drawn by inverting the character it sits on, so the glyph under it is
 * still present in the frame — only the SGR wrapper has to come off.
 */
const field = (frame: string | undefined) => {
  const line = (frame ?? '').split('\n').find((l) => l.includes('›'))
  return (line ?? '').replace(ANSI, '').replace('›', '').trim()
}

async function typed(text: string) {
  const app = render(<App initialWidth={80} />)
  app.stdin.write(text)
  await settle()
  return app
}

describe('drop area — caret motion', () => {
  it('option+left jumps a word back (Terminal.app ESC b)', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(OPT_LEFT_TERMINAL)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('foo Xbar')
  })

  it('option+left jumps a word back (iTerm2/xterm CSI 1;3D)', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(OPT_LEFT_CSI)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('foo Xbar')
  })

  it('option+right jumps a word forward (Terminal.app ESC f)', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(HOME)
    await settle()
    stdin.write(OPT_RIGHT_TERMINAL)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('fooX bar')
  })

  it('option+right jumps a word forward (iTerm2/xterm CSI 1;3C)', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(HOME)
    await settle()
    stdin.write(OPT_RIGHT_CSI)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('fooX bar')
  })

  it('ctrl+left and ctrl+right move by word too', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(CTRL_LEFT)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('foo Xbar')

    stdin.write(CTRL_RIGHT)
    await settle()
    stdin.write('Y')
    await settle()
    expect(field(lastFrame())).toContain('foo XbarY')
  })

  it('home and end reach the ends of the line', async () => {
    const { stdin, lastFrame } = await typed('abc')
    stdin.write(HOME)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('Xabc')

    stdin.write(END)
    await settle()
    stdin.write('Z')
    await settle()
    expect(field(lastFrame())).toContain('XabcZ')
  })
})

describe('drop area — deletion', () => {
  it('option+backspace deletes only the last word, not the whole line', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(OPT_BACKSPACE)
    await settle()
    const text = field(lastFrame())
    expect(text).toContain('foo')
    expect(text).not.toContain('bar')
  })

  it('fn+delete removes the character after the caret, not before it', async () => {
    const { stdin, lastFrame } = await typed('abc')
    stdin.write(LEFT) // caret sits on 'c'
    await settle()
    stdin.write(FORWARD_DELETE)
    await settle()
    // Forward delete takes 'c'. Deleting backward would have taken 'b'.
    expect(field(lastFrame())).toContain('ab')
    expect(field(lastFrame())).not.toContain('ac')
  })

  it('ctrl+k kills from the caret to the end of the line', async () => {
    const { stdin, lastFrame } = await typed('keep drop')
    stdin.write(OPT_LEFT_TERMINAL) // caret to start of 'drop'
    await settle()
    stdin.write(CTRL_K)
    await settle()
    const text = field(lastFrame())
    expect(text).toContain('keep')
    expect(text).not.toContain('drop')
  })
})

describe('drop area — stray escape sequences', () => {
  /**
   * Ink strips the leading ESC, so a mouse report reaches the handler as the
   * bare string "[<0;12;34M". The old guard tested `input.startsWith('\x1b')`,
   * which can never be true — so a terminal with mouse reporting on would
   * type its own mouse events into the path.
   */
  it('does not type a mouse report into the field', async () => {
    const { stdin, lastFrame } = await typed('file')
    stdin.write(MOUSE_PRESS)
    await settle()
    const text = field(lastFrame())
    expect(text).toContain('file')
    expect(text).not.toContain('0;12;34')
    expect(text).not.toContain('<')
  })

  it('still accepts a literal bracket, which is legal in a filename', async () => {
    const { stdin, lastFrame } = await typed('shot')
    stdin.write('[')
    await settle()
    stdin.write('1')
    await settle()
    stdin.write(']')
    await settle()
    expect(field(lastFrame())).toContain('shot[1]')
  })
})
