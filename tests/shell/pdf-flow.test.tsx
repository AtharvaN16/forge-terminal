import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, expandTilde } from '../../src/config/preferences.js'
import { deleteAction, extractAction } from '../../src/core/actions/extract.js'
import { mergeAction } from '../../src/core/actions/merge.js'
import { rotateAction } from '../../src/core/actions/rotate.js'
import { everyNCuts, everyPageCuts, splitAction } from '../../src/core/actions/split.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { COMMANDS, parseCommand } from '../../src/shell/commands.js'
import { PdfFlow } from '../../src/shell/flows/pdf.js'
import { addToStage, emptyStage } from '../../src/shell/stage.js'

const doc = (path: string, pages = 7): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 1000,
  pages,
  encrypted: false,
})

const frame = (sources: DocumentInfo[]) => {
  const stage = addToStage(emptyStage(), sources, [])
  const { lastFrame } = render(
    createElement(PdfFlow, {
      stage,
      width: 80,
      height: 24,
      onDone: () => {},
      onCancel: () => {},
    } as never),
  )
  return lastFrame() ?? ''
}

describe('/pdf', () => {
  it('is a command the palette lists', () => {
    expect(COMMANDS.map((c) => c.name)).toContain('pdf')
    expect(parseCommand('/pdf')?.name).toBe('pdf')
  })

  it('lists the five operations this phase builds', () => {
    const out = frame([doc('/a.pdf')])
    for (const label of ['Split', 'Extract', 'Delete', 'Rotate']) {
      expect(out).toContain(label)
    }
  })

  it('dims merge with a reason when only one file is staged', () => {
    const out = frame([doc('/a.pdf')])
    expect(out).toContain('Merge')
    expect(out).toContain('needs 2+ files')
  })

  it('offers merge when two files are staged', () => {
    const out = frame([doc('/a.pdf'), doc('/b.pdf')])
    expect(out).toContain('Merge')
    expect(out).not.toContain('needs 2+ files')
  })

  it('says why split is unavailable on a one-page document', () => {
    expect(frame([doc('/a.pdf', 1)])).toContain('only one page')
  })
})

// --- everything below is additional coverage written for this task, beyond
// the five tests the brief specifies verbatim above. ---

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const ESCAPE = ESC
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/** Where Save as opens: the configured default folder, which the flow's prefs leave at ~/Desktop. */
const DESKTOP = expandTilde(DEFAULT_PREFERENCES.defaultOutput)
/** `onDone`'s arguments for `jobs` saved where Save as opens, names as planned. */
const saved = (jobs: Job[]) => [
  jobs.map((j) => ({ ...j, outputs: j.outputs.map((o) => join(DESKTOP, basename(o))) })),
  expect.anything(),
]

/** Mounts the flow and drives it into the hub, staged with `sources`. */
function mount(sources: DocumentInfo[], opts: { width?: number; height?: number } = {}) {
  const stage = addToStage(emptyStage(), sources, [])
  const onDone = vi.fn()
  const onCancel = vi.fn()
  const app = render(
    createElement(PdfFlow, {
      stage,
      width: opts.width ?? 80,
      height: opts.height ?? 24,
      onDone,
      onCancel,
    } as never),
  )
  return { ...app, onDone, onCancel, stage }
}

