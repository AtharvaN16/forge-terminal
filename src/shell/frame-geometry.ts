/**
 * Where things are, in the coordinate space of Ink's rendered frame.
 *
 * Pure arithmetic — no React, no terminal I/O — so every rule here is
 * unit-testable without a terminal. The hooks that supply the inputs live in
 * `useFrameOrigin.ts` and `ClickTargets.tsx`.
 */

export interface YogaLike {
  getComputedTop(): number
  getComputedLeft(): number
  getComputedWidth(): number
  getComputedHeight(): number
}

/**
 * The shape of an Ink DOM node this module needs. Structural rather than
 * Ink's own `DOMElement` so the tests can build one without a renderer.
 */
export interface MeasurableNode {
  yogaNode?: YogaLike
  parentNode?: MeasurableNode | null
}

export interface Rect {
  row: number
  col: number
  width: number
  height: number
}

export interface Point {
  row: number
  col: number
}

/**
 * A node's position within the frame, in cells from the frame's top-left.
 *
 * `measureElement` gives width and height but not position, so the offset is
 * accumulated up the parent chain — which is how Yoga stores it: each node's
 * computed top/left is relative to its own parent.
 *
 * Returns the *border-box* origin. A Box with padding reports its own edge,
 * not its content's, so a caller hit-testing text must add the padding itself.
 */
export function positionInFrame(node: MeasurableNode | null | undefined): Rect | null {
  if (!node?.yogaNode) return null
  let row = 0
  let col = 0
  let current: MeasurableNode | null | undefined = node
  // Ink's root container has no yogaNode, which is what terminates the walk.
  while (current?.yogaNode) {
    row += current.yogaNode.getComputedTop()
    col += current.yogaNode.getComputedLeft()
    current = current.parentNode
  }
  return {
    row,
    col,
    width: node.yogaNode.getComputedWidth(),
    height: node.yogaNode.getComputedHeight(),
  }
}

/** Inclusive of both edges — a click on a region's last column is still on it. */
export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.row >= rect.row &&
    point.row < rect.row + rect.height &&
    point.col >= rect.col &&
    point.col < rect.col + rect.width
  )
}

/**
 * The frame's absolute top row, given where the terminal says its cursor is.
 *
 * Ink hides the cursor and leaves it at column 0 one line *past* the frame
 * (`cursor-helpers.ts`: "Assumes cursor is at (col 0, line visibleLineCount)"),
 * so the frame's first line is `frameHeight` rows above it. Measured against
 * Ink 7.1.1; a version that parks the cursor elsewhere breaks this and the
 * calibration test in `use-frame-origin.test.tsx` is what will say so.
 */
export function frameTopFromCursor(cursorRow: number, frameHeight: number): number {
  return cursorRow - frameHeight
}
