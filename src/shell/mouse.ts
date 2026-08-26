import stringWidth from 'string-width'

/**
 * Terminal mouse reporting: the escape sequences that switch it on, and the
 * decoder for the reports that come back.
 *
 * Pure data in, pure data out — nothing here touches React or stdout, for the
 * same reason `core/` does not (invariant 1). The hook that owns the terminal
 * side lives in `useMouse.ts`.
 *
 * Protocol reference: xterm ctlseqs, "Mouse Tracking".
 */

/**
 * SGR encoding (`?1006`) rather than the original X10 scheme, which packs
 * each coordinate into a single byte at `value + 32` and therefore cannot
 * express a column past 223. A wide terminal is not an edge case, and the
 * failure is silent — the coordinate simply wraps.
 *
 * `?1002` (report motion only while a button is held) rather than `?1003`
 * (report every motion): a text field has nothing to do with a bare hover,
 * and `?1003` wakes the process on every pixel of pointer travel.
 */
export const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'

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

/**
 * Disabled in the reverse order, and — critically — this must run on every
 * exit path. Ink installs no SIGINT/SIGTSTP handling of its own, so a process
 * killed while reporting is on leaves the *terminal* in that state: the shell
 * the user returns to spews `[<35;…M` on every mouse move. That is the bug
 * behind the "stuck in mouse reporting" reports filed against other CLIs.
 */
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'

/**
 * Device Status Report — asks the terminal where the cursor currently is.
 * The reply comes back on the *input* stream as `ESC [ row ; col R`.
 *
 * This is what makes a click mappable at all. Ink never exposes the absolute
 * terminal position of its frame (the reason its maintainers rejected built-in
 * mouse support), and in inline mode the frame moves every time `<Static>`
 * history scrolls the screen. But `useCursor` parks the *real* terminal cursor
 * on the caret, so asking the terminal where the cursor is answers where the
 * caret is, in absolute coordinates, no matter what has scrolled.
 */
export const CURSOR_QUERY = '\x1b[6n'

/**
 * Decodes a DSR reply. Like a mouse report, this arrives with its leading ESC
 * already stripped by Ink, so the ESC is optional.
 */
export function parseCursorReport(input: string): { row: number; col: number } | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the sequence's own first byte
  const m = /^(?:\x1b)?\[(\d+);(\d+)R$/.exec(input)
  if (!m) return null
  // One-based on the wire, zero-based everywhere downstream — the same
  // convention the mouse decoder above applies.
  return { row: Number(m[1]) - 1, col: Number(m[2]) - 1 }
}

export interface MouseEvent {
  /** Zero-based column, converted from the protocol's one-based report. */
  x: number
  /** Zero-based row. */
  y: number
  /** 1 = left, 2 = middle, 3 = right, 4/5 = wheel up/down, null on release. */
  button: number | null
  action: 'press' | 'release' | 'drag' | 'move' | 'wheel'
  shift: boolean
  meta: boolean
  ctrl: boolean
}

/**
 * `ESC [ < Pb ; Px ; Py (M|m)` — but Ink strips the leading ESC from any
 * sequence its keypress parser could not resolve, and a mouse report is
 * exactly that. So the ESC is optional here: this accepts both the raw
 * sequence and the stripped form Ink actually delivers.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the sequence's own first byte
const SGR = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([Mm])$/

/**
 * Maps a click's column to an index into `text`, by walking display widths
 * rather than code points — `日本語` is three characters and six columns, and
 * a caret placed by column arithmetic alone lands in the wrong place the
 * moment a path contains one wide glyph or an emoji.
 *
 * A click past the midpoint of a wide glyph lands after it, which is what
 * every graphical text field does.
 */
export function offsetForColumn(text: string, column: number): number {
  const chars = Array.from(text)
  let col = 0
  for (let i = 0; i < chars.length; i++) {
    const w = stringWidth(chars[i] ?? '')
    if (column < col + w / 2) return i
    col += w
  }
  return chars.length
}

/**
 * Decodes one SGR mouse report, or returns null for anything else — including
 * ordinary typed text, which is the common case and must stay cheap.
 */
export function parseMouse(input: string): MouseEvent | null {
  const m = SGR.exec(input)
  if (!m) return null

  const code = Number(m[1])
  const col = Number(m[2])
  const row = Number(m[3])
  const released = m[4] === 'm'

  /**
   * Bit 32 marks motion, bit 64 the wheel, bit 128 the extra buttons; the low
   * two bits carry which button, except that `3` means "none" (a release in
   * the days before the `m` terminator disambiguated it).
   */
  const low = code & 3
  const motion = (code & 32) !== 0

  let button: number | null
  if (code & 64) button = 4 + low
  else if (code & 128) button = 8 + low
  else button = low === 3 ? null : low + 1

  /**
   * The wheel reports no release — a scroll is a single event terminated by
   * `M` — so it is checked before the release flag, which would otherwise
   * never be reached for it anyway but reads as an accident.
   */
  const action: MouseEvent['action'] =
    code & 64
      ? 'wheel'
      : released
        ? 'release'
        : motion
          ? button === null
            ? 'move'
            : 'drag'
          : 'press'

  return {
    // The protocol numbers the top-left cell 1,1; every layout calculation
    // downstream is zero-based, so the conversion happens once, here.
    x: col - 1,
    y: row - 1,
    button,
    action,
    shift: (code & 4) !== 0,
    meta: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  }
}
