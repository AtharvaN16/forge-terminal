import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { convertAction } from '../../src/core/actions/convert.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'
import { App } from '../../src/shell/App.js'
import { makePdf, makeTempDir } from '../helpers/fixtures.js'

const doc: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.pdf',
  format: 'pdf',
  bytes: 1,
  pages: 248,
  encrypted: false,
}
const img: ImageInfo = {
  kind: 'image',
  path: '/tmp/a.jpg',
  format: 'jpeg',
  bytes: 1,
  width: 10,
  height: 10,
  hasAlpha: false,
  frames: 1,
}

describe('converting a document', () => {
  it('asks which pages, naming the file count', () => {
    const specs = convertAction.options([doc], { target: 'jpeg' }, DEFAULT_PREFERENCES)
    const pages = specs.find((s) => s.id === 'pages')
    expect(pages?.kind).toBe('select')
    if (pages?.kind !== 'select') throw new Error('expected a select')
    expect(pages.choices[0]?.hint).toContain('248')
  })

  it('asks for a resolution, defaulting to 150', () => {
    const specs = convertAction.options([doc], { target: 'jpeg' }, DEFAULT_PREFERENCES)
    const dpi = specs.find((s) => s.id === 'dpi')
    if (dpi?.kind !== 'select') throw new Error('expected a select')
    expect(dpi.default).toBe('150')
  })

  it('asks neither of an image', () => {
    const specs = convertAction.options([img], { target: 'png' }, DEFAULT_PREFERENCES)
    expect(specs.find((s) => s.id === 'pages')).toBeUndefined()
    expect(specs.find((s) => s.id === 'dpi')).toBeUndefined()
  })

  it('plans one output per selected page, zero-padded', () => {
    const [job] = convertAction.plan([{ ...doc, pages: 12 }], {
      target: 'jpeg',
      pages: 'all',
      dpi: '150',
      destination: '/out',
    })
    expect(job?.outputs).toHaveLength(12)
    expect(job?.outputs[0]).toContain('-01.jpg')
    expect(job?.outputs[11]).toContain('-12.jpg')
  })
})

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Polls with the same `settle()` every other test in this suite already
 * uses — real rasterisation time is CPU-load-dependent (measured anywhere
 * from ~300ms to ~2s for a single page at 300dpi on this machine), so a
 * single fixed-offset snapshot is exactly the kind of flaky guess the shell
 * suite's own timing sensitivity warns against. Polling in short steps up
 * to a generous ceiling catches a real in-flight frame under either extreme
 * without inventing a different synchronisation mechanism.
 */
async function waitFor(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  ceilingMs = 15_000,
  stepMs = 100,
): Promise<string> {
  const start = Date.now()
  for (;;) {
    const frame = lastFrame() ?? ''
    if (predicate(frame)) return frame
    if (Date.now() - start > ceilingMs) return frame
    await settle(stepMs)
  }
}

/**
 * End-to-end wiring, not just `convertAction` in isolation: drops a
 * multi-page PDF, walks the real `pages` -> `dpi` -> `quality` -> `destination`
 * steps this task adds to App.tsx, and drives the run all the way through
 * `runPdfJobs`.
 *
 * 300 dpi on a 10-page A4 document is deliberately the slow choice, so the
 * run stays "in flight" long enough for `waitFor` to land on a real
 * intermediate frame rather than either the pre-run or the finished one.
 */
describe('the shell — page and resolution steps, live progress', () => {
  it('renders a real, growing position while rasterising, and never a fabricated one for an ordinary conversion', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 10)
    const { stdin, lastFrame } = render(
      <App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(file)
    await settle()
    stdin.write(ENTER) // stage the file -> target picker (jpeg is first)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert PDF to')

    stdin.write(ENTER) // choose jpeg -> pages step
    await settle(300)
    expect(lastFrame() ?? '').toContain('Pages')

    stdin.write(ENTER) // "All pages" (default, first choice) -> dpi step
    await settle(300)
    expect(lastFrame() ?? '').toContain('Resolution')

    stdin.write(DOWN + DOWN) // 72 -> 150 -> 300 dpi
    await settle()
    stdin.write(ENTER) // -> quality (jpeg is lossy)
    await settle(300)
    stdin.write(ENTER) // accept default quality -> destination
    await settle(300)
    stdin.write(ENTER) // accept the default destination -> runs, no rename step for a document
    await settle(300)

    // Caught mid-run: a real page count, not a blank or completed frame.
    // Invariant 7 forbids a fabricated position, so this only passes if the
    // bar is showing a genuine `{ done, total }` pdfium itself reported —
    // not the "Running…" text `pdf-running` falls back to before the first
    // `page` event, and not the finished result either (asserted below).
    const midFrame = await waitFor(lastFrame, (f) => f.includes('RENDERING'))
    expect(midFrame).toContain('RENDERING')
    expect(midFrame).toMatch(/page \d+ of 10/)
    // A page count under the total this document actually has: proof the
    // frame was caught mid-run, not read after everything had already
    // finished (which would also happen to contain "page 10 of 10").
    const caughtDone = Number(midFrame.match(/page (\d+) of 10/)?.[1])
    expect(caughtDone).toBeLessThan(10)

    // Let the run finish.
    const finalFrame = await waitFor(lastFrame, (f) => f.includes('drop a file or type a path'))

    const written = (await readdir(dir)).filter((f) => f !== 'doc.pdf').sort()
    expect(written).toEqual([
      'doc-01.jpg',
      'doc-02.jpg',
      'doc-03.jpg',
      'doc-04.jpg',
      'doc-05.jpg',
      'doc-06.jpg',
      'doc-07.jpg',
      'doc-08.jpg',
      'doc-09.jpg',
      'doc-10.jpg',
    ])

    // Back at the ordinary prompt, stage cleared — the same landing spot
    // `/pdf`'s other page operations use, not the single-file result screen.
    expect(finalFrame).toContain('drop a file or type a path')
  }, 30_000)
})
