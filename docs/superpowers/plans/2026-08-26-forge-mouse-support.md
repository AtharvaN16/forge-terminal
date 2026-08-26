# Forge Mouse Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Select rows, the result links, and the prompt's caret clickable
(and hoverable) in every terminal that reports SGR mouse events, without
leaving Forge's inline rendering model.

**Architecture:** Ink hides the terminal cursor during render and leaves it at
column 0, one line below the last frame line. A DSR query (`ESC[6n`) is
therefore invisible and reports the frame's position directly:
`frameTop = cursorRow - frameHeight`. Frame-relative positions of individual
components come from walking Yoga's computed top/left up the parent chain.
A React Context registry collects clickable regions; `useMouse` matches
incoming events against it.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`), React 19, Ink 7.1.1,
Vitest 4, `ink-testing-library`, Biome.

**Spec:** [docs/superpowers/specs/2026-08-26-forge-mouse-and-cmd-keys-design.md](../specs/2026-08-26-forge-mouse-and-cmd-keys-design.md)

## Global Constraints

- `core/` and `engines/` import no React/Ink/Chalk and never write to stdout
  (invariant 1). Everything in this plan lives in `src/shell/` — no exceptions.
- Writes to the terminal that are *not* the frame (mode-setting sequences, DSR)
  go to the stream Ink renders to, gated on `isTTY`, never to a piped stream.
- Mouse is strictly additive: every action reachable by mouse must remain
  reachable by keyboard. No feature may depend on terminal capability.
- Mouse reporting must be switched off on every exit path — the existing
  `MOUSE_OFF` logic in `useMouse.ts` already covers SIGINT/SIGTERM/SIGHUP/exit
  and must not be weakened.
- `nothing in this app may call Ink's useInput directly` — keyboard goes through
  `useKeys` (`src/shell/useKeys.ts`). This plan adds no `useInput` calls.
- Existing tests are the regression net. `npm test` must stay green at every
  commit. Run `npm run lint` and `npm run typecheck` before each commit.

## Verified Facts (measured on this repo, Ink 7.1.1 — do not re-derive)

These were probed during planning. Trust them; a task that contradicts one is wrong.

1. **The cursor is hidden during render.** `log-update.js` calls
   `cliCursor.hide(stream)` on first render. A DSR query is therefore invisible
   — there is no cursor flash, and no need to move the cursor to calibrate.
2. **After render the cursor is at column 0, one line past the last frame line.**
   `cursor-helpers.js`: *"Assumes cursor is at (col 0, line visibleLineCount) —
   i.e. just after the last output line."* So `frameTop = cursorRow - frameHeight`.
3. **`<Static>` is excluded from the root Box's Yoga layout.** Probed: with two
   static lines printed, the root Box reported `height: 3` for three live lines,
   and the live child reported `top: 0`. So the root's Yoga height *is* the live
   frame height, and frame-relative coordinates are unaffected by scrollback.
4. **Frame-relative position is obtainable** by summing `getComputedTop()` /
   `getComputedLeft()` up the `parentNode` chain from a Box's ref. Probed
   against a rendered frame: predicted (3,2) and (4,2) for two rows, matching
   the render exactly.
5. **Yoga returns the *border-box* origin.** A Box with `paddingLeft={3}` reports
   its own left edge, not its text's. Padding must be added when hit-testing text.
6. **DSR replies are already filtered out of typed input.** `Prompt.tsx`'s text
   branch guards on `/^\[(?:[<>?][\d;]*|[\d;]+)[A-Za-z~]$/`, which matches
   `[24;1R`. No new filtering is needed.

---

### Task 1: Frame geometry — pure functions

Pure, dependency-free geometry: where a component sits in the frame, and
whether a point is inside a region. No React, no terminal I/O, so it is fully
unit-testable.

**Files:**
- Create: `src/shell/frame-geometry.ts`
- Test: `tests/shell/frame-geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Rect { row: number; col: number; width: number; height: number }`
  - `interface Point { row: number; col: number }`
  - `positionInFrame(node: MeasurableNode | null): Rect | null`
  - `containsPoint(rect: Rect, point: Point): boolean`
  - `frameTopFromCursor(cursorRow: number, frameHeight: number): number`
  - `type MeasurableNode = { yogaNode?: YogaLike; parentNode?: MeasurableNode | null }`
  - `interface YogaLike { getComputedTop(): number; getComputedLeft(): number; getComputedWidth(): number; getComputedHeight(): number }`

- [ ] **Step 1: Write the failing test**

Create `tests/shell/frame-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  containsPoint,
  frameTopFromCursor,
  type MeasurableNode,
  positionInFrame,
} from '../../src/shell/frame-geometry.js'

/** Builds a fake Ink node chain: `node(top, left, w, h, parent)`. */
function node(
  top: number,
  left: number,
  width: number,
  height: number,
  parentNode: MeasurableNode | null = null,
): MeasurableNode {
  return {
    parentNode,
    yogaNode: {
      getComputedTop: () => top,
      getComputedLeft: () => left,
      getComputedWidth: () => width,
      getComputedHeight: () => height,
    },
  }
}

describe('positionInFrame', () => {
  it('sums top/left up the parent chain', () => {
    // Mirrors the probed layout: a row at top 1 inside a container at top 2,
    // itself inside the root — the render put it at frame row 3, col 2.
    const root = node(0, 0, 80, 7)
    const container = node(3, 2, 76, 3, root)
    const row = node(1, 0, 76, 1, container)
    expect(positionInFrame(row)).toEqual({ row: 4, col: 2, width: 76, height: 1 })
  })

  it('returns the node itself when it has no parent', () => {
    expect(positionInFrame(node(0, 0, 80, 7))).toEqual({
      row: 0,
      col: 0,
      width: 80,
      height: 7,
    })
  })

  it('returns null for a node that has not been laid out', () => {
    expect(positionInFrame(null)).toBeNull()
    expect(positionInFrame({ parentNode: null })).toBeNull()
  })

  it('stops walking at the first ancestor without a yoga node', () => {
    // Ink's root container has no yogaNode; the walk must not throw on it.
    const detachedParent: MeasurableNode = { parentNode: null }
    const child = node(2, 1, 10, 1, detachedParent)
    expect(positionInFrame(child)).toEqual({ row: 2, col: 1, width: 10, height: 1 })
  })
})

describe('containsPoint', () => {
  const rect = { row: 4, col: 2, width: 6, height: 2 }

  it('accepts points inside, including both edges', () => {
    expect(containsPoint(rect, { row: 4, col: 2 })).toBe(true)
    expect(containsPoint(rect, { row: 5, col: 7 })).toBe(true)
  })

  it('rejects points outside on every side', () => {
    expect(containsPoint(rect, { row: 3, col: 4 })).toBe(false)
    expect(containsPoint(rect, { row: 6, col: 4 })).toBe(false)
    expect(containsPoint(rect, { row: 4, col: 1 })).toBe(false)
    expect(containsPoint(rect, { row: 4, col: 8 })).toBe(false)
  })

  it('rejects every point in a zero-height region', () => {
    expect(containsPoint({ row: 4, col: 2, width: 6, height: 0 }, { row: 4, col: 2 })).toBe(
      false,
    )
  })
})

describe('frameTopFromCursor', () => {
  it('places the frame above the resting cursor', () => {
    // Ink leaves the cursor one line past the frame, so a 3-line frame whose
    // cursor reports row 10 starts at row 7.
    expect(frameTopFromCursor(10, 3)).toBe(7)
  })

  it('handles a frame flush against the top of the screen', () => {
    expect(frameTopFromCursor(3, 3)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/frame-geometry.test.ts`
