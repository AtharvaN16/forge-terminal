import { render } from 'ink-testing-library'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import type { MouseEvent } from '../../src/shell/mouse.js'

/**
 * The assembly test the per-file tests could not be.
 *
 * Every piece of the mouse stack passed its own tests while the feature was
 * entirely dead in the real app: `useMouseRouting` was called in `App`'s body
 * while `ClickTargetProvider` was rendered as `App`'s *child*, so the router's
 * `useContext` found no provider and got the inert fallback registry — one that
 * hit-tests to nothing — while every clickable component below registered into
 * the real one. Two registries that never meet.
 *
 * Nothing that mounts a component in isolation can see that; only mounting the
 * genuine `App` can. So this file mounts `App` and asserts on what the mouse
 * stack actually asks the terminal for, which is observable and is exactly what
 * a real terminal showed was wrong.
 */

const mouseHookCalls: Array<{ isActive?: boolean; hover?: boolean }> = []
let deliver: ((event: MouseEvent) => void) | null = null

vi.mock('../../src/shell/useMouse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shell/useMouse.js')>()
  return {
    ...actual,
    useMouse: (onEvent: (event: MouseEvent) => void, options: { hover?: boolean } = {}) => {
      mouseHookCalls.push(options)
      deliver = onEvent
    },
    // A real terminal answers the origin query; nothing does under test, so the
    // reply is supplied by the test itself where it matters.
    useCursorReport: () => {},
  }
})

vi.mock('../../src/shell/terminal-write.js', () => ({ writeToTerminal: () => {} }))

const { App } = await import('../../src/shell/App.js')

const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('App mouse wiring', () => {
  it('routes through the same registry its children register into', async () => {
    mouseHookCalls.length = 0
    deliver = null

    let app: ReturnType<typeof render> | undefined
    await act(async () => {
      app = render(<App initialWidth={80} prefs={prefs} />)
    })
    // Let the registration effects and the notification they schedule settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    /**
     * The idle screen renders a `Prompt`, which registers a click target. If
     * the router shared that registry it sees a non-zero count and asks the
     * terminal for motion reporting. Reading `hover` is how a wrong-registry
     * wiring becomes visible from outside: with the inert fallback it is
     * pinned to `false` forever, which is precisely what a real terminal
     * showed (it never emitted the motion-reporting sequence).
     */
    expect(mouseHookCalls.length).toBeGreaterThan(0)
    expect(mouseHookCalls.some((call) => call.hover === true)).toBe(true)

    app?.unmount()
  })

  it('hands the router a live event channel', async () => {
    mouseHookCalls.length = 0
    deliver = null

    let app: ReturnType<typeof render> | undefined
    await act(async () => {
      app = render(<App initialWidth={80} prefs={prefs} />)
    })

    // Not an assertion about behaviour so much as about wiring: the router is
    // mounted and holding the callback the terminal's decoded events arrive on.
    expect(deliver).toBeTypeOf('function')

    app?.unmount()
  })
})
