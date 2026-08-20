import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const CTRL_U = String.fromCharCode(21)
const DOWN = `${ESC}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Stages `file`, then drives it through a real, deterministic failure — an
 * unreachable compress target size ("1b", which no real JPEG can ever hit)
 * — so the run reports `target-unreachable` and returns to the idle prompt
 * *without* clearing the stage. Duplicated from `batch-refusal.test.tsx`
 * rather than shared, matching this suite's existing convention of each
 * file keeping its own scenario helper (`toCompress`, `ontoAnExistingOutput`).
 * This is currently the one path in the app that leaves the idle prompt in
 * front of a non-empty stage — see the note above `convert()` in App.tsx —
 * which is what makes "open the palette while something is staged" reachable
 * through the real UI at all.
 */
async function stageOneThenFailBackToIdle(dir: string, file: string) {
  const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // stages the file, lands on the compress "mode" step
  await settle(300)
  app.stdin.write(DOWN) // "To a target size"
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write('1b') // unreachable for any real JPEG
  await settle()
  app.stdin.write(ENTER) // submits the size -> destination step
  await settle()
  app.stdin.write(ENTER) // accepts the default destination -> rename step
  await settle()
  app.stdin.write(ENTER) // accepts the proposed name -> runs the search
  await settle(3000) // up to 8 real encodes of a tiny fixture, plus render
  return app
}

describe('esc at the prompt', () => {
  it('closes the command palette without discarding a staged file', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const app = await stageOneThenFailBackToIdle(dir, a)
    // Sanity check on the setup: the failure really left a.jpg staged.
    expect(app.lastFrame() ?? '').toContain('a.jpg')

    // Open the palette with a partial command. Its description text is what
    // proves the palette itself is open — plain "/convert" also appears in
    // the leftover `target-unreachable` error's hint ("...or /convert to a
    // smaller format"), so that alone can't distinguish palette-open from
    // palette-closed.
    app.stdin.write('/conv')
    await settle()
    expect(app.lastFrame() ?? '').toContain("change a file's format")

    // One esc: this is the keystroke `Select`'s own escape handling already
    // owns (it clears the palette's text buffer via onCancel) — it must
    // not *also* clear the stage as an unrelated side effect.
    app.stdin.write(ESC)
    await settle()

    const afterEsc = app.lastFrame() ?? ''
    // The buffer really did clear — the palette is gone and the prompt
    // shows its placeholder again, not the leftover "/conv" text.
    expect(afterEsc).not.toContain("change a file's format")
    expect(afterEsc).toContain('drop a file or type a path')

    // The stage really did survive: asking to /convert still has a.jpg to
    // act on, which only happens if the stage was never cleared. Landing
    // on the target picker (rather than staying at the idle prompt) is
    // only possible when a source is still staged.
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain('Convert JPEG to')
  }, 20_000)

  it('clears a leftover stage when the typed fragment matches no command', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const app = await stageOneThenFailBackToIdle(dir, a)
    expect(app.lastFrame() ?? '').toContain('a.jpg')

    // "/U" — realistic and minimal: the start of any absolute path under
    // /Users, and it matches none of convert/compress/theme/help.
    // `CommandPalette` renders a plain, non-interactive "no command
    // matches" message here — no `<Select>`, no `useInput` at all — so
    // nothing but the stage hook itself is in a position to consume esc.
    app.stdin.write('/U')
    await settle()
    expect((app.lastFrame() ?? '').toLowerCase()).toContain('no command matches')

    // Esc: nothing is mounted to consume this keystroke (no `<Select>`,
    // no `useInput` inside the "no command matches" message), so this is
    // testing the stage hook and only the stage hook.
    app.stdin.write(ESC)
    await settle()

    // The typed "/U" itself is untouched by this esc — clearing the text
    // buffer was never this hook's job, only `Select`'s `onCancel` does
    // that, and nothing here plays that role. Ctrl-u (an ordinary,
    // already-available editing key, unrelated to either fix) clears it
    // so the next assertion starts from a clean prompt.
    app.stdin.write(CTRL_U)
    await settle()
    expect(app.lastFrame() ?? '').toContain('drop a file or type a path')

    // The stage really did clear on that esc: /convert now has nothing
    // staged to act on, so it stays at the idle prompt instead of
    // reaching the target picker.
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').not.toContain('Convert JPEG to')
    expect(app.lastFrame() ?? '').toContain('drop a file or type a path')
  }, 20_000)
})
