import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { deleteAction, extractAction } from '../../src/core/actions/extract.js'
import { mergeAction } from '../../src/core/actions/merge.js'
import { rotateAction } from '../../src/core/actions/rotate.js'
import { everyNCuts, everyPageCuts, splitAction } from '../../src/core/actions/split.js'
import type { DocumentInfo } from '../../src/core/types.js'
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
    expect(lastFrame() ?? '').toContain('order the files')
    expect(lastFrame() ?? '').toContain('a.pdf')
    stdin.write(ENTER) // submit the (untouched) order
    await settle()
    expect(lastFrame() ?? '').toContain('Merge 2 files')
    stdin.write(ENTER) // confirm
    await settle()
    expect(onDone).toHaveBeenCalledWith(mergeAction.plan(sources, {}))
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
    expect(onDone).toHaveBeenCalledWith(mergeAction.plan(reordered, {}))
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
    stdin.write(ENTER) // submit — reaches confirm
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
    expect(onDone).toHaveBeenCalledWith(mergeAction.plan(reordered, {}))
  })

  it('removing files down to one exits back to the hub with a note, and never calls onDone', async () => {
    const sources = [doc('/docs/a.pdf'), doc('/docs/b.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    stdin.write(ENTER) // Merge — the reorder screen
    await settle()
    stdin.write('x') // remove a.pdf, leaving one file
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('PDF — choose an operation')
    expect(frame).toContain('at least two')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('rotate — one select, then confirm', () => {
  it('asks the turn, then plans a matching rotate job', async () => {
    const sources = [doc('/docs/r.pdf')]
    const { stdin, lastFrame, onDone } = mount(sources)
    // hub order is merge, split, extract, delete, rotate.
    stdin.write(DOWN + DOWN + DOWN + DOWN)
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
    expect(onDone).toHaveBeenCalledWith(rotateAction.plan(sources, { degrees: '180' }))
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
      splitAction.plan(sources, { mode: 'every-page', cuts: everyPageCuts(7) }),
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
      splitAction.plan(sources, { mode: 'every-n', n: 3, cuts: everyNCuts(7, 3) }),
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
    expect(onDone).toHaveBeenCalledWith(splitAction.plan(sources, { mode: 'points', cuts: [0] }))
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
    expect(gridFrame).not.toContain('Pages')
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
      extractAction.plan(sources, { pages: [0], separate: 'one' }),
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
      extractAction.plan(sources, { pages: [1, 2, 3], separate: 'many' }),
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
    expect(lastFrame() ?? '').toContain('Pages')
    expect(lastFrame() ?? '').toContain('1')
    stdin.write('g') // toggle back to the grid
    await settle()
    const back = lastFrame() ?? ''
    expect(back).not.toContain('Pages')
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
    expect(onDone).toHaveBeenCalledWith(deleteAction.plan(sources, { pages: [0] }))
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

describe('cancelling out of the hub', () => {
  it('calls onCancel on escape', async () => {
    const { stdin, onCancel } = mount([doc('/a.pdf')])
    stdin.write(ESCAPE)
    await settle()
    expect(onCancel).toHaveBeenCalled()
  })
})
