import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const CTRL_N = String.fromCharCode(14)
const DOWN = `${ESC}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/** Walks to the name field, pre-filled with the source's stem. */
async function toRename(dir: string, file: string) {
  const app = render(<App initialWidth={80} prefs={prefsFor(dir)} />)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write(DOWN) // webp, lossy
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write(ENTER) // accept quality
  await settle()
  app.stdin.write(ENTER) // accept the destination -> rename step
  await settle(250)
  return app
}

/** Walks to the compress-to-size text field. */
async function toSize(dir: string, file: string) {
  const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write(DOWN) // "To a target size"
  await settle()
  app.stdin.write(ENTER)
  await settle()
  return app
}

/** The prompt's own line, not the whole frame — the source's stem and the
 * output preview also say "photo", so asserting on the full frame would
 * pass even if the field itself never cleared. */
const fieldLine = (frame: string | undefined) =>
  (frame ?? '').split('\n').find((l) => l.trimStart().startsWith('›'))

describe('esc on the rename field', () => {
  it('clears the pre-filled name on the first press', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const app = await toRename(dir, file)
    expect(fieldLine(app.lastFrame())).toContain('photo')

    app.stdin.write(ESC)
    await settle()

    expect(app.lastFrame() ?? '').toContain('Name the file') // still on the rename step
    expect(fieldLine(app.lastFrame())).not.toContain('photo')
  })

  it('goes back to the destination step on the second press, once the field is empty', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const app = await toRename(dir, file)

    app.stdin.write(ESC) // clears "photo"
    await settle()
    app.stdin.write(ESC) // now empty -> back
    await settle()

    expect(app.lastFrame() ?? '').not.toContain('Name the file')
    expect(app.lastFrame() ?? '').toContain('Save to')
  })
})

describe('esc on the compress-to-size field', () => {
  it('clears typed digits on the first press, then returns to the mode choice', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const app = await toSize(dir, file)
    app.stdin.write('200kb')
    await settle()
    expect(app.lastFrame() ?? '').toContain('200kb')

    app.stdin.write(ESC)
    await settle()
    expect(app.lastFrame() ?? '').not.toContain('200kb')
    // Still the size step: the mode choice ("By quality") is not showing yet.
    expect(app.lastFrame() ?? '').not.toContain('By quality')

    app.stdin.write(ESC) // now empty -> back to the mode choice
    await settle()
    expect(app.lastFrame() ?? '').toContain('By quality')
  })
})

describe('esc at the idle prompt', () => {
  /**
   * A staged JPEG's target picker cancels via `clearSource` — escaping it
   * discards the stage outright, which is the wrong fixture for proving
   * escape leaves a stage alone. A document keeps `backToPromptKeepingStage`
   * instead (see App.tsx), the same fixture `batch-refusal.test.tsx` uses
   * for exactly this reason: two PDFs.
   */
  it('clears typed text without discarding a staged file', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 2)
    const b = await makePdf(dir, 'b.pdf', 2)
    const app = render(<App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />)

    app.stdin.write(a)
    await settle()
    app.stdin.write(ENTER)
    await settle(400) // target picker
    app.stdin.write(ESC)
    await settle(300) // back to idle, a.pdf still staged

    // Type something that is not a command.
    app.stdin.write('some stray text')
    await settle()
    expect(app.lastFrame() ?? '').toContain('some stray text')

    app.stdin.write(ESC)
    await settle()

    // The text is gone, but the staged file was not touched by this press.
    expect(app.lastFrame() ?? '').not.toContain('some stray text')

    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain('a.pdf')
    expect(app.lastFrame() ?? '').toContain('b.pdf')
  }, 20_000)

  it('clears a leftover stage on the press after the text is already empty', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 2)
    const app = render(<App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />)

    app.stdin.write(a)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    app.stdin.write(ESC)
    await settle(300) // back to idle, a.pdf still staged, prompt text is empty

    app.stdin.write(ESC) // nothing to clear in the text field -> clears the stage
    await settle()

    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').not.toContain('Convert PDF to')
    expect(app.lastFrame() ?? '').toContain('drop a file or type a path')
  }, 20_000)
})

describe('ctrl-n starts a new session', () => {
  it('abandons an in-progress conversion and returns to the idle prompt', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const app = render(<App initialWidth={80} prefs={prefsFor(dir)} />)
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400) // target picker
    app.stdin.write(ENTER) // pick the first target -> quality
    await settle()

    app.stdin.write(CTRL_N)
    await settle()

    expect(app.lastFrame() ?? '').toContain('drop a file or type a path')
  })

  it('leaves nothing staged behind, so the next drop starts completely fresh', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const app = render(<App initialWidth={80} prefs={prefsFor(dir)} />)
    app.stdin.write(a)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    app.stdin.write(CTRL_N)
    await settle()

    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('a.jpg')
  })
})
