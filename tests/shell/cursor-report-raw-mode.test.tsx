import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The cursor query's reply is typed back at the terminal. Until stdin is in
 * raw mode the tty echoes it — `^[[24;80R`, printed after a frame that fills
 * the window, which wraps and scrolls the screen a row. Ink's incremental
 * renderer never rewrites the rows that did not change, so every one of
 * them stayed on screen a row up as a second copy (2026-10-14).
 */
const events: string[] = []
vi.mock('../../src/shell/terminal-write.js', () => ({
  writeToTerminal: (s: string) => {
    if (s.includes('[6n')) events.push('query')
  },
}))

const { useFrameOrigin } = await import('../../src/shell/useFrameOrigin.js')

function Harness() {
  const rootRef = useRef(null)
  useFrameOrigin(rootRef, 0)
  return (
    <Box ref={rootRef}>
      <Text>frame</Text>
    </Box>
  )
}

describe('the cursor query', () => {
  it('is sent with stdin already in raw mode, so the reply is not echoed', () => {
    // ink-testing-library's Stdin is not exported; its prototype is reached
    // through an instance.
    const probe = render(<Text />)
    const proto = Object.getPrototypeOf(probe.stdin) as { setRawMode: (on: boolean) => void }
    probe.unmount()
    const spy = vi.spyOn(proto, 'setRawMode').mockImplementation((on: boolean) => {
      events.push(`raw ${on}`)
    })

    events.length = 0
    const app = render(<Harness />)
    expect(events.indexOf('query')).toBeGreaterThan(-1)
    expect(events.indexOf('raw true')).toBeGreaterThan(-1)
    expect(events.indexOf('raw true')).toBeLessThan(events.indexOf('query'))

    app.unmount()
    expect(events.at(-1)).toBe('raw false')
    spy.mockRestore()
  })
})
