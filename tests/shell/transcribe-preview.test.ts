import { describe, expect, it } from 'vitest'
import { previewLines } from '../../src/shell/flows/transcribe.js'

/** Done's first lines of a picture's text (spec 2026-10-23-extract-text-design §3.1). */
describe('previewLines', () => {
  it('drops the blank lines between blocks', () => {
    expect(previewLines('Title\n\nA paragraph.\n')).toEqual(['Title', 'A paragraph.'])
  })

  it('lines a table up, each column as wide as its widest cell', () => {
    expect(previewLines('Region\tRate\nNorth\t90%\nSouthwest\t7%\n\nAfter.\n')).toEqual([
      'Region      Rate',
      'North       90%',
      'Southwest   7%',
      'After.',
    ])
  })
})
