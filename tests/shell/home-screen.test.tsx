import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Home, homeKeys, homeLayout, Suggestions } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import { ansiRow, describeHomeRow, type FixtureFrame, homeRow, MOCKUP } from './home-cells.js'

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
        savesTo="~/Desktop"
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
        keys={homeKeys({ typing, completions: items.length, commands: false })}
      />
    </ThemeProvider>,
  )
}

function expectFrame(frame: FixtureFrame, skip: number[] = []) {
  const lines = (screen(frame).lastFrame() ?? '').split('\n')
  expect(lines).toHaveLength(24)
  for (let row = 0; row < 24; row++) {
    if (skip.includes(row)) continue
    const actual = ansiRow(lines[row] ?? '')
    expect(describeHomeRow(actual, homeRow(frame, row)), `${frame.label}, row ${row}`).toBe('equal')
  }
}

describe('the home screen, against the decided mockup (80 × 24)', () => {
  const [empty, typing, compress, pdfTyping] = MOCKUP as [
    FixtureFrame,
    FixtureFrame,
    FixtureFrame,
    FixtureFrame,
  ]

  it('empty', () => expectFrame(empty))

  it('typing a path', () => expectFrame(typing))

  it('typing in pdf mode', () => expectFrame(pdfTyping))

  it('after pressing 2, but without promising video', () => {
    // The mockup lists "images · PDF · video"; compress has no video engine.
    expectFrame(compress, [11])
    const lines = (screen(compress).lastFrame() ?? '').split('\n')
    const kinds = ansiRow(lines[11] ?? '')
      .map((c) => c.ch)
      .join('')
    expect(kinds).toContain('images · PDF ')
    expect(kinds).not.toContain('video')
  })
})

describe('the home screen at other sizes', () => {
  it('fills exactly the height it is given', () => {
    for (const height of [12, 16, 19, 20, 24, 30, 40]) {
      const lines = (screen({ mode: 'convert', text: '', height }).lastFrame() ?? '').split('\n')
      expect(lines, `height ${height}`).toHaveLength(height)
      expect(lines.at(-1), `height ${height}`).toContain('send')
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
})

describe('the key row (F1)', () => {
  it('drops footnote items from the right before it would wrap', () => {
    const lines = (screen({ mode: 'convert', text: '', width: 50 }).lastFrame() ?? '').split('\n')
    const keys = ansiRow(lines.at(-1) ?? '', 50)
      .map((c) => c.ch)
      .join('')
    expect(keys).toContain('send')
    expect(keys).toContain('esc clear')
    expect(keys).not.toContain('ctrl-c quit')
  })

  it('offers only what works: no tab or arrows without completions', () => {
    expect(homeKeys({ typing: true, completions: 0, commands: false })).toEqual({
      main: [['↵', 'send']],
      foot: [
        ['esc', 'clear'],
        ['ctrl-c', 'quit'],
      ],
    })
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
