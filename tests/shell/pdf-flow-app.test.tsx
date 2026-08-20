import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/**
 * Drops `file`, opens `/pdf`, chooses Rotate, accepts 90°, confirms.
 *
 * A staged PDF now has a real convert target (jpeg, png — see
 * `engines/mupdf.ts`), so the drop's own Enter lands on "Convert PDF to",
 * not idle — `hasConvertTarget` in App.tsx is genuinely true for it. `esc`
 * backs out of that picker without discarding the stage
 * (`backToPromptKeepingStage`), which is what makes `/pdf` reachable from
 * here at all; the same escape is exercised on its own further down, in
 * `describe('the /pdf signpost')` and `describe('/pdf refuses a stage
 * nothing applies to')`.
 */
async function rotateOnce(stdin: { write: (s: string) => void }, file: string) {
  stdin.write(file)
  await settle()
  stdin.write(ENTER)
  await settle(400)
  stdin.write(ESC)
  await settle(200)
  stdin.write('/pdf')
  await settle()
  stdin.write(ENTER)
  await settle(300)
  // Hub order is Merge, Split, Extract, Delete, Rotate. Merge is disabled
  // with one file staged, so the cursor already starts on Split.
  stdin.write(DOWN + DOWN + DOWN) // Rotate
  await settle()
  stdin.write(ENTER)
  await settle(300)
  stdin.write(ENTER) // 90°, the default
  await settle(300)
  stdin.write(ENTER) // confirm and run
  await settle(800)
}

/**
 * End-to-end wiring for `/pdf`: App.tsx's command dispatch, `PdfFlow`, and
 * the `runJobs` handoff on `onDone`. `tests/shell/pdf-flow.test.tsx` proves
 * `PdfFlow` itself works in isolation; this proves App.tsx actually gets a
 * staged PDF to it and back out again.
 */
