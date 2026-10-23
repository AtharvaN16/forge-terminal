import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { MODE_KINDS } from '../../src/shell/home-art.js'

const ENTER = String.fromCharCode(13)
const BACKSPACE = String.fromCharCode(127)
const settle = (ms = 140) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('the command list in the prompt', () => {
  it('opens on a bare slash', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={40} prefs={prefs} />)
    stdin.write('/')
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).toContain('/theme')
  })

  it('narrows as you type', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/comp')
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).not.toContain('/theme')
  })

  it('does not open for a path that contains slashes', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/Users/me/photo.png')
    await settle()
    expect(lastFrame() ?? '').not.toContain('Modes')
  })

  it('closes when the slash is deleted', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/')
    await settle()
    expect(lastFrame() ?? '').toContain('/theme')
    stdin.write(BACKSPACE)
    await settle()
    expect(lastFrame() ?? '').not.toContain('Modes')
  })

  it('runs /theme from the list', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/theme')
    await settle()
    stdin.write(ENTER)
    await settle(250)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Dark')
    expect(frame).toContain('Light')
  })

  it('reports an unknown command instead of probing it as a file', async () => {
    const { stdin, lastFrame, frames } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/nope')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const all = frames.join('') + (lastFrame() ?? '')
    expect(all.toLowerCase()).toContain('no command')
    expect(all).not.toContain('could not be read')
  })

  it('/help opens the whole list, which is the help', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={40} prefs={prefs} />)
    stdin.write('/help')
    await settle()
    const frame = lastFrame() ?? ''
    for (const name of ['/convert', '/compress', '/pdf', '/theme']) expect(frame).toContain(name)
  })

  it('/pdf with nothing staged arms pdf mode and keeps the drop area open', async () => {
    // Mirrors `/compress`: with nothing staged there is no hub to open yet,
    // but the choice of what the *next* dropped file goes through is real
    // and worth remembering. Silently returning to idle with the banner
    // unchanged was indistinguishable from the keystroke doing nothing at
    // all, which is exactly how "/pdf isn't switching the mode" was
    // reported.
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(250)
    const frame = lastFrame() ?? ''
    expect(frame).toContain(MODE_KINDS.pdf)
    expect(frame).toContain('Drop a file here')
  })
})
