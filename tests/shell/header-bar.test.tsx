import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { trailBarRow } from '../../src/shell/bar-art.js'
import { HeaderBar, isWorking } from '../../src/shell/components/HeaderBar.js'
import { slantedChips } from '../../src/shell/glyphs.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import {
  ansiRow,
  type Cell,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

type BarFrame = FixtureFrame & { at: number }
const BARS = loadFixture('bar-mockup.json') as BarFrame[]

/** The mockup's questions and answers, per mode (its TRAIL). */
/** The modes the mockup draws a bar for; colour and enhance came after it. */
type MockMode = Exclude<ShellMode, 'colour' | 'enhance'>
const TRAIL: Record<MockMode, { steps: string[]; answers: string[] }> = {
  convert: { steps: ['Format', 'Quality', 'Save to', 'Name'], answers: ['JPEG', '80', 'Desktop'] },
  compress: { steps: ['Method', 'Quality', 'Save to', 'Name'], answers: ['By quality', '70'] },
  pdf: { steps: ['Action', 'Pages', 'Save to'], answers: ['Split', '1-3, 7'] },
}
const trailAt = (mode: MockMode, at: number) => ({
  answers: TRAIL[mode].answers.slice(0, at),
  current: TRAIL[mode].steps[at],
})

const text = (cells: Cell[]) => cells.map((c) => c.ch).join('')

describe('the header bar, against the decided mockup (04)', () => {
  for (const bar of BARS) {
    it(`${bar.mode}, at question ${bar.at + 1}`, () => {
      const row = trailBarRow({
        width: 80,
        palette: modePalette(DARK, bar.mode),
        mode: bar.mode,
        trail: trailAt(bar.mode as MockMode, bar.at),
        slanted: true,
      })
      expect(describeRow(runsRow(row), fixtureRow(bar, 0))).toBe('equal')
    })
  }

  it('draws the same cells through Ink', () => {
    const bar = BARS[2] as BarFrame
    const { lastFrame } = render(
      <ThemeProvider palette={modePalette(DARK, 'convert')}>
        <HeaderBar mode="convert" trail={trailAt('convert', 2)} width={80} slanted />
      </ThemeProvider>,
    )
    const lines = (lastFrame() ?? '').split('\n')
    expect(lines).toHaveLength(1)
    expect(describeRow(ansiRow(lines[0] ?? ''), fixtureRow(bar, 0))).toBe('equal')
  })
})

describe('the header bar beyond the mockup', () => {
  const row = (p: Partial<Parameters<typeof trailBarRow>[0]> = {}) =>
    runsRow(
      trailBarRow({
        width: 80,
        palette: DARK,
        mode: 'convert',
        trail: trailAt('convert', 2),
        slanted: true,
        ...p,
      }),
      p.width ?? 80,
    )

  it('falls back to a plain filled chip, the trail where it was', () => {
    const plain = row({ slanted: false })
    const slanted = row()
    expect(text(plain)).toMatch(/^ {2} convert ╱+ JPEG ╱ 80 ╱ Save to ╱╱ {2}$/)
    // The chip loses its two slanted ends, so the hatching starts two cells earlier.
    expect(text(plain).indexOf('╱')).toBe(text(slanted).indexOf('╱') - 2)
    expect(text(plain).slice(-20)).toBe(text(slanted).slice(-20))
    expect(plain[2]).toMatchObject({ ch: ' ', bg: DARK.modeConvert })
  })

  it('is the chip and hatching alone with no trail', () => {
    expect(text(row({ trail: { answers: [] } }))).toMatch(/^ {2} convert ╱+ {2}$/)
  })

  it('drops the oldest answers first when the row is too narrow, and never overflows', () => {
    expect(text(row({ width: 40 }))).toContain(' JPEG ╱ 80 ╱ Save to ')
    const narrow = text(row({ width: 34 }))
    expect(narrow).toContain(' 80 ╱ Save to ')
    expect(narrow).not.toContain('JPEG')
    for (const width of [20, 30, 40, 60, 120]) {
      const cells = row({ width })
      expect(cells.findLastIndex((c) => c.ch !== ' ')).toBeLessThan(width - 2)
      expect(text(cells)).toContain('convert')
    }
  })

  it('can lead the current part with a dim word, as /about signs its bar', () => {
    const cells = row({
      slanted: false,
      trail: { answers: [], lead: 'by', current: 'Atharva Nayak' },
    })
    expect(text(cells)).toMatch(/^ {2} convert ╱+ by Atharva Nayak ╱╱ {2}$/)
    const by = text(cells).indexOf(' by ') + 1
    expect(cells[by]).toMatchObject({ ch: 'b', fg: DARK.dim, b: false })
    expect(cells[by + 3]).toMatchObject({ ch: 'A', fg: DARK.fg, b: true })
  })

  it('keeps the hatching on absolute columns, like the home band', () => {
    const a = row({ trail: { answers: [] } })
    const b = row({ trail: { answers: ['JPEG'], current: 'Quality' } })
    // Column 20 is hatching in both, so it is the same colour in both.
    expect(a[20]).toEqual(b[20])
  })
})

describe('slantedChips: whether the terminal draws the slants itself', () => {
  it('is on in the terminals that draw them natively', () => {
    for (const env of [
      { TERM_PROGRAM: 'iTerm.app' },
      { TERM_PROGRAM: 'WezTerm' },
      { TERM_PROGRAM: 'ghostty' },
      { TERM_PROGRAM: 'vscode' },
      { TERM: 'xterm-kitty' },
      { TERM: 'xterm-ghostty' },
    ])
      expect(slantedChips(env), JSON.stringify(env)).toBe(true)
  })

  it('is off anywhere it cannot be sure, Apple Terminal included', () => {
    expect(slantedChips({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false)
    expect(slantedChips({ TERM_PROGRAM: 'tmux' })).toBe(false)
    expect(slantedChips({})).toBe(false)
  })

  it('is off under NO_COLOR', () => {
    expect(slantedChips({ TERM_PROGRAM: 'iTerm.app', NO_COLOR: '1' })).toBe(false)
  })

  it('does what FORGE_POWERLINE says, either way', () => {
    expect(slantedChips({ TERM_PROGRAM: 'Apple_Terminal', FORGE_POWERLINE: '1' })).toBe(true)
    expect(slantedChips({ TERM_PROGRAM: 'iTerm.app', FORGE_POWERLINE: '0' })).toBe(false)
  })
})

describe('isWorking', () => {
  it('is false only at an empty idle prompt and on the theme picker', () => {
    expect(isWorking('idle', 0)).toBe(false)
    expect(isWorking('theme', 0)).toBe(false)
    expect(isWorking('idle', 1)).toBe(true)
    expect(isWorking('target', 1)).toBe(true)
    expect(isWorking('result', 0)).toBe(true)
  })
})
