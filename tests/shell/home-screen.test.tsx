import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Home, homeKeys, homeLayout, Suggestions } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { MODE_KINDS } from '../../src/shell/home-art.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import {
  ansiRow,
  describeHomeRow,
  type FixtureFrame,
  homeRow,
  MOCKUP,
  runsRow,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const COMPLETIONS = ['~/Desktop/', '~/Desktop/converted/', '~/Desktop/receipts/']

function screen({
  mode,
  text,
  width = 80,
  height = 24,
}: {
  mode: ShellMode
  text: string
  width?: number
  height?: number
}) {
  const typing = text !== ''
  const items = typing ? COMPLETIONS : []
  return render(
    <ThemeProvider palette={modePalette(DARK, mode)}>
      <Home
        width={width}
        height={height}
        mode={mode}
        typing={typing}
        field={
          <Prompt
            value={text}
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="or type a path"
            isActive
            variant="home"
            width={width}
          />
        }
        list={
          typing
            ? (rows) => <Suggestions items={items} selected={0} width={width} rows={rows} />
            : undefined
        }
        keys={homeKeys({ typing, completions: items.length })}
      />
    </ThemeProvider>,
  )
}

// The rule above the keys sits on the app's margins since 2026-10-20: two
// columns in from each side, where the mockup drew it the full width.
const RULE = 22
const rule = () => runsRow([{ text: '  ' }, { text: '─'.repeat(76), fg: DARK.border }])

function expectFrame(frame: FixtureFrame, skip: number[] = []) {
  const lines = (screen(frame).lastFrame() ?? '').split('\n')
  expect(lines).toHaveLength(24)
  for (let row = 0; row < 24; row++) {
    if (skip.includes(row)) continue
    const actual = ansiRow(lines[row] ?? '')
    const expected = row === RULE ? rule() : homeRow(frame, row)
    expect(describeHomeRow(actual, expected), `${frame.label}, row ${row}`).toBe('equal')
  }
}

describe('the home screen, against the decided mockup (80 × 24)', () => {
  const [empty, typing, compress, pdfTyping] = MOCKUP as [
    FixtureFrame,
    FixtureFrame,
    FixtureFrame,
    FixtureFrame,
  ]

  // The key row says "1–6 ←→ mode" since ←→ step through the modes
  // (2026-10-13), after these mockups; mode-arrows-app.test.tsx holds it.
  const KEY_ROW = 23
  // The kinds line names the formats since 2026-10-18 ("images · HEIC · PDF ·
  // Word" in the mockups). It is longer, so the dots clear further on it and
  // on the heading above it; those two rows are checked by their words.
  const KINDS = [10, 11]
  const words = (frame: FixtureFrame, row: number) =>
    ansiRow((screen(frame).lastFrame() ?? '').split('\n')[row] ?? '')
      .map((c) => c.ch)
      .join('')

  it('empty', () => {
    expectFrame(empty, [...KINDS, KEY_ROW])
    expect(words(empty, 10)).toContain('↓  Drop a file here')
    expect(words(empty, 11)).toContain(MODE_KINDS.convert)
    // "/ menu" ends on the app's right margin, two columns short (2026-10-20).
    expect(words(empty, 21)).toBe(`${' '.repeat(70)} /  menu  `)
  })

  it('typing a path', () => {
    // The key row's footnote keys are bright since 2026-10-19, after the mockup.
    expectFrame(typing, [...KINDS, KEY_ROW])
    expect(words(typing, 11)).toContain(MODE_KINDS.convert)
  })

  // The kinds line is longer than the frozen mockup's ("split · merge · rotate"
  // grew to name extract and delete), so the dots clear further on its two rows;
  // and the key row is the typing one (esc clear beside tab complete, 2026-10-19).
  it('typing in pdf mode', () => expectFrame(pdfTyping, [...KINDS, KEY_ROW]))

  it('after pressing 2, but without promising video', () => {
    // The mockup lists "images · PDF · video"; compress has no video engine.
    expectFrame(compress, [...KINDS, KEY_ROW])
    const kinds = words(compress, 11)
    expect(kinds).toContain(MODE_KINDS.compress)
    expect(kinds).not.toContain('video')
  })
})

describe('typing never fades the drop area (2026-10-19)', () => {
  it('draws the drop area the same, cell for cell, with one letter typed as with none', () => {
    const rows = (text: string) =>
      (screen({ mode: 'convert', text }).lastFrame() ?? '').split('\n').slice(7, 15)
    expect(rows('a')).toEqual(rows(''))
  })
})

describe('the home screen at other sizes', () => {
  it('fills exactly the height it is given', () => {
    for (const height of [12, 16, 19, 20, 24, 30, 40]) {
      const lines = (screen({ mode: 'convert', text: '', height }).lastFrame() ?? '').split('\n')
      expect(lines, `height ${height}`).toHaveLength(height)
      expect(lines.at(-1), `height ${height}`).toContain('quit')
    }
  })

  it('never draws past the width it is given', () => {
    for (const width of [40, 60, 100, 140]) {
      const lines = (screen({ mode: 'convert', text: '~/D', width }).lastFrame() ?? '').split('\n')
      for (const line of lines)
        expect(ansiRow(line, 400).findLastIndex((c) => c.ch !== ' ' || c.bg !== null)).toBeLessThan(
          width,
        )
    }
  })

  it('gives up the brand before the drop zone, and the drop zone last', () => {
    // The field's shelf (round 5, P2) is three rows, a row more than the field and its gap were.
    expect(homeLayout(80, 24)).toEqual({ brand: true, surface: 8, list: 5 })
    expect(homeLayout(80, 20).brand).toBe(true)
    expect(homeLayout(80, 20).surface).toBeGreaterThanOrEqual(4)
    expect(homeLayout(80, 16).brand).toBe(false)
    expect(homeLayout(80, 16).surface).toBeGreaterThanOrEqual(4)
    expect(homeLayout(80, 10).surface).toBe(0)
    expect(homeLayout(30, 24).brand).toBe(false)
  })

  it('makes room under the field for a note taller than the list, from the drop zone', () => {
    // A failed run's E5 panel: 6 rows, a blank row above it and the rule below.
    const layout = homeLayout(80, 24, 6)
    expect(layout.list).toBeGreaterThanOrEqual(1 + 6 + 1)
    expect(layout).toEqual({ brand: true, surface: 5, list: 8 })
    // A note that fits the list as it is changes nothing.
    expect(homeLayout(80, 24, 2)).toEqual(homeLayout(80, 24))
  })
})

