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
 * One in-flight `CURSOR_QUERY`: the frame height it was paired with when it
 * was sent, and whether its reply needs cross-checking before being trusted.
 *
 * `verify` is false only for a query sent because `revision` changed. Those
 * commits carry a `<Static>` push, which goes through Ink's
 * `onImmediateRender` — `resetAfterCommit` in `node_modules/ink/build/
 * reconciler.js` calls it, unthrottled, whenever `isStaticDirty`, and returns
 * before the regular (possibly throttled) `onRender` even runs for that
 * commit. So a revision-triggered query is never raced the way described on
 * `useCursorReport` below, and — because `<Static>` is the one thing that
 * legitimately moves the frame's top row — its reply is exactly the case the
 * check below cannot tell apart from the race. `heightChanged` and `resized`
 * queries get no such guarantee and are always verified.
 */
interface PendingQuery {
  height: number
  verify: boolean
}

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
 *
 * A `heightChanged` or `resized` refresh can itself race Ink's own repaint —
 * see the comment inside `useCursorReport` below for the mechanism and
 * `PendingQuery` for how a reply from that race is told apart from a
 * legitimate one.
 */
export function useFrameOrigin(
  rootRef: RefObject<DOMElement | null>,
  revision: number,
): number | null {
  const { stdout } = useStdout()
  const [origin, setOrigin] = useState<number | null>(null)

  /**
   * In-flight queries, oldest first. The reply carries no identity, so it
   * must be paired with the height that was current when it was *sent* —
   * pairing it with the height at arrival would be wrong for any render that
   * happened in between, and a single scalar survives only one in-flight
   * query at a time: a second recalibration before the first reply lands
   * would overwrite it, mispairing the first reply and dropping the second
   * (its arrival would see nothing pending).
   *
   * A FIFO queue instead of a scalar is correct because DSR replies are not
   * reordered — the terminal answers requests over a single serial
   * connection in the order they were sent — so shifting the oldest pending
   * entry off the front always matches the oldest reply still owed, however
   * many queries are in flight at once.
   */
  const pending = useRef<PendingQuery[]>([])
  const lastHeight = useRef<number | null>(null)
  const lastRevision = useRef<number | null>(null)
  const lastColumns = useRef<number | undefined>(stdout?.columns)
  const lastRows = useRef<number | undefined>(stdout?.rows)
  /**
   * Mirrors `origin` synchronously. `useCursorReport`'s handler fires from a
   * raw input event, not a render, so it cannot wait for `origin` state to
   * catch up before the next reply needs to read it — the same reason
   * `PathInput.tsx` and `Prompt.tsx` shadow their own state with a ref.
   */
  const originRef = useRef<number | null>(null)

  const query = (height: number, verify: boolean) => {
    pending.current.push({ height, verify })
    writeToTerminal(CURSOR_QUERY, stdout as NodeJS.WriteStream | undefined)
  }

  useCursorReport((position) => {
    // A reply with nothing queued is a stray report the app did not ask for
    // (or one delivered after this component already unmounted its previous
    // instance) — ignore it rather than pairing it with an unrelated entry.
    const entry = pending.current.shift()
    if (!entry) return

    /**
     * Ink's render throttle (`node_modules/ink/build/ink.js`:
     * `throttle(this.onRender, renderThrottleMs, {leading: true, trailing:
     * true})`, ~33ms at the default `maxFps: 30`) can paint on a trailing
     * timer that fires *after* the effect below has already measured the new
     * layout and sent its query. Yoga's layout — what `measureElement` reads
     * — updates synchronously on every commit regardless of the throttle
     * (`resetAfterCommit` in `node_modules/ink/build/reconciler.js` calls
     * `onComputeLayout()` unconditionally, before the possibly-throttled
     * `onRender()`), so the effect can measure and query a height the
     * terminal has not been told about yet. When that happens, this reply
     * describes whatever was *last actually painted* — the old frame — but
     * is about to be paired with the *new* height, which would misplace the
     * origin by the difference and leave it wrong until an unrelated trigger
     * recalibrated.
     *
     * `entry.verify` is false for a query that cannot have raced (see
     * `PendingQuery`), and its reply is trusted outright. Otherwise: a reply
     * consistent with the paint having caught up satisfies `position.row -
     * originRef.current === entry.height` (the frame's top has not moved,
     * only its height did — the case this hook can retry safely). A reply
     * that fails this is not trustworthy either way — the paint may not have
     * landed, or the frame moved for a reason this hook does not model — so
     * it is dropped and a fresh, verified query goes out against the
     * *current* measured height instead of risking a wrong pairing. The very
     * first reply of all (`originRef.current === null`) has nothing to check
     * against and is always trusted: nothing can be mid-throttle before the
     * first paint has ever happened.
     */
    if (
      entry.verify &&
      originRef.current !== null &&
      position.row - originRef.current !== entry.height
    ) {
      if (pending.current.length < MAX_PENDING_QUERIES) {
        const node = rootRef.current
        if (node) {
          const height = measureElement(node).height
          lastHeight.current = height
          query(height, true)
        }
      }
      return
    }

    const next = frameTopFromCursor(position.row, entry.height)
    originRef.current = next
    setOrigin(next)
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
    // (see `MAX_PENDING_QUERIES`) — nothing ever shifts `pending` in that
    // world, so left ungated this would push one more entry per
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
    if (pending.current.length >= MAX_PENDING_QUERIES) return

    lastHeight.current = height
    lastRevision.current = revision
    lastColumns.current = stdout?.columns
    lastRows.current = stdout?.rows

    // Revision-triggered queries cannot race (see `PendingQuery`) and — via
    // `<Static>` — are the one legitimate way the origin moves, which is
    // exactly what the verification above cannot distinguish from the race.
    // So they skip it; height and resize queries do not.
    query(height, !revisionChanged)
  })

  return origin
}