Expected: FAIL — `Cannot find module '../../src/shell/frame-geometry.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/shell/frame-geometry.ts`:

```ts
/**
 * Where things are, in the coordinate space of Ink's rendered frame.
 *
 * Pure arithmetic — no React, no terminal I/O — so every rule here is
 * unit-testable without a terminal. The hooks that supply the inputs live in
 * `useFrameOrigin.ts` and `ClickTargets.tsx`.
 */

export interface YogaLike {
  getComputedTop(): number
  getComputedLeft(): number
  getComputedWidth(): number
  getComputedHeight(): number
}

/**
 * The shape of an Ink DOM node this module needs. Structural rather than
 * Ink's own `DOMElement` so the tests can build one without a renderer.
 */
export interface MeasurableNode {
  yogaNode?: YogaLike
  parentNode?: MeasurableNode | null
}

export interface Rect {
  row: number
  col: number
  width: number
  height: number
}

export interface Point {
  row: number
  col: number
}

/**
 * A node's position within the frame, in cells from the frame's top-left.
 *
 * `measureElement` gives width and height but not position, so the offset is
 * accumulated up the parent chain — which is how Yoga stores it: each node's
 * computed top/left is relative to its own parent.
 *
 * Returns the *border-box* origin. A Box with padding reports its own edge,
 * not its content's, so a caller hit-testing text must add the padding itself.
 */
export function positionInFrame(node: MeasurableNode | null | undefined): Rect | null {
  if (!node?.yogaNode) return null
  let row = 0
  let col = 0
  let current: MeasurableNode | null | undefined = node
  // Ink's root container has no yogaNode, which is what terminates the walk.
  while (current?.yogaNode) {
    row += current.yogaNode.getComputedTop()
    col += current.yogaNode.getComputedLeft()
    current = current.parentNode
  }
  return {
    row,
    col,
    width: node.yogaNode.getComputedWidth(),
    height: node.yogaNode.getComputedHeight(),
  }
}

/** Inclusive of both edges — a click on a region's last column is still on it. */
export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.row >= rect.row &&
    point.row < rect.row + rect.height &&
    point.col >= rect.col &&
    point.col < rect.col + rect.width
  )
}

/**
 * The frame's absolute top row, given where the terminal says its cursor is.
 *
 * Ink hides the cursor and leaves it at column 0 one line *past* the frame
 * (`cursor-helpers.ts`: "Assumes cursor is at (col 0, line visibleLineCount)"),
 * so the frame's first line is `frameHeight` rows above it. Measured against
 * Ink 7.1.1; a version that parks the cursor elsewhere breaks this and the
 * calibration test in `use-frame-origin.test.tsx` is what will say so.
 */
export function frameTopFromCursor(cursorRow: number, frameHeight: number): number {
  return cursorRow - frameHeight
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/frame-geometry.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/shell/frame-geometry.test.ts
git add src/shell/frame-geometry.ts tests/shell/frame-geometry.test.ts
git commit -m "feat(shell): add frame geometry helpers for mouse hit-testing"
```

---

### Task 2: Hover-capable mouse reporting mode

One constant, plus the test that pins its bytes. Separate from Task 1 because
it lives in the existing `mouse.ts` and has its own existing test file.

**Files:**
- Modify: `src/shell/mouse.ts:24` (add a constant beneath `MOUSE_ON`)
- Test: `tests/shell/mouse.test.ts` (existing file — append)

**Interfaces:**
- Consumes: nothing.
- Produces: `MOUSE_ON_WITH_HOVER: string`

- [ ] **Step 1: Write the failing test**

Append to `tests/shell/mouse.test.ts`:

```ts
describe('MOUSE_ON_WITH_HOVER', () => {
  it('asks for any-motion reporting instead of button-motion', async () => {
    const { MOUSE_ON_WITH_HOVER } = await import('../../src/shell/mouse.js')
    // ?1003 (any motion) in place of ?1002 (motion only while held): hover
    // feedback needs events when no button is down.
    expect(MOUSE_ON_WITH_HOVER).toBe('\x1b[?1000h\x1b[?1003h\x1b[?1006h')
    expect(MOUSE_ON_WITH_HOVER).not.toContain('?1002h')
  })

  it('is cleared by the existing MOUSE_OFF', async () => {
    const { MOUSE_OFF } = await import('../../src/shell/mouse.js')
    // ?1003 and ?1002 are the same tracking slot, so ?1002l clears either.
    expect(MOUSE_OFF).toContain('?1002l')
    expect(MOUSE_OFF).toContain('?1000l')
    expect(MOUSE_OFF).toContain('?1006l')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/mouse.test.ts`
Expected: FAIL — `MOUSE_ON_WITH_HOVER` is undefined

- [ ] **Step 3: Write minimal implementation**

In `src/shell/mouse.ts`, directly after the `MOUSE_ON` export:

```ts
/**
 * `MOUSE_ON`, but with `?1003` (report *every* motion) in place of `?1002`
 * (report motion only while a button is held).
 *
 * Used only while something hoverable is on screen. `?1003` wakes the process
 * on every cell of pointer travel, which is why it is not the default: with an
 * empty target registry `useMouse` asks for `MOUSE_ON` instead and the terminal
 * stays quiet. Cleared by the same `MOUSE_OFF` — `?1002l` releases this
 * tracking slot whichever of the two set it.
 */
export const MOUSE_ON_WITH_HOVER = '\x1b[?1000h\x1b[?1003h\x1b[?1006h'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/mouse.test.ts`
Expected: PASS (all existing tests plus 2 new)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/shell/mouse.test.ts
git add src/shell/mouse.ts tests/shell/mouse.test.ts
git commit -m "feat(shell): add a hover-capable mouse reporting mode"
```

---

### Task 3: The click-target registry

A React Context holding every currently-mounted clickable region. Context
rather than module state because targets are registered from components across
the tree and `ink-testing-library` mounts independent app instances per test —
a module singleton would leak targets between them.

**Files:**
- Create: `src/shell/ClickTargets.tsx`
- Test: `tests/shell/click-targets.test.tsx`

**Interfaces:**
- Consumes: `Rect`, `Point`, `containsPoint`, `positionInFrame` from Task 1.
- Produces:
  - `interface ClickTarget { id: string; rect: Rect; onClick: (point: Point) => void; onHover?: (hovering: boolean) => void }`
  - `interface ClickTargetRegistry { register(target: ClickTarget): () => void; hitTest(point: Point): ClickTarget | null; size(): number }`
  - `<ClickTargetProvider>{children}</ClickTargetProvider>`
  - `useClickTargetRegistry(): ClickTargetRegistry`
  - `useClickTarget(spec: { id: string; ref: RefObject<DOMElement | null>; onClick: (point: Point) => void; onHover?: (hovering: boolean) => void; isActive?: boolean; inset?: { row?: number; col?: number; width?: number; height?: number } }): void`

**`onClick` receives the click's position within the target**, in cells from
the target's own top-left. Most consumers ignore it; `Prompt` (Task 9) needs it
to know which character was clicked. Passing it from the start avoids widening
the signature later.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/click-targets.test.tsx`:

