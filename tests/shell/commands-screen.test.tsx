import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../src/shell/commands.js'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import { ansiRow, describeHomeRow, type FixtureFrame, homeRow, loadFixture } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

type Step = FixtureFrame & { selected?: string }
const STEPS = loadFixture('commands-mockup.json') as Step[]

/** Home with `text` in the field and, when it opens a command, the list in the panel. */
function screen({
  mode,
  text,
  selected,
  width = 80,
  height = 24,
}: {
  mode: ShellMode
  text: string
  selected?: string | undefined
  width?: number
  height?: number
}) {
  const list = text.startsWith('/') ? listCommands(text.slice(1)) : undefined
  const commands = list && {
    ...list,
    selected: Math.max(
      0,
      list.items.findIndex((c) => c.name === selected),
    ),
  }
  return render(
    <ThemeProvider palette={modePalette(DARK, mode)}>
      <Home
        width={width}
        height={height}
        mode={mode}
        typing={text !== ''}
        savesTo="~/Desktop"
        commands={commands}
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
        keys={homeKeys({ typing: text !== '', completions: 0, commands: commands !== undefined })}
      />
    </ThemeProvider>,
  )
}

/**
 * The panel's last column, where the scroll bar goes when the list is longer
 * than the panel (S2, mockups/commands-scroll-2026-10.html). The N6 mockup
 * predates it; commands-scroll.test.ts holds the bar itself.
 */
const BAR_COLUMN = 77

function expectStep(step: Step, skip: number[] = [], bar = false) {
  const lines = (screen(step).lastFrame() ?? '').split('\n')
  expect(lines).toHaveLength(24)
  for (let row = 0; row < 24; row++) {
    if (skip.includes(row)) continue
    const actual = ansiRow(lines[row] ?? '')
    if (bar) {
      const want = homeRow(step, row)[BAR_COLUMN]
      if (want && actual[BAR_COLUMN]) actual[BAR_COLUMN] = want
    }
    expect(describeHomeRow(actual, homeRow(step, row)), `${step.label}, row ${row}`).toBe('equal')
  }
}

describe('commands as a fourth tab of home (N6), against the decided mockup', () => {
  const [rest, slash, filtered, after] = STEPS as [Step, Step, Step, Step]

  // Row 23, the key row, says "1–5 ←→ mode" since ←→ step through the modes
  // (2026-10-13), after this mockup; mode-arrows-app.test.tsx holds it.
  it('1 · home: "/ commands" waits, dim, after the modes', () => expectStep(rest, [23]))
  // The mockup's list has three modes; colour is the fourth (colour spec
  // §6.1) and enhance the fifth, and /extensions a second setting
  // (mockups/extensions-2026-10.html), so the rows from colour's onward differ
  // from it by design. Those rows are held below by what they say, in order.
  // The longer list pushes the field's shelf (round 5, P2) down to row 21.
  const fromRow = (r: number) => Array.from({ length: 22 - r }, (_, i) => r + i)
  // While the list is open the band (rows 1–3) and the "/" on the tab row
  // (6) are the commands' gold (K1, round 5), not the mode's colour as in the
  // mockup; light-l6.test.tsx holds them. Row 8, the "modes" heading, is
  // gold with a rule after it (C1).
  const GOLD = [1, 2, 3, 6, 8]
  it('2 · typed /: the tab lights and the panel holds the list', () =>
    expectStep(slash, [...GOLD, ...fromRow(12)], true))
  it('3 · typed /co, then ↓: the list narrows and the strip moves', () =>
    expectStep(filtered, [...GOLD, ...fromRow(11)]))
  // Row 11 is compress's kinds line, which leaves out the mockup's "video":
  // compress has no video engine (see home-screen.test.tsx).
  it('4 · pressed ↵ on /compress: compress, with the dots back', () => expectStep(after, [11, 23]))
})

describe('the list in the panel', () => {
  const text = (frame: string | undefined) =>
    (frame ?? '').split('\n').map((l) =>
      ansiRow(l)
        .map((c) => c.ch)
        .join(''),
    )

  it('has no /help row, and /help typed opens the whole list', () => {
    const lines = text(screen({ mode: 'convert', text: '/help' }).lastFrame())
    const rows = lines.filter((l) => !l.includes('›'))
    expect(rows.join('\n')).not.toContain('/help')
    for (const name of ['/convert', '/compress', '/pdf', '/theme'])
      expect(lines.some((l) => l.includes(name))).toBe(true)
  })

  it('lists colour then enhance after pdf among the modes, and under /co after compress', () => {
    const all = text(screen({ mode: 'convert', text: '/' }).lastFrame()).join('\n')
    expect(all.indexOf('/colour')).toBeGreaterThan(all.indexOf('/pdf'))
    expect(all.indexOf('/enhance')).toBeGreaterThan(all.indexOf('/colour'))
    expect(all.indexOf('/enhance')).toBeLessThan(all.indexOf('/theme'))
    expect(all.indexOf('/extensions')).toBeGreaterThan(all.indexOf('/theme'))
    expect(all).not.toContain('/boost')
    const co = text(screen({ mode: 'convert', text: '/co' }).lastFrame()).join('\n')
    expect(co.indexOf('/colour')).toBeGreaterThan(co.indexOf('/compress'))
  })

  it('says so in the panel when nothing matches', () => {
    const lines = text(screen({ mode: 'convert', text: '/zz' }).lastFrame())
    expect(lines.some((l) => l.includes('no command matches /zz'))).toBe(true)
    expect(lines.some((l) => l.includes('Drop a file here'))).toBe(false)
  })

  it('never says "or press" on a row', () => {
    const frame = text(screen({ mode: 'convert', text: '/', selected: 'pdf' }).lastFrame())
    expect(frame.join('\n')).not.toContain('or press')
  })

  it('fills exactly the height it is given, list and all', () => {
    for (const height of [12, 16, 19, 20, 24, 30]) {
      const lines = (screen({ mode: 'convert', text: '/', height }).lastFrame() ?? '').split('\n')
      expect(lines, `height ${height}`).toHaveLength(height)
      expect(lines.at(-1), `height ${height}`).toContain('run')
    }
  })

  it('never draws past the width it is given', () => {
    for (const width of [40, 60, 100]) {
      const lines = (screen({ mode: 'convert', text: '/', width }).lastFrame() ?? '').split('\n')
      for (const line of lines)
        expect(ansiRow(line, 400).findLastIndex((c) => c.ch !== ' ' || c.bg !== null)).toBeLessThan(
          width,
        )
    }
  })
})

describe('the key row while the list is open', () => {
  it('runs, goes back, and says typing filters', () => {
    expect(homeKeys({ typing: true, completions: 0, commands: true })).toEqual({
      main: [
        ['↵', 'run'],
        ['esc', 'back'],
      ],
      foot: [
        ['↑↓', 'choose'],
        ['type', 'filter'],
        ['ctrl-c', 'quit'],
      ],
    })
  })

  it('no longer says "/ commands" at rest: the tab row does', () => {
    expect(homeKeys({ typing: false, completions: 0, commands: false }).main).toEqual([
      ['↵', 'send'],
    ])
  })
})
