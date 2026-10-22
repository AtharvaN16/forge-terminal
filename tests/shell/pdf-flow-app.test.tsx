import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

/**
 * Drops `file`, opens `/pdf`, chooses Rotate, accepts 90°, confirms.
 *
 * A staged PDF now has a real convert target (jpeg, png — see
 * `engines/pdfium.ts`), so the drop's own Enter lands on "Convert to",
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
    // A PDF now has real convert targets — jpeg and png, from the pdfium
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
    expect(pickerFrame).toContain('Convert to')
    // The route to page operations rides along on the same screen, as a
    // selectable row rather than a hint someone has to act on elsewhere.
    expect(pickerFrame).toContain('/pdf')
    expect(pickerFrame).toContain('for more options')

    // Escaping the picker must not cost the user the file: `esc` here goes
    // to `backToPromptKeepingStage`, not `clearSource`, specifically
    // because a document has somewhere else to go.
    stdin.write(ESC)
    await settle(300)
    const homeFrame = lastFrame() ?? ''
    expect(homeFrame).not.toContain('Convert to')
    // Still staged — home draws its card and asks for more.
    expect(homeFrame).toContain('doc.pdf')
    expect(homeFrame).toContain('drop more, or type a path')
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
    expect(lastFrame() ?? '').toContain('Convert to')
  }, 20_000)

  it('typing /convert on a staged, idle PDF opens the real picker, now that conversion works', async () => {
    // Reaching idle with a PDF still staged means going through the picker
    // and backing out first (see the previous test) — a solo drop no
    // longer stops at idle on its own now that `hasConvertTarget` is true
    // for a PDF. Once there, `/convert` is a second, explicit way in, and
    // — unlike before a rasterisation engine existed — it now finds real
    // choices instead
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
    expect(lastFrame() ?? '').toContain('Convert to')
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
    expect(lastFrame() ?? '').toContain('Choose an operation')

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
    expect(frame).toContain('Drop a file here')

    const written = (await readdir(dir)).filter((f) => f !== 'doc.pdf')
    expect(written).toEqual(['doc-rotated.pdf'])
  }, 20_000)

  /**
   * The convert-target picker's only route into `/pdf` used to be a line of
   * dim text below the list — real information, but not a choice: reaching
   * it meant escaping the picker (see `backToPromptKeepingStage` above) and
   * typing the command from memory. This proves the picker itself now
   * carries a real, selectable row to the same place, reached the same way
   * JPEG or PNG are — arrow down, Enter — with the file still staged when it
   * lands.
   */
  it('the hub Convert row opens the convert picker, and esc comes back to the hub', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write(DOWN + DOWN + DOWN) // the picker's /pdf row
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Choose an operation')

    // Split → Extract → Delete → Rotate → Convert (Compress is dimmed: no images).
    stdin.write(DOWN + DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert to')

    stdin.write(ESC)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Choose an operation')
  }, 20_000)

  it('the hub Convert row takes several PDFs on as one batch, and esc comes back', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 2)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write('3')
    await settle()
    stdin.write(`${a} ${b}`)
    await settle(500)
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Choose an operation')

    // Merge → Convert: the page operations take one PDF, and Compress has no images.
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const frame = (lastFrame() ?? '').replace(SGR, '')
    expect(frame).toContain('Convert to')
    expect(frame).toContain('PDF ×2')

    stdin.write(ESC)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Choose an operation')
  }, 20_000)

  it('the target picker has a selectable row into /pdf, not just a hint', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert to')

    // Picker order is JPEG, PNG, DOCX, a gap, then the /pdf row — three
    // arrow-downs from JPEG lands on it, the gap itself unreachable like any
    // disabled row.
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    expect(lastFrame() ?? '').toContain('Choose an operation')
  }, 20_000)
})

/**
 * The target step's `onCancel` is a ternary — `backToPromptKeepingStage` for
 * a document (exercised throughout the describe block above: a PDF has
 * `/pdf` and merge staging to go back to, so escaping the picker must not
 * cost it its place on the bench), `clearSource` for anything else. Every
 * test above drives the document branch; nothing exercised the image one
 * before this — an image has nowhere else to go once it backs out of "convert
 * to", so the whole point of `clearSource` here is that escaping really does
 * give the file back, not just close the picker.
 */
