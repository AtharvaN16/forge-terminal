import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Stages a PDF and backs out of the convert picker with esc, which returns
 * to home *without* clearing the stage — a PDF has `/pdf` and a
 * merge list still ahead of it (`backToPromptKeepingStage` in App.tsx).
 * Duplicated from `batch-refusal.test.tsx` rather than shared, matching this
 * suite's existing convention of each file keeping its own scenario helper.
 *
 * This used to fail a compress search and escape the "can't get that small"
 * question instead. That path now ends the action and clears the stage (UX
 * audit #7), which leaves the PDF back-out as the way to reach "open the
 * palette while something is staged" through the real UI.
 */
async function stageOneThenBackToIdle(dir: string, file: string) {
  const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // stages the PDF, opens the convert picker
  await settle(400)
  return app
}

describe('esc at the prompt', () => {
  it('closes the command palette without discarding a staged file', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 2)
    const app = await stageOneThenBackToIdle(dir, a)
    // Sanity check on the setup: the picker is open for a.pdf.
    expect(app.lastFrame() ?? '').toContain('Convert to')

    // Back out of the picker — for a PDF, esc returns to the idle prompt
    // without discarding what was staged.
    app.stdin.write(ESC)
    await settle()

    // Open the palette with a partial command. Its `Modes` heading is what
    // proves the palette itself is open.
    app.stdin.write('/conv')
    await settle()
    expect(app.lastFrame() ?? '').toContain('Modes')

    // One esc: this is the keystroke `Select`'s own escape handling already
    // owns (it clears the palette's text buffer via onCancel) — it must
    // not *also* clear the stage as an unrelated side effect.
    app.stdin.write(ESC)
    await settle()

    const afterEsc = app.lastFrame() ?? ''
    // The buffer really did clear — the palette is gone and the prompt
    // shows its placeholder again, not the leftover "/conv" text.
    expect(afterEsc).not.toContain('Modes')
    expect(afterEsc).toContain('drop more, or type a path')

    // The stage really did survive: asking to /convert still has a.pdf to
    // act on, which only happens if the stage was never cleared. Landing
    // on the target picker (rather than staying at the idle prompt) is
    // only possible when a source is still staged.
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain('Convert to')
  }, 20_000)

  it('clears a leftover stage when the typed fragment matches no command', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 2)
    const app = await stageOneThenBackToIdle(dir, a)
    expect(app.lastFrame() ?? '').toContain('Convert to')

    // Back out of the picker first — the idle prompt this test actually
    // exercises only mounts once it is closed.
    app.stdin.write(ESC)
    await settle()

    // "/Us" — realistic and minimal: the start of any absolute path under
    // /Users, and it matches no command ("/U" alone now matches /update,
    // as "/e" matches /edit and "/p" /pdf).
    // `CommandPalette` renders a plain, non-interactive "no command
    // matches" message here — no `<Select>`, no `useInput` at all — so
    // nothing but the stage hook itself is in a position to consume esc.
    app.stdin.write('/Us')
    await settle()
    expect((app.lastFrame() ?? '').toLowerCase()).toContain('no command matches')

    // Esc: nothing is mounted to consume this keystroke (no `<Select>`,
    // no `useInput` inside the "no command matches" message), so this is
    // testing the stage hook and only the stage hook. The hook clears
    // whatever is typed first — same as every other text field — so this
    // first press only takes back "/Us"; the stage is untouched by it.
    app.stdin.write(ESC)
    await settle()
    expect(app.lastFrame() ?? '').toContain('drop more, or type a path')

    // A second press, now that the field is already empty, is what reaches
    // the stage.
    app.stdin.write(ESC)
    await settle()

    // The stage really did clear on that esc: /convert now has nothing
    // staged to act on, so it stays at the idle prompt instead of
    // reaching the target picker.
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').not.toContain('Convert to')
    expect(app.lastFrame() ?? '').toContain('Drop a file here')
  }, 20_000)
})
