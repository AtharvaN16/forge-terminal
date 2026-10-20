import type { Row } from './home-art.js'
import { keyIsDown } from './pressed-key.js'
import type { Palette } from './theme.js'

/**
 * A key hint inside a text field (decided 2026-10-16, clipboard round 3):
 * the key on a chip filled with a colour, then what it does in that same
 * colour, at the field's far end. The mode's colour on home; neutral grey in
 * colour mode, where the swatches already compete for attention.
 *
 * Without a fill — no colour, or NO_COLOR — the chip cannot be drawn, so the
 * key is bracketed instead, as the key row's keycaps are.
 */
export function fieldKey({
  palette,
  key,
  words,
  colour,
  ink = palette.ink,
  plain = false,
}: {
  palette: Palette
  key: string
  words: string
  colour: string
  /** The key's own colour, on the chip. The mode chip's ink by default. */
  ink?: string
  plain?: boolean
}): Row {
  if (plain || colour === '')
    return [{ text: `[${key}] ${words}`, fg: keyIsDown(key) ? palette.fg : palette.border }]
  // Pressed, the chip goes white for a moment.
  const down = keyIsDown(key)
  return [
    { text: ` ${key} `, fg: ink, bg: down ? palette.fg : colour, bold: true },
    { text: ` ${words}`, fg: colour },
  ]
}