describe('the key row (F1)', () => {
  it('drops footnote items from the right before it would wrap', () => {
    const lines = (screen({ mode: 'convert', text: '', width: 30 }).lastFrame() ?? '').split('\n')
    const keys = ansiRow(lines.at(-1) ?? '', 30)
      .map((c) => c.ch)
      .join('')
    expect(keys).toContain('1–6 ←→ mode')
    expect(keys).not.toContain('ctrl-c quit')
  })

  it('offers only what works: no tab or arrows without completions', () => {
    // Typing, esc clear is a key beside ↵ send (2026-10-19).
    // ↵ is said in the field ("enter") once something is typed (2026-10-19).
    expect(homeKeys({ typing: true, completions: 0 })).toEqual({
      main: [['esc', 'clear']],
      foot: [['ctrl-c', 'quit']],
    })
    expect(homeKeys({ typing: true, completions: 2 }).main).toEqual([
      ['esc', 'clear'],
      ['tab', 'complete'],
    ])
  })

  it('puts esc clear on the key row beside ↵ while files are staged', () => {
    expect(
      homeKeys({ typing: false, completions: 0, staged: { count: 1, verb: 'edit' } }).main,
    ).toEqual([
      ['↵', 'edit'],
      ['esc', 'clear'],
    ])
    expect(
      homeKeys({ typing: false, completions: 0, staged: { count: 1, verb: null } }).main,
    ).toEqual([['esc', 'clear']])
  })

  it('says tab for the supported formats on a bare home, and no ctrl-n new anywhere', () => {
    const bare = homeKeys({ typing: false, completions: 0, formats: true })
    expect(bare.foot).toEqual([
      ['tab', 'supported formats'],
      ['1–6 ←→', 'mode'],
      ['ctrl-c', 'quit'],
    ])
    expect(homeKeys({ typing: false, completions: 0 }).foot).not.toContainEqual([
      'tab',
      'supported formats',
    ])
    for (const k of [
      homeKeys({ typing: false, completions: 0, formats: true }),
      homeKeys({ typing: false, completions: 0, colour: true }),
      homeKeys({ typing: false, completions: 0, staged: { count: 1, verb: 'convert' } }),
    ])
      expect(JSON.stringify(k)).not.toContain('ctrl-n')
  })
})

describe('the footnote: keys bright, what they do faded (2026-10-19)', () => {
  it('draws each key in the text colour and its words in the faint one', () => {
    const p = modePalette(DARK, 'convert')
    const lines = (screen({ mode: 'convert', text: '' }).lastFrame() ?? '').split('\n')
    const row = ansiRow(lines.at(-1) ?? '', 80)
    const at = (word: string) => {
      const text = row.map((c) => c.ch).join('')
      return row[text.indexOf(word)]?.fg
    }
    expect(at('1–6')).toBe(p.fg)
    expect(at('ctrl-c')).toBe(p.fg)
    expect(at('mode')).toBe(p.border)
    expect(at('quit')).toBe(p.border)
  })
})

describe('the row above the rule: "esc clear" at the left, "/ menu" at the right', () => {
  const rowAbove = (frame: ReturnType<typeof screen>) =>
    ansiRow((frame.lastFrame() ?? '').split('\n').at(-3) ?? '', 80)
      .map((c) => c.ch)
      .join('')

  it('is "/ menu" alone on a bare home', () => {
    const row = rowAbove(screen({ mode: 'convert', text: '' }))
    expect(row).toMatch(/\/ +menu\s*$/)
    expect(row).not.toContain('esc')
  })

  it('gives the row to the list while typing; esc clear is on the key row then', () => {
    const lines = (screen({ mode: 'convert', text: '~/Desk' }).lastFrame() ?? '').split('\n')
    const text = (l: string | undefined) =>
      ansiRow(l ?? '', 80)
        .map((c) => c.ch)
        .join('')
    expect(text(lines.at(-3))).not.toContain('menu')
    expect(text(lines.at(-1))).toMatch(/^ +esc +clear +tab +complete/)
  })
})

describe('suggestions', () => {
  it('keeps the chosen row in view when it is below the fold', () => {
    const items = Array.from({ length: 12 }, (_, i) => `~/f${i}/`)
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <Suggestions items={items} selected={9} width={80} rows={4} />
      </ThemeProvider>,
    )
    const text = (lastFrame() ?? '').split('\n').map((l) =>
      ansiRow(l)
        .map((c) => c.ch)
        .join(''),
    )
    expect(text.some((l) => l.includes('▌ ~/f9/'))).toBe(true)
    expect(text.some((l) => l.includes('~/f0/'))).toBe(false)
  })
})
