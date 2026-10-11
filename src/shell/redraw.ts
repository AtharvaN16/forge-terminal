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
 * Separator rules carry the width they were drawn at; everything else is laid
 * out from the live width already. Redrawing a rule at its old width would
 * wrap it — the very artefact the redraw exists to remove.
 */
export function historyForRedraw(history: HistoryBlock[], width: number): HistoryBlock[] {
  return history.map((block) => (block.kind === 'separator' ? { ...block, width } : block))
}
