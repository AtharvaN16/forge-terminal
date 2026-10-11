import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shimmer } from '../../src/shell/components/Shimmer.js'
import {
  easeOut,
  mix,
  motionEnabled,
  setMotionForTests,
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
