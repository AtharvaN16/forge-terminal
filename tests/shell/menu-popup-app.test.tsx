import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import type { RightClickSystem } from '../../src/shell/flows/right-click.js'
import { MODE_KINDS } from '../../src/shell/home-art.js'
import { setMotionForTests } from '../../src/shell/motion.js'
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

/** The menu's box, by its bar: the chip, then the hatching. */
const POPUP = /menu ╱╱/

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
  /**
   * The frame's rows, from the box's top edge: 0 is its empty top ring, then
   * the bar, … The box has no line (2026-10-19, M1), so its edges are found by
   * what is inside: the bar's chip and hatching, the field's "› /".
   */
  const box = () => {
    const lines = frame().split('\n')
    const top = lines.findIndex((l) => POPUP.test(l)) - 1
    const bottom = lines.findIndex((l) => /› \//.test(l)) + 1
    return { lines, top, bottom, last: lines.at(-1) ?? '' }
  }
  return { ...a, frame, box }
}

describe('the / menu, as a popup', () => {
  afterEach(() => setMotionForTests(undefined))

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
    expect(a.frame()).not.toMatch(POPUP)
  })

  it('closes on a second /, leaving home’s field empty and the mode as it was (2026-10-18)', async () => {
    const a = app()
    await settle()
    a.stdin.write('2')
    await settle()
    a.stdin.write('/')
    await settle()
    expect(a.frame()).toMatch(POPUP)
    a.stdin.write('/')
    await settle()
    const f = a.frame()
    expect(f).not.toMatch(POPUP)
    expect(f).not.toContain('//')
    expect(f).toContain('OR search or enter a file path…')
    expect(f).toContain(MODE_KINDS.compress)
  })

  it('does not play home’s launch again when it closes (2026-10-18)', async () => {
    setMotionForTests(true)
    const a = app()
    const band = () => a.frame().split('\n').slice(1, 7).join('\n')
    await settle(1300)
    const still = band()
    expect(still).toContain('╱')
    a.stdin.write('/')
    await settle()
    a.stdin.write('/')
    await settle(60)
    expect(band()).toBe(still)
    a.stdin.write('/')
    await settle()
    a.stdin.write(ESC)
    await settle(60)
    expect(band()).toBe(still)
  })

  it('closes on a / typed after part of a name too', async () => {
    const a = app()
    await settle()
    a.stdin.write('/co')
    await settle()
    a.stdin.write('/')
    await settle()
    const f = a.frame()
    expect(f).not.toMatch(POPUP)
    expect(f).not.toContain('/co')
    expect(f).toContain('OR search or enter a file path…')
  })

  it('switches home to a mode chosen from the list, and closes', async () => {
    const a = app()
    await settle()
    a.stdin.write('/compress')
    await settle()
    a.stdin.write(ENTER)
    await settle()
    expect(a.frame()).not.toMatch(POPUP)
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

  it('stays open when nothing matches, saying so, until a second slash makes it a path (2026-10-19)', async () => {
    const a = app()
    await settle()
    a.stdin.write('/s')
    await settle()
    let f = a.frame()
    expect(f).toMatch(POPUP)
    expect(f).toContain('no command matches /s')
    a.stdin.write('/')
    await settle()
    f = a.frame()
    expect(f).not.toMatch(POPUP)
    expect(f).toContain('/s/')
    expect(f).toContain('Drop a file here')
  })

  it('sends a name no command has on as a path with ↵, when there is something there', async () => {
    const a = app()
    await settle()
    a.stdin.write('/tmp')
    await settle()
    expect(a.frame()).toContain('no command matches /tmp')
    a.stdin.write(ENTER)
    await settle(400)
    const f = a.frame()
    expect(f).not.toMatch(POPUP)
    expect(f).not.toContain('no command matches')
  })

  it('draws its field as one row, the marker in the list’s column (F1)', async () => {
    const a = app()
    await settle()
    a.stdin.write('/')
    await settle()
    const lines = a.frame().split('\n')
    const field = lines.find((l) => /› \//.test(l)) ?? ''
    const listed = lines.find((l) => l.includes('/convert')) ?? ''
    expect(field.indexOf('›')).toBe(listed.indexOf('/convert'))
  })
})
