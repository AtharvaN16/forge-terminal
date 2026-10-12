import { describe, expect, it } from 'vitest'
import { placementFrom } from '../../src/shell/useInlinePictures.js'

describe('placementFrom (where an inline picture goes, from where Ink leaves the cursor)', () => {
  it('counts up from the line past a frame shorter than the viewport', () => {
    // A 21-row frame in 40 rows: the cursor rests on row 21, the box at row 3 is 18 up.
    expect(placementFrom(3, 2, 21, 40)).toEqual({ up: 18, col: 2 })
  })

  it('counts from the last line when the frame fills the viewport (no trailing newline)', () => {
    expect(placementFrom(3, 2, 24, 24)).toEqual({ up: 20, col: 2 })
  })

  it('skips a box whose top has scrolled off the viewport', () => {
    expect(placementFrom(3, 2, 40, 24)).toBeUndefined()
    expect(placementFrom(16, 2, 40, 24)).toEqual({ up: 23, col: 2 })
  })
})
