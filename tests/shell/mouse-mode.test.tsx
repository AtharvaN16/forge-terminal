import type { DOMElement } from 'ink'
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { act, type RefObject, useEffect, useRef } from 'react'
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

const { ClickTargetProvider, useClickTarget, useClickTargetRegistry } = await import(
  '../../src/shell/ClickTargets.js'
)
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

/**
 * Matches production, unlike `Harness` above: `useMouseRouting` (the
 * `useSyncExternalStore` subscriber) lives on the PARENT, exactly where
 * `App` puts it; `useClickTarget` (the registrant) lives on a CHILD, exactly
 * where `Prompt` puts it. React runs child effects before parent effects
 * within a commit, so `Target`'s registration effect fires before
 * `Parent`'s subscribing effect — a same-component harness runs both
 * hooks' effects in declaration order instead and cannot see that ordering
 * bug at all.
 */
function Target({ targetRef }: { targetRef: RefObject<DOMElement | null> }) {
  useClickTarget({ id: 'a', ref: targetRef, onClick: () => {} })
  return (
    <Box ref={targetRef}>
      <Text>TARGET</Text>
    </Box>
  )
}

function Parent() {
  const rootRef = useRef(null)
  const targetRef = useRef(null)
  useMouseRouting(rootRef, 0)
  return (
    <Box ref={rootRef}>
      <Target targetRef={targetRef} />
    </Box>
  )
}

describe('hover-driven reporting mode', () => {
  it('turns motion reporting on once targets have registered (same component)', async () => {
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

  it('turns motion reporting on once targets have registered (parent subscribes, child registers)', async () => {
    // Matches production's component boundary: `Harness` above calls both
    // hooks from one component, where effects run in hook declaration order
    // (subscribe, then register) and cannot see the ordering bug at all.
    // `Parent`/`Target` split them the way `App`/`Prompt` do.
    //
    // This test cannot actually FAIL against the pre-fix bug, and that's
    // worth recording rather than hiding: `useSyncExternalStore` runs its
    // own per-commit tearing check (independent of anything `ClickTargets.tsx`
    // does) that re-reads `getSnapshot()` from a passive effect and forces a
    // corrective re-render on any mismatch — completely masking a lost
    // `notify()` in a synchronous test render. Verified empirically: this
    // test passes unmodified against the pre-fix synchronous-notify code.
    // It's kept because it documents the production shape and still catches
    // a *different* class of regression (e.g. the subscription never being
    // installed at all). The test below isolates the actual ordering hazard
    // by subscribing directly, without `useSyncExternalStore` in the way.
    mouseHookCalls.length = 0
    let app: ReturnType<typeof render> | undefined
    await act(async () => {
      app = render(
        <ClickTargetProvider>
          <Parent />
        </ClickTargetProvider>,
      )
    })
    expect(mouseHookCalls.at(-1)?.hover).toBe(true)
    app?.unmount()
  })
})

describe('registry notification survives the parent/child effect-ordering hazard', () => {
  it('reaches a subscriber whose subscribing effect runs after the child that already registered', async () => {
    // The actual regression guard for the parent/child notify-ordering bug.
    //
    // The hover-mode test above reproduces the same component shape as
    // production but, per its comment, cannot fail against the bug:
    // `useSyncExternalStore` has its own independent safety net that papers
    // over a lost `notify()`. Subscribing directly to the registry — the
    // way `useSyncExternalStore` itself does internally, minus that safety
    // net — removes the confound and tests exactly one thing: does a
    // child's registration notification survive long enough for a parent
    // whose own subscribing effect runs *after* it, in commit order, to
    // receive it? React always runs a child's effects before its parent's,
    // so `Child` registers before `ParentSubscriber` subscribes on every
    // mount — exactly the ordering `App`/`Prompt` have in production.
    const notifiedSizes: number[] = []

    function Child({ targetRef }: { targetRef: RefObject<DOMElement | null> }) {
      useClickTarget({ id: 'a', ref: targetRef, onClick: () => {} })
      return (
        <Box ref={targetRef}>
          <Text>TARGET</Text>
        </Box>
      )
    }

    function ParentSubscriber() {
      const registry = useClickTargetRegistry()
      const targetRef = useRef(null)
      useEffect(
        () => registry.subscribe(() => notifiedSizes.push(registry.getSnapshot())),
        [registry],
      )
      return (
        <Box>
          <Child targetRef={targetRef} />
        </Box>
      )
    }

    await act(async () => {
      render(
        <ClickTargetProvider>
          <ParentSubscriber />
        </ClickTargetProvider>,
      )
    })
    // A snapshot of 1 proves the child's registration notification actually
    // reached the parent's listener, not just that the registry itself
    // ended up in the right state (`getSnapshot()` is always live and would
    // read 1 regardless of whether any notification ever fired).
    expect(notifiedSizes).toContain(1)
  })
})
