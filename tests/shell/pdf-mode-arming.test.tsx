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

/** Arms `/pdf` mode, with nothing staged yet — mirrors `toCompress` in compress-flow.test.tsx. */
async function armPdfMode(dir: string) {
  const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
  app.stdin.write('/pdf')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  return app
}

describe('/pdf mode arming', () => {
  it('a PDF dropped while armed opens the hub directly, no second /pdf needed', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf')
    const app = await armPdfMode(dir)
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    const frame = app.lastFrame() ?? ''
    // The hub's own operation list, not the convert target picker.
    expect(frame).toContain('Merge')
    expect(frame).toContain('Split')
    expect(frame).toContain('needs 2+ files')
  })

  it('a non-PDF dropped while armed falls back to convert, with a reason', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const app = await armPdfMode(dir)
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    const frame = app.lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('not a pdf')
    expect(frame).toContain('current mode: convert')
    expect(frame).toContain('Convert JPEG to')
  })

  it('escaping the hub keeps the file staged, so a second PDF can join it for merge', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf')
    const b = await makePdf(dir, 'b.pdf')
    const app = await armPdfMode(dir)
    app.stdin.write(a)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    expect(app.lastFrame() ?? '').toContain('needs 2+ files')

    app.stdin.write(ESC)
    await settle()
    // Back at idle, still armed, and a.pdf was not dropped from the stage.
    expect(app.lastFrame() ?? '').toContain('current mode: pdf')

    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    const frame = app.lastFrame() ?? ''
    // Two PDFs staged now reaches the ordinary multi-file signpost rather
    // than re-opening the hub on its own — /pdf, typed once more, is what
    // actually merges them; this just confirms the first file survived.
    expect(frame).toContain('a.pdf')
    expect(frame).toContain('b.pdf')
  })
})
