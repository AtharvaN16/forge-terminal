import { describe, expect, it } from 'vitest'
import {
  containsPoint,
  frameTopFromCursor,
  type MeasurableNode,
  positionInFrame,
} from '../../src/shell/frame-geometry.js'

/** Builds a fake Ink node chain: `node(top, left, w, h, parent)`. */
function node(
  top: number,
  left: number,
  width: number,
  height: number,
  parentNode: MeasurableNode | null = null,
): MeasurableNode {
  return {
    parentNode,
    yogaNode: {
      getComputedTop: () => top,
      getComputedLeft: () => left,
      getComputedWidth: () => width,
      getComputedHeight: () => height,
    },
  }
}

describe('positionInFrame', () => {
  it('sums top/left up the parent chain', () => {
    // Mirrors the probed layout: a row at top 1 inside a container at top 2,
    // itself inside the root — the render put it at frame row 3, col 2.
    const root = node(0, 0, 80, 7)
    const container = node(3, 2, 76, 3, root)
    const row = node(1, 0, 76, 1, container)
    expect(positionInFrame(row)).toEqual({ row: 4, col: 2, width: 76, height: 1 })
  })

  it('returns the node itself when it has no parent', () => {
    expect(positionInFrame(node(0, 0, 80, 7))).toEqual({
      row: 0,
      col: 0,
      width: 80,
      height: 7,
    })
  })

  it('returns null for a node that has not been laid out', () => {
    expect(positionInFrame(null)).toBeNull()
    expect(positionInFrame({ parentNode: null })).toBeNull()
  })

  it('stops walking at the first ancestor without a yoga node', () => {
    // Ink's root container has no yogaNode; the walk must not throw on it.
    const detachedParent: MeasurableNode = { parentNode: null }
    const child = node(2, 1, 10, 1, detachedParent)
    expect(positionInFrame(child)).toEqual({ row: 2, col: 1, width: 10, height: 1 })
  })
})

describe('containsPoint', () => {
  const rect = { row: 4, col: 2, width: 6, height: 2 }

  it('accepts points inside, including both edges', () => {
    expect(containsPoint(rect, { row: 4, col: 2 })).toBe(true)
    expect(containsPoint(rect, { row: 5, col: 7 })).toBe(true)
  })

  it('rejects points outside on every side', () => {
    expect(containsPoint(rect, { row: 3, col: 4 })).toBe(false)
    expect(containsPoint(rect, { row: 6, col: 4 })).toBe(false)
    expect(containsPoint(rect, { row: 4, col: 1 })).toBe(false)
    expect(containsPoint(rect, { row: 4, col: 8 })).toBe(false)
  })

  it('rejects every point in a zero-height region', () => {
    expect(containsPoint({ row: 4, col: 2, width: 6, height: 0 }, { row: 4, col: 2 })).toBe(false)
  })
})

describe('frameTopFromCursor', () => {
  it('places the frame above the resting cursor', () => {
    // Ink leaves the cursor one line past the frame, so a 3-line frame whose
    // cursor reports row 10 starts at row 7.
    expect(frameTopFromCursor(10, 3)).toBe(7)
  })

  it('handles a frame flush against the top of the screen', () => {
    expect(frameTopFromCursor(3, 3)).toBe(0)
  })
})