describe('merge — the reorder screen comes before confirm', () => {
  it('plans and hands off exactly what mergeAction.plan produces when the order is untouched', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    // Merge is the first hub row.
    stdin.write(ENTER)
    await settle()
    // The reorder screen, not confirm yet.
    expect(lastFrame() ?? '').toMatch(/order the files/i)
    expect(lastFrame() ?? '').toContain('a.pdf')
    stdin.write(ENTER) // submit the (untouched) order
    await settle()
    expect(lastFrame() ?? '').toContain('Merge 2 files')
    stdin.write(ENTER) // confirm
    await settle()
    expect(onDone).toHaveBeenCalledWith(...saved(mergeAction.plan(sources, {})))
  })

  it('reordering before confirming changes which order the job actually plans in', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf'), doc('/docs/c.pdf')]
    const { stdin, onDone } = mount(sources)
    stdin.write(ENTER) // Merge — the reorder screen
    await settle()
    stdin.write(' ') // pick up the first row, a.pdf
    await settle()
    stdin.write(DOWN) // move it past b.pdf
    await settle()
    stdin.write(' ') // drop it
    await settle()
    stdin.write(ENTER) // submit the edited order
    await settle()
    stdin.write(ENTER) // confirm
    await settle()
    const reordered = [sources[1], sources[0], sources[2]] as typeof sources
    expect(onDone).toHaveBeenCalledWith(...saved(mergeAction.plan(reordered, {})))
  })

  it('escaping back from confirm to the reorder screen keeps the edit — it does not reset to the staged order', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf'), doc('/docs/c.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(ENTER) // Merge — the reorder screen
    await settle()
    stdin.write(' ') // pick up a.pdf
    await settle()
    stdin.write(DOWN) // move it past b.pdf
    await settle()
    stdin.write(' ') // drop it
    await settle()
    stdin.write(ENTER) // submit — reaches Save as, on the name
    await settle()
    stdin.write(ESCAPE) // clears the name
    await settle()
    stdin.write(ESCAPE) // back to the reorder screen
    await settle()
    // MergeList re-mounted: it must show the edit that was already made,
    // not the original staged order it started from.
    expect(lastFrame() ?? '').toMatch(/1\s+b\.pdf/)
    stdin.write(ENTER) // submit again, untouched this time
    await settle()
    stdin.write(ENTER) // confirm
    await settle()
    const reordered = [sources[1], sources[0], sources[2]] as typeof sources
    expect(onDone).toHaveBeenCalledWith(...saved(mergeAction.plan(reordered, {})))
  })

  it('removing files down to one exits back to the hub with a note, and never calls onDone', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(ENTER) // Merge — the reorder screen
    await settle()
    stdin.write('x') // remove a.pdf, leaving one file
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Choose an operation')
    expect(frame).toContain('at least two')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('rotate — one select, then confirm', () => {
  it('asks the turn, then plans a matching rotate job', async () => {
    const sources = [doc('/docs/r.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    // hub order is merge, split, extract, delete, rotate.
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER) // choose Rotate
    await settle()
    expect(lastFrame() ?? '').toContain('Turn')
    stdin.write(DOWN) // 180
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame() ?? '').toContain('Rotate 180')
    stdin.write(ENTER) // confirm
    await settle()
    expect(onDone).toHaveBeenCalledWith(...saved(rotateAction.plan(sources, { degrees: '180' })))
  })
})

describe('split — the mode picker comes before any grid', () => {
  it('every page: skips straight to confirm with one cut per page boundary', async () => {
    const sources = [doc('/docs/s.pdf', 7)]
    const { stdin, lastFrame, onDone } = mount(sources)
    // Merge is disabled with one file staged, so the hub cursor already
    // starts on Split — no down-arrow needed to reach it.
    stdin.write(ENTER) // Split
    await settle()
    expect(lastFrame() ?? '').toContain('How')
    stdin.write(ENTER) // "Every page" is the default, first row
    await settle()
    expect(lastFrame() ?? '').toContain('Split into 7 files')
    stdin.write(ENTER)
    await settle()
    expect(onDone).toHaveBeenCalledWith(
      ...saved(splitAction.plan(sources, { mode: 'every-page', cuts: everyPageCuts(7) })),
    )
  })

  it('every N pages: asks how many, then plans from everyNCuts', async () => {
    const sources = [doc('/docs/s.pdf', 7)]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(ENTER) // Split — the hub cursor already starts there
    await settle()
    stdin.write(DOWN) // Every N pages
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('3')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame() ?? '').toContain('Split into 3 files')
    stdin.write(ENTER)
    await settle()
    expect(onDone).toHaveBeenCalledWith(
      ...saved(splitAction.plan(sources, { mode: 'every-n', n: 3, cuts: everyNCuts(7, 3) })),
    )
  })

  it('at points I choose: opens the grid in gap mode', async () => {
    const sources = [doc('/docs/s.pdf', 7)]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(ENTER) // Split — the hub cursor already starts there
    await settle()
    stdin.write(DOWN + DOWN) // At points I choose
    await settle()
    stdin.write(ENTER)
    await settle()
    // No cuts yet: the grid's gap-mode header counts one whole file.
    expect(lastFrame() ?? '').toContain('1 file')
    stdin.write(' ') // cut after page 1
    await settle()
    stdin.write(ENTER) // submit the grid
    await settle()
    expect(lastFrame() ?? '').toContain('Split into 2 files')
    stdin.write(ENTER) // confirm
    await settle()
    expect(onDone).toHaveBeenCalledWith(
      ...saved(splitAction.plan(sources, { mode: 'points', cuts: [0] })),
    )
  })
})

