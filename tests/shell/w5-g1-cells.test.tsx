import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QualityStep } from '../../src/shell/components/QualityStep.js'
import { Working } from '../../src/shell/components/Working.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import {
  ansiRow,
  type Cell,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  shifted,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})
afterEach(() => {
  setMotionForTests(undefined)
  vi.useRealTimers()
})

const W5 = loadFixture('working-mockup.json') as Array<FixtureFrame & { t: number }>
const G1 = loadFixture('quality-mockup.json') as Array<FixtureFrame & { q: number }>
const lines = (f: string | undefined) => (f ?? '').split('\n')

// The kit draws step rows three cells in; the app draws them on its margin
// (two cells in, 2026-10-20), so each mockup row is held one cell to the left.
const onMargin = (cells: Cell[]) => shifted(cells, 1)

describe('Working through Ink, against W5, on the app’s margin (2026-10-20)', () => {
  it('draws the line as the mockup does, four seconds in', () => {
    setMotionForTests(true)
    // The clock and the spinner both read the time: frozen, the line is the
    // one 4.0 s in on its first spinner frame, however slow the runner is.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const frame = W5.find((f) => f.label === 'convert at 4s') as FixtureFrame
    const { lastFrame } = render(
      <ThemeProvider palette={modePalette(DARK, 'convert')}>
        <Working mode="convert" label="Encoding AVIF" startedAt={Date.now() - 4000} width={80} />
      </ThemeProvider>,
    )
    expect(describeRow(ansiRow(lines(lastFrame())[0] ?? ''), onMargin(fixtureRow(frame, 7)))).toBe(
      'equal',
    )
  })

  it('draws the page bar as the mockup does', () => {
    setMotionForTests(false)
    const frame = W5.find((f) => f.label === 'pdf at 1s') as FixtureFrame
    const { lastFrame } = render(
      <ThemeProvider palette={modePalette(DARK, 'pdf')}>
        <Working
          mode="pdf"
          label="Splitting report.pdf"
          startedAt={Date.now()}
          pages={{ done: 3, total: 12 }}
          width={80}
        />
      </ThemeProvider>,
    )
    expect(describeRow(ansiRow(lines(lastFrame())[2] ?? ''), onMargin(fixtureRow(frame, 9)))).toBe(
      'equal',
    )
  })
})

describe('Quality through Ink, against G1, on the app’s margin (2026-10-20)', () => {
  for (const q of [80, 35, 100]) {
    it(`draws the title, the slider at ${q} and its ends as the mockup does`, () => {
      const frame = G1.find((f) => f.q === q) as FixtureFrame
      const { lastFrame } = render(
        <ThemeProvider palette={modePalette(DARK, 'convert')}>
          <QualityStep
            mode="convert"
            aside="JPEG"
            min={1}
            max={100}
            step={5}
            value={q}
            onChange={() => {}}
            onSubmit={() => {}}
            onCancel={() => {}}
            size={{ status: 'measuring' }}
            sourceBytes={1000}
            width={80}
          />
        </ThemeProvider>,
      )
      const drawn = lines(lastFrame())
      expect(describeRow(ansiRow(drawn[0] ?? ''), onMargin(fixtureRow(frame, 0)))).toBe('equal')
      expect(describeRow(ansiRow(drawn[2] ?? ''), onMargin(fixtureRow(frame, 1)))).toBe('equal')
      expect(describeRow(ansiRow(drawn[3] ?? ''), onMargin(fixtureRow(frame, 2)))).toBe('equal')
    })
  }
})
