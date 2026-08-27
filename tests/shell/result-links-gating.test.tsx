import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

/**
 * Whether the click-only "Open file · Show in Finder" line is worth
 * drawing at all depends on the terminal, not just on app-level hit
 * testing — see `mouseSupported`'s doc comment in `mouse.ts` for why
 * Terminal.app calibrates and reports mouse *reporting* enabled while
 * still never delivering a click. `supports-hyperlinks`'s own detection
 * runs once at import time off `process.env`, which is awkward to flip
 * between tests in the same process, so this mocks `mouse.js` directly —
 * the one thing `App.tsx` actually calls.
 */
async function renderResult(mouseSupported: boolean) {
  vi.resetModules()
  vi.doMock('../../src/shell/mouse.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/shell/mouse.js')>()
    return { ...actual, mouseSupported: () => mouseSupported }
  })
  const { App } = await import('../../src/shell/App.js')
  const dir = await makeTempDir()
  const file = await makePng(dir, 'a.png')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // submits the dropped path -> target picker
  await settle(300)
  app.stdin.write(ENTER) // target
  await settle(300)
  app.stdin.write(ENTER) // quality (JPEG default)
  await settle(300)
  app.stdin.write(ENTER) // destination
  await settle(300)
  app.stdin.write(ENTER) // name -> runs
  await settle(1500)
  return app
}

describe('result screen links, gated on terminal support', () => {
  it('draws Open file / Show in Finder when the terminal supports mouse clicks', async () => {
    const app = await renderResult(true)
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('Open file')
    expect(frame).toContain('Show in Finder')
    vi.doUnmock('../../src/shell/mouse.js')
  })

  it('hides them on a terminal that cannot deliver a click, keeping the keyboard hints', async () => {
    const app = await renderResult(false)
    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('Open file')
    expect(frame).not.toContain('Show in Finder')
    // The same actions, still reachable without a mouse.
    expect(frame).toContain('o open')
    expect(frame).toContain('show in finder')
    vi.doUnmock('../../src/shell/mouse.js')
  })
})