describe('extract — the grid leads when the document fits', () => {
  it('opens the grid directly for a small document, asks one file vs many, plans a matching job', async () => {
    const sources = [doc('/docs/e.pdf', 5)]
    const { stdin, lastFrame, onDone } = mount(sources)
    // Merge is disabled with one file staged, so the hub cursor starts on
    // Split; one down reaches Extract.
    stdin.write(DOWN) // Extract
    await settle()
    stdin.write(ENTER)
    await settle()
    // The grid, not a bare text field: page cells are on screen.
    const gridFrame = lastFrame() ?? ''
    expect(gridFrame).toContain('1')
    // Both views are titled Pages; the grid counts, the field has a marker.
    expect(gridFrame).toContain('selected')
    expect(gridFrame).not.toContain('› ')
    stdin.write(' ') // select page 1
    await settle()
    stdin.write(ENTER) // submit selection
    await settle()
    expect(lastFrame() ?? '').toContain('Output')
    stdin.write(ENTER) // "One file" is the default
    await settle()
    expect(lastFrame() ?? '').toContain('Extract 1 page')
    stdin.write(ENTER) // confirm
    await settle()
    expect(onDone).toHaveBeenCalledWith(
      ...saved(extractAction.plan(sources, { pages: [0], separate: 'one' })),
    )
  })

  it('falls back to the typed range field when the document does not fit', async () => {
    const sources = [doc('/docs/big.pdf', 999)]
    const { stdin, lastFrame, onDone } = mount(sources, { width: 40, height: 10 })
    stdin.write(DOWN) // Extract — the hub cursor starts on Split
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame() ?? '').toContain('Pages')
    stdin.write('2-4')
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(DOWN) // Separate files
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame() ?? '').toContain('Extract 3 pages into 3 files')
    stdin.write(ENTER)
    await settle()
    expect(onDone).toHaveBeenCalledWith(
      ...saved(extractAction.plan(sources, { pages: [1, 2, 3], separate: 'many' })),
    )
  })

  it('r and g swap between the grid and the typed field, editing the same selection', async () => {
    const sources = [doc('/docs/e.pdf', 5)]
    const { stdin, lastFrame } = mount(sources)
    // Merge is disabled with one file staged, so the hub cursor starts on
    // Split; one down reaches Extract.
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER) // Extract, grid leads (fits)
    await settle()
    stdin.write(' ') // select page 1
    await settle()
    stdin.write('r') // toggle to the typed field
    await settle()
    expect(lastFrame() ?? '').toContain('› ')
    expect(lastFrame() ?? '').toContain('1')
    stdin.write('g') // toggle back to the grid
    await settle()
    const back = lastFrame() ?? ''
    expect(back).not.toContain('› ')
    // The toggle preserved the selection made before it (both views write
    // `values.pages`): submitting now should reach extract's *second*
    // question, "Output" — proof this was genuinely the extract path and
    // not delete, which the grid alone can't distinguish since both render
    // identically.
    stdin.write(ENTER)
    await settle()
    expect(lastFrame() ?? '').toContain('Output')
  })
})

