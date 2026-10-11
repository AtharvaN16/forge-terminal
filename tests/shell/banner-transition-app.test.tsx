import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const WORDMARK_ROW = '███████╗ ██████╗'

/**
 * The full logo belongs to an empty prompt (spec 2026-10-11 §4). First run
 * is the one path where the logo is pushed into history inside Ink — every
 * other launch prints it before Ink mounts — so it is the path an Ink frame
 * can observe.
 */
describe('the logo in a running session', () => {
  it('gives way to the header bar once a file is dropped', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, defaultOutput: dir }
    const app = render(<App initialWidth={100} prefs={prefs} />)
    app.stdin.write(ENTER) // first-run picker: accept Dark, which pushes the logo
    await settle()
    expect(app.frames.join('\n')).toContain(WORDMARK_ROW)
    app.stdin.write(jpg)
    await settle(150)
    app.stdin.write(ENTER)
    await settle()
    // The last frame, not every frame since the drop: one render shows the
    // header bar before the effect that clears the logo has run, and in a
    // terminal the clear that follows erases it at once.
    const last = app.lastFrame() ?? ''
    expect(last).toContain('↔ FORGE')
    expect(last).not.toContain(WORDMARK_ROW)
  })
})
