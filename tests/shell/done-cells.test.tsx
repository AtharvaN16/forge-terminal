import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { DoneScreen } from '../../src/shell/components/Done.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import {
  ansiRow,
  type Cell,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/**
 * Done (K3·a) through Ink, cell for cell against the decided frames
 * (tests/shell/fixtures/done-mockup.json, made by
 * scripts/done-mockup-fixture.mjs from mockups/flow-parts-2-2026-10.html).
 */
const K3A = loadFixture('done-mockup.json') as Array<FixtureFrame & { key: string }>
const DESKTOP = join(homedir(), 'Desktop')
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

interface Sample {
  mode: ShellMode
  source: Partial<SourceInfo>
  out: string
  bytes: number
  answers: string[]
  again: string
  offer?: { format: string; sentence: string }
  warnings?: string[]
}

/** The page's sample results (`DJ`), as the app would have them. */
const SAMPLES: Record<string, Sample> = {
  cv: {
    mode: 'convert',
    source: { path: join(DESKTOP, 'test.png'), format: 'png', bytes: 122_000 },
    out: join(DESKTOP, 'test.jpg'),
    bytes: 74_600,
    answers: ['JPEG', '80', 'Desktop', 'test.jpg'],
    again: 'convert another',
  },
  cm: {
    mode: 'compress',
    source: { path: join(DESKTOP, 'photo.jpg'), format: 'jpeg', bytes: 2_400_000 },
    out: join(DESKTOP, 'photo.jpg'),
    bytes: 812_000,
    answers: ['By quality', '70', 'Desktop', 'photo.jpg'],
    again: 'compress again',
    offer: { format: 'WebP', sentence: '✧ WebP would be 590 KB, 27% smaller again.' },
  },
  gif: {
    mode: 'convert',
    source: { path: join(DESKTOP, 'party.gif'), format: 'gif', bytes: 1_100_000, frames: 12 },
    out: join(DESKTOP, 'party.png'),
    bytes: 1_600_000,
    answers: ['PNG', 'Desktop', 'party.png'],
    again: 'convert another',
    warnings: [
      'party.gif has 12 frames, and PNG cannot animate. Only the first frame was converted.',
    ],
  },
}

const resultOf = (s: Sample): Result => ({
  job: {
    op: 'convert',
    sources: [
      {
        kind: 'image',
        width: 100,
        height: 100,
        hasAlpha: false,
        frames: 1,
        ...s.source,
      } as SourceInfo,
    ],
    outputs: [s.out],
    target: 'jpeg',
    options: { background: '#ffffff', keepMetadata: false },
  },
  outputBytes: s.bytes,
  warnings: (s.warnings ?? []).map((message) => ({ code: 'animation-flattened', message })),
})

const screen = (s: Sample) =>
  render(
    <ThemeProvider palette={modePalette(DARK, s.mode)}>
      <DoneScreen
        mode={s.mode}
        trail={{ answers: s.answers, current: 'Done' }}
        result={resultOf(s)}
        offers={s.offer ? [s.offer.sentence] : []}
        again={s.again}
        offer={s.offer?.format}
        reveal="Show in Finder"
        width={80}
        height={24}
      />
    </ThemeProvider>,
  ).lastFrame() ?? ''

/** The rows where the app knowingly differs from the frame, as decided. */
const CHANGE_ROW = 14
function expected(frame: FixtureFrame, row: number, mode: ShellMode): Cell[] {
  const p = modePalette(DARK, mode)
  return fixtureRow(frame, row).map((c) => ({
    ...c,
    // The after panel's fill is `panelBand` (decided over the frame's #3d3d3d).
    bg: c.bg === '#3d3d3d' ? DARK.panelBand : c.bg,
    // The offer is drawn in the screen's accent, as today's is.
    fg: c.fg === '#55c7d9' && c.ch !== '│' && c.ch !== '▼' ? p.accent : c.fg,
  }))
}

describe('Done through Ink, against K3·a', () => {
  for (const frame of K3A) {
    const s = SAMPLES[frame.key] as Sample
    it(`draws ${frame.label} as the mockup does`, () => {
      const lines = screen(s).split('\n')
      expect(lines).toHaveLength(24)
      for (let r = 1; r < 24; r++) {
        if (r === CHANGE_ROW) continue
        const got = describeRow(ansiRow(lines[r] ?? ''), expected(frame, r, s.mode))
        expect(`row ${r}: ${got}`).toBe(`row ${r}: equal`)
      }
    })

    it(`ends ${frame.label}'s change where the longer panel ends`, () => {
      const row = ansiRow(screen(s).split('\n')[CHANGE_ROW] ?? '')
      const want = fixtureRow(frame, CHANGE_ROW)
      // The phrase is today's (one decimal); the mockup rounds its sample.
      expect(row[77]).toEqual(want[77])
      expect(row[78]).toEqual(want[78])
    })
  }

  it('heads the screen with the bar, its trail ending in Done', () => {
    const top = screen(SAMPLES.cv as Sample).split('\n')[0] ?? ''
    expect(top.replace(SGR, '')).toMatch(/JPEG ╱ 80 ╱ Desktop ╱ test\.jpg ╱ Done ╱╱ *$/)
  })
})