```tsx
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { useRef } from 'react'
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
  const app = render(
    <ClickTargetProvider>
      <Harness
        onRegistry={(r) => {
          registry = r
        }}
        onClickA={onClickA}
        onClickB={onClickB}
        activeB={props.activeB}
      />
    </ClickTargetProvider>,
  )
  return { app, get registry() { return registry }, onClickA, onClickB }
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/click-targets.test.tsx`
Expected: FAIL — `Cannot find module '../../src/shell/ClickTargets.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/shell/ClickTargets.tsx`:

```tsx
import type { DOMElement } from 'ink'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { containsPoint, type Point, type Rect, positionInFrame } from './frame-geometry.js'

export interface ClickTarget {
  id: string
  /** Frame-relative, from `positionInFrame`. */
  rect: Rect
  /**
   * Receives where the click landed *within this target*, in cells from its
   * own top-left. Most consumers ignore it; the prompt uses it to find which
   * character was clicked, and target-relative means it never has to know
   * where it was placed.
   */
  onClick: (point: Point) => void
  /** Called with `true` when the pointer enters and `false` when it leaves. */
  onHover?: (hovering: boolean) => void
}

export interface ClickTargetRegistry {
  register(target: ClickTarget): () => void
  hitTest(point: Point): ClickTarget | null
  size(): number
}

/**
 * A Context rather than module-level state, for two reasons that both bite:
 * targets are registered from components scattered across the tree (rows,
 * links, the prompt), and `ink-testing-library` mounts independent app
 * instances within one process — a module singleton would leak one test's
 * targets into the next.
 */
const RegistryContext = createContext<ClickTargetRegistry | null>(null)

export function ClickTargetProvider({ children }: { children: ReactNode }) {
  const registry = useMemo<ClickTargetRegistry>(() => {
    const targets = new Map<string, ClickTarget>()
    return {
      register(target) {
        targets.set(target.id, target)
        return () => {
          // Guarded so a stale cleanup cannot evict a live target that
          // re-registered under the same id after a re-render.
          if (targets.get(target.id) === target) targets.delete(target.id)
        }
      },
      hitTest(point) {
        /**
         * Last registered wins. Registration order follows mount order, so a
         * target mounted inside another (a row within a list) is checked after
         * its container and takes the hit — the same "innermost wins" rule the
         * DOM applies.
         */
        let match: ClickTarget | null = null
        for (const target of targets.values()) {
          if (containsPoint(target.rect, point)) match = target
        }
        return match
      },
      size: () => targets.size,
    }
  }, [])

  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
}

/**
 * The registry, or an inert one when no provider is mounted.
 *
 * Inert rather than throwing: a component that registers a click target must
 * still render in a test that does not care about the mouse, and every existing
 * component test mounts without the provider.
 */
export function useClickTargetRegistry(): ClickTargetRegistry {
  const context = useContext(RegistryContext)
  const fallback = useMemo<ClickTargetRegistry>(
    () => ({ register: () => () => {}, hitTest: () => null, size: () => 0 }),
    [],
  )
  return context ?? fallback
}

/**
 * Registers the region a Box occupies as clickable for as long as it is
 * mounted and active.
 *
 * Re-registers on every render rather than only on mount, because the region
 * moves whenever layout changes — a row shifts when a line above it appears —
 * and a stale rect would route clicks to whatever used to be there. Registering
 * is a Map write, so this is cheap enough to do unconditionally.
 */
export function useClickTarget(spec: {
  id: string
  ref: RefObject<DOMElement | null>
  onClick: (point: Point) => void
  onHover?: (hovering: boolean) => void
  isActive?: boolean
  /**
   * Shrinks the registered region relative to the Box's border box — the
   * padding between a Box's edge and its text, which Yoga does not include.
   */
  inset?: { row?: number; col?: number; width?: number; height?: number }
}): void {
  const { id, ref, onClick, onHover, isActive = true, inset } = spec

  /**
   * Handlers are mirrored into refs so the effect below does not have to
   * re-run when the caller passes fresh closures, which it does every render.
   */
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover

  const registry = useClickTargetRegistry()

  // No dependency array: layout can change on any render, so the rect is
  // recomputed and re-registered on every one.
  useEffect(() => {
    if (!isActive) return
    const rect = positionInFrame(ref.current as unknown as Parameters<typeof positionInFrame>[0])
    if (!rect) return
    const inseted: Rect = {
      row: rect.row + (inset?.row ?? 0),
      col: rect.col + (inset?.col ?? 0),
      width: rect.width - (inset?.width ?? 0) - (inset?.col ?? 0),
      height: rect.height - (inset?.height ?? 0) - (inset?.row ?? 0),
    }
    return registry.register({
      id,
      rect: inseted,
      onClick: (point) => clickRef.current(point),
      onHover: hoverRef.current ? (hovering) => hoverRef.current?.(hovering) : undefined,
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/click-targets.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/shell/click-targets.test.tsx
git add src/shell/ClickTargets.tsx tests/shell/click-targets.test.tsx
git commit -m "feat(shell): add a click-target registry"
```

---

### Task 4: Frame origin calibration

Turns the terminal's DSR reply into the frame's absolute top row, cached and
recalibrated only when the frame can have moved.

**Files:**
- Create: `src/shell/useFrameOrigin.ts`
- Test: `tests/shell/use-frame-origin.test.tsx`

**Interfaces:**
- Consumes: `frameTopFromCursor` (Task 1); existing `CURSOR_QUERY` and
  `useCursorReport` from `src/shell/mouse.ts` / `src/shell/useMouse.ts`.
- Produces: `useFrameOrigin(rootRef: RefObject<DOMElement | null>, revision: number): number | null`
  — the frame's absolute top row, or `null` before the first reply lands.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/use-frame-origin.test.tsx`:

```tsx
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { useRef } from 'react'
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
        <Text key={i}>{`line ${i}`}</Text>
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

  it('derives the frame top from the reply and the frame height', () => {
    const app = render(<Harness revision={0} lines={2} />)
    // 2 lines + the origin line = a 3-line frame. Ink rests the cursor one
    // line past it, so a reply of row 10 means the frame starts at row 7.
    reportHandlers[0]?.({ row: 10, col: 0 })
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

  it('keeps the previous origin until a new reply lands', () => {
    const app = render(<Harness revision={0} lines={2} />)
    reportHandlers[0]?.({ row: 10, col: 0 })
    app.rerender(<Harness revision={1} lines={2} />)
    // Query issued, reply not yet in: the cached value must still be readable
    // rather than reverting to null, or every in-flight click would miss.
    expect(app.lastFrame()).toContain('origin=7')
    reportHandlers[0]?.({ row: 14, col: 0 })
    expect(app.lastFrame()).toContain('origin=11')
    app.unmount()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/use-frame-origin.test.tsx`
Expected: FAIL — cannot resolve `useFrameOrigin.js` / `terminal-write.js`

- [ ] **Step 3: Write minimal implementation**

First create `src/shell/terminal-write.ts` — a one-function seam so tests can
observe what is sent to the terminal without a TTY:

