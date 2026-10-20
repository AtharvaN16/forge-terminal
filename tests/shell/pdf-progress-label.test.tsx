import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePdf, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Polls the same way `convert-pdf.test.tsx`'s own `waitFor` does — real
 * split time depends on machine load, so a fixed-offset snapshot is exactly
 * the flaky guess this project's own timing notes warn against.
 */
async function waitFor(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  ceilingMs = 15_000,
  stepMs = 20,
): Promise<string> {
  const start = Date.now()
  for (;;) {
    const frame = lastFrame() ?? ''
    if (predicate(frame)) return frame
    if (Date.now() - start > ceilingMs) {
      // Throw rather than return the last frame. Returning it makes a timeout
      // surface as whatever assertion runs next — "expected <a PDF screen> to
      // contain 'drop a file…'" — which reads like a behaviour bug and sends
      // the reader looking in the wrong place. This says what happened.
      throw new Error(`waitFor gave up after ${ceilingMs}ms. Last frame was:\n${frame}`)
    }
    await settle(stepMs)
  }
}

/**
 * (The labels below were RENDERING and SPLITTING before Working, W5, gave
 * the count a line of its own: "Splitting doc.pdf", and a solid bar.)
 *
 * Task 8 wired `runPdfJobs`'s `onEvent` into every `/pdf` operation and
 * hardcoded `label="RENDERING"` for all of it — accurate for a document
 * rasterisation (that genuinely renders pages to images, and
 * `convert-pdf.test.tsx` already pins "RENDERING" for exactly that case),
 * but false for a split, which only copies existing pages into new PDFs.
 * Nothing rasterises during a split, so a real 60-page split through the
 * actual UI showed "RENDERING page 30 of 60" — a real, honest page count
 * sitting behind a lying verb.
 *
 * 1000 blank pages is deliberately overkill: split's actual cost is almost
 * entirely per-file write overhead (~1ms/page measured locally, blank pages
 * have nothing to encode), so this is what keeps the run "in flight" long
 * enough for `waitFor` to land on a genuine intermediate frame instead of
 * either the pre-run or the already-finished one — the same reason
 * `convert-pdf.test.tsx` picks 300 dpi over 72 for its own progress test.
 */
describe('a running split names itself correctly, not as rendering', () => {
  it('says Splitting, with a real, growing page count while the split is in flight', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 300)
    const { stdin, lastFrame } = render(
      <App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(file)
    await settle()
    stdin.write(ENTER) // stage -> convert picker (a PDF has real targets now)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert to')

    stdin.write(ESC) // back to idle, doc.pdf still staged
    await settle(200)

    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Choose an operation')

    // Hub order is Merge, Split, Extract, Delete, Rotate. Merge is disabled
    // with one file staged, so the cursor already starts on Split.
    stdin.write(ENTER) // Split -> mode picker
    await settle(300)
    expect(lastFrame() ?? '').toContain('How')

    stdin.write(ENTER) // "Every page" is the default mode -> confirm step
    await settle(300)
    expect(lastFrame() ?? '').toContain('Split into 300 files')

    stdin.write(ENTER) // confirm and run

    // Caught mid-run: a real page count from a real `page` event, not the
    // phase line Working shows before the first one arrives, and not the
    // finished frame either (asserted separately below).
    const midFrame = unpaint(await waitFor(lastFrame, (f) => /page \d+ of 300/.test(f)))
    expect(midFrame).toMatch(/page \d+ of 300/)
    const caughtDone = Number(midFrame.match(/page (\d+) of 300/)?.[1])
    expect(caughtDone).toBeGreaterThan(0)
    expect(caughtDone).toBeLessThan(300)

    // The positive assertion the label itself needs: the split's own verb
    // and file actually rendered (W5's "Splitting report.pdf"), on the line
    // and at the end of the bar, not a blank or unrelated frame.
    expect(midFrame).toMatch(/^ {4}Splitting doc\.pdf/m)
    expect(midFrame).toMatch(/Splitting ╱╱$/m)
    // The bug this pins: split must never claim to be converting pages.
    expect(midFrame).not.toMatch(/Converting|RENDERING/)
    // A solid bar, a full cell tall: it fills, and has no knob to drag.
    expect(midFrame).toMatch(/^ {4}█{30} {2}page \d+ of 300$/m)
    expect(midFrame).not.toContain('●')

    const finalFrame = await waitFor(
      lastFrame,
      (f) => f.includes('Drop a file here'),
      // The split itself has to finish here; the suite runs 16 files at once,
      // and a Windows runner scans each of the 300 new files as it lands.
      60_000,
    )
    expect(finalFrame).toContain('Drop a file here')

    const written = (await readdir(dir)).filter((f) => f !== 'doc.pdf')
    expect(written).toHaveLength(300)
  }, 75_000)
})
