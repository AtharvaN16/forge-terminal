import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeaderBar } from '../../src/shell/components/HeaderBar.js'
import { WorkingLine } from '../../src/shell/components/WorkingLine.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

/** Truecolor, read by chalk once at import — so set before Ink loads. */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g
const plain = (f: string | undefined) => (f ?? '').replace(ANSI, '')
const bgOf = (hex: string) =>
  `48;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`

/** Only the clock and intervals are faked; React schedules on setImmediate. */
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
}
const advance = async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await flush()
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }))
afterEach(() => {
  vi.useRealTimers()
  setMotionForTests(undefined)
})

const inTheme = (node: React.ReactElement) => <ThemeProvider palette={DARK}>{node}</ThemeProvider>

describe('WorkingLine', () => {
  it('spins and counts real seconds while motion is on', async () => {
    setMotionForTests(true)
    const app = render(inTheme(<WorkingLine label="Converting…" />))
    await flush()
    expect(plain(app.lastFrame())).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Converting… {2}0\.0s$/)
    await advance(1200)
    expect(plain(app.lastFrame())).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Converting… {2}1\.2s$/)
  })

  it('is the plain label when motion is off', () => {
    setMotionForTests(false)
    expect(plain(render(inTheme(<WorkingLine label="Converting…" />)).lastFrame())).toBe(
      'Converting…',
    )
  })
})

describe('HeaderBar mode wipe', () => {
  const trail = { answers: [], current: 'Format' }
  const bar = (mode: 'convert' | 'compress') =>
    inTheme(<HeaderBar mode={mode} trail={trail} width={80} slanted />)
  const fgOf = (hex: string) =>
    `38;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`
  /** Where the bar's hatching on the far right is, by colour: the last ╱ drawn. */
  const lastHatch = (frame: string) => frame.slice(frame.lastIndexOf('╱') - 30)

  it('wipes the new mode in from the left, then rests on it', async () => {
    setMotionForTests(true)
    const app = render(bar('convert'))
    const before = lastHatch(app.lastFrame() ?? '')
    app.rerender(bar('compress'))
    await advance(99)
    const mid = app.lastFrame() ?? ''
    // The chip, on the left, is already compress's; the far end still convert's.
    expect(mid).toContain(bgOf(DARK.modeCompress))
    expect(plain(mid)).toContain(' compress ')
    expect(lastHatch(mid)).toBe(before)
    await advance(300)
    const done = app.lastFrame() ?? ''
    expect(lastHatch(done)).not.toBe(before)
    expect(done).not.toContain(fgOf(DARK.modeConvert))
  })

  it('cuts straight to the new mode when motion is off', () => {
    setMotionForTests(false)
    const app = render(bar('convert'))
    app.rerender(bar('compress'))
    expect(app.lastFrame()).not.toContain(bgOf(DARK.modeConvert))
    expect(plain(app.lastFrame())).toContain(' compress ')
  })
})

describe('picker glide and drop flash', () => {
  const DOWN = `${String.fromCharCode(27)}[B`
  const items = [
    { value: 'a', label: 'JPEG' },
    { value: 'b', label: 'WebP' },
  ]

  it('fades the band onto the new row, then rests on the band colour', async () => {
    setMotionForTests(true)
    const { Select } = await import('../../src/shell/components/Select.js')
    const app = render(inTheme(<Select width={40} items={items} onSubmit={() => {}} />))
    await flush()
    app.stdin.write(DOWN)
    await flush()
    await advance(33)
    const mid = (app.lastFrame() ?? '').split('\n')[1] ?? ''
    expect(mid).toContain('48;2;')
    expect(mid).not.toContain(bgOf(DARK.band))
    await advance(200)
    const rest = (app.lastFrame() ?? '').split('\n')
    expect(rest[1]).toContain(bgOf(DARK.band))
    expect(rest[0]).not.toContain('48;2;')
  })

  it('flashes the Save to input when a path is dropped, then fades', async () => {
    setMotionForTests(true)
    const { PathInput } = await import('../../src/shell/components/PathInput.js')
    const app = render(
      inTheme(
        <PathInput
          label="Save to"
          presets={[{ label: 'Desktop', path: '/Users/me/Desktop' }]}
          preview={(p) => p}
          onSubmit={() => {}}
          width={60}
          showHints
          defaultPath=""
        />,
      ),
    )
    await flush()
    app.stdin.write('/tmp/dropped/thing.png')
    await flush()
    const inputLine = () => (app.lastFrame() ?? '').split('\n')[1] ?? ''
    expect(inputLine()).toContain(bgOf(DARK.band))
    await advance(600)
    expect(inputLine()).not.toContain('48;2;')
  })
})
