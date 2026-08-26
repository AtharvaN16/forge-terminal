import type { DOMElement } from 'ink'
import { type RefObject, useCallback, useRef, useSyncExternalStore } from 'react'
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
export function useMouseRouting(rootRef: RefObject<DOMElement | null>, revision: number): void {
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

  /**
   * Read through `useSyncExternalStore` rather than by calling `registry.size()`
   * during render: targets register in effects, so a render-time read sees an
   * empty registry on mount and would leave motion reporting off until
   * something unrelated re-rendered.
   */
  const targetCount = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  )

  useMouse(onEvent, { hover: targetCount > 0 })
}
