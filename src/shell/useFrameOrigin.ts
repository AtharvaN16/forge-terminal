import { type DOMElement, measureElement, useStdout } from 'ink'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { frameTopFromCursor } from './frame-geometry.js'
import { CURSOR_QUERY } from './mouse.js'
import { writeToTerminal } from './terminal-write.js'
import { useCursorReport } from './useMouse.js'

/**
 * The absolute row the frame's first line occupies, or null until the terminal
 * has answered once.
 *
 * Ink hides the cursor while rendering and leaves it at column 0 one line past
 * the frame, so asking the terminal where its cursor is (DSR) locates the frame
 * without moving anything and without being visible. That is what makes this
 * work inline: Ink never exposes the frame's absolute position, and in inline
 * mode the frame moves whenever `<Static>` history scrolls the screen.
 *
 * The answer is cached, not re-queried per event, because hover needs a
 * position on every cell of pointer travel and a round trip per motion event
 * is not affordable. It is refreshed only when the frame can have moved:
 *
 *   - mount
 *   - `revision` changed — the caller's signal that history committed
 *   - the frame's own height changed
 *   - the terminal was resized
 *
 * Between refreshes the cached value stands. A click landing in the window
 * between a refresh being issued and its reply arriving is resolved against the
 * previous origin; `<Static>` only ever pushes the frame *down*, so a stale
 * origin fails the bounds check and the click is dropped rather than routed to
 * the wrong target.
 */
export function useFrameOrigin(
  rootRef: RefObject<DOMElement | null>,
  revision: number,
): number | null {
  const { stdout } = useStdout()
  const [origin, setOrigin] = useState<number | null>(null)

  /**
   * The height the frame had when the in-flight query was sent. The reply
   * carries no identity, so it must be paired with the height that was current
   * when it was asked for — pairing it with the height at *arrival* would be
   * wrong for any render that happened in between.
   */
  const pendingHeight = useRef<number | null>(null)
  const lastHeight = useRef<number | null>(null)
  const lastRevision = useRef<number | null>(null)
  const lastColumns = useRef<number | undefined>(stdout?.columns)
  const lastRows = useRef<number | undefined>(stdout?.rows)

  useCursorReport((position) => {
    const height = pendingHeight.current
    if (height === null) return
    pendingHeight.current = null
    setOrigin(frameTopFromCursor(position.row, height))
  })

  // No dependency array: the frame's height is only knowable after a render,
  // so the decision to re-query is made from measurements taken here.
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const { height } = measureElement(node)

    const heightChanged = lastHeight.current !== height
    const revisionChanged = lastRevision.current !== revision
    const resized = lastColumns.current !== stdout?.columns || lastRows.current !== stdout?.rows

    if (!heightChanged && !revisionChanged && !resized) return

    lastHeight.current = height
    lastRevision.current = revision
    lastColumns.current = stdout?.columns
    lastRows.current = stdout?.rows

    pendingHeight.current = height
    writeToTerminal(CURSOR_QUERY, stdout as NodeJS.WriteStream | undefined)
  })

  return origin
}
