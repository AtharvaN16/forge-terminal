import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/**
 * A target no encoder can reach: 1 byte. The search walks its whole bounded
 * ladder, misses, and lands on the screen under test.
 */
async function toUnreachable() {
  const dir = await makeTempDir()
  const file = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(300)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(800)

  app.stdin.write(DOWN) // To a target size
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write('1b')
  await settle(400)
  app.stdin.write(ENTER) // size
  await settle(600)
  app.stdin.write(ENTER) // Save as -> search runs and misses
  // Waited on rather than slept through: under a full suite's load the
  // search can take longer than any fixed pause.
  const start = Date.now()
  while (
    !(app.lastFrame() ?? '').includes('Try a different target size') &&
    Date.now() - start < 30_000
  ) {
    await settle(100)
  }
  // The screen is drawn a moment before Ink attaches its key handler (an
  // effect); a key sent in that gap is dropped, and ↵ then took the lowest quality.
  await settle()
  return app
}

describe('the not-found screen after an unreachable target size', () => {
  it('offers a way back to the size field and to quality, not just lowest/convert', async () => {
    const app = await toUnreachable()
    const frame = app.lastFrame() ?? ''

    expect(frame).toContain('Try a different target size')
    expect(frame).toContain('Compress by quality instead')
  }, 60_000)

  it('returns to the size field when that is chosen', async () => {
    const app = await toUnreachable()

    app.stdin.write(DOWN) // past "use the lowest quality"
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    expect(app.lastFrame()).toContain('Target size')
  }, 60_000)
})
