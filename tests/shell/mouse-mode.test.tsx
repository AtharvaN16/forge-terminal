import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { act, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MOUSE_ON, MOUSE_ON_WITH_HOVER } from '../../src/shell/mouse.js'
import { reportingSequence } from '../../src/shell/useMouse.js'

describe('reportingSequence', () => {
  it('asks for motion reporting when something is hoverable', () => {
    expect(reportingSequence(true)).toBe(MOUSE_ON_WITH_HOVER)
  })

  it('asks for the cheaper mode when nothing is', () => {
    expect(reportingSequence(false)).toBe(MOUSE_ON)
  })
})

/**
 * `useMouse` itself is mocked here so the options object `useMouseRouting`
 * passes it can be captured directly, rather than inferred from the escape
 * sequence written to a fake terminal. `reportingSequence` and the rest of
 * the module are kept real: this file also exercises `reportingSequence`
 * above, and `useFrameOrigin` (pulled in transitively via `useMouseRouting`)
 * calls the real `useCursorReport`.
 */
const mouseHookCalls: Array<{ isActive?: boolean; hover?: boolean }> = []
vi.mock('../../src/shell/useMouse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shell/useMouse.js')>()
  return {
    ...actual,
    useMouse: (_onEvent: unknown, options: { isActive?: boolean; hover?: boolean } = {}) => {
      mouseHookCalls.push(options)
    },
  }
})
vi.mock('../../src/shell/terminal-write.js', () => ({ writeToTerminal: () => {} }))

const { ClickTargetProvider, useClickTarget } = await import('../../src/shell/ClickTargets.js')
const { useMouseRouting } = await import('../../src/shell/useMouseRouting.js')

function Harness() {
  const rootRef = useRef(null)
  const targetRef = useRef(null)
  useMouseRouting(rootRef, 0)
  useClickTarget({ id: 'a', ref: targetRef, onClick: () => {} })
  return (
    <Box ref={rootRef}>
      <Box ref={targetRef}>
        <Text>TARGET</Text>
      </Box>
    </Box>
  )
}

describe('hover-driven reporting mode', () => {
  it('turns motion reporting on once targets have registered', async () => {
    // The regression guard: registration happens in an effect, so a
    // render-time read of the registry would report zero targets here.
    // Assert against the mode actually requested after mount.
    mouseHookCalls.length = 0
    let app: ReturnType<typeof render> | undefined
    // useClickTarget registers its target inside an effect, and that
    // registration's `notify()` drives a further re-render through
    // useSyncExternalStore — both happen only on Ink's own render path, so
    // the mount itself is wrapped in act() to flush them before asserting.
    await act(async () => {
      app = render(
        <ClickTargetProvider>
          <Harness />
        </ClickTargetProvider>,
      )
    })
    expect(mouseHookCalls.at(-1)?.hover).toBe(true)
    app?.unmount()
  })
})
