import { describe, expect, it } from 'vitest'
import {
  actionsFor,
  deleteAction,
  extractAction,
  mergeAction,
  rotateAction,
  splitAction,
  unavailableReason,
} from '../../src/core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../../src/core/actions/split.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'

const doc = (path: string, pages = 7): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 1000,
  pages,
  encrypted: false,
})
const image: ImageInfo = {
  kind: 'image',
  path: '/tmp/a.jpg',
  format: 'jpeg',
  bytes: 1,
  width: 1,
  height: 1,
  hasAlpha: false,
  frames: 1,
}
const docx: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.docx',
  format: 'docx',
  bytes: 1000,
  pages: 3,
  encrypted: false,
}

describe('appliesTo', () => {
  it('offers merge only when two or more documents are staged', () => {
    expect(mergeAction.appliesTo([doc('/a.pdf')])).toBe(false)
    expect(mergeAction.appliesTo([doc('/a.pdf'), doc('/b.pdf')])).toBe(true)
  })

  it('explains why merge is unavailable', () => {
    expect(unavailableReason(mergeAction, [doc('/a.pdf')])).toBe('needs 2+ files')
  })

  it('offers the single-document operations on exactly one document', () => {
    for (const action of [splitAction, extractAction, deleteAction, rotateAction]) {
      expect(action.appliesTo([doc('/a.pdf')])).toBe(true)
      expect(action.appliesTo([doc('/a.pdf'), doc('/b.pdf')])).toBe(false)
    }
  })

  it('offers no page operation on an image', () => {
    expect(actionsFor([image]).map((a) => a.id)).not.toContain('split')
  })

  it('never offers a page operation on a docx — those stay pdf-only', () => {
    expect(mergeAction.appliesTo([docx, docx])).toBe(false)
    for (const action of [splitAction, extractAction, deleteAction, rotateAction]) {
      expect(action.appliesTo([docx])).toBe(false)
    }
  })

  it('does not offer split on a one-page document', () => {
    expect(splitAction.appliesTo([doc('/a.pdf', 1)])).toBe(false)
    expect(unavailableReason(splitAction, [doc('/a.pdf', 1)])).toBe('only one page')
  })
})

describe('plan', () => {
  it('builds a merge job in the staged order', () => {
    const sources = [doc('/inv/jan.pdf'), doc('/inv/feb.pdf')]
    const [job] = mergeAction.plan(sources, {})
    expect(job?.op).toBe('merge')
    expect(job?.sources.map((s) => s.path)).toEqual(['/inv/jan.pdf', '/inv/feb.pdf'])
    expect(job?.outputs).toEqual(['/inv/inv-merged.pdf'])
  })

  it('builds a split job with one output per part', () => {
    const [job] = splitAction.plan([doc('/docs/report.pdf')], { cuts: [0, 3] })
    expect(job?.op).toBe('split')
    expect(job?.outputs).toEqual(['/docs/report-1.pdf', '/docs/report-2.pdf', '/docs/report-3.pdf'])
  })

  it('builds an extract job from a typed range', () => {
    const [job] = extractAction.plan([doc('/docs/report.pdf')], {
      pages: '1-3',
      separate: false,
    })
    expect(job?.op).toBe('extract')
    if (job?.op !== 'extract') throw new Error('expected extract')
    expect(job.pages).toEqual([0, 1, 2])
    expect(job.outputs).toEqual(['/docs/report-extract.pdf'])
  })

  it('builds a rotate job from a degree value', () => {
    const [job] = rotateAction.plan([doc('/docs/report.pdf')], { degrees: 180 })
    expect(job?.op).toBe('rotate')
    if (job?.op !== 'rotate') throw new Error('expected rotate')
    expect(job.turns).toBe(2)
    expect(job.outputs).toEqual(['/docs/report-rotated.pdf'])
  })
})

/**
 * A step of 0 never advances the loop, so this used to run until the cuts
 * array hit its maximum length — about a second of CPU — and then throw a
 * raw `RangeError` that `src/index.ts` rethrows as a stack trace. Both front
 * ends now validate before calling, so this guard is the backstop: it fails
 * as a ForgeError, which every caller already knows how to render, rather
 * than silently answering "no cuts" for an input nobody could have meant.
 */
describe('everyNCuts', () => {
  it('cuts every n pages, with a shorter last group', () => {
    expect(everyNCuts(25, 10)).toEqual([9, 19])
  })

  it('refuses a step of zero instead of looping forever', () => {
    expect(() => everyNCuts(24, 0)).toThrow(/at least 1/)
  })

  it('refuses a negative or fractional step for the same reason', () => {
    expect(() => everyNCuts(24, -1)).toThrow(/at least 1/)
    expect(() => everyNCuts(24, 2.5)).toThrow(/at least 1/)
  })

  it('leaves every-page alone', () => {
    expect(everyPageCuts(3)).toEqual([0, 1])
  })
})
