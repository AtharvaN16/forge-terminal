import { type DOMElement, measureElement, useStdout } from 'ink'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { frameTopFromCursor } from './frame-geometry.js'
import { CURSOR_QUERY } from './mouse.js'
import { writeToTerminal } from './terminal-write.js'
import { useCursorReport } from './useMouse.js'

/**
 * How many unanswered `CURSOR_QUERY` writes `pendingHeights` tolerates before
 * this hook stops sending more. Real latency plus a burst of triggers (a fast
 * resize followed immediately by a revision bump, say) can leave a couple of
 * replies outstanding briefly; a terminal that never answers DSR at all —
 * some multiplexers, CI/wrapper PTYs, minimal emulators, all real, not
 * hypothetical — would otherwise leave this queue growing by one on every
 * recalibration for the life of the process. Small enough to bound that
 * leak quickly, generous enough that ordinary round-trip latency never
 * trips it.
 */
const MAX_PENDING_QUERIES = 4

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
   * Heights of in-flight queries, oldest first. The reply carries no identity,
   * so it must be paired with the height that was current when it was *sent*
   * — pairing it with the height at arrival would be wrong for any render
   * that happened in between, and a single scalar survives only one in-flight
   * query at a time: a second recalibration before the first reply lands
   * would overwrite it, mispairing the first reply and dropping the second
   * (its arrival would see nothing pending).
   *
   * A FIFO queue instead of a scalar is correct because DSR replies are not
   * reordered — the terminal answers requests over a single serial
   * connection in the order they were sent — so shifting the oldest pending
   * height off the front always matches the oldest reply still owed,
   * however many queries are in flight at once.
   */
  const pendingHeights = useRef<number[]>([])
  const lastHeight = useRef<number | null>(null)
  const lastRevision = useRef<number | null>(null)
  const lastColumns = useRef<number | undefined>(stdout?.columns)
  const lastRows = useRef<number | undefined>(stdout?.rows)

  useCursorReport((position) => {
    // A reply with nothing queued is a stray report the app did not ask for
    // (or one delivered after this component already unmounted its previous
    // instance) — ignore it rather than pairing it with an unrelated height.
    const height = pendingHeights.current.shift()
    if (height === undefined) return
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

    // A terminal that never answers DSR is an expected case, not an anomaly
    // (see `MAX_PENDING_QUERIES`) — nothing ever shifts `pendingHeights` in
    // that world, so left ungated this would push one more entry per
    // recalibration for as long as the process runs. Once that many replies
    // are still outstanding, give up asking: `origin` stays at whatever it
    // last resolved to (`null`, if the very first query was never answered),
    // mouse support degrades to inert rather than guessing, and no further
    // escape sequences are wasted on a terminal that ignores them.
    //
    // The trackers below are deliberately left stale while gated, so that
    // the render right after a slot frees (a reply finally does shift one
    // off) re-evaluates against *current* geometry rather than the
    // possibly-long-stale geometry from when queries first stopped.
    if (pendingHeights.current.length >= MAX_PENDING_QUERIES) return

    lastHeight.current = height
    lastRevision.current = revision
    lastColumns.current = stdout?.columns
    lastRows.current = stdout?.rows

    pendingHeights.current.push(height)
    writeToTerminal(CURSOR_QUERY, stdout as NodeJS.WriteStream | undefined)
  })

  return origin
}
