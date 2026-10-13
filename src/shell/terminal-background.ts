import { insideMultiplexer } from './multiplexer.js'
import { type Palette, paintsCanvas } from './theme.js'

/**
 * The terminal's own background, set to the painted canvas while forge runs.
 *
 * Painting (`paintsCanvas`) covers every cell, but not the terminal's padding
 * around the grid — Ghostty's default profile left a blue frame around dark's
 * #1e1e1e — nor a resize before the next frame lands. OSC 11 sets the
 * terminal's default background, which is what both of those show. OSC 111
 * resets it to the profile's own on the way out (a reset, not a restore of a
 * queried value: a query needs a reply on stdin, which Ink owns).
 *
 * A terminal that does not know OSC 11 ignores it, and painting still covers
 * the grid.
 */

const ESC = '\u001b'
const ST = `${ESC}\\`

/** OSC 111: the default background back to the profile's. */
export const BACKGROUND_RESET = `${ESC}]111${ST}`

/**
 * OSC 11 setting the default background to `p`'s canvas, or null where it
 * must not be sent: a palette that paints nothing (neutral), NO_COLOR, and
 * inside a multiplexer, where it would colour every pane.
 */
export function backgroundSequence(p: Palette, env: NodeJS.ProcessEnv): string | null {
  if (!paintsCanvas(p)) return null
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return null
  if (insideMultiplexer(env)) return null
  return `${ESC}]11;${p.canvas}${ST}`
}
