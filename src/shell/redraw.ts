import type { HistoryBlock } from './blocks.js'

/**
 * Erase the visible screen *and* the scrollback, then home the cursor.
 *
 * Why the shell needs this on a width change at all: a terminal reflows the
 * lines already on screen when it is resized — one 100-column line becomes two
 * rows at 50 — but Ink erases its previous frame by counting the lines it
 * wrote, not the rows they now occupy. Every resize therefore left a partial
 * copy of the old frame above the new one, and the copies accumulated (UX
 * audit #5). Ink's own narrowing clear has the same blind spot.
 *
 * There is no erase that can be aimed at "the rows the old frame reflowed
 * into", so the shell clears everything and redraws: history is replayed
 * through a fresh `<Static>` and the live frame is drawn under it, both at the
 * new width. The scrollback has to go too — the reflowed copies live there
 * once they scroll off, and replaying history above them would duplicate
 * every block. This is the same sequence Ink itself writes when a frame
 * overflows the viewport.
 */
export const CLEAR_SCREEN = '\u001b[2J\u001b[3J\u001b[H'

/**
 * History as it is replayed after `CLEAR_SCREEN`.
 *
 * Banners and separator rules carry the width they were drawn at; everything
 * else is laid out from the live width already. Redrawing a rule at its old
 * width would wrap it — the very artefact the redraw exists to remove.
 *
 * `intro` is the banner `playIntro` printed before Ink mounted. It was never
 * part of history, so the clear erases it with nothing to put it back; the
 * caller passes it on the first redraw only, after which it is history like
 * any other block.
 */
export function historyForRedraw(
  history: HistoryBlock[],
  width: number,
  intro?: HistoryBlock,
): HistoryBlock[] {
  const blocks = intro ? [intro, ...history] : history
  return blocks.map((block) =>
    block.kind === 'banner' || block.kind === 'separator' ? { ...block, width } : block,
  )
}

/**
 * Whether the logo is on screen. `enabled` is false for a session that
 * never drew one — only tests today — which keeps `bannerTransition` from
 * inventing a logo there.
 */
export interface BannerState {
  enabled: boolean
  onScreen: boolean
}

/**
 * The history that puts the logo where it belongs, or `null` if it is
 * already there.
 *
 * The full logo belongs to an empty prompt; once there is work on screen the
 * header bar takes over (spec 2026-10-11 §4). Scrollback cannot be edited,
 * so either direction is a clear-and-replay — the same move a width change
 * makes. A non-null result means: write `CLEAR_SCREEN`, then replay this.
 */
export function bannerTransition(
  history: HistoryBlock[],
  working: boolean,
  state: BannerState,
  makeBanner: () => HistoryBlock,
): { history: HistoryBlock[]; state: BannerState } | null {
  if (!state.enabled) return null
  const rest = history.filter((b) => b.kind !== 'banner')
  if (working && state.onScreen) return { history: rest, state: { ...state, onScreen: false } }
  if (!working && !state.onScreen) {
    return { history: [makeBanner(), ...rest], state: { ...state, onScreen: true } }
  }
  return null
}