describe('delete — one question fewer than extract', () => {
  it('goes straight to confirm once pages are chosen — no separate-files question', async () => {
    const sources = [doc('/docs/d.pdf', 5)]
    const { stdin, lastFrame, onDone } = mount(sources)
    // Merge is disabled with one file staged, so the hub cursor starts on
    // Split; two downs reach Delete.
    stdin.write(DOWN + DOWN) // Delete
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(' ') // select page 1
    await settle()
    stdin.write(ENTER) // submit selection
    await settle()
    expect(lastFrame() ?? '').toContain('Delete 1 page')
    stdin.write(ENTER)
    await settle()
    expect(onDone).toHaveBeenCalledWith(...saved(deleteAction.plan(sources, { pages: [0] })))
  })

  it('refuses to plan deleting every page — the engine would reject it', async () => {
    const sources = [doc('/docs/d.pdf', 2)]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(DOWN + DOWN) // Delete — the hub cursor starts on Split
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('a') // select all pages
    await settle()
    stdin.write(ENTER) // try to submit
    await settle()
    expect(lastFrame() ?? '').toContain('every page')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('the hub Compress and Convert rows', () => {
  const withImages = (path: string): DocumentInfo => ({
    ...doc(path),
    images: { compressible: 2, skipped: 0 },
  })

  it('lists both after the page operations', () => {
    const out = frame([doc('/a.pdf')])
    expect(out).toContain('Compress')
    expect(out).toContain('Convert')
    expect(out.indexOf('Rotate')).toBeLessThan(out.indexOf('Compress'))
  })

  it('dims Compress when the PDF has no images to re-encode', () => {
    expect(frame([doc('/a.pdf')])).toContain('no images to shrink')
    expect(frame([withImages('/a.pdf')])).not.toContain('no images to shrink')
  })

  it('takes several PDFs as one batch; Compress needs images in one of them', () => {
    expect(frame([doc('/a.pdf'), withImages('/b.pdf')])).not.toContain('one file at a time')
    expect(frame([doc('/a.pdf'), withImages('/b.pdf')])).not.toContain('no images to shrink')
    expect(frame([doc('/a.pdf'), doc('/b.pdf')])).toContain('no images to shrink')
  })

  it('hands off to compress on ↵', async () => {
    const onHandoff = vi.fn()
    const stage = addToStage(emptyStage(), [withImages('/a.pdf')], [])
    const { stdin } = render(
      createElement(PdfFlow, {
        stage,
        width: 80,
        height: 24,
        onDone: () => {},
        onCancel: () => {},
        onHandoff,
      } as never),
    )
    await settle()
    stdin.write(DOWN + DOWN + DOWN + DOWN) // Split → Extract → Delete → Rotate → Compress
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onHandoff).toHaveBeenCalledWith('compress')
  })

  it('hands off to convert on ↵, skipping a dimmed Compress', async () => {
    const onHandoff = vi.fn()
    const stage = addToStage(emptyStage(), [doc('/a.pdf')], [])
    const { stdin } = render(
      createElement(PdfFlow, {
        stage,
        width: 80,
        height: 24,
        onDone: () => {},
        onCancel: () => {},
        onHandoff,
      } as never),
    )
    await settle()
    stdin.write(DOWN + DOWN + DOWN + DOWN) // … Rotate → Convert
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onHandoff).toHaveBeenCalledWith('convert')
  })
})

describe('cancelling out of the hub', () => {
  it('calls onCancel on escape', async () => {
    const { stdin, onCancel } = mount([doc('/a.pdf')])
    stdin.write(ESCAPE)
    await settle()
    expect(onCancel).toHaveBeenCalled()
  })
})

const CTRL_U = String.fromCharCode(21)
const TAB = '\t'
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

describe('/pdf ends on Save as', () => {
  /** Rotate 90° right, up to Save as. */
  async function rotateToSaveAs() {
    const sources = [doc('/docs/report.pdf', 3)]
    const app = mount(sources)
    app.stdin.write(DOWN + DOWN + DOWN) // Rotate
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(ENTER) // 90° right
    await settle()
    return { ...app, sources }
  }

  it('asks Save as for rotate: the job at the title’s right, the name editable, ↵ runs it', async () => {
    const { stdin, lastFrame, onDone } = await rotateToSaveAs()
    const out = plain(lastFrame())
    expect(out).toMatch(/^ {2}Save as +Rotate 90°$/m)
    expect(out).toMatch(/name +report-rotated +\.pdf/)
    expect(out).toMatch(/▌ Desktop/)
    stdin.write('X')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onDone.mock.calls[0]?.[0]?.[0]?.outputs).toEqual([join(DESKTOP, 'report-rotatedX.pdf')])
  })

  it('opens split on the folder, the names fixed, and esc goes back to how to split', async () => {
    const sources = [doc('/docs/s.pdf', 3)]
    const { stdin, lastFrame } = mount(sources)
    stdin.write(ENTER) // Split
    await settle()
    stdin.write(ENTER) // Every page
    await settle()
    const out = plain(lastFrame())
    // No name to edit: the row says what will be written; the folders are live.
    expect(out).toMatch(/files {3}s-1\.pdf … 3 files/)
    expect(out).toMatch(/▌ Desktop/)
    expect(out).toMatch(/esc back · ctrl-c quit/)
    stdin.write(ESCAPE)
    await settle()
    expect(plain(lastFrame())).toContain('Every N pages')
  })

  it('expands ~ in a typed folder before planning', async () => {
    const { stdin, onDone } = await rotateToSaveAs()
    stdin.write(TAB)
    await settle()
    stdin.write('~/forge-pdf-out')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onDone.mock.calls[0]?.[0]?.[0]?.outputs?.[0]).toBe(
      join(homedir(), 'forge-pdf-out', 'report-rotated.pdf'),
    )
  })

  it('trims a typed name and turns / into -', async () => {
    const { stdin, onDone } = await rotateToSaveAs()
    stdin.write(CTRL_U)
    await settle()
    stdin.write('  a/b  ')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(basename(onDone.mock.calls[0]?.[0]?.[0]?.outputs?.[0] ?? '')).toBe('a-b.pdf')
  })

  it('names a merge on Save as, after the order, and esc goes back to the order', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf')]
    const { stdin, lastFrame } = mount(sources)
    stdin.write(ENTER) // Merge
    await settle()
    expect(plain(lastFrame())).not.toContain('rename')
    stdin.write(ENTER) // the order as it is
    await settle()
    expect(plain(lastFrame())).toMatch(/name +docs-merged +\.pdf/)
    stdin.write(ESCAPE) // clears the name
    await settle()
    stdin.write(ESCAPE) // back to the order
    await settle()
    expect(plain(lastFrame())).toMatch(/order the files/i)
  })
})