```ts
/**
 * Writes a control sequence to the terminal.
 *
 * A named seam rather than `process.stdout.write` at the call site, so tests
 * can observe the sequence without a TTY and so the `isTTY` gate is stated
 * once. Control sequences are not the frame: a piped or redirected run must
 * never receive them (the frame is the product's output, and nothing that is
 * not the frame belongs in it).
 */
export function writeToTerminal(sequence: string, stream?: NodeJS.WriteStream): void {
  const out = stream ?? process.stdout
  if (!out.isTTY) return
  out.write(sequence)
}
```

Then create `src/shell/useFrameOrigin.ts`:

```ts
import { type DOMElement, measureElement, useStdout } from 'ink'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { frameTopFromCursor } from './frame-geometry.js'
import { CURSOR_QUERY } from './mouse.js'
import { writeToTerminal } from './terminal-write.js'
import { useCursorReport } from './useMouse.js'

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
   * The height the frame had when the in-flight query was sent. The reply
   * carries no identity, so it must be paired with the height that was current
   * when it was asked for — pairing it with the height at *arrival* would be
   * wrong for any render that happened in between.
   */
  const pendingHeight = useRef<number | null>(null)
  const lastHeight = useRef<number | null>(null)
  const lastRevision = useRef<number | null>(null)
  const lastColumns = useRef<number | undefined>(stdout?.columns)
  const lastRows = useRef<number | undefined>(stdout?.rows)

  useCursorReport((position) => {
    const height = pendingHeight.current
    if (height === null) return
    pendingHeight.current = null
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

    lastHeight.current = height
    lastRevision.current = revision
    lastColumns.current = stdout?.columns
    lastRows.current = stdout?.rows

    pendingHeight.current = height
    writeToTerminal(CURSOR_QUERY, stdout as NodeJS.WriteStream | undefined)
  })

  return origin
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/use-frame-origin.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/shell/use-frame-origin.test.tsx
git add src/shell/useFrameOrigin.ts src/shell/terminal-write.ts tests/shell/use-frame-origin.test.tsx
git commit -m "feat(shell): calibrate the frame's origin from a cursor report"
```

---

### Task 5: Route mouse events to targets

Joins Tasks 1–4: converts an absolute mouse report into a frame-relative point,
matches it against the registry, and fires click or hover.

**Files:**
- Create: `src/shell/useMouseRouting.ts`
- Test: `tests/shell/mouse-routing.test.tsx`

**Interfaces:**
- Consumes: `ClickTargetRegistry` (Task 3), `useFrameOrigin` (Task 4),
  `MOUSE_ON_WITH_HOVER` (Task 2), existing `useMouse` and `MouseEvent`.
- Produces: `useMouseRouting(rootRef: RefObject<DOMElement | null>, revision: number): void`

- [ ] **Step 1: Write the failing test**

Create `tests/shell/mouse-routing.test.tsx`:

```tsx
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { useRef } from 'react'
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

function Harness({ onA, onB, hoverA }: { onA: () => void; onB: () => void; hoverA: (h: boolean) => void }) {
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

function mount() {
  const onA = vi.fn()
  const onB = vi.fn()
  const hoverA = vi.fn()
  const app = render(
    <ClickTargetProvider>
      <Harness onA={onA} onB={onB} hoverA={hoverA} />
    </ClickTargetProvider>,
  )
  // A 2-line frame whose cursor rests at row 12 starts at row 10.
  reportHandlers[0]?.({ row: 12, col: 0 })
  return { app, onA, onB, hoverA }
}

describe('mouse routing', () => {
  it('routes a press to the target under it, offset by the frame origin', () => {
    const h = mount()
    mouseHandlers[0]?.(press(11, 1)) // absolute row 11 = frame row 1 = ROW-B
    expect(h.onB).toHaveBeenCalledOnce()
    expect(h.onA).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('ignores a press outside every target', () => {
    const h = mount()
    mouseHandlers[0]?.(press(40, 1))
    expect(h.onA).not.toHaveBeenCalled()
    expect(h.onB).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('ignores a release, so one click fires once', () => {
    const h = mount()
    mouseHandlers[0]?.(press(10, 1))
    mouseHandlers[0]?.({ ...press(10, 1), action: 'release', button: null })
    expect(h.onA).toHaveBeenCalledOnce()
    h.app.unmount()
  })

  it('reports hover enter and leave', () => {
    const h = mount()
    mouseHandlers[0]?.(move(10, 1))
    expect(h.hoverA).toHaveBeenLastCalledWith(true)
    mouseHandlers[0]?.(move(11, 1))
    expect(h.hoverA).toHaveBeenLastCalledWith(false)
    h.app.unmount()
  })

  it('does not re-fire hover while the pointer stays on one target', () => {
    const h = mount()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/mouse-routing.test.tsx`
Expected: FAIL — `Cannot find module '../../src/shell/useMouseRouting.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/shell/useMouseRouting.ts`:

```ts
import type { DOMElement } from 'ink'
import { type RefObject, useCallback, useRef } from 'react'
import { useClickTargetRegistry } from './ClickTargets.js'
import type { MouseEvent } from './mouse.js'
import { useFrameOrigin } from './useFrameOrigin.js'
import { useMouse } from './useMouse.js'

/**
 * Turns terminal mouse reports into calls on whatever is rendered under the
 * pointer.
 *
 * Mounted once, at the shell root. The registry it reads is filled by
 * `useClickTarget` from wherever the clickable things are.
 */
export function useMouseRouting(
  rootRef: RefObject<DOMElement | null>,
  revision: number,
): void {
  const registry = useClickTargetRegistry()
  const origin = useFrameOrigin(rootRef, revision)

  /** The target the pointer was over on the previous motion event. */
  const hovered = useRef<string | null>(null)
  const hoveredLeave = useRef<((hovering: boolean) => void) | null>(null)

  const originRef = useRef(origin)
  originRef.current = origin

  const onEvent = useCallback(
    (event: MouseEvent) => {
      const top = originRef.current
      // Uncalibrated: a coordinate cannot be placed, and guessing would route
      // a click to whatever happens to be at that row. Drop it instead.
      if (top === null) return

      const point = { row: event.y - top, col: event.x }
      const target = registry.hitTest(point)

      if (event.action === 'move' || event.action === 'drag') {
        const id = target?.id ?? null
        // Only a *change* of target redraws. Motion reporting delivers an event
        // per cell of travel, and re-rendering on each would flicker for no
        // visible difference.
        if (id === hovered.current) return
        hoveredLeave.current?.(false)
        hovered.current = id
        hoveredLeave.current = target?.onHover ?? null
        target?.onHover?.(true)
        return
      }

      /**
       * Press only. A click delivers press *and* release at the same cell, so
       * acting on both would fire every action twice — the same double-delivery
       * hazard `useKeys` exists to solve for the kitty keyboard protocol.
       * Wheel events are decoded but unbound: the inline layout has no
       * scrollable region of its own, scrollback belongs to the terminal.
       */
      if (event.action !== 'press') return
      if (event.button !== 1) return
      if (!target) return
      // Target-relative, so a consumer never has to know where it was placed.
      target.onClick({
        row: point.row - target.rect.row,
        col: point.col - target.rect.col,
      })
    },
    [registry],
  )

  useMouse(onEvent)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/mouse-routing.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/shell/mouse-routing.test.tsx
git add src/shell/useMouseRouting.ts tests/shell/mouse-routing.test.tsx
git commit -m "feat(shell): route mouse events to registered targets"
```

