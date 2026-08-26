import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { act, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from '../../src/shell/mouse.js'

const mouseHandlers: Array<(e: MouseEvent) => void> = []
const reportHandlers: Array<(p: { row: number; col: number }) => void> = []

vi.mock('../../src/shell/useMouse.js', () => ({
  useMouse: (onEvent: (e: MouseEvent) => void) => {
    mouseHandlers.length = 0
    mouseHandlers.push(onEvent)
  },
  useCursorReport: (onReport: (p: { row: number; col: number }) => void) => {
    reportHandlers.length = 0
    reportHandlers.push(onReport)
  },
}))
vi.mock('../../src/shell/terminal-write.js', () => ({ writeToTerminal: () => {} }))

const { ClickTargetProvider, useClickTarget } = await import('../../src/shell/ClickTargets.js')
const { useMouseRouting } = await import('../../src/shell/useMouseRouting.js')

function press(row: number, col: number): MouseEvent {
  return { x: col, y: row, button: 1, action: 'press', shift: false, meta: false, ctrl: false }
}
function move(row: number, col: number): MouseEvent {
  return { x: col, y: row, button: null, action: 'move', shift: false, meta: false, ctrl: false }
}

function Harness({
  onA,
  onB,
  hoverA,
}: {
  onA: () => void
  onB: () => void
  hoverA: (h: boolean) => void
}) {
  const rootRef = useRef(null)
  const refA = useRef(null)
  const refB = useRef(null)
  useMouseRouting(rootRef, 0)
  useClickTarget({ id: 'a', ref: refA, onClick: onA, onHover: hoverA })
  useClickTarget({ id: 'b', ref: refB, onClick: onB })
  return (
    <Box flexDirection="column" ref={rootRef}>
      <Box ref={refA}>
        <Text>ROW-A</Text>
      </Box>
      <Box ref={refB}>
        <Text>ROW-B</Text>
      </Box>
    </Box>
  )
}

async function mount() {
  const onA = vi.fn()
  const onB = vi.fn()
  const hoverA = vi.fn()
  const app = render(
    <ClickTargetProvider>
      <Harness onA={onA} onB={onB} hoverA={hoverA} />
    </ClickTargetProvider>,
  )
  // A 2-line frame whose cursor rests at row 12 starts at row 10.
  // Ink only commits the resulting state update on its own render path, so a
  // synchronous call here would leave `useMouseRouting` reading a stale
  // (null) origin for the very next line — act() forces the commit first.
  await act(async () => {
    reportHandlers[0]?.({ row: 12, col: 0 })
  })
  return { app, onA, onB, hoverA }
}

describe('mouse routing', () => {
  it('routes a press to the target under it, offset by the frame origin', async () => {
    const h = await mount()
    mouseHandlers[0]?.(press(11, 1)) // absolute row 11 = frame row 1 = ROW-B
    expect(h.onB).toHaveBeenCalledOnce()
    expect(h.onA).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('ignores a press outside every target', async () => {
    const h = await mount()
    mouseHandlers[0]?.(press(40, 1))
    expect(h.onA).not.toHaveBeenCalled()
    expect(h.onB).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('ignores a release, so one click fires once', async () => {
    const h = await mount()
    mouseHandlers[0]?.(press(10, 1))
    mouseHandlers[0]?.({ ...press(10, 1), action: 'release', button: null })
    expect(h.onA).toHaveBeenCalledOnce()
    h.app.unmount()
  })

  it('reports hover enter and leave', async () => {
    const h = await mount()
    mouseHandlers[0]?.(move(10, 1))
    expect(h.hoverA).toHaveBeenLastCalledWith(true)
    mouseHandlers[0]?.(move(11, 1))
    expect(h.hoverA).toHaveBeenLastCalledWith(false)
    h.app.unmount()
  })

  it('does not re-fire hover while the pointer stays on one target', async () => {
    const h = await mount()
    mouseHandlers[0]?.(move(10, 1))
    mouseHandlers[0]?.(move(10, 2))
    mouseHandlers[0]?.(move(10, 3))
    expect(h.hoverA).toHaveBeenCalledTimes(1)
    h.app.unmount()
  })

  it('drops every event while the origin is uncalibrated', () => {
    const onA = vi.fn()
    const app = render(
      <ClickTargetProvider>
        <Harness onA={onA} onB={vi.fn()} hoverA={vi.fn()} />
      </ClickTargetProvider>,
    )
    // No cursor reply supplied: a click cannot be placed, so it must be
    // dropped rather than guessed at.
    mouseHandlers[0]?.(press(10, 1))
    expect(onA).not.toHaveBeenCalled()
    app.unmount()
  })
})
