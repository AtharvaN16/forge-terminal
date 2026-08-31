import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/**
 * A scan is the slow case on purpose: its ladder is several rungs of real
 * encodes, so the search is genuinely still running when esc arrives — which
 * is the state that used to have no way out but quitting the app.
 */
async function toRunningSearch() {
  const dir = await makeTempDir()
  const file = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 4 })
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(800)

  app.stdin.write(DOWN) // To a target size
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write('80kb')
  await settle()
  app.stdin.write(ENTER)
  await settle(500)
  app.stdin.write(ENTER) // destination
  await settle(300)
  app.stdin.write(ENTER) // name -> search starts
  await settle(600)
  return { ...app, dir }
}

describe('cancelling a target-size search', () => {
  it('offers esc while the search runs, and steps back to the size field', async () => {
    const app = await toRunningSearch()

    expect(app.lastFrame()).toContain('esc')

    app.stdin.write(ESC)
    // Deliberately short: esc must answer on the keystroke, not once the
    // encode already in flight happens to finish. That wait is seconds long
    // for a scan, and waiting it out is the dead end this fixes.
    await settle(250)

    // Back at the step before the search — not the prompt, and not stuck on a
    // screen with no way out.
    expect(app.lastFrame()).toContain('Target size')
  }, 60_000)
})
