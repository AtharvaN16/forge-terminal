import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import {
  ansiRow,
  describeHomeRow,
  type FixtureFrame,
  homeRow,
  loadFixture,
  runsRow,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

type Step = FixtureFrame & { selected?: string }
const STEPS = loadFixture('commands-mockup.json') as Step[]

/**
 * Home with `text` in the field. The list these steps open is a popup over
 * home now (2026-10-17, "/ menu" 1–7), drawn by the App rather than by Home,
 * so only the steps before and after it are held here; menu-popup-app.test.tsx
 * holds the popup.
 */
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
  return render(
    <ThemeProvider palette={modePalette(DARK, mode)}>
      <Home
        width={width}
        height={height}
        mode={mode}
        typing={text !== ''}
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
        keys={homeKeys({ typing: text !== '', completions: 0 })}
      />
    </ThemeProvider>,
  )
}

// The rule above the keys sits on the app's margins since 2026-10-20: two
// columns in from each side, where the mockup drew it the full width.
const RULE = 22
const rule = () => runsRow([{ text: '  ' }, { text: '─'.repeat(76), fg: DARK.border }])

function expectStep(step: Step, skip: number[] = []) {
  const lines = (screen(step).lastFrame() ?? '').split('\n')
  expect(lines).toHaveLength(24)
  for (let row = 0; row < 24; row++) {
    if (skip.includes(row)) continue
    const got = ansiRow(lines[row] ?? '')
    const expected = row === RULE ? rule() : homeRow(step, row)
    expect(describeHomeRow(got, expected), `${step.label}, row ${row}`).toBe('equal')
  }
}

describe('commands as a fourth tab of home (N6), against the decided mockup', () => {
  const [rest, , , after] = STEPS as [Step, Step, Step, Step]

  // Row 23, the key row, says "1–6 ←→ mode" since ←→ step through the modes
  // (2026-10-13), after this mockup; mode-arrows-app.test.tsx holds it.
  // Rows 10 and 11 are the drop zone's heading and kinds line, which name the
  // formats themselves since 2026-10-18; the longer line clears more dots
  // (see home-screen.test.tsx).
  it('1 · home: "/ menu" waits, dim, after the modes', () => {
    expectStep(rest, [10, 11, 23])
    // On the app's right margin since 2026-10-20, two columns short of the edge.
    const row = ansiRow((screen(rest).lastFrame() ?? '').split('\n')[21] ?? '')
    expect(row.map((c) => c.ch).join('')).toBe(`${' '.repeat(70)} /  menu  `)
  })
  it('4 · pressed ↵ on /compress: compress, with the dots back', () =>
    expectStep(after, [10, 11, 23]))
})

describe('the key row at rest', () => {
  it('no longer says "/ menu": the tab row does — nor ↵, with nothing to send (2026-10-19)', () => {
    expect(homeKeys({ typing: false, completions: 0 }).main).toEqual([])
    expect(JSON.stringify(homeKeys({ typing: false, completions: 0 }))).not.toContain('menu')
  })
})
