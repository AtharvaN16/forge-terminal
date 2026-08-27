import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'

const ENTER = String.fromCharCode(13)
const BACKSPACE = String.fromCharCode(127)
const settle = (ms = 140) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('the palette in the prompt', () => {
  it('opens on a bare slash', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
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
    expect(lastFrame() ?? '').not.toContain('make a file smaller')
  })

  it('closes when the slash is deleted', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/')
    await settle()
    expect(lastFrame() ?? '').toContain('/compress')
    stdin.write(BACKSPACE)
    await settle()
    expect(lastFrame() ?? '').not.toContain('make a file smaller')
  })

  it('runs /theme from the palette', async () => {
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

  it('/help lists the commands', async () => {
    const { stdin, lastFrame, frames } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/help')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const all = frames.join('') + (lastFrame() ?? '')
    expect(all).toContain('/convert')
    expect(all).toContain('/compress')
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
    expect(frame).toContain('current mode: pdf')
    expect(frame).toContain('drop a file or type a path')
  })
})
