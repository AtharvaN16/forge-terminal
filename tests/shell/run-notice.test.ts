import { describe, expect, it } from 'vitest'
import { NOTICE_VERBS, noticeRun } from '../../src/shell/run-notice.js'

describe('noticeRun', () => {
  it('hands the run’s notice and how long it took to the poster', () => {
    const posted: unknown[] = []
    noticeRun(
      NOTICE_VERBS.pdf,
      1_000,
      { made: [{ from: ['/a/book.pdf'], to: ['/a/book-rotated.pdf'] }], failed: [] },
      {
        now: () => 26_000,
        post: async (notice, elapsed) => {
          posted.push({ notice, elapsed })
        },
      },
    )
    expect(posted).toEqual([
      {
        notice: { title: 'PDF finished', body: 'book.pdf → book-rotated.pdf' },
        elapsed: 25_000,
      },
    ])
  })

  it('names each mode as home’s tabs do', () => {
    expect(NOTICE_VERBS).toEqual({
      convert: 'Convert',
      compress: 'Compress',
      pdf: 'PDF',
      edit: 'Edit',
      transcribe: 'Transcribe',
      colour: 'Colour',
    })
  })
})
