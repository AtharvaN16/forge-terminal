import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { act, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

const reportHandlers: Array<(p: { row: number; col: number }) => void> = []

// `useCursorReport` needs a real terminal to answer; the test supplies the
// reply itself, which is what makes the arithmetic assertable.
vi.mock('../../src/shell/useMouse.js', () => ({
  useCursorReport: (onReport: (p: { row: number; col: number }) => void) => {
    reportHandlers.length = 0
    reportHandlers.push(onReport)
  },
  useMouse: () => {},
}))

const writes: string[] = []
vi.mock('../../src/shell/terminal-write.js', () => ({
  writeToTerminal: (s: string) => {
    writes.push(s)
  },
}))

const { useFrameOrigin } = await import('../../src/shell/useFrameOrigin.js')

function Harness({ revision, lines }: { revision: number; lines: number }) {
  const rootRef = useRef(null)
  const origin = useFrameOrigin(rootRef, revision)
  return (
    <Box flexDirection="column" ref={rootRef}>
      {Array.from({ length: lines }, (_, i) => (
        // Fixed-length filler that pads the harness to a known frame height;
        // it never reorders or resizes within a single render, so the index
        // is a stable key here.
        // biome-ignore lint/suspicious/noArrayIndexKey: see comment above
        <Text key={`line-${i}`}>{`line ${i}`}</Text>
      ))}
      <Text>{`origin=${origin ?? 'null'}`}</Text>
    </Box>
  )
}

describe('useFrameOrigin', () => {
  it('issues a cursor query on mount', () => {
    writes.length = 0
    const app = render(<Harness revision={0} lines={2} />)
    expect(writes.some((w) => w.includes('[6n'))).toBe(true)
    app.unmount()
  })

  it('derives the frame top from the reply and the frame height', async () => {
    const app = render(<Harness revision={0} lines={2} />)
    // 2 lines + the origin line = a 3-line frame. Ink rests the cursor one
    // line past it, so a reply of row 10 means the frame starts at row 7.
    await act(async () => {
      reportHandlers[0]?.({ row: 10, col: 0 })
    })
    expect(app.lastFrame()).toContain('origin=7')
    app.unmount()
  })

  it('recalibrates when the revision changes', () => {
    const app = render(<Harness revision={0} lines={2} />)
    reportHandlers[0]?.({ row: 10, col: 0 })
    writes.length = 0
    app.rerender(<Harness revision={1} lines={2} />)
    expect(writes.some((w) => w.includes('[6n'))).toBe(true)
    app.unmount()
  })

  it('recalibrates when the frame height changes', () => {
    const app = render(<Harness revision={0} lines={2} />)
    reportHandlers[0]?.({ row: 10, col: 0 })
    writes.length = 0
    app.rerender(<Harness revision={0} lines={5} />)
    expect(writes.some((w) => w.includes('[6n'))).toBe(true)
    app.unmount()
  })

  it('does not re-query on a render that changed neither', () => {
    const app = render(<Harness revision={0} lines={2} />)
    reportHandlers[0]?.({ row: 10, col: 0 })
    writes.length = 0
    app.rerender(<Harness revision={0} lines={2} />)
    expect(writes.filter((w) => w.includes('[6n'))).toHaveLength(0)
    app.unmount()
  })

  it('keeps the previous origin until a new reply lands', async () => {
    const app = render(<Harness revision={0} lines={2} />)
    await act(async () => {
      reportHandlers[0]?.({ row: 10, col: 0 })
    })
    app.rerender(<Harness revision={1} lines={2} />)
    // Query issued, reply not yet in: the cached value must still be readable
    // rather than reverting to null, or every in-flight click would miss.
    expect(app.lastFrame()).toContain('origin=7')
    await act(async () => {
      reportHandlers[0]?.({ row: 14, col: 0 })
    })
    expect(app.lastFrame()).toContain('origin=11')
    app.unmount()
  })

  it('pairs each in-flight query with its own reply, in the order sent', async () => {
    const app = render(<Harness revision={0} lines={2} />)
    // Mount already queued a query for the 3-line frame (2 lines + the origin
    // line). Grow the frame before that reply arrives, so a second query is
    // in flight at the same time — the two-recalibrations-before-any-reply
    // case a scalar `pendingHeight` cannot survive.
    app.rerender(<Harness revision={0} lines={5} />)
    // Replies arrive in the order the queries were sent: the mount query's
    // reply (paired with height 3) before the growth query's reply (paired
    // with height 6, the new 5-line + origin-line frame). Row 13 is what a
    // real terminal would answer for the second query — the frame grew in
    // place, so its top (7) did not move — which also satisfies
    // `useFrameOrigin`'s own cross-check that a height/resize-triggered
    // reply is consistent with the last confirmed origin.
    await act(async () => {
      reportHandlers[0]?.({ row: 10, col: 0 })
    })
    expect(app.lastFrame()).toContain('origin=7')
    await act(async () => {
      reportHandlers[0]?.({ row: 13, col: 0 })
    })
    // Still 7 — via height 6 (frameTopFromCursor(13, 6) = 7), not the mount
    // query's height 3 (frameTopFromCursor(13, 3) = 10, which would show up
    // as a wrong origin here) — proving the second reply was paired with the
    // second query's own height, not a mispairing.
    expect(app.lastFrame()).toContain('origin=7')
    app.unmount()
  })

  it('recalibrates when the terminal resizes', () => {
    const app = render(<Harness revision={0} lines={2} />)
    writes.length = 0
    // The fake terminal's `columns` is a hardcoded getter on the class
    // prototype; shadow it with an own property on this instance so the test
    // can drive it, the same way a real resize changes what `useStdout`
    // reports.
    Object.defineProperty(app.stdout, 'columns', { get: () => 40, configurable: true })
    app.rerender(<Harness revision={0} lines={2} />)
    expect(writes.some((w) => w.includes('[6n'))).toBe(true)
    app.unmount()
  })

  it('stops issuing queries once too many replies are outstanding, instead of growing forever', () => {
    const app = render(<Harness revision={0} lines={2} />)
    writes.length = 0
    // A terminal that never replies to DSR at all — the case that would
    // otherwise leak one pending entry per recalibration for the life of the
    // process. Drive far more height changes than any reasonable bound, and
    // never deliver a single reply.
    for (let n = 3; n <= 20; n++) {
      app.rerender(<Harness revision={0} lines={n} />)
    }
    const queriesWhileUnanswered = writes.filter((w) => w.includes('[6n')).length
    // Bounded, not one-per-trigger: 18 height changes above, far fewer queries.
    expect(queriesWhileUnanswered).toBeGreaterThan(0)
    expect(queriesWhileUnanswered).toBeLessThan(10)

    // Once the cap is hit, a further unanswered trigger issues nothing more —
    // this is "gave up on this terminal", not "still catching up".
    writes.length = 0
    app.rerender(<Harness revision={0} lines={21} />)
    expect(writes.filter((w) => w.includes('[6n'))).toHaveLength(0)
    app.unmount()
  })

  /**
   * Reproduces the effect of, rather than the cause of, the throttle race:
   * Ink renders with `debug: true` under ink-testing-library (see
   * node_modules/ink-testing-library/build/index.js), which is what
   * `unthrottled` in node_modules/ink/build/ink.js checks for — so every
   * paint here is synchronous and the real race (a query overtaking Ink's own
   * *throttled* repaint) cannot be provoked from this harness. What can be
   * tested honestly is the self-correction itself: fed a reply that looks
   * like it describes the pre-repaint frame — consistent with the old
   * height, not the one this query was sent for — `useFrameOrigin` must
   * refuse to commit the origin that pairing implies, and must retry rather
   * than leave the wrong value standing.
   */
  it('does not commit a height/resize reply that is inconsistent with the last confirmed origin, and retries', async () => {
    const app = render(<Harness revision={0} lines={2} />)
    await act(async () => {
      reportHandlers[0]?.({ row: 10, col: 0 }) // 3-line frame -> origin 7
    })
    expect(app.lastFrame()).toContain('origin=7')

    writes.length = 0
    app.rerender(<Harness revision={0} lines={5} />) // height 3 -> 6, no revision bump
    expect(writes.filter((w) => w.includes('[6n'))).toHaveLength(1)

    // Row 10 is what the *previous* (height-3) query would have received.
    // Paired with the new query's height of 6 it implies origin 4 — wrong,
    // since the frame's top never moved. `position.row - originRef(7) !== 6`,
    // so this must be rejected rather than committed.
    writes.length = 0
    await act(async () => {
      reportHandlers[0]?.({ row: 10, col: 0 })
    })
    expect(app.lastFrame()).toContain('origin=7')
    expect(app.lastFrame()).not.toContain('origin=4')
    // Rejecting it must not leave the hook silently stuck: a fresh, verified
    // query goes out against the current (height 6) measurement.
    expect(writes.filter((w) => w.includes('[6n'))).toHaveLength(1)

    // The retry's reply is consistent with the frame having genuinely just
    // grown in place (row 13 - origin 7 = height 6), and is accepted.
    await act(async () => {
      reportHandlers[0]?.({ row: 13, col: 0 })
    })
    expect(app.lastFrame()).toContain('origin=7')
    app.unmount()
  })
})
