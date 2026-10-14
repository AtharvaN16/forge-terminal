import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shimmer } from '../../src/shell/components/Shimmer.js'
import {
  blendRows,
  easeOut,
  mix,
  motionEnabled,
  setMotionForTests,
  useBlendedRows,
  useTicker,
  useTween,
} from '../../src/shell/motion.js'

describe('mix', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('blends each channel in between', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#305070', 0.5)).toBe('#203850')
  })

  it('clamps outside 0..1', () => {
    expect(mix('#000000', '#ffffff', -3)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 9)).toBe('#ffffff')
  })

  it('snaps at the midpoint when either side is not a hex colour', () => {
    expect(mix('cyan', '#ffffff', 0.4)).toBe('cyan')
    expect(mix('cyan', '#ffffff', 0.6)).toBe('#ffffff')
    expect(mix('#000000', '', 1)).toBe('')
  })
})

describe('blendRows', () => {
  const ends = { canvas: '#000000', fg: '#ffffff' }
  const cells = (row: ReturnType<typeof blendRows>) =>
    row.flatMap((r) => Array.from(r.text, (ch) => ({ ch, fg: r.fg, bg: r.bg })))

  it('is the first row at 0 and the second at 1, cell for cell', () => {
    const a = [{ text: 'ab', fg: '#ff0000', bg: '#000000' }]
    const b = [{ text: 'cd', fg: '#00ff00', bg: '#202020' }]
    expect(cells(blendRows(a, b, 0, ends))).toEqual(cells(a))
    expect(cells(blendRows(a, b, 1, ends))).toEqual(cells(b))
  })

  it('mixes each cell’s colours in between where the glyphs stay', () => {
    const a = [{ text: 'a', fg: '#000000', bg: '#000000' }]
    const b = [{ text: 'a', fg: '#ffffff', bg: '#202020' }]
    expect(cells(blendRows(a, b, 0.25, ends))).toEqual([{ ch: 'a', fg: '#404040', bg: '#080808' }])
  })

  it('fades words that change out into the fill, then the new ones up, never mixing letters', () => {
    // Swapped letter by letter at the midpoint, two words showed as one
    // garble ("↓reDropsafile here"): the drop zone's line under a card's.
    const a = [{ text: 'ab', fg: '#ffffff', bg: '#000000' }]
    const b = [{ text: 'cb', fg: '#ffffff', bg: '#000000' }]
    expect(cells(blendRows(a, b, 0.25, ends))).toEqual([
      { ch: 'a', fg: '#808080', bg: '#000000' },
      { ch: 'b', fg: '#808080', bg: '#000000' },
    ])
    // Half way, nothing shows: the old ink has gone, the new not come.
    expect(cells(blendRows(a, b, 0.5, ends)).map((c) => [c.ch, c.fg])).toEqual([
      ['c', '#000000'],
      ['b', '#000000'],
    ])
    expect(cells(blendRows(a, b, 0.75, ends)).map((c) => [c.ch, c.fg])).toEqual([
      ['c', '#808080'],
      ['b', '#808080'],
    ])
  })

  it('fades a glyph up out of the fill of the blank it replaces', () => {
    const a = [{ text: ' ', bg: '#000000' }]
    const b = [{ text: 'x', fg: '#ffffff' }]
    // A blank shows only its fill; a missing fill is the canvas.
    expect(cells(blendRows(a, b, 0.5, ends))).toEqual([{ ch: 'x', fg: '#808080', bg: '#000000' }])
  })

  it('leaves a cell unfilled when neither row fills it', () => {
    // The canvas is a guess at the terminal's background: painting it where
    // nothing had a fill shows as dark patches on any other background.
    const a = [{ text: 'a ', fg: '#000000' }]
    const b = [{ text: ' b', fg: '#ffffff' }]
    expect(cells(blendRows(a, b, 0.5, ends)).map((c) => c.bg)).toEqual([undefined, undefined])
    expect(cells(blendRows([], b, 0.5, ends)).map((c) => c.bg)).toEqual([undefined, undefined])
  })

  it('pads the shorter row with blanks on the canvas', () => {
    const out = blendRows([{ text: 'a' }], [{ text: 'abc' }], 1, ends)
    expect(
      cells(out)
        .map((c) => c.ch)
        .join(''),
    ).toBe('abc')
  })
})

