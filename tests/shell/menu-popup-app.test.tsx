import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import type { RightClickSystem } from '../../src/shell/flows/right-click.js'
import { unpaint } from '../helpers/unpaint.js'

const ENTER = '\r'
const ESC = '\u001b'
const DOWN = '\u001b[B'
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const plain = (s: string | undefined) => unpaint(s ?? '')

const rightClick: RightClickSystem = {
  isOn: async () => true,
  turnOn: async () => {},
  turnOff: async () => {},
  copy: () => {},
}

function app() {
  const a = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
      rightClick={rightClick}
    />,
  )
  const frame = () => plain(a.lastFrame())
  /** The frame's rows, from the box's top edge: 0 is ╭, then the bar, … */
  const box = () => {
    const lines = frame().split('\n')
    const top = lines.findIndex((l) => l.includes('╭'))
    const bottom = lines.findIndex((l) => l.includes('╰'))
    return { lines, top, bottom, last: lines.at(-1) ?? '' }
  }
  return { ...a, frame, box }
}

describe('the / menu, as a popup', () => {
  it('opens over home on /: the box, the settings above the modes, its own field at the foot', async () => {
    const a = app()
    await settle()
    a.stdin.write('/')
    await settle()
    const { lines, top, bottom, last } = a.box()
    expect(top).toBeGreaterThanOrEqual(0)
    expect(lines[top + 1]).toContain('menu')
    const body = lines.join('\n')
    expect(body.indexOf('Settings')).toBeLessThan(body.indexOf('Modes'))
    expect(body).toContain('/right-click')
    expect(body).toContain('switch between light and dark')
    expect(lines[bottom - 1]).toMatch(/› \//)
    expect(lines[bottom + 1]).toMatch(/\/ +menu/)
    expect(last).toMatch(/↑↓\s+choose\s+↵\s+open/)
    expect(last).toContain('esc close')
    // home is behind it: no drop zone words
    expect(body).not.toContain('Drop a file here')
  })

  it('narrows as you type, a group with nothing left losing its heading', async () => {
    const a = app()
    await settle()
    a.stdin.write('/ex')
    await settle()
    const body = a.frame()
    expect(body).toContain('/extensions')
    expect(body).not.toContain('Modes')
  })

  it('opens a setting inside the box, its name in the bar, and esc goes back to the list', async () => {
    const a = app()
    await settle()
    a.stdin.write('/right-click')
    await settle()
    a.stdin.write(ENTER)
    await settle()
    let b = a.box()
    expect(b.top).toBeGreaterThanOrEqual(0)
    expect(b.lines[b.top + 1]).toContain('Right-click')
    expect(a.frame()).toContain('Uninstalling Forge')
    expect(b.lines[b.bottom - 1]).toContain('/right-click')
    expect(b.last).toContain('esc back')
    a.stdin.write(ESC)
    await settle()
    b = a.box()
    expect(a.frame()).toContain('Settings')
    expect(a.frame()).not.toContain('Uninstalling Forge')
    expect(b.last).toContain('esc close')
  })

  it('closes on esc from the list, back to home', async () => {
    const a = app()
    await settle()
    a.stdin.write('/')
    await settle()
    a.stdin.write(ESC)
    await settle()
    expect(a.frame()).toContain('Drop a file here')
    expect(a.frame()).not.toMatch(/╭─+╮/)
  })

  it('switches home to a mode chosen from the list, and closes', async () => {
    const a = app()
    await settle()
    a.stdin.write('/compress')
    await settle()
    a.stdin.write(ENTER)
    await settle()
    expect(a.frame()).not.toMatch(/╭─+╮/)
    expect(a.frame()).toMatch(/2 compress/)
  })

  it('moves the band with ↓', async () => {
    const a = app()
    await settle()
    a.stdin.write('/')
    await settle()
    a.stdin.write(DOWN)
    await settle()
    // the second setting is chosen: ↵ opens /extensions
    a.stdin.write(ENTER)
    await settle()
    const b = a.box()
    expect(b.lines[b.top + 1]).toContain('Extensions')
  })

  it('gives a path back to home’s field once what is typed matches no command', async () => {
    const a = app()
    await settle()
    a.stdin.write('/Us')
    await settle()
    const f = a.frame()
    expect(f).not.toMatch(/╭─+╮/)
    expect(f).toContain('/Us')
    expect(f).toContain('Drop a file here')
  })
})
