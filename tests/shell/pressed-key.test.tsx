import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { announceKey, keyIsDown, usePressedKeys } from '../../src/shell/pressed-key.js'
import { DARK } from '../../src/shell/theme.js'
import { PASTE } from '../../src/shell/useKeys.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

function Probe({ on }: { on: boolean }) {
  usePressedKeys(on)
  return null
}

const press = (input: string, key: Partial<typeof PASTE> = {}) =>
  announceKey(input, { ...PASTE, ...key })

describe('a key hint knows which key was pressed', () => {
  afterEach(() => setMotionForTests(undefined))

  it('matches a hint’s label to the presses it stands for', () => {
    setMotionForTests(true)
    const app = render(<Probe on={true} />)
    const down = (label: string, input: string, key: Partial<typeof PASTE> = {}) => {
      press(input, key)
      return keyIsDown(label)
    }
    expect(down('↵', '', { return: true })).toBe(true)
    expect(down('enter', '', { return: true })).toBe(true)
    expect(down('esc', '', { escape: true })).toBe(true)
    expect(down('tab', '', { tab: true })).toBe(true)
    expect(down('↑↓', '', { downArrow: true })).toBe(true)
    expect(down('←→', '', { leftArrow: true })).toBe(true)
    expect(down('1–6 ←→', '3')).toBe(true)
    expect(down('1–6 ←→', '', { rightArrow: true })).toBe(true)
    expect(down('1–6 ←→', '7')).toBe(false)
    expect(down('ctrl-n', 'n', { ctrl: true })).toBe(true)
    expect(down('n', 'n', { ctrl: true })).toBe(false)
    expect(down('o', 'O')).toBe(true)
    expect(down('+/−', '-')).toBe(true)
    expect(down('esc', 'x')).toBe(false)
    app.unmount()
  })

  it('lets go after a moment, and with no motion never goes down', async () => {
    setMotionForTests(true)
    const app = render(<Probe on={true} />)
    press('', { tab: true })
    expect(keyIsDown('tab')).toBe(true)
    await settle(200)
    expect(keyIsDown('tab')).toBe(false)
    app.unmount()
    const still = render(<Probe on={false} />)
    press('', { tab: true })
    expect(keyIsDown('tab')).toBe(false)
    still.unmount()
  })
})

/** The home key row's "1–6 ←→" while a mode key is pressed, and after. */
describe('on the home screen', () => {
  afterEach(() => setMotionForTests(undefined))
  const lastRow = (frame: string | undefined) => {
    const line = (frame ?? '').split('\n').findLast((l) => l.replace(SGR, '').trim() !== '') ?? ''
    return ansiRow(line, Math.max(80, [...line.replace(SGR, '')].length))
  }
  const colourOf = (frame: string | undefined, text: string) => {
    const cells = lastRow(frame)
    return cells[
      cells
        .map((c) => c.ch)
        .join('')
        .indexOf(text)
    ]
  }

  it('lights the mode keys for a moment, the words beside them unchanged', async () => {
    setMotionForTests(true)
    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: await makeTempDir() }}
      />,
    )
    await settle(300)
    const rest = colourOf(app.lastFrame(), '1–6')
    const words = colourOf(app.lastFrame(), 'mode')
    app.stdin.write('\x1b[C')
    // Pressing → moves to compress; the key is the same orange in every mode.
    // Polled, not a fixed wait: a slow runner may draw the lit frame late.
    for (let i = 0; i < 20 && colourOf(app.lastFrame(), '1–6')?.fg !== DARK.brand; i++)
      await settle(5)
    expect(colourOf(app.lastFrame(), '1–6')?.fg).toBe(DARK.brand)
    expect(colourOf(app.lastFrame(), '1–6')?.fg).not.toBe(rest?.fg)
    expect(colourOf(app.lastFrame(), 'mode')?.fg).toBe(words?.fg)
    await settle(300)
    expect(colourOf(app.lastFrame(), '1–6')?.fg).toBe(rest?.fg)
    app.unmount()
  })
})
