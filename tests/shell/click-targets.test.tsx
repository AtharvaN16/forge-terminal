import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { act, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ClickTargetProvider,
  useClickTarget,
  useClickTargetRegistry,
} from '../../src/shell/ClickTargets.js'

/** Renders two stacked rows and exposes the registry to the test. */
function Harness({
  onRegistry,
  onClickA,
  onClickB,
  activeB = true,
}: {
  onRegistry: (r: ReturnType<typeof useClickTargetRegistry>) => void
  onClickA: () => void
  onClickB: () => void
  activeB?: boolean
}) {
  const registry = useClickTargetRegistry()
  onRegistry(registry)
  const refA = useRef(null)
  const refB = useRef(null)
  useClickTarget({ id: 'a', ref: refA, onClick: onClickA })
  useClickTarget({ id: 'b', ref: refB, onClick: onClickB, isActive: activeB })
  return (
    <Box flexDirection="column">
      <Box ref={refA}>
        <Text>ROW-A</Text>
      </Box>
      <Box ref={refB}>
        <Text>ROW-B</Text>
      </Box>
    </Box>
  )
}

function mount(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  let registry!: ReturnType<typeof useClickTargetRegistry>
  const onClickA = props.onClickA ?? vi.fn()
  const onClickB = props.onClickB ?? vi.fn()
  const activeB = props.activeB
  const onRegistry = (r: ReturnType<typeof useClickTargetRegistry>) => {
    registry = r
  }
  // Kept as a builder, not a one-shot element, so `rerenderUnchanged` below
  // can hand the exact same tree shape back to `app.rerender` — the same
  // ClickTargetProvider position means React updates the existing instance
  // (and its memoized registry) instead of remounting it.
  const buildTree = () => (
    <ClickTargetProvider>
      <Harness onRegistry={onRegistry} onClickA={onClickA} onClickB={onClickB} activeB={activeB} />
    </ClickTargetProvider>
  )
  const app = render(buildTree())
  return {
    app,
    get registry() {
      return registry
    },
    onClickA,
    onClickB,
    /**
     * Re-renders with identical ids, refs, and handlers — the "an unrelated
     * ancestor re-rendered" case, not a mount or unmount. Every mounted
     * `useClickTarget`'s effect has no dependency array, so this still runs
     * each target's cleanup followed immediately by re-registration; the
     * registry must treat that as a no-op, not two membership changes.
     */
    rerenderUnchanged() {
      app.rerender(buildTree())
    },
  }
}

describe('click target registry', () => {
  it('hit-tests a point to the row rendered there', () => {
    const h = mount()
    // ROW-A occupies frame row 0, ROW-B row 1 — the layout the harness renders.
    expect(h.registry.hitTest({ row: 0, col: 1 })?.id).toBe('a')
    expect(h.registry.hitTest({ row: 1, col: 1 })?.id).toBe('b')
    h.app.unmount()
  })

  it('returns null for a point on no target', () => {
    const h = mount()
    expect(h.registry.hitTest({ row: 9, col: 0 })).toBeNull()
    h.app.unmount()
  })

  it('invokes the matched target’s onClick and no other', () => {
    const onClickA = vi.fn()
    const onClickB = vi.fn()
    const h = mount({ onClickA, onClickB })
    h.registry.hitTest({ row: 1, col: 2 })?.onClick({ row: 0, col: 2 })
    expect(onClickB).toHaveBeenCalledOnce()
    expect(onClickA).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('hands onClick the position within the target, not the frame', () => {
    const onClickB = vi.fn()
    const h = mount({ onClickB })
    // ROW-B sits at frame row 1; a click there is row 0 of that target.
    h.registry.hitTest({ row: 1, col: 3 })?.onClick({ row: 0, col: 3 })
    expect(onClickB).toHaveBeenCalledWith({ row: 0, col: 3 })
    h.app.unmount()
  })

  it('omits an inactive target', () => {
    const h = mount({ activeB: false })
    expect(h.registry.hitTest({ row: 1, col: 1 })).toBeNull()
    expect(h.registry.size()).toBe(1)
    h.app.unmount()
  })

  it('drops every target when the tree unmounts', () => {
    const h = mount()
    expect(h.registry.size()).toBe(2)
    const registry = h.registry
    h.app.unmount()
    expect(registry.size()).toBe(0)
  })

  it('does not share targets between two mounted apps', () => {
    const first = mount()
    const second = mount()
    expect(first.registry.size()).toBe(2)
    expect(second.registry.size()).toBe(2)
    first.app.unmount()
    second.app.unmount()
  })

  it('notifies subscribers when a target is added or removed', async () => {
    const h = mount()
    const listener = vi.fn()
    const unsubscribe = h.registry.subscribe(listener)
    expect(h.registry.getSnapshot()).toBe(2)
    h.app.unmount()
    // A removal's notification is deferred by one microtask (see
    // ClickTargets.tsx) so a same-commit re-registration of the same id can
    // cancel it — give it one turn to run before checking.
    await Promise.resolve()
    // Unmount removes both targets, and each removal is a genuine membership
    // change with nothing re-registering to cancel it.
    expect(listener).toHaveBeenCalled()
    expect(h.registry.getSnapshot()).toBe(0)
    unsubscribe()
  })

  it('does not notify subscribers when a mounted target re-registers unchanged', async () => {
    const h = mount()
    const listener = vi.fn()
    const unsubscribe = h.registry.subscribe(listener)
    // useClickTarget's effect has no dependency array, so this re-render
    // still runs cleanup-then-register for both 'a' and 'b' — same ids, same
    // rects. React always runs the previous cleanup before the new effect in
    // one commit; a naive notify-on-every-mutation implementation fires on
    // the delete and again on the re-add, waking a useSyncExternalStore
    // subscriber for a target that never actually left.
    await act(async () => {
      h.rerenderUnchanged()
    })
    // The re-registration cancels the pending removal synchronously, but
    // give any (wrongly) scheduled notification a microtask turn anyway —
    // this must observe zero calls, not just zero calls so far.
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(h.registry.getSnapshot()).toBe(2)
    h.app.unmount()
    unsubscribe()
  })
})
