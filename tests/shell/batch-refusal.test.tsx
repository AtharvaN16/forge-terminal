import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

describe('several files at once', () => {
  /**
   * Only a merge consumes several staged files. Staging two images used to
   * probe both, draw a rich `JPEG ×2` card, and only then refuse — the
   * interface built the expectation and then took it back (UX audit #6).
   * The drop is now refused before anything is staged, with the reason and
   * the place several files *can* be converted: the flag CLI (spec §10).
   */
  it('refuses to stage two images at once, and says why before drawing anything', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    // Both at once, the way a real drag of two files pastes them.
    app.stdin.write(`${a} ${b}`)
    await settle()
    app.stdin.write(ENTER)
    await settle(300)

    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('JPEG ×2')
    expect(frame).toContain('only PDFs can be staged together')
    expect(frame).toContain('--to')
    expect(frame).not.toContain("isn't supported yet")

    // Nothing was staged: /convert has no file to open a picker for…
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').not.toContain('Convert JPEG to')

    // …and a single drop afterwards goes straight to its own picker.
    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    const after = app.lastFrame() ?? ''
    expect(after).toContain('Convert JPEG to')
    expect(after).not.toContain('JPEG ×2')

    const written = (await readdir(dir)).filter((f) => f !== 'a.jpg' && f !== 'b.jpg')
    expect(written).toHaveLength(0)
  }, 20_000)

  it('does not append an image to a staged PDF, and says what is still staged', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'jan.pdf', 2)
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    app.stdin.write(pdf)
    await settle()
    app.stdin.write(ENTER)
    await settle(400) // opens the convert picker for jan.pdf
    app.stdin.write(ESC)
    await settle(300) // back to idle, jan.pdf kept for /pdf
    app.stdin.write(jpg)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('MIXED ×2')
    expect(frame).toContain('photo.jpg was not staged')
    expect(frame).toMatch(/jan\.pdf is still\s+staged/)
  }, 20_000)

  it('still refuses /convert on a staged merge list rather than converting one of it', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 2)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    app.stdin.write(`${a} ${b}`)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    expect(app.lastFrame() ?? '').toContain('PDF ×2')

    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain("isn't supported yet")

    const written = (await readdir(dir)).filter((f) => f !== 'jan.pdf' && f !== 'feb.pdf')
    expect(written).toHaveLength(0)
  }, 20_000)

  /**
   * Dropping a second PDF is the only way to build a merge stage, and until
   * this test existed that path contradicted itself: nothing confirmed
   * either file was staged, and the refusal above — written when nothing
   * consumed several files at once — told the user to "drop a single file"
   * two lines above the shell's own "/pdf for page operations" signpost.
   * Merge ordering made a multi-file stage useful and the message wrong.
   *
   * A PDF now has a real convert target (jpeg, png), so the first drop's
   * Enter lands on that picker rather than idle — the same as any image.
   * `esc` backs out of it without discarding the stage
   * (`backToPromptKeepingStage` in App.tsx, added alongside the
   * rasterisation engine specifically so this stayed reachable), which is
   * what makes the
   * second drop land on the same idle prompt as before.
   */
  it('stages two PDFs, shows them, and does not tell the user to undo it', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 3)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)

    app.stdin.write(a)
    await settle()
    app.stdin.write(ENTER)
    await settle(400) // opens the convert picker for jan.pdf
    app.stdin.write(ESC)
    await settle(300) // back to idle, jan.pdf still staged
    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    const frame = app.lastFrame() ?? ''
    // What they have: the card, both files, and the count in the tag.
    expect(frame).toContain('jan.pdf')
    expect(frame).toContain('feb.pdf')
    expect(frame).toContain('PDF ×2')
    // What to do next, with nothing telling them to take it back.
    expect(frame).toContain('/pdf for page operations')
    expect(frame).not.toContain("isn't supported yet")
    expect(frame).not.toContain('Drop a single file')
  }, 20_000)

  it('still converts a single staged file normally — the common case has not moved', async () => {
    const dir = await makeTempDir()
    const solo = await makeJpeg(dir, 'solo.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
    app.stdin.write(solo)
    await settle()
    app.stdin.write(ENTER) // submit the path -> target picker
    await settle(300)
    app.stdin.write(ENTER) // accept the first offered target
    await settle()
    app.stdin.write(ENTER) // quality (if shown) / destination
    await settle()
    app.stdin.write(ENTER) // destination -> the name step
    await settle()
    app.stdin.write(ENTER) // accept the proposed name
    await settle(600)

    expect(app.lastFrame() ?? '').not.toContain("isn't supported yet")
    const written = (await readdir(dir)).filter((f) => f !== 'solo.jpg')
    expect(written).toHaveLength(1)
  }, 20_000)
})
