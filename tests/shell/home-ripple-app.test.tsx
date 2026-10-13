import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { RIPPLE } from '../../src/shell/home-art.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/** Truecolor, read by chalk once at import — so set before Ink loads. */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g
const plain = (f: string | undefined) => (f ?? '').replace(ANSI, '')
/** Every `·` on the screen: the grid's dots, and a few fixed ones in the words and keys. */
const dots = (f: string | undefined) => plain(f).split('·').length - 1

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

function home(text = '') {
  const typing = text !== ''
  return (
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <Home
        width={80}
        height={24}
        mode="convert"
        typing={typing}
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
        keys={homeKeys({ typing, completions: 0, commands: false })}
      />
    </ThemeProvider>
  )
}

/** The screen with the dots still: what motion off draws. */
function stillFrame(text = '') {
  setMotionForTests(false)
  const app = render(home(text))
  const frame = app.lastFrame()
  app.unmount()
  return frame
}

describe('the drop zone’s ripple on the home screen', () => {
  it('starts empty, fills in as the ring crosses, then fades out and comes again', async () => {
    const still = stillFrame()
    setMotionForTests(true)
    const app = render(home())
    await flush()
    // The grid's dots are all missing; only the fixed ones are left.
    const fixed = dots(app.lastFrame())
    expect(dots(still) - fixed).toBeGreaterThan(100)

    await advance(RIPPLE.ring * 0.3)
    const part = dots(app.lastFrame())
    expect(part).toBeGreaterThan(fixed)
    expect(part).toBeLessThan(dots(still))

    await advance(RIPPLE.ring * 0.7 + RIPPLE.hold / 2)
    expect(plain(app.lastFrame())).toBe(plain(still))

    await advance(RIPPLE.hold / 2 + RIPPLE.fade + RIPPLE.gap / 2)
    expect(dots(app.lastFrame())).toBe(fixed)

    await advance(RIPPLE.gap / 2 + RIPPLE.ring * 0.3)
    expect(dots(app.lastFrame())).toBeGreaterThan(fixed)
    app.unmount()
  })

  it('with motion off, is the still surface and does not change', async () => {
    const still = stillFrame()
    setMotionForTests(false)
    const app = render(home())
    await flush()
    expect(app.lastFrame()).toBe(still)
    await advance(RIPPLE.ring / 2)
    expect(app.lastFrame()).toBe(still)
    app.unmount()
  })

  it('holds still, stepped back, while a path is typed', async () => {
    const still = stillFrame('~/Desk')
    setMotionForTests(true)
    const app = render(home('~/Desk'))
    await flush()
    expect(app.lastFrame()).toBe(still)
    await advance(RIPPLE.ring / 2)
    expect(app.lastFrame()).toBe(still)
    app.unmount()
  })
})
