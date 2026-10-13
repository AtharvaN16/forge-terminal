import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from '../../src/shell/Text.js'
import { BACKGROUND_RESET, backgroundSequence } from '../../src/shell/terminal-background.js'
import { DARK, LIGHT, NEUTRAL, type Palette } from '../../src/shell/theme.js'
import { useTerminalBackground } from '../../src/shell/useTerminalBackground.js'

/** A terminal that records every sequence written to it. */
function fakeTerminal(isTTY = true) {
  const out = Object.assign(new EventEmitter(), {
    isTTY,
    columns: 80,
    rows: 24,
    written: [] as string[],
    write(chunk: string) {
      out.written.push(String(chunk))
      return true
    },
  })
  return out
}

function Harness({ palette }: { palette: Palette }) {
  useTerminalBackground(palette)
  return <Text>x</Text>
}

const SET_DARK = backgroundSequence(DARK, {}) as string
const SET_LIGHT = backgroundSequence(LIGHT, {}) as string
const tick = () => new Promise((r) => setTimeout(r, 20))
const ours = (written: string[]) =>
  written.filter((s) => s === SET_DARK || s === SET_LIGHT || s === BACKGROUND_RESET)

beforeEach(() => {
  // Whatever terminal runs the tests, the hook sees a plain one.
  for (const name of ['TMUX', 'STY', 'ZELLIJ', 'TERM_PROGRAM', 'NO_COLOR']) vi.stubEnv(name, '')
  vi.stubEnv('TERM', 'xterm-256color')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('useTerminalBackground', () => {
  it('sets the background on mount and resets it on unmount', async () => {
    const out = fakeTerminal()
    const app = render(<Harness palette={DARK} />, { stdout: out as never, patchConsole: false })
    await tick()
    expect(ours(out.written)).toEqual([SET_DARK])
    app.unmount()
    await tick()
    expect(ours(out.written)).toEqual([SET_DARK, BACKGROUND_RESET])
  })

  it('writes the new canvas straight away when the theme changes', async () => {
    const out = fakeTerminal()
    const app = render(<Harness palette={DARK} />, { stdout: out as never, patchConsole: false })
    await tick()
    app.rerender(<Harness palette={LIGHT} />)
    await tick()
    // No reset in between: the profile's colour would flash.
    expect(ours(out.written)).toEqual([SET_DARK, SET_LIGHT])
    app.unmount()
  })

  it('resets on process exit, for a crash that never unmounts', async () => {
    const out = fakeTerminal()
    const before = process.listeners('exit')
    const app = render(<Harness palette={DARK} />, { stdout: out as never, patchConsole: false })
    await tick()
    const added = process.listeners('exit').filter((l) => !before.includes(l))
    for (const listener of added) (listener as (code: number) => void)(1)
    expect(ours(out.written)).toContain(BACKGROUND_RESET)
    app.unmount()
  })

  it('writes nothing for a palette that does not paint', async () => {
    const out = fakeTerminal()
    const app = render(<Harness palette={NEUTRAL} />, { stdout: out as never, patchConsole: false })
    await tick()
    app.unmount()
    await tick()
    expect(ours(out.written)).toEqual([])
  })

  it('writes nothing when stdout is not a terminal', async () => {
    const out = fakeTerminal(false)
    const app = render(<Harness palette={DARK} />, { stdout: out as never, patchConsole: false })
    await tick()
    app.unmount()
    await tick()
    expect(ours(out.written)).toEqual([])
  })
})
