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
})