---

### Task 6: Switch reporting mode on demand

`useMouse` currently always writes `MOUSE_ON`. It must ask for motion reporting
only while something hoverable is mounted.

**Files:**
- Modify: `src/shell/useMouse.ts:23-63` (signature and the `MOUSE_ON` write)
- Modify: `src/shell/useMouseRouting.ts` (pass the flag)
- Test: `tests/shell/mouse-mode.test.tsx`

**Interfaces:**
- Consumes: `MOUSE_ON_WITH_HOVER` (Task 2).
- Produces: `useMouse(onEvent, options?: { isActive?: boolean; hover?: boolean })`
  — **note the signature change**: the old second positional `isActive` boolean
  becomes an options object. `useMouse` has no other callers today, so no
  migration is needed beyond Task 5's call site.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/mouse-mode.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/mouse-mode.test.tsx`
Expected: FAIL — `reportingSequence` is not exported

- [ ] **Step 3: Write minimal implementation**

In `src/shell/useMouse.ts`, add the import and the helper above `useMouse`:

```ts
import { MOUSE_OFF, MOUSE_ON, MOUSE_ON_WITH_HOVER, type MouseEvent, parseCursorReport, parseMouse } from './mouse.js'

/**
 * Which reporting mode to ask the terminal for.
 *
 * Motion reporting costs an event per cell of pointer travel, so it is asked
 * for only while something on screen can respond to a hover.
 */
export function reportingSequence(hover: boolean): string {
  return hover ? MOUSE_ON_WITH_HOVER : MOUSE_ON
}
```

Change the signature and the write:

```ts
export function useMouse(
  onEvent: (event: MouseEvent) => void,
  options: { isActive?: boolean; hover?: boolean } = {},
): void {
  const { isActive = true, hover = false } = options
```

and inside the effect, replace `out.write(MOUSE_ON)` with:

```ts
    out.write(reportingSequence(hover))
```

then add `hover` to the effect's dependency array so a change of mode is
re-applied:

```ts
  }, [isActive, hover, setRawMode, internal_eventEmitter, stdout])
```

In `src/shell/useMouseRouting.ts`, replace the `useMouse(onEvent)` call with:

```ts
  // Motion reporting only while something is actually hoverable.
  useMouse(onEvent, { hover: registry.size() > 0 })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/mouse-mode.test.tsx tests/shell/mouse-routing.test.tsx`
Expected: PASS

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/useMouse.ts src/shell/useMouseRouting.ts tests/shell/mouse-mode.test.tsx
git commit -m "feat(shell): ask for motion reporting only when something is hoverable"
```

---

### Task 7: Mount the provider and routing in App.tsx

**Files:**
- Modify: `src/shell/App.tsx:1547-1605` (root JSX, add a ref and the provider)
- Modify: `src/shell/launch.tsx` if the provider must wrap `<App>` — it must not;
  the provider goes *inside* `App`'s root Box so the ref and the registry share
  one tree.
- Test: `tests/shell/app-mouse.test.tsx`

**Interfaces:**
- Consumes: `ClickTargetProvider` (Task 3), `useMouseRouting` (Task 5).
- Produces: an `App` tree in which any descendant's `useClickTarget` resolves.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/app-mouse.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

const routingCalls: number[] = []
vi.mock('../../src/shell/useMouseRouting.js', () => ({
  useMouseRouting: (_ref: unknown, revision: number) => {
    routingCalls.push(revision)
  },
}))

const { App } = await import('../../src/shell/App.js')
const { ThemeProvider } = await import('../../src/shell/ThemeContext.js')
const { paletteFor } = await import('../../src/shell/theme.js')

describe('App mouse wiring', () => {
  it('mounts mouse routing', () => {
    routingCalls.length = 0
    const app = render(
      <ThemeProvider palette={paletteFor('dark')}>
        <App />
      </ThemeProvider>,
    )
    expect(routingCalls.length).toBeGreaterThan(0)
    app.unmount()
  })

  it('passes a revision that tracks committed history', () => {
    routingCalls.length = 0
    const app = render(
      <ThemeProvider palette={paletteFor('dark')}>
        <App />
      </ThemeProvider>,
    )
    // The revision is the count of committed <Static> blocks: it must be a
    // number, and it is what tells the origin to recalibrate after a scroll.
    expect(typeof routingCalls[0]).toBe('number')
    app.unmount()
  })
})
```

> **Note for the implementer:** `App`'s exact props are visible at its
> definition in `src/shell/App.tsx`. If it requires props in this repo's current
> state, pass whatever the existing `tests/shell/app-flow.test.tsx` passes —
> copy that harness rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/app-mouse.test.tsx`
Expected: FAIL — routing is never called

- [ ] **Step 3: Write minimal implementation**

In `src/shell/App.tsx`, add imports:

```ts
import { ClickTargetProvider } from './ClickTargets.js'
import { useMouseRouting } from './useMouseRouting.js'
```

Inside `App`, before the `return`, add the root ref. The existing `history`
state is the `<Static>` item list, so its length is exactly the "history
committed" signal the origin needs:

```ts
  /**
   * The Box the whole frame is measured from. `useFrameOrigin` needs its
   * height to place the frame, and `<Static>` is excluded from this Box's
   * layout (measured against Ink 7.1.1) — which is what makes the height the
   * *live* frame's height rather than the whole session's.
   */
  const rootRef = useRef<DOMElement | null>(null)

  /**
   * Bumping this recalibrates the frame's origin. Committed history scrolls
   * the live frame down the screen, and `history.length` changes exactly when
   * that happens.
   */
  useMouseRouting(rootRef, history.length)