describe('/pdf, drawn with the decided parts', () => {
  const keyRow = (f: string | undefined) => plain(f).trimEnd().split('\n').at(-1) ?? ''

  it('titles the hub, the file at its right; the list no wider than the card; esc back', () => {
    const { lastFrame } = mount([doc('/docs/r.pdf', 7)])
    const out = plain(lastFrame())
    expect(out).toMatch(/^ {2}Choose an operation +r\.pdf · 7 pages$/m)
    const row = out.split('\n').find((l) => l.includes('▌')) ?? ''
    expect(row.length).toBeLessThanOrEqual(52)
    expect(keyRow(lastFrame())).toMatch(/esc back · ctrl-c quit$/)
  })

  it('titles split’s question “How to split”, rotate’s by its label, the pages at their right', async () => {
    const split = mount([doc('/docs/r.pdf', 7)])
    split.stdin.write(ENTER)
    await settle()
    expect(plain(split.lastFrame())).toMatch(/^ {2}How to split +7 pages$/m)
    const rotate = mount([doc('/docs/r.pdf', 7)])
    rotate.stdin.write(DOWN + DOWN + DOWN + ENTER)
    await settle()
    expect(plain(rotate.lastFrame())).toMatch(/^ {2}Turn +7 pages$/m)
  })

  it('asks “Pages per file” in the filled field, which says what the number makes', async () => {
    const { stdin, lastFrame } = mount([doc('/docs/r.pdf', 7)])
    stdin.write(ENTER) // Split
    await settle()
    stdin.write(DOWN + ENTER) // Every N pages
    await settle()
    stdin.write('2')
    await settle()
    const out = plain(lastFrame())
    expect(out).toMatch(/^ {2}Pages per file +7 pages$/m)
    expect(out).toMatch(/› 2 +pages each → 4 files/)
    expect(keyRow(lastFrame())).toMatch(/esc back · ctrl-c quit$/)
  })

  it('titles the page grid, and its keys say esc', async () => {
    const { stdin, lastFrame } = mount([doc('/docs/r.pdf', 7)])
    stdin.write(DOWN + ENTER) // Extract
    await settle()
    expect(plain(lastFrame())).toMatch(/^ {2}Pages +r\.pdf · 7 pages$/m)
    // Keys on the margin leave this long row a column short at 80, so the
    // footnote gives up "ctrl-c quit" first, as a narrow row always does.
    expect(keyRow(lastFrame())).toMatch(/r type ranges · esc back$/)
  })

  it('orders a merge on the picker’s band, “choose” not “select”, sort and remove quiet', async () => {
    const { stdin, lastFrame } = mount([doc('/docs/a.pdf', 7), doc('/docs/b.pdf', 7)])
    stdin.write(ENTER) // Merge
    await settle()
    const out = plain(lastFrame())
    expect(out).toMatch(/^ {2}Order the files +2 files · 14 pages$/m)
    expect(out).toMatch(/▌ +1 +a\.pdf/)
    expect(out).not.toContain('❯')
    expect(keyRow(lastFrame())).toMatch(
      // Caps where there is colour, brackets where there is none; brackets
      // are wider, so the footnote gives up its last item first (F1).
      /↑↓\]? +choose .*s sort · x remove · esc back/,
    )
  })
})