describe('/pdf end to end through App', () => {
  it('a dropped PDF opens the convert picker, and /pdf still reaches page operations from there', async () => {
    // A PDF now has real convert targets — jpeg and png, from the mupdf
    // engine — so `hasConvertTarget` is genuinely true for it and a solo
    // drop advances straight to the picker, the same as any image (see the
    // next test). What changed with that: page operations must not become
    // a casualty of conversion becoming real. Both need to be reachable
    // from this one drop — see `backToPromptKeepingStage` in App.tsx.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const pickerFrame = lastFrame() ?? ''
    expect(pickerFrame).toContain('Convert PDF to')
    // The pointer to page operations rides along on the same screen —
    // it does not have to be discovered some other way.
    expect(pickerFrame).toContain('/pdf for page operations')

    // Escaping the picker must not cost the user the file: `esc` here goes
    // to `backToPromptKeepingStage`, not `clearSource`, specifically
    // because a document has somewhere else to go.
    stdin.write(ESC)
    await settle(300)
    const idleFrame = lastFrame() ?? ''
    expect(idleFrame).toContain('drop a file or type a path')
    expect(idleFrame).not.toContain('Convert PDF to')
    // Still staged — proven by the signpost still rendering, which only
    // draws when `stage.sources` actually contains a document.
    expect(idleFrame).toContain('/pdf for page operations')
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

  it('typing /convert on a staged, idle PDF opens the real picker, now that conversion works', async () => {
    // Reaching idle with a PDF still staged means going through the picker
    // and backing out first (see the previous test) — a solo drop no
    // longer stops at idle on its own now that `hasConvertTarget` is true
    // for a PDF. Once there, `/convert` is a second, explicit way in, and
    // — unlike before mupdf existed — it now finds real choices instead
    // of silently doing nothing.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write(ESC) // back to idle, doc.pdf still staged
    await settle(300)

    stdin.write('/convert')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Convert PDF to')
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
    // The drop lands on the convert picker now (a real target picker, not
    // an empty one) — back out of it without losing the stage before
    // reaching for /pdf. See `rotateOnce`, which does the same thing.
    stdin.write(ESC)
    await settle(200)

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

/**
 * `checkWriteSafety` (Task: write-safety) already covers the rule itself in
 * isolation; this covers the thing that actually matters here — that the
 * `/pdf` run path in App.tsx calls it before `runJobs`, the same way the
 * CLI's page-op path does. Without this wiring, rotating the same file
 * twice silently overwrites `doc-rotated.pdf` with no warning; with a
 * source-consuming operation (merge globbing its own prior output back in)
 * the same missing check is destructive, not just surprising — see
 * `checkWriteSafety`'s own module doc.
 */
describe('/pdf refuses to overwrite without asking', () => {
  it('running the same rotate twice refuses the second run and writes nothing new', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    await rotateOnce(stdin, file)
    const outputPath = join(dir, 'doc-rotated.pdf')
    const firstBytes = await readFile(outputPath)

    // Drop the same source again and ask for the exact same rotation.
    await rotateOnce(stdin, file)

    const frame = lastFrame() ?? ''
    // `outputExists`'s own wording ("<name> is already there"), not a
    // fabricated message — the shell is showing the real refusal, not
    // paraphrasing it.
    expect(frame).toContain('already there')

    const secondBytes = await readFile(outputPath)
    expect(secondBytes).toEqual(firstBytes) // nothing written — refused before runJobs
    expect((await readdir(dir)).sort()).toEqual(['doc-rotated.pdf', 'doc.pdf'])
  }, 20_000)

  it('choosing Cancel on the refusal returns to the hub without writing', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    await rotateOnce(stdin, file)
    const outputPath = join(dir, 'doc-rotated.pdf')
    const firstBytes = await readFile(outputPath)

    await rotateOnce(stdin, file) // refused, lands on the blocked step
    stdin.write(ENTER) // "Cancel" is the safe default — first row, no arrow needed
    await settle(300)

    expect(lastFrame() ?? '').toContain('PDF — choose an operation')
    expect(await readFile(outputPath)).toEqual(firstBytes)
  }, 20_000)

  it('choosing Replace proceeds and actually overwrites', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    await rotateOnce(stdin, file)
    await rotateOnce(stdin, file) // refused
    expect(lastFrame() ?? '').toContain('already there')

    stdin.write(DOWN) // off "Cancel" onto "Replace"
    await settle()
    stdin.write(ENTER)
    await settle(600)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('rotated 90')
    expect(frame).toContain('drop a file or type a path') // back at idle, stage cleared
  }, 20_000)
})

describe('the /pdf signpost', () => {
  it('points at /pdf alongside the convert picker a dropped PDF now opens', async () => {
    // Covered end-to-end in the first describe block above too; this one
    // exists so the signpost's own describe block still has a test that
    // fails first if the hint is ever removed from the target step.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('/pdf for page operations')
  }, 20_000)

  it('says nothing for a file that already has somewhere to convert to', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').not.toContain('/pdf for page operations')
  }, 20_000)

  it('says nothing once the command palette is open — the palette is already doing that job', async () => {
    // The command palette only exists at idle (typed against `Prompt`),
    // and a solo PDF drop no longer stops there — reach it the same way
    // the other tests above do, by backing out of the picker first.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write(ESC) // back to idle, doc.pdf still staged
    await settle(300)
    stdin.write('/')
    await settle(200)
    expect(lastFrame() ?? '').not.toContain('/pdf for page operations')
  }, 20_000)
})

/**
 * `/convert` (`hasConvertTarget`) and `/compress` (`compressAction.appliesTo`)
 * both refuse to open a picker before checking that something in it would
 * actually apply. `/pdf` needs the same guard: without it, staging a source
 * none of the five page actions apply to and running `/pdf` mounts the hub
 * anyway — every row comes back `disabled`, `Select`'s cursor falls back to
 * index 0 regardless, and that row is disabled too, so nothing is selected,
 * arrows are no-ops and Enter submits nothing. `items.length` is 5, not 0,
 * so — unlike the dead end this task originally fixed — Escape still works;
 * but it is still a confusing, silent screen.
 *
 * A lone image can never reach this state through a single drop (every real
 * image format has a valid convert target, so it always advances past
 * idle — see `hasConvertTarget`). A PDF now advances past idle too — its
 * picker opens the same way — but backing out of it with `esc` returns to
 * idle *with the file still staged* (`backToPromptKeepingStage`), which is
 * what makes it possible to reach a mixed stage through the real UI at
 * all: drop the PDF, back out of its picker, then drop an image on top.
 * The second drop is refused as a batch (`refuseBatch`) before it ever
 * reaches a wizard step, which is what leaves both files sitting in a
 * mixed, idle stage — a JPEG genuinely staged, exactly the reviewer's
 * scenario, reached through real UI paths rather than injected test state.
 */
describe('/pdf refuses a stage nothing applies to', () => {
  it('does not open the hub for a mixed stage, and says why', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const jpeg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(pdf)
    await settle()
    stdin.write(ENTER)
    await settle(400) // opens the convert picker — a PDF has a real target now
    stdin.write(ESC)
    await settle(200) // back to idle, doc.pdf still staged

    stdin.write(jpeg)
    await settle()
    stdin.write(ENTER)
    await settle(400) // refused as a batch, still idle — now [doc.pdf, photo.jpg]

    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(300)

    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('PDF — choose an operation')
    expect(frame).toContain('/pdf needs the staged files to be PDFs')
  }, 20_000)
})