describe('easeOut', () => {
  it('starts at 0, ends at 1, and is ahead of linear in between', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })
})

describe('motionEnabled', () => {
  afterEach(() => setMotionForTests(undefined))

  it('is off for the neutral palette and off without a terminal', () => {
    expect(motionEnabled('neutral')).toBe(false)
    // vitest's stdout is not a TTY
    expect(motionEnabled('dark')).toBe(false)
  })

  it('can be forced for a test', () => {
    setMotionForTests(true)
    expect(motionEnabled('dark')).toBe(true)
    setMotionForTests(false)
    expect(motionEnabled('dark')).toBe(false)
  })
})

function TweenProbe({ k, onMount }: { k: unknown; onMount?: boolean }) {
  const t = useTween(k, 100, { enabled: true, ...(onMount ? { onMount } : {}) })
  return <Text>{`t=${t.toFixed(2)}`}</Text>
}

/** One row whose colour says which key it was drawn for: red for a, blue for b. */
function RowsProbe({ k, on = true }: { k: 'a' | 'b'; on?: boolean }) {
  const row = [{ text: 'x', fg: k === 'a' ? '#ff0000' : '#0000ff' }]
  const [shown] = useBlendedRows(k, [row], 100, { enabled: on, canvas: '#000000', fg: '#ffffff' })
  return <Text>{`fg=${shown?.[0]?.fg}`}</Text>
}

function TickerProbe({ active }: { active: boolean }) {
  return <Text>{`n=${useTicker(active, 50)}`}</Text>
}

/**
 * Only the clock and the interval are faked. React schedules its own work on
 * `setImmediate`; faking that too would freeze rendering, not time.
 */
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
}
const advance = async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await flush()
}

describe('useTween and useTicker', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }))
  afterEach(() => vi.useRealTimers())

  it('rests at 1 until its key changes', async () => {
    const app = render(<TweenProbe k="a" />)
    expect(app.lastFrame()).toBe('t=1.00')
    await advance(200)
    expect(app.lastFrame()).toBe('t=1.00')
  })

  it('runs from 0 to 1 after its key changes', async () => {
    const app = render(<TweenProbe k="a" />)
    app.rerender(<TweenProbe k="b" />)
    await flush()
    expect(app.lastFrame()).toBe('t=0.00')
    await advance(66)
    const mid = Number(app.lastFrame()?.slice(2))
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    await advance(100)
    expect(app.lastFrame()).toBe('t=1.00')
  })

  it('runs on mount when asked to', async () => {
    const app = render(<TweenProbe k="a" onMount />)
    expect(app.lastFrame()).toBe('t=0.00')
    await advance(150)
    expect(app.lastFrame()).toBe('t=1.00')
  })

  it('fades rows from what was drawn to what the new key draws', async () => {
    const app = render(<RowsProbe k="a" />)
    expect(app.lastFrame()).toBe('fg=#ff0000')
    app.rerender(<RowsProbe k="b" />)
    await flush()
    expect(app.lastFrame()).toBe('fg=#ff0000')
    await advance(33)
    expect(app.lastFrame()).not.toMatch(/#ff0000|#0000ff/)
    await advance(100)
    expect(app.lastFrame()).toBe('fg=#0000ff')
  })

  it('cuts straight to the new rows when not enabled', () => {
    const app = render(<RowsProbe k="a" on={false} />)
    app.rerender(<RowsProbe k="b" on={false} />)
    expect(app.lastFrame()).toBe('fg=#0000ff')
  })

  it('counts frames only while active', async () => {
    const app = render(<TickerProbe active />)
    await flush()
    await advance(160)
    expect(app.lastFrame()).toBe('n=3')
    app.rerender(<TickerProbe active={false} />)
    await advance(500)
    expect(app.lastFrame()).toBe('n=3')
  })
})

describe('Shimmer', () => {
  afterEach(() => setMotionForTests(undefined))

  it('is plain text when motion is off', () => {
    setMotionForTests(false)
    expect(
      render(<Shimmer text="measuring…" base="#8b93a6" highlight="#e4e8f0" />).lastFrame(),
    ).toBe('measuring…')
  })

  it('says the same words when motion is on', () => {
    setMotionForTests(true)
    expect(
      render(<Shimmer text="measuring…" base="#8b93a6" highlight="#e4e8f0" />).lastFrame(),
    ).toBe('measuring…')
  })
})
