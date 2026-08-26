import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/shell/App.js'

vi.mock('../../src/shell/clipboard.js', () => ({ copy: () => {}, paste: () => '' }))

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

const ESC = String.fromCharCode(27)

/**
 * The kitty keyboard protocol's encoding, which is the only channel on macOS
 * that can report Cmd. The modifier field is a bitmask plus one, so Cmd
 * (super = 8) is 9; the `:1` suffix is the event type, `press`.
 *
 * Measured against Ink 7.1.1: without the event-type field these same chords
 * arrive as the legacy `CSI 1;9D`, which Ink folds into `key.meta` — the
 * reason `launch.tsx` asks for `reportEventTypes` rather than
 * `disambiguateEscapeCodes` alone.
 */
const CMD_LEFT = `${ESC}[1;9:1D`
const CMD_RIGHT = `${ESC}[1;9:1C`
const CMD_SHIFT_LEFT = `${ESC}[1;10:1D`
const CMD_BACKSPACE = `${ESC}[127;9:1u`
const KEY_A_RELEASE = `${ESC}[97;1:3u`
const OPT_LEFT = `${ESC}b`

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR is the point
const ANSI = /\x1b\[[0-9;]*m/g
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

describe('cmd shortcuts via the kitty keyboard protocol', () => {
  it('cmd+left goes to the line start, not back one word', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(CMD_LEFT)
    await settle()
    stdin.write('X')
    await settle()
    // Option+Left would have produced 'foo Xbar'. Cmd is line-scoped.
    expect(field(lastFrame())).toContain('Xfoo bar')
  })

  it('cmd+right goes to the line end', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(CMD_LEFT)
    await settle()
    stdin.write(CMD_RIGHT)
    await settle()
    stdin.write('Z')
    await settle()
    expect(field(lastFrame())).toContain('foo barZ')
  })

  it('keeps option word-scoped while cmd is line-scoped', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(OPT_LEFT)
    await settle()
    stdin.write('X')
    await settle()
    expect(field(lastFrame())).toContain('foo Xbar')
  })

  it('cmd+shift+left selects to the line start', async () => {
    const { stdin, lastFrame } = await typed('foo bar')
    stdin.write(CMD_SHIFT_LEFT)
    await settle()
    stdin.write('X')
    await settle()
    // The whole line was selected, so typing replaces all of it.
    expect(field(lastFrame())).toBe('X')
  })

  it('cmd+backspace deletes to the line start', async () => {
    // Not the word "drop": an emptied field shows the placeholder, "drop a
    // file or type a path", and the assertion would match that instead.
    const { stdin, lastFrame } = await typed('remove this')
    stdin.write(CMD_BACKSPACE)
    await settle()
    expect(field(lastFrame())).not.toContain('remove')
  })

  /**
   * `reportEventTypes` is the flag that makes Cmd legible on the arrows, and
   * it also makes the terminal report every key going up. If those releases
   * reached the handlers, one keystroke would be acted on twice.
   */
  it('ignores key releases, which would otherwise double every keystroke', async () => {
    const { stdin, lastFrame } = await typed('')
    stdin.write(`${ESC}[97;1:1u`) // press 'a'
    await settle()
    stdin.write(KEY_A_RELEASE) // release 'a'
    await settle()
    expect(field(lastFrame())).toBe('a')
  })
})
