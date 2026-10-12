import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeaderBar } from '../../src/shell/components/HeaderBar.js'
import { Working } from '../../src/shell/components/Working.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

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

describe('Working', () => {
  const working = (props: Partial<React.ComponentProps<typeof Working>> = {}) =>
    inTheme(
      <Working mode="convert" label="Encoding AVIF" startedAt={Date.now()} width={80} {...props} />,
    )
  const line = (f: string | undefined) => plain(f).split('\n')[0] ?? ''

  it('spins in the mode’s colour, and shows the clock only once 3 s have passed', async () => {
    setMotionForTests(true)
    const app = render(working())
    await flush()
    const first = line(app.lastFrame())
    expect(first).toMatch(/^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Encoding AVIF$/)
    await advance(160)
    expect(line(app.lastFrame())).not.toBe(first)
    await advance(2700)
    expect(line(app.lastFrame())).toMatch(/AVIF$/)
    await advance(400)
    expect(line(app.lastFrame())).toMatch(/^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Encoding AVIF {2,}3\.3s$/)
    expect(line(app.lastFrame())).toHaveLength(65)
  })

  it('with motion off, has no spinner, but the clock still tells the truth', async () => {
    setMotionForTests(false)
    const app = render(working())
    await flush()
    expect(line(app.lastFrame())).toBe('   Encoding AVIF')
    await advance(4000)
    expect(line(app.lastFrame())).toMatch(/^ {3}Encoding AVIF {2,}4\.0s$/)
  })

  it('offers esc only for the size search', async () => {
    setMotionForTests(false)
    const keys = (f: string | undefined) => plain(f).trimEnd().split('\n').at(-1) ?? ''
    const single = render(working())
    await flush()
    expect(keys(single.lastFrame())).toMatch(
      /^ {30,}nothing is saved until it is done · ctrl-c quit$/,
    )
    const search = render(working({ label: 'Finding the right quality', search: { n: 2, of: 8 } }))
    await flush()
    expect(keys(search.lastFrame())).toMatch(/^ {2}esc {2}stop {10,}ctrl-c quit$/)
    expect(plain(search.lastFrame())).toContain('   ● ● ○ ○ ○ ○ ○ ○')
  })
})

describe('HeaderBar drift', () => {
  const trail = { answers: ['JPEG'], current: 'Converting' }
  const bar = (drift: boolean) =>
    inTheme(<HeaderBar mode="convert" trail={trail} width={80} slanted drift={drift} />)

  it('moves the hatching while a job runs, and nothing else', async () => {
    setMotionForTests(true)
    const app = render(bar(true))
    await flush()
    const before = app.lastFrame() ?? ''
    await advance(400)
    const after = app.lastFrame() ?? ''
    expect(after).not.toBe(before)
    expect(plain(after)).toBe(plain(before))
  })

  it('stays still with motion off', async () => {
    setMotionForTests(false)
    const still = render(bar(false)).lastFrame()
    const app = render(bar(true))
    await advance(400)
    expect(app.lastFrame()).toBe(still)
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
    expect(mid).not.toContain(bgOf(DARK.listBand))
    await advance(200)
    const rest = (app.lastFrame() ?? '').split('\n')
    expect(rest[1]).toContain(bgOf(DARK.listBand))
    expect(rest[0]).not.toContain('48;2;')
  })

  it("flashes Save as's pill when a path is dropped, then rests on the pill", async () => {
    setMotionForTests(true)
    const { SaveAs } = await import('../../src/shell/components/SaveAs.js')
    const palette = modePalette(DARK, 'convert')
    const app = render(
      <ThemeProvider palette={palette}>
        <SaveAs
          mode="convert"
          width={80}
          name="photo"
          onNameChange={() => {}}
          proposed="photo"
          ext=".jpg"
          folder="/Users/me/Desktop"
          onFolder={() => {}}
          presets={[{ label: 'Desktop', path: '/Users/me/Desktop' }]}
          defaultPath=""
          display={(p) => p}
          onMakeDefault={() => {}}
          onSubmit={() => {}}
          onBack={() => {}}
          initialFocus="folder"
        />
      </ThemeProvider>,
    )
    await flush()
    // The title, two blank rows, the field's padding, then the sentence.
    const sentence = () => (app.lastFrame() ?? '').split('\n')[4] ?? ''
    expect(sentence()).toContain(bgOf(palette.pill))
    app.stdin.write('/tmp/dropped/thing.png')
    await flush()
    expect(sentence()).not.toContain(bgOf(palette.pill))
    await advance(600)
    expect(sentence()).toContain(bgOf(palette.pill))
  })
})