describe('/pdf, a refusal of what was typed (E5·b)', () => {
  it('says “Not a number” under every N pages, and clears once typing starts again', async () => {
    const { stdin, lastFrame } = mount([doc('/docs/r.pdf', 7)])
    stdin.write(ENTER) // Split
    await settle()
    stdin.write(DOWN + ENTER) // Every N pages
    await settle()
    stdin.write('x')
    await settle()
    stdin.write(ENTER)
    await settle()
    const out = plain(lastFrame())
    expect(out).toMatch(/Not a number {3}x is not a whole number of pages\./)
    expect(out).not.toContain('⚠')
    stdin.write('2')
    await settle()
    expect(plain(lastFrame())).not.toContain('Not a number')
  })

  it('says “Not a page range” under a typed range it cannot read', async () => {
    const { stdin, lastFrame } = mount([doc('/docs/r.pdf', 300)])
    stdin.write(DOWN + ENTER) // Extract: too many pages for the grid, so the field
    await settle()
    stdin.write('zz')
    await settle()
    stdin.write(ENTER)
    await settle()
    const out = plain(lastFrame())
    expect(out).toMatch(/Not a page range {3}/)
    expect(out).not.toContain('⚠')
  })
})

describe('merge’s title counts what is in the list', () => {
  it('says one file fewer the moment x removes one', async () => {
    const { stdin, lastFrame } = mount([
      doc('/docs/a.pdf', 2),
      doc('/docs/b.pdf', 3),
      doc('/docs/c.pdf', 4),
    ])
    stdin.write(ENTER) // Merge
    await settle()
    expect(plain(lastFrame())).toMatch(/^ {2}Order the files +3 files · 9 pages$/m)
    stdin.write('x') // remove a.pdf
    await settle()
    expect(plain(lastFrame())).toMatch(/^ {2}Order the files +2 files · 7 pages$/m)
  })
})