```

Add `DOMElement` to the Ink type import and `useRef` to the React import if not
already present.

Wrap the root Box's children in the provider and attach the ref:

```tsx
  return (
    <ThemeProvider palette={paletteFor(theme)}>
      <ClickTargetProvider>
        <Box flexDirection="column" ref={rootRef}>
          {/* …existing children unchanged… */}
        </Box>
      </ClickTargetProvider>
    </ThemeProvider>
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/app-mouse.test.tsx && npm test`
Expected: PASS, and the full suite still green (the provider adds no output, so
no frame snapshot should change).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/App.tsx tests/shell/app-mouse.test.tsx
git commit -m "feat(shell): mount the click-target provider and mouse routing"
```

---

### Task 8: Clickable and hoverable Select rows

**Files:**
- Modify: `src/shell/components/Select.tsx`
- Test: `tests/shell/select-mouse.test.tsx`

**Interfaces:**
- Consumes: `useClickTarget` (Task 3), `ClickTargetProvider` (Task 3).
- Produces: no new exports — `Select`'s props are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/select-mouse.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { Select } from '../../src/shell/components/Select.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

const items = [
  { label: 'First', value: 'first' },
  { label: 'Second', value: 'second' },
  { label: 'Third', value: 'third', disabled: true },
]

function Harness({
  onSubmit,
  onRegistry,
}: {
  onSubmit: (v: string) => void
  onRegistry: (r: ReturnType<typeof useClickTargetRegistry>) => void
}) {
  const registry = useClickTargetRegistry()
  onRegistry(registry)
  return <Select items={items} onSubmit={onSubmit} width={40} />
}

function mount() {
  const onSubmit = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness onSubmit={onSubmit} onRegistry={(r) => { registry = r }} />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return { app, onSubmit, get registry() { return registry } }
}

describe('Select mouse support', () => {
  it('submits the row that was clicked — the same path Enter takes', () => {
    const h = mount()
    const target = h.registry.hitTest({ row: 1, col: 1 })
    expect(target).not.toBeNull()
    target?.onClick({ row: 0, col: 1 })
    expect(h.onSubmit).toHaveBeenCalledWith('second')
    h.app.unmount()
  })

  it('registers no target for a disabled row', () => {
    const h = mount()
    // Row 2 is the disabled 'Third'; arrow keys skip it, so a click must too.
    const target = h.registry.hitTest({ row: 2, col: 1 })
    expect(target).toBeNull()
    h.app.unmount()
  })

  it('moves the highlight on hover', () => {
    const h = mount()
    const second = h.registry.hitTest({ row: 1, col: 1 })
    second?.onHover?.(true)
    // The highlight arrow is what the keyboard moves; hover must move the
    // same one rather than introduce a second kind of selection.
    expect(h.app.lastFrame()).toMatch(/[>❯▶]\s*Second/)
    h.app.unmount()
  })

  it('submits the hovered row when it is clicked', () => {
    const h = mount()
    const second = h.registry.hitTest({ row: 1, col: 1 })
    second?.onHover?.(true)
    second?.onClick({ row: 0, col: 1 })
    expect(h.onSubmit).toHaveBeenCalledWith('second')
    h.app.unmount()
  })
})
```

> **Note for the implementer:** the highlight glyph in the assertion above is
> whatever `SYMBOLS` in `src/shell/theme.ts` uses for the cursor. Read it and
> match the real one rather than keeping the permissive character class.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/select-mouse.test.tsx`
Expected: FAIL — `hitTest` returns null; no targets are registered

- [ ] **Step 3: Write minimal implementation**

In `src/shell/components/Select.tsx`:

Add imports:

```ts
import { useClickTarget } from '../ClickTargets.js'
```

Add a pointer-driven highlight next to the existing `move`, so hover and arrows
share one notion of "highlighted":

```ts
  /**
   * Moves the highlight to an exact row, for the pointer.
   *
   * Separate from `move`, which is relative and skips disabled rows — a
   * pointer names the row directly, and a disabled row registers no target so
   * it can never be named.
   */
  const highlightRow = (next: number) => {
    if (next === indexRef.current) return
    indexRef.current = next
    setIndex(next)
    if (onHighlight) onHighlight(next)
  }
```

Each row must be its own Box with a ref so it can be measured. Extract the row
into a component — a hook cannot be called in a loop:

```tsx
/**
 * One row, plus the click region it occupies.
 *
 * A component rather than inline JSX because each row needs its own ref and
 * its own `useClickTarget`, and hooks cannot be called from inside a `map`.
 */
function SelectRow({
  index,
  isActive,
  onChoose,
  onPointer,
  children,
}: {
  index: number
  isActive: boolean
  onChoose: () => void
  onPointer: () => void
  children: ReactNode
}) {
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({
    id: `select-row-${index}`,
    ref,
    onClick: onChoose,
    onHover: (hovering) => {
      if (hovering) onPointer()
    },
    isActive,
  })
  return <Box ref={ref}>{children}</Box>
}
```

In `Select`'s render, wrap each rendered row in `SelectRow`, passing:

- `index={i}`
- `isActive={isActive && !item.disabled}` — a disabled row registers nothing,
  so clicks fall through exactly as arrow keys walk past it
- `onChoose={() => onSubmit(item.value)}` — **the same call Enter makes**, so a
  click and a keypress cannot diverge
- `onPointer={() => highlightRow(i)}`

Keep the existing row content unchanged inside it.

Add `ReactNode`, `useRef` to the React import and `DOMElement` to the Ink import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/select-mouse.test.tsx tests/shell/select.test.tsx tests/shell/select-band.test.tsx`
Expected: PASS — including the existing Select tests, whose frames must be
unchanged (a `<Box>` wrapper adds no output).

- [ ] **Step 5: Run the full suite, lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/components/Select.tsx tests/shell/select-mouse.test.tsx
git commit -m "feat(shell): make select rows clickable and hoverable"
```

---

### Task 9: Click-to-position the caret

Replaces the "deliberately absent" comment at `Prompt.tsx:471-493` with the
feature, now that the frame's origin is knowable without parking the real
cursor on the caret.

**Files:**
- Modify: `src/shell/components/Prompt.tsx:471-493` (replace the comment) and
  the render body (add a ref)
- Test: `tests/shell/prompt-mouse.test.tsx`

**Interfaces:**
- Consumes: `useClickTarget` (Task 3) — including the target-relative `point`
  its `onClick` already receives; existing `offsetForColumn`
  (`src/shell/mouse.ts:92`); existing `moveTo` in `Prompt`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/prompt-mouse.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

function mount(value: string, opts: { isActive?: boolean } = {}) {
  const onChange = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  function Harness() {
    registry = useClickTargetRegistry()
    return (
      <Prompt
        value={value}
        onChange={onChange}
        onSubmit={vi.fn()}
        placeholder="drop a file"
        isActive={opts.isActive ?? true}
        variant="plain"
        width={40}
      />
    )
  }
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return { app, onChange, get registry() { return registry } }
}

describe('Prompt click-to-position', () => {
  it('registers a target covering the text', () => {
    const h = mount('hello.png')
    expect(h.registry.size()).toBeGreaterThan(0)
    h.app.unmount()
  })

  it('moves the caret to the clicked character', () => {
    const h = mount('hello.png')
    // Column 5 is the '.', counting from the first character of the text.
    h.registry.hitTest({ row: 0, col: 5 })?.onClick({ row: 0, col: 5 })
    // Assert by effect, the way prompt-selection.test.tsx does: type, and see
    // where the character landed. Far more robust than matching the caret's
    // inverse-video run, which renders differently under NO_COLOR.
    h.app.stdin.write('X')
    expect(h.onChange).toHaveBeenLastCalledWith('helloX.png')
    h.app.unmount()
  })

  it('clamps a click past the end of the text to the end', () => {
    const h = mount('ab')
    h.registry.hitTest({ row: 0, col: 30 })?.onClick({ row: 0, col: 30 })
    h.app.stdin.write('X')
    // `offsetForColumn` returns the character count for any column past the
    // text, so the caret lands after 'b' — never beyond the buffer.
    expect(h.onChange).toHaveBeenLastCalledWith('abX')
    h.app.unmount()
  })

  it('leaves the caret alone when the prompt is inactive', () => {
    const h = mount('hello.png', { isActive: false })
    // An inactive prompt registers nothing, so a click cannot reach it — the
    // same rule its `useKeys({ isActive })` gate already applies to keys.
    expect(h.registry.hitTest({ row: 0, col: 5 })).toBeNull()
    h.app.unmount()
  })
})
```

> **Note for the implementer:** `Prompt` is fully controlled — it calls
> `onChange` but its own `value` prop does not change unless the parent
> re-renders it. Asserting on `onChange`'s argument is therefore the correct
> assertion; do not expect `lastFrame()` to show the typed character.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/prompt-mouse.test.tsx`
Expected: FAIL — no target is registered

- [ ] **Step 3: Write minimal implementation**

In `src/shell/components/Prompt.tsx`, add imports:

```ts
import type { DOMElement } from 'ink'
import { useClickTarget } from '../ClickTargets.js'
import { offsetForColumn } from '../mouse.js'
```

Add a ref for the line, and register it. Replace the whole
"Click-to-position-the-caret is deliberately absent" comment block
(`Prompt.tsx:471-493`) with:

```ts
  /**
   * Click-to-position the caret.
   *
   * This was once impossible for a stated reason: mapping a click needs the
   * frame's absolute position, which Ink never exposes, and the apparent way
   * around it — parking the *real* terminal cursor on the caret and asking the
   * terminal where its cursor is — showed a second cursor, because Ink cannot
   * place the cursor without making it visible.
   *
   * What changed is that the query never needed the caret. Ink hides the cursor
   * while rendering and leaves it one line below the frame, so asking where it
   * is locates the *frame* — invisibly, and without moving anything. The caret
   * is then plain arithmetic from there. See `useFrameOrigin.ts`.
   */
  const lineRef = useRef<DOMElement | null>(null)

  useClickTarget({
    id: 'prompt-line',
    ref: lineRef,
    isActive,
    /**
     * The prompt marker (`› `, or `  › ` in the plain variant) sits between the
     * Box's left edge and the first character, so the click column is measured
     * from the text's start, not the Box's.
     */
    inset: { col: variant === 'plain' ? 4 : 2 },
    /**
     * `point` is already target-relative and already inset past the prompt
     * marker, so it is a column into the text. `offsetForColumn` converts it
     * to a character index by display width, which is what makes a click land
     * correctly in a path containing a wide glyph or an emoji.
     */
    onClick: (point) => {
      moveTo(offsetForColumn(valueRef.current, point.col), false)
    },
  })
```

Attach the ref to the Box that wraps the line in **both** return branches (the
`!bg || variant === 'plain'` branch and the filled branch), on the inner `Box`
that holds the `<Text>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/prompt-mouse.test.tsx tests/shell/prompt-caret.test.tsx tests/shell/prompt-selection.test.tsx tests/shell/prompt-shortcuts.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/components/Prompt.tsx tests/shell/prompt-mouse.test.tsx
git commit -m "feat(shell): position the caret from a click"
```

---

### Task 10: Clickable result links in every terminal

Today the links render only where OSC 8 is supported (`App.tsx:1952`), so
Terminal.app shows nothing. With app-level hit-testing they can render — and
work — everywhere.

**Files:**
- Modify: `src/shell/App.tsx:1949-1958`
- Create: `src/shell/components/ResultLinks.tsx`
- Test: `tests/shell/result-links.test.tsx`

**Interfaces:**
- Consumes: `useClickTarget` (Task 3); existing `fileLink` /
  `hyperlinksSupported` (`src/shell/hyperlink.ts`); existing `openPath`,
  `revealPath`, `revealLabel` (`src/shell/reveal.ts`, already imported by
  `App.tsx:40`).
- Produces: `<ResultLinks outputPath={string} revealLabel={string} onOpen={() => void} onReveal={() => void} />`

**The `o` and `s` keys already call these**, at `App.tsx:662-663`:

```ts
if (input === 'o') openPath(lastResult.job.outputs[0]).catch(showError)
if (input === 's') revealPath(lastResult.job.outputs[0]).catch(showError)
```

Note the `.catch(showError)` — it is load-bearing and the comment above it says
why: `reveal.ts` promisifies `execFile`, so `open` exiting non-zero (the file
was moved or its volume unmounted, which is likely because result blocks stay
in scrollback for the whole session) rejects, and a `void`ed rejection
terminates the process. **The click handlers must keep the same `.catch`.**

- [ ] **Step 1: Write the failing test**

Create `tests/shell/result-links.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { ResultLinks } from '../../src/shell/components/ResultLinks.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

function mount() {
  const onOpen = vi.fn()
  const onReveal = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  function Harness() {
    registry = useClickTargetRegistry()
    return (
      <ResultLinks
        outputPath="/tmp/photo.webp"
        revealLabel="Reveal in Finder"
        onOpen={onOpen}
        onReveal={onReveal}
      />
    )
  }
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return { app, onOpen, onReveal, get registry() { return registry } }
}

describe('ResultLinks', () => {
  it('renders both labels regardless of OSC 8 support', () => {
    const h = mount()
    // Terminal.app supports no OSC 8; the labels must still be on screen,
    // because they are now real click targets rather than terminal hyperlinks.
    expect(h.app.lastFrame()).toContain('Open file')
    expect(h.app.lastFrame()).toContain('Reveal in Finder')
    h.app.unmount()
  })

  it('registers a target for each link', () => {
    const h = mount()
    expect(h.registry.size()).toBe(2)
    h.app.unmount()
  })

  it('opens the file when "Open file" is clicked', () => {
    const h = mount()
    const target = h.registry.hitTest({ row: 0, col: 1 })
    target?.onClick({ row: 0, col: 1 })
    expect(h.onOpen).toHaveBeenCalledOnce()
    expect(h.onReveal).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('reveals when the second link is clicked', () => {
    const h = mount()
    // 'Open file' is 9 cells, then a '  ·  ' separator: the reveal label
    // starts well past column 12.
    const target = h.registry.hitTest({ row: 0, col: 20 })
    target?.onClick({ row: 0, col: 20 })
    expect(h.onReveal).toHaveBeenCalledOnce()
    h.app.unmount()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/result-links.test.tsx`
Expected: FAIL — `Cannot find module '../../src/shell/components/ResultLinks.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/shell/components/ResultLinks.tsx`:

```tsx
import { Box, type DOMElement, Text } from 'ink'
import { useRef } from 'react'
import { useClickTarget } from '../ClickTargets.js'
import { fileLink, hyperlinksSupported } from '../hyperlink.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/**
 * One link: the label, and the region a click on it lands in.
 *
 * Still an OSC 8 hyperlink where the terminal supports one, so cmd+click keeps
 * working and the URL is still copyable — the click target is additive. Where
 * OSC 8 is absent (Terminal.app) the label renders as plain text and the click
 * target is the whole mechanism, which is why the label is no longer gated on
 * `hyperlinksSupported()`.
 */
function Link({
  id,
  label,
  path,
  onActivate,
}: {
  id: string
  label: string
  path: string
  onActivate: () => void
}) {
  const palette = useTheme()
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({ id, ref, onClick: onActivate })
  return (
    <Box ref={ref}>
      <Text color={colourProp(palette.accent)}>
        {hyperlinksSupported() ? fileLink(label, path) : label}
      </Text>
    </Box>
  )
}

export function ResultLinks({
  outputPath,
  revealLabel,
  onOpen,
  onReveal,
}: {
  outputPath: string
  revealLabel: string
  onOpen: () => void
  onReveal: () => void
}) {
  return (
    <Box>
      <Link id="result-open" label="Open file" path={outputPath} onActivate={onOpen} />
      <Text>{'  ·  '}</Text>
      <Link
        id="result-reveal"
        label={revealLabel}
        path={outputPath.replace(/\/[^/]+$/, '')}
        onActivate={onReveal}
      />
    </Box>
  )
}
```

In `src/shell/App.tsx`, replace the `hyperlinksSupported() ? (...) : null` block
at lines 1952-1958 with:

```tsx
            <ResultLinks
              outputPath={lastResult.job.outputs[0]}
              revealLabel={revealLabel()}
              onOpen={openLastResult}
              onReveal={revealLastResult}
            />
```

Define those two next to the `useKeys` handler, and **make the key handler call
them too**, so a click and a keypress run one function rather than two copies
that can drift:

```ts
  /**
   * Shared by the `o`/`s` keys and by clicking the result links. One function
   * per action, not two: the keyboard and the pointer must not be able to
   * diverge, and the `.catch` below is easy to omit from a second copy.
   */
  const openLastResult = () => {
    if (!lastResult) return
    openPath(lastResult.job.outputs[0]).catch(showError)
  }
  const revealLastResult = () => {
    if (!lastResult) return
    revealPath(lastResult.job.outputs[0]).catch(showError)
  }
```

then replace lines 662-663 with:

```ts
      if (input === 'o') openLastResult()
      if (input === 's') revealLastResult()
```

Add the `ResultLinks` import. Leave `fileLink` / `hyperlinksSupported` imported
only if something else in `App.tsx` still uses them — `ResultLinks` imports its
own.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shell/result-links.test.tsx tests/shell/hyperlink.test.ts && npm test`
Expected: PASS. **Existing frame-snapshot tests that assert the links are absent
without OSC 8 will now fail** — that is the intended behaviour change. Update
those assertions to expect the labels, and note the change in the commit body.

- [ ] **Step 5: Run the full suite, lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/components/ResultLinks.tsx src/shell/App.tsx tests/shell/result-links.test.tsx
git commit -m "feat(shell): make the result links clickable in every terminal"
```

---

### Task 11: Document the Option-key fallback

No behaviour change — `Prompt.tsx:319-362` already implements these. This makes
them discoverable, which is the whole of the keyboard half of the spec.

**Files:**
- Modify: `README.md` (add a shortcuts section)
- Modify: `docs/superpowers/specs/2026-08-19-forge-design.md:425-433` (correct
  the keybinding names in the "Clickable links" section — the shell binds `o`
  and `s`, not `f` and `o`, and the links are no longer gated on OSC 8)

- [ ] **Step 1: Verify the bindings before writing them down**

```bash
grep -n "key.meta\|key.ctrl\|key.super" src/shell/components/Prompt.tsx
```

Confirm each row of the table below against the code. **If any row does not
match, correct the table — the code is the truth.**

- [ ] **Step 2: Add the shortcuts section to README.md**

```markdown
## Keyboard shortcuts

In the text field:

| Action | Keys |
| --- | --- |
| Move a word | Option+Left / Option+Right (also Ctrl+Left / Ctrl+Right) |
| Start / end of line | Home / End, or Ctrl+A / Ctrl+E |
| Delete the word before the caret | Option+Backspace, or Ctrl+W |
| Delete the word after the caret | Option+fn+Delete |
| Delete to start / end of line | Ctrl+U / Ctrl+K |
| Cut / paste the selection | Ctrl+X / Ctrl+Y |
| Extend a selection | Shift+Left / Shift+Right |

**On Cmd shortcuts.** Cmd+Left, Cmd+Right, Cmd+Backspace and Cmd+A work in
terminals that speak the kitty keyboard protocol — iTerm2, Ghostty, WezTerm,
kitty, and the VS Code integrated terminal. Terminal.app cannot report Cmd at
all: its key-mapping UI does not offer Command as a modifier, so no Cmd chord
produces any bytes. The Option and Ctrl bindings above are the equivalents
there, and they work everywhere.
```

- [ ] **Step 3: Correct the design doc's "Clickable links" section**

Replace the paragraph at `docs/superpowers/specs/2026-08-19-forge-design.md:425-433`
with one that reflects Task 10: the labels always render; OSC 8 is used where
available so cmd+click and URL-copying still work; a click is hit-tested by the
app itself where it is not; and the `o` / `s` keys always work.

- [ ] **Step 4: Verify the docs match the code**

```bash
npm test && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-19-forge-design.md
git commit -m "docs: document the Option-key fallback and the clickable links"
```

---

### Task 12: Manual verification in both terminal families

Automated tests cannot prove the DSR arithmetic against a real terminal — no
test in this repo talks to one. This task is the evidence that it works.

**Files:** none — this is a verification pass.

- [ ] **Step 1: Build and run in Terminal.app**

```bash
npm run build && node dist/index.js
```

Confirm, and record the result of each:
- Clicking a Select row chooses it.
- Hovering a Select row moves the highlight.
- Clicking in the text field moves the caret to the clicked character.
- After a conversion, "Open file" and "Reveal in Finder" are visible and a
  single click on each works.
- Option+Left / Option+Backspace still behave as the README now claims.
- Quitting with `q` and with Ctrl+C both leave the terminal clean — no
  `[<35;…M` noise on mouse movement afterwards. **This is the regression that
  matters most**; if it fails, `MOUSE_OFF` is not reaching the terminal.

- [ ] **Step 2: Repeat in a kitty-protocol terminal**

Run the same list in iTerm2, Ghostty, or the VS Code integrated terminal, plus:
- Cmd+Left / Cmd+Right / Cmd+Backspace / Cmd+A behave as documented.

- [ ] **Step 3: Verify the frame origin survives scrollback**

Convert several files in one session so committed history scrolls the frame
down the screen, then click a Select row again. The click must still land on
the right row. **This is the test for the recalibration triggers** — if it
fails, `history.length` is not reaching `useMouseRouting` as `revision`.

- [ ] **Step 4: Verify a non-TTY run is unaffected**

```bash
node dist/index.js < /dev/null; echo "exit=$?"
node dist/index.js photo.jpg --to webp | cat
```

Neither may emit a mouse or DSR sequence into its output.

- [ ] **Step 5: Record the results**

Append a short "Verified" note to the spec listing which terminals were tested
and on what date, then commit.

```bash
git add docs/superpowers/specs/2026-08-26-forge-mouse-and-cmd-keys-design.md
git commit -m "docs(spec): record manual mouse verification results"
```

---

## Notes for the implementer

**Two things in the spec are now known, and the spec's own text is out of date
on both.** The spec left an "open implementation question" about whether
calibration would be visible. It is not: Ink hides the cursor during render
(`log-update.js`), so the DSR query is invisible and no cursor is ever moved.
The spec also proposed recalibrating on "`<Static>` commits, resize, mount";
frame-height changes were added during planning, because a frame that grows
tall enough to scroll the screen moves its own top. Task 4 implements the
corrected set. Update the spec's §4 as part of Task 12's documentation step.

**The Yoga walk is the load-bearing risk.** `positionInFrame` reads
`yogaNode` and `parentNode` off Ink's DOM nodes. These are not part of Ink's
documented API — `measureElement` is, and it exposes width and height only.
The walk is verified against Ink 7.1.1 in this repo. Task 1's tests pin the
arithmetic but use fake nodes, so they would not catch Ink changing the node
shape; Task 8's and Task 10's tests render real components and would. If an Ink
upgrade breaks hit-testing, that is where it will show.
