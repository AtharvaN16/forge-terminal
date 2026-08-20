import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/**
 * End-to-end wiring for `/pdf`: App.tsx's command dispatch, `PdfFlow`, and
 * the `runJobs` handoff on `onDone`. `tests/shell/pdf-flow.test.tsx` proves
 * `PdfFlow` itself works in isolation; this proves App.tsx actually gets a
 * staged PDF to it and back out again.
 */
describe('/pdf end to end through App', () => {
  it('a dropped PDF stays staged and idle, not stuck on an empty target picker', async () => {
    // A PDF's only writable format is PDF itself, which convert's target
    // picker filters out as a no-op — so the target list is genuinely
    // empty. `Select` no-ops entirely (even on escape) when its item list
    // is empty, which made this a real dead end before App.tsx checked for
    // it: see `hasConvertTarget`.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const frame = lastFrame() ?? ''
    // Back at the ordinary prompt — not a "Convert PDF to" picker with
    // nothing in it.
    expect(frame).toContain('drop a file or type a path')
    expect(frame).not.toContain('Convert PDF to')
  }, 20_000)

  it('an image still opens the target picker as before — the PDF fix does not touch it', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert JPEG to')
  }, 20_000)

  it('typing /convert on a staged PDF also stays put rather than opening an empty picker', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write('/convert')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame() ?? '').not.toContain('Convert PDF to')
  }, 20_000)

  it('drop, /pdf, rotate: writes a real file, reports it in history, and clears the stage', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame() ?? '').toContain('PDF — choose an operation')

    // Hub order is Merge, Split, Extract, Delete, Rotate. Merge is disabled
    // with one file staged, so the cursor already starts on Split.
    stdin.write(DOWN + DOWN + DOWN) // Rotate
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Turn')

    stdin.write(ENTER) // 90°, the default
    await settle(300)
    expect(lastFrame() ?? '').toContain('Rotate 90')

    stdin.write(ENTER) // confirm and run
    await settle(800)

    const frame = lastFrame() ?? ''
    // Back at the ordinary prompt: the stage cleared.
    expect(frame).toContain('drop a file or type a path')

    const written = (await readdir(dir)).filter((f) => f !== 'doc.pdf')
    expect(written).toEqual(['doc-rotated.pdf'])
  }, 20_000)
})
