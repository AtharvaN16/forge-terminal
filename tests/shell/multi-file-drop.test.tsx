import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * A real OS drag of several files pastes every escaped path on one line,
 * space-separated, before a single Enter submits the lot — not one path
 * per drop the way a sequential drag-then-drag-again does. `submitPath`
 * must split that line and stage every file it names, the same way two
 * separate drops already do.
 */
describe('dropping several files at once', () => {
  it('stages both PDFs from one multi-path line', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 3)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const { stdin, lastFrame } = render(
      <App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(`${a} ${b}`)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('jan.pdf')
    expect(frame).toContain('feb.pdf')
    expect(frame).toContain('PDF ×2')
  }, 20_000)

  it('stages the good path and reports the bad one, without losing either', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 3)
    const missing = `${dir}/does-not-exist.pdf`
    const { stdin, lastFrame } = render(
      <App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(`${a} ${missing}`)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('jan.pdf')
    expect(frame).toContain('1 skipped')
    expect(frame).toContain('does-not-exist.pdf')
  }, 20_000)

  /**
   * A real drag escapes each path's own spaces before joining them with a
   * plain one — `"a\ b.pdf" + " " + "c.pdf"` — so the separator has to be
   * told apart from an escaped space *before* either gets unescaped. This is
   * why `Prompt` hands this one prompt the buffer raw (`rawOnSubmit`) rather
   * than pre-unescaping it: unescape first, as every other field still does,
   * and "my\ report.pdf feb.pdf" collapses into one bad path with a
   * mid-string space nothing can split correctly any more.
   */
  it('stages a multi-file drop where one filename has an escaped space', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'my report.pdf', 3)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const { stdin, lastFrame } = render(
      <App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(`${dir}/my\\ report.pdf ${b}`)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('my report.pdf')
    expect(frame).toContain('feb.pdf')
    expect(frame).toContain('PDF ×2')
  }, 20_000)
})
