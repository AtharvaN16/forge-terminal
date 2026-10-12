import { chmod } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const locked: string[] = []
afterEach(async () => {
  for (const dir of locked.splice(0)) await chmod(dir, 0o755)
})

/**
 * Phase 3's rule is "completing an action clears the stage", so that
 * converting `a.jpg` and then dropping `b.jpg` starts fresh instead of
 * staging both. A run that *failed* used to skip the clear: the file stayed
 * staged, and the natural recovery — drop it again, or drop another — built a
 * two-file batch the convert flow then refused (UX audit #7).
 */
describe('a conversion that fails', () => {
  it('ends the action, so the next drop starts fresh', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    await chmod(out, 0o555) // the default destination cannot be written to
    locked.push(out)
    const big = await makeJpeg(dir, 'big.jpg')
    const photo = await makeJpeg(dir, 'photo.jpg')

    const app = render(
      <App
        initialWidth={100}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: out }}
      />,
    )
    app.stdin.write(big)
    await settle()
    app.stdin.write(ENTER) // probe -> target picker
    await settle(300)
    app.stdin.write(ENTER) // first target (lossless, so no quality step)
    await settle()
    app.stdin.write(ENTER) // the read-only default destination
    await settle()
    app.stdin.write(ENTER) // accept the proposed name -> runs, and fails
    await settle(600)
    // The run's failure is the E5 panel in the scrollback: the tab on its edge.
    expect(app.lastFrame() ?? '').toMatch(/^\s+failed\s*$/m)

    app.stdin.write(photo)
    await settle()
    app.stdin.write(ENTER)
    await settle(300)

    const frame = app.lastFrame() ?? ''
    // `big.jpg` is still named by the error in history; what matters is that
    // it is no longer staged alongside the new drop.
    expect(frame).toContain('photo.jpg')
    expect(frame).not.toContain('JPEG ×2')
    expect(frame).not.toContain("isn't supported yet")
    expect(frame).toContain('Convert JPEG to')
  }, 20_000)
})