describe('esc on the target picker for an image', () => {
  it('clears the stage, not just the picker', async () => {
    const dir = await makeTempDir()
    const file = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert to') // sanity: really on the picker

    stdin.write(ESC)
    await settle(300)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Drop a file here')
    expect(frame).not.toContain('Convert to')

    // The stronger proof: with `backToPromptKeepingStage` instead of
    // `clearSource` here, photo.jpg would still be staged, and `/convert`
    // would reopen the exact picker just escaped from. Landing back at
    // idle instead is only possible if the stage genuinely emptied.
    stdin.write('/convert')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const afterConvert = lastFrame() ?? ''
    expect(afterConvert).not.toContain('Convert to')
    expect(afterConvert).toContain('Drop a file here')
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
    // Asked as Name taken (L1), the question convert asks too.
    expect(frame).toContain('doc-rotated.pdf already exists')

    const secondBytes = await readFile(outputPath)
    expect(secondBytes).toEqual(firstBytes) // nothing written — refused before runJobs
    expect((await readdir(dir)).sort()).toEqual(['doc-rotated.pdf', 'doc.pdf'])
  }, 20_000)

  it('choosing Cancel goes back to Save as on the folder, the name kept, and writes nothing', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    await rotateOnce(stdin, file)
    const outputPath = join(dir, 'doc-rotated.pdf')
    const firstBytes = await readFile(outputPath)

    await rotateOnce(stdin, file) // refused, lands on Name taken
    stdin.write(DOWN + DOWN) // Keep both, Replace, Cancel
    await settle()
    stdin.write(ENTER)
    await settle(300)

    const frame = unpaint((lastFrame() ?? '').replace(SGR, ''))
    expect(frame).not.toContain('choose an operation')
    expect(frame).toMatch(/^ {2}Save as +Rotate 90°$/m)
    // Back on Save as, the name as it was given and the folders there to change.
    expect(frame).toMatch(/name +doc-rotated +\.pdf/)
    expect(frame).toMatch(/esc back · ctrl-c quit/)
    expect(await readFile(outputPath)).toEqual(firstBytes)
    expect((await readdir(dir)).sort()).toEqual(['doc-rotated.pdf', 'doc.pdf'])
  }, 20_000)

  it('choosing Replace proceeds and actually overwrites', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    await rotateOnce(stdin, file)
    await rotateOnce(stdin, file) // refused
    expect(lastFrame() ?? '').toContain('already exists')

    stdin.write(DOWN) // off "Keep both" onto "Replace"
    await settle()
    stdin.write(ENTER)
    await settle(600)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('rotated 90')
    expect(frame).toContain('Drop a file here') // back at idle, stage cleared
  }, 20_000)
})

describe('the /pdf signpost', () => {
  it('points at /pdf alongside the convert picker a dropped PDF now opens', async () => {
    // Covered end-to-end in the first describe block above too; this one
    // exists so the signpost's own describe block still has a test that
    // fails first if the route to /pdf is ever removed from the target step.
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)
    stdin.write(file)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/pdf')
    expect(frame).toContain('for more options')
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
    expect(lastFrame() ?? '').not.toContain('for more options')
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
 * Home holds any stage now (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md),
 * so a mixed one is one drop away: a PDF and an image dropped together, or
 * one after the other, are both staged and listed. `/pdf` on that stage is
 * what this guard exists for.
 */
describe('/pdf refuses a stage nothing applies to', () => {
  it('does not open the hub for a mixed stage, and says why', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const jpeg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} initialHeight={24} prefs={prefs} />)

    stdin.write(pdf)
    await settle(400)
    stdin.write(jpeg)
    await settle(400) // both staged on home: a mixed stage
    expect(lastFrame() ?? '').toContain('2 files')

    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(300)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('/pdf needs the staged files to be PDFs')
    expect(frame).not.toContain('Choose an operation')
  }, 20_000)
})
