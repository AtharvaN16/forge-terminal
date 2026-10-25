import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * Waits until the frame shows `text`, then a beat more for the screen's keys
 * to be listened for — the same walk as app-convert.test.tsx's, for the same
 * reason: on a busy machine a fixed pause can send a key to the wrong screen.
 */
async function until(lastFrame: () => string | undefined, text: string, ms = 10_000) {
  const shown = () => (lastFrame() ?? '').replace(SGR, '').includes(text)
  const start = Date.now()
  while (!shown() && Date.now() - start < ms) await settle(30)
  if (!shown()) throw new Error(`never showed "${text}":\n${(lastFrame() ?? '').replace(SGR, '')}`)
  await settle(100)
}

/**
 * Done (K3·a) draws no click-only "Open file · Show in Finder" labels, on any
 * terminal: `o` and `s` on its key row do the same, and the design has no row
 * for them. `mouse.js` is mocked to say clicks arrive, which is the case
 * the labels used to be drawn in.
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
  await until(app.lastFrame, 'Convert to')
  app.stdin.write(ENTER) // target
  await until(app.lastFrame, 'sharper')
  app.stdin.write(ENTER) // quality (JPEG default)
  await until(app.lastFrame, 'Save as')
  app.stdin.write(ENTER) // Save as -> runs
  await until(app.lastFrame, '↵ Home')
  return app
}

describe('Done, opening and showing the file', () => {
  for (const mouse of [true, false]) {
    it(`uses the key row, not clickable labels (mouse ${mouse ? 'on' : 'off'})`, async () => {
      const app = await renderResult(mouse)
      const frame = (app.lastFrame() ?? '').replace(SGR, '')
      expect(frame).not.toContain('Open file')
      expect(frame).toMatch(/o open +f \S+/)
      vi.doUnmock('../../src/shell/mouse.js')
    })
  }
})
