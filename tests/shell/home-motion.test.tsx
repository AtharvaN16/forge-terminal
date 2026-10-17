import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { INTRO_MS } from '../../src/shell/home-art.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import type { StagedView } from '../../src/shell/stage.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, type ShellMode } from '../../src/shell/theme.js'

/** Truecolor, read by chalk once at import — so set before Ink loads. */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

/** Only the clock and intervals are faked; React schedules on setImmediate. */
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
}
const advance = async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await flush()
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }))
afterEach(() => {
  vi.useRealTimers()
  setMotionForTests(undefined)
})

/**
 * Home with a path typed, so the drop zone's idle ripple holds still and
 * only a mode change can move anything.
 */
function home(mode: ShellMode, staged?: StagedView, intro = false) {
  const text = staged || intro ? '' : '~/Desk'
  return (
    <ThemeProvider palette={DARK}>
      <Home
        width={80}
        height={24}
        mode={mode}
        typing={text !== ''}
        staged={staged}
        intro={intro}
        field={
          <Prompt
            value={text}
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="or type a path"
            isActive
            variant="home"
            width={80}
          />
        }
        keys={homeKeys({ typing: true, completions: 0, menu: false })}
      />
    </ThemeProvider>
  )
}

function still(mode: ShellMode, staged?: StagedView) {
  setMotionForTests(false)
  const app = render(home(mode, staged))
  const frame = app.lastFrame()
  app.unmount()
  return frame
}

describe('a mode change on home (M1b)', () => {
  it('fades the band, the tabs and the drop zone from one mode to the next', async () => {
    const from = still('convert')
    const to = still('compress')
    setMotionForTests(true)
    const app = render(home('convert'))
    await flush()
    expect(app.lastFrame()).toBe(from)
    app.rerender(home('compress'))
    await flush()
    await advance(66)
    const mid = app.lastFrame()
    expect(mid).not.toBe(from)
    expect(mid).not.toBe(to)
    await advance(300)
    expect(app.lastFrame()).toBe(to)
    app.unmount()
  })

  it('cuts straight to the new mode with motion off', () => {
    const to = still('compress')
    setMotionForTests(false)
    const app = render(home('convert'))
    app.rerender(home('compress'))
    expect(app.lastFrame()).toBe(to)
    app.unmount()
  })
})

describe('a file landing on home (M2a)', () => {
  const file = { name: 'Id card.png', tag: 'PNG', size: '1.9 MB', facts: '2480×1748 · 1.9 MB' }
  const view = (fresh: number): StagedView => ({
    files: [file],
    headline: '1 image',
    total: '1.9 MB',
    fresh,
  })

  it('runs one ring through the card’s dots as it lands, then rests', async () => {
    const rest = still('convert', view(1))
    setMotionForTests(true)
    const app = render(home('convert'))
    await flush()
    app.rerender(home('convert', view(1)))
    await flush()
    await advance(200)
    expect(app.lastFrame()).not.toBe(rest)
    await advance(500)
    expect(app.lastFrame()).toBe(rest)
    app.unmount()
  })

  it('does not ring again while the same file sits there', async () => {
    const rest = still('convert', view(0))
    setMotionForTests(true)
    const app = render(home('convert', view(0)))
    await flush()
    await advance(200)
    expect(app.lastFrame()).toBe(rest)
    app.unmount()
  })
})

describe('the launch (M8b)', () => {
  /** The band and the tabs: rows 1 to 6. The drop zone below has its own ripple. */
  const top = (f: string | undefined) => (f ?? '').split('\n').slice(1, 7)
  const plainTop = (f: string | undefined) =>
    top(f).map((l) => l.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ''))
  const rest = () => {
    setMotionForTests(false)
    const app = render(home('convert', undefined, true))
    const frame = app.lastFrame()
    app.unmount()
    return frame
  }

  it('draws the band in from nothing, once, then rests', async () => {
    const still = rest()
    setMotionForTests(true)
    const app = render(home('convert', undefined, true))
    await flush()
    expect(plainTop(app.lastFrame()).slice(0, 3).join('').trim()).toBe('')
    await advance(INTRO_MS / 2)
    const part = plainTop(app.lastFrame()).join('')
    expect(part).toContain('╱')
    expect(part).not.toBe(plainTop(still).join(''))
    await advance(INTRO_MS)
    expect(top(app.lastFrame())).toEqual(top(still))
    app.unmount()
  })

  it('lets any key cut it short: the band is there at once', async () => {
    const still = rest()
    setMotionForTests(true)
    const app = render(home('convert', undefined, true))
    await flush()
    app.stdin.write('x')
    await flush()
    expect(top(app.lastFrame())).toEqual(top(still))
    app.unmount()
  })

  it('is not played without being asked for', async () => {
    const still = rest()
    setMotionForTests(true)
    const app = render(home('convert', undefined, false))
    await flush()
    expect(top(app.lastFrame())).toEqual(top(still))
    app.unmount()
  })
})
