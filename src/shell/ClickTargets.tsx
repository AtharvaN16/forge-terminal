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
import { containsPoint, type Point, positionInFrame, type Rect } from './frame-geometry.js'

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
  /** Called whenever the set of registered targets changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /**
   * A value that changes whenever the set of targets changes, for
   * `useSyncExternalStore`. Returns the target count, which is both the
   * snapshot and what the only consumer actually wants to know.
   */
  getSnapshot(): number
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
    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of listeners) listener()
    }
    return {
      register(target) {
        // Adding a new id is a membership change; overwriting an existing
        // id's rect on a later render is not — only notify on the former,
        // or useSyncExternalStore would wake on every re-registration.
        const isNewId = !targets.has(target.id)
        targets.set(target.id, target)
        if (isNewId) notify()
        return () => {
          // Guarded so a stale cleanup cannot evict a live target that
          // re-registered under the same id after a re-render.
          if (targets.get(target.id) === target) {
            targets.delete(target.id)
            notify()
          }
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
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => targets.size,
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
    () => ({
      register: () => () => {},
      hitTest: () => null,
      size: () => 0,
      subscribe: () => () => {},
      getSnapshot: () => 0,
    }),
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
    // Ink's DOMElement is not structurally identical to MeasurableNode (its
    // yogaNode/parentNode types come from a different package), but the
    // fields positionInFrame reads line up at runtime — narrow cast at the
    // boundary rather than widening MeasurableNode to Ink's types.
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
