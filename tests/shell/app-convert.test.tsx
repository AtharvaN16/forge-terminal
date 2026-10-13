import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

/**
 * Waits until the frame shows `text`, then a beat more. A key sent before its
 * screen is up lands on the screen before — on a busy machine a fixed pause
 * once let the ↓ to WebP go missing, and PNG was written instead. And a
 * screen is drawn before its keys are listened for (Ink attaches `useInput`
 * in an effect, after the frame is written), so a key sent the moment the
 * frame appears can still be lost; the beat is for that.
 */
async function until(lastFrame: () => string | undefined, text: string, ms = 10_000) {
  const shown = () => (lastFrame() ?? '').replace(SGR, '').includes(text)
  const start = Date.now()
  while (!shown() && Date.now() - start < ms) await settle(30)
  if (!shown()) throw new Error(`never showed "${text}":\n${(lastFrame() ?? '').replace(SGR, '')}`)
  await settle(100)
}

/**
 * Preferences pinned to this test's own temp folder. Without it the shell
 * would preselect the factory default — the user's real ~/Desktop — and the
 * suite would write conversion output into it. `theme` is set so the
 * first-run picker does not stand between the test and the prompt.
 */
const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

async function driveToResult() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const app = render(<App initialWidth={80} prefs={prefsFor(dir)} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER) // submit path
  await until(app.lastFrame, 'Convert to')
  app.stdin.write(DOWN) // targets exclude jpeg (same-format is a no-op), so
  await until(app.lastFrame, '▌ WebP') // the order is png, webp, avif…
  app.stdin.write(ENTER)
  await until(app.lastFrame, 'smaller')
  app.stdin.write(ENTER) // accept quality
  await until(app.lastFrame, 'Save as')
  app.stdin.write(ENTER) // Save as: the proposed name, in the default folder
  await until(app.lastFrame, 'convert another')
  return { ...app, dir }
}

describe('shell conversion', () => {
  it('converts and writes the file', async () => {
    const { dir } = await driveToResult()
    expect(existsSync(join(dir, 'photo.webp'))).toBe(true)
  })

  it('shows the result with both sizes and the change', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✓')
    expect(frame).toContain('photo.webp')
    expect(frame).toMatch(/smaller|larger|same size/)
  })

  it('offers the result keybindings', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('convert another')
    expect(frame).toContain('open')
    // "Reveal" is Finder's word; the label follows the platform now.
    expect(frame.toLowerCase()).toContain('show in')
  })

  it('returns to the prompt on enter so you can convert another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('keeps the previous result in history after converting another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('photo.webp')
  })

  /**
   * Two Enters in the same tick — a held key repeating, or a paste carrying
   * two line endings — both reach `convert` before React re-renders, because
   * `useInput` handlers run synchronously between renders and unmounting the
   * destination step only takes effect on the next one. Measured before the
   * guard: two `runJobs` calls, two encodes, two renames onto the same path,
   * two result blocks.
   *
   * Deliberately two separate synchronous `write` calls with no `settle`
   * between them — that is the only way both land on the same mounted
   * handler. A yield in between lets React unmount it, and the second write
   * hits nothing, which proves nothing.
   */
  it('starts exactly one conversion when two Enters arrive in the same tick', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const app = render(<App initialWidth={80} prefs={prefsFor(dir)} />)
    app.stdin.write(jpg)
    await settle()
    app.stdin.write(ENTER) // submit path
    await until(app.lastFrame, 'Convert to')
    app.stdin.write(DOWN) // webp (jpeg excluded, so png, webp, avif…)
    await until(app.lastFrame, '▌ WebP')
    app.stdin.write(ENTER)
    await until(app.lastFrame, 'smaller')
    app.stdin.write(ENTER) // quality -> Save as
    await until(app.lastFrame, 'Save as')
    // Both in one tick, at the step that actually submits the conversion.
    // React unmounts the handler on the next render, but both calls have
    // already run by then — which is exactly what `converting` guards.
    app.stdin.write(ENTER)
    app.stdin.write(ENTER)
    // Asserted on disk, not on the frame. "Exactly one conversion" is a claim
    // about what was written, and the result block lives in <Static>, which a
    // later dynamic render pushes out of what `lastFrame()` returns — so
    // counting ✓ in the frame measured render timing, not conversions.
    const { readdir } = await import('node:fs/promises')
    const webps = async () => (await readdir(dir)).filter((f) => f.endsWith('.webp'))
    // The first lands when it lands (seconds on a busy runner); a second
    // conversion, were there one, gets the same 900 ms after it.
    const start = Date.now()
    while ((await webps()).length === 0 && Date.now() - start < 10_000) await settle(30)
    await settle(900)
    expect(await webps()).toHaveLength(1)
  })

  /**
   * Result blocks stay in `<Static>` scrollback for the rest of the session,
   * so `o` and `s` remain pressable long after the file they point at has
   * been moved, renamed, or had its volume unmounted. `reveal.ts` promisifies
   * `execFile`, so `open` exiting non-zero rejects — and a `void`ed rejection
   * is an unhandled rejection, which terminates Node and prints the whole
   * stack. Spec §11: no raw stack trace without `--debug`, and the shell has
   * no `--debug`.
   */
  it('reports a failed open as an error block instead of dying on it', async () => {
    const { stdin, lastFrame, dir } = await driveToResult()
    await rm(join(dir, 'photo.webp'))
    stdin.write('o')
    await settle(1500)
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/^\s+failed\s*$/m)
    expect(frame).toContain('convert another') // still alive, still on the result stage
  })

  it('opens with a capital O too, as enhance’s note says it', async () => {
    const { stdin, lastFrame, dir } = await driveToResult()
    await rm(join(dir, 'photo.webp'))
    stdin.write('O')
    await settle(1500)
    // The open was attempted (and failed on the missing file), so O reached it.
    expect(lastFrame()).toMatch(/^\s+failed\s*$/m)
  })

  it('reports a failed reveal the same way', async () => {
    const { stdin, lastFrame, dir } = await driveToResult()
    await rm(join(dir, 'photo.webp'))
    stdin.write('s')
    await settle(1500)
    expect(lastFrame()).toMatch(/^\s+failed\s*$/m)
  })
})
