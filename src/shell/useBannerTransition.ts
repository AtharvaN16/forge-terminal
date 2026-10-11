import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from 'react'
import type { HistoryBlock } from './blocks.js'
import { type BannerState, bannerTransition, historyForRedraw } from './redraw.js'

/**
 * The full logo belongs to an empty prompt: when work starts it is cleared
 * away, and when the prompt is empty again it is replayed on top of history
 * (spec 2026-10-11 §4). Fires on the `working` edge only.
 *
 * `clear` writes `CLEAR_SCREEN`; the caller decides how (Ink's own `write`,
 * so the frame is repainted after it) and whether (TTY only).
 */
export function useBannerTransition({
  working,
  history,
  setHistory,
  bannerState,
  makeBanner,
  width,
  clear,
  remountStatic,
}: {
  working: boolean
  history: HistoryBlock[]
  setHistory: Dispatch<SetStateAction<HistoryBlock[]>>
  bannerState: MutableRefObject<BannerState>
  makeBanner: () => HistoryBlock
  width: number
  clear: () => void
  remountStatic: () => void
}): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the working/idle edge only
  useEffect(() => {
    // Decided from the history this render saw, applied to the latest one:
    // another effect in the same commit may have pushed a block since, and a
    // plain `setHistory(next.history)` would throw it away.
    const before = bannerState.current
    const next = bannerTransition(history, working, before, makeBanner)
    if (!next) return
    bannerState.current = next.state
    clear()
    setHistory((h) =>
      historyForRedraw(bannerTransition(h, working, before, makeBanner)?.history ?? h, width),
    )
    remountStatic()
  }, [working])
}
