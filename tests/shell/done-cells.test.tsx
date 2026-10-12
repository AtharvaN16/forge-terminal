import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { DoneScreen, doneFacts } from '../../src/shell/components/Done.js'
import { doneBody, doneLayout } from '../../src/shell/done-art.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type ShellMode } from '../../src/shell/theme.js'
import { ansiRow, describeRow, runsRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/**
 * Done (B6a) through Ink, cell for cell: the screen draws exactly the rows
 * `doneBody` makes (held to the decision in done-art.test.ts), where
 * `doneLayout` puts them, under the bar and over the rule and keys.
 */
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

const doneScreen = (
  s: Sample,
  { pressed, result = resultOf(s) }: { pressed?: { key: string; n: number }; result?: Result } = {},
) => (
  <ThemeProvider palette={modePalette(DARK, s.mode)}>
    <DoneScreen
      mode={s.mode}
      trail={{ answers: s.answers, current: 'Done' }}
      result={result}
      offers={s.offer ? [s.offer.sentence] : []}
      again={s.again}
      offer={s.offer?.format}
      reveal="Show in Finder"
      width={80}
      height={24}
      pressed={pressed}
    />
  </ThemeProvider>
)
const screenApp = (s: Sample) => render(doneScreen(s))
const screen = (s: Sample) => screenApp(s).lastFrame() ?? ''

describe('Done through Ink (B6a)', () => {
  for (const [key, s] of Object.entries(SAMPLES)) {
    it(`draws ${key}'s body where the layout puts it, cell for cell`, () => {
      const lines = screen(s).split('\n')
      expect(lines).toHaveLength(24)
      const p = modePalette(DARK, s.mode)
      const result = resultOf(s)
      const body = doneBody({ palette: p, facts: doneFacts(result, s.mode), width: 80 })
      const notes = (s.offer ? 1 : 0) + (s.warnings ? 2 : 0)
      const { top } = doneLayout({ height: 24, body: body.length, notes })
      body.forEach((row, i) => {
        const r = 2 + top + i
        const got = describeRow(ansiRow(lines[r] ?? ''), runsRow(row))
        expect(`row ${r}: ${got}`).toBe(`row ${r}: equal`)
      })
    })

    it(`puts ${key}'s keys on the last row, under a rule`, () => {
      const lines = screen(s).split('\n')
      expect(
        describeRow(ansiRow(lines[22] ?? ''), runsRow([{ text: '─'.repeat(80), fg: DARK.border }])),
      ).toBe('equal')
      expect((lines[23] ?? '').replace(SGR, '')).toMatch(/^ {4}↵ /)
    })
  }

  it('heads the screen with the bar, its trail ending in Done', () => {
    const top = screen(SAMPLES.cv as Sample).split('\n')[0] ?? ''
    expect(top.replace(SGR, '')).toMatch(/JPEG ╱ 80 ╱ Desktop ╱ test\.jpg ╱ Done ╱╱ *$/)
  })
})

describe('the bar draws itself once (M5a)', () => {
  const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
  }
  afterEach(() => {
    vi.useRealTimers()
    setMotionForTests(undefined)
  })
  const cv = SAMPLES.cv as Sample
  /** The bar's middle row: the name, and the change once it is written. */
  const at = 2 + doneLayout({ height: 24, body: 6, notes: 0 }).top + 2
  const mid = (frame: string) => (frame.split('\n')[at] ?? '').replace(SGR, '')

  it('opens with the band at the old length and the change unwritten, then rests', async () => {
    setMotionForTests(false)
    const rest = screen(cv)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    setMotionForTests(true)
    const app = screenApp(cv)
    await flush()
    expect(mid(app.lastFrame() ?? '')).toContain('✓ test.jpg')
    expect(mid(app.lastFrame() ?? '')).not.toContain('smaller')
    vi.advanceTimersByTime(800)
    await flush()
    expect(app.lastFrame()).toBe(rest)
  })

  it('is at rest from the first frame with motion off', () => {
    setMotionForTests(false)
    expect(mid(screen(cv))).toContain('47.4 KB saved · 38.9% smaller')
  })
})

describe('a pressed key answers at once (M6b)', () => {
  const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
  }
  afterEach(() => {
    vi.useRealTimers()
    setMotionForTests(undefined)
  })
  const cv = SAMPLES.cv as Sample
  const keys = (frame: string) => frame.split('\n')[23] ?? ''
  /** The SGR fill of a hex colour, as Ink writes it in truecolor. */
  const fill = (hex: string) =>
    new RegExp(
      `48;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}m(?:${SGR.source})* o `,
    )

  it('turns the keycap white for a moment, then puts it back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    setMotionForTests(true)
    const result = resultOf(cv)
    const app = render(doneScreen(cv, { result }))
    vi.advanceTimersByTime(1000)
    await flush()
    const rest = keys(app.lastFrame() ?? '')
    expect(rest).toMatch(fill(DARK.keycapBg))
    app.rerender(doneScreen(cv, { result, pressed: { key: 'o', n: 1 } }))
    await flush()
    expect(keys(app.lastFrame() ?? '')).toMatch(fill(DARK.fg))
    vi.advanceTimersByTime(200)
    await flush()
    expect(keys(app.lastFrame() ?? '')).toBe(rest)
  })

  it('does not flash with motion off', () => {
    setMotionForTests(false)
    const result = resultOf(cv)
    const app = render(doneScreen(cv, { result }))
    const rest = keys(app.lastFrame() ?? '')
    app.rerender(doneScreen(cv, { result, pressed: { key: 'o', n: 1 } }))
    expect(keys(app.lastFrame() ?? '')).toBe(rest)
  })
})
