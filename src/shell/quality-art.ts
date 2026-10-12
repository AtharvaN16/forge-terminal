import stringWidth from 'string-width'
import { blank, type Row } from './home-art.js'
import { modeColours, type Palette, type ShellMode } from './theme.js'

/**
 * Quality (G1, mockups/flow-parts-2-2026-10.html tab 6): a band a full cell
 * tall, grey up to the thumb and dark after it, and the thumb a pill with the
 * value on it. No mode colour anywhere in it — the bar above, the card's tag
 * and the title carry the mode. Rows start one cell in from the card's edge,
 * as the kit draws them.
 */
const LEAD = 1
/** The band's width, thumb included. */
export const SLIDER_WIDTH = 48
/** The title row's width from `LEAD`, the same as Working's line. */
const TITLE_WIDTH = 64

/**
 * The band at `value`. The thumb travels the band's width less its own, so
 * it touches each end at `min` and `max`. Where there are no fills (the
 * first-run palette, NO_COLOR) the band is drawn as a heavy rule up to the
 * value and a light one after it, so where the value sits still shows.
 */
export function sliderRow({
  palette,
  value,
  min,
  max,
  width = SLIDER_WIDTH,
  plain = palette.track === '',
  unit = '',
}: {
  palette: Palette
  value: number
  min: number
  max: number
  width?: number
  /** No fills will show (NO_COLOR): draw the band in shapes instead. */
  plain?: boolean
  /** After the value on the thumb: `%` for Resize's band. */
  unit?: string
}): Row {
  const label = ` ${value}${unit} `
  const room = Math.max(0, width - stringWidth(label))
  const ratio = max === min ? 0 : (Math.min(max, Math.max(min, value)) - min) / (max - min)
  const k = Math.round(ratio * room)
  const rest = room - k
  if (plain) {
    return [
      blank(LEAD),
      { text: '━'.repeat(k), fg: palette.dim },
      { text: label, fg: palette.fg, bold: true },
      { text: '─'.repeat(rest), fg: palette.border },
    ].filter((r) => r.text !== '')
  }
  return [
    blank(LEAD),
    { text: ' '.repeat(k), bg: palette.trackFill },
    { text: label, fg: palette.ink, bg: palette.thumb, bold: true },
    { text: ' '.repeat(rest), bg: palette.track },
  ].filter((r) => r.text !== '')
}

/**
 * "smaller" under the band's left end and "sharper" under its right, both
 * quiet. A centred band (Resize's, 100 % in the middle) says what its middle
 * is too, centred under it: `smaller · same size · larger`.
 */
export function endsRow({
  palette,
  width = SLIDER_WIDTH,
  ends = ['smaller', 'sharper'],
  middle,
}: {
  palette: Palette
  width?: number
  ends?: [string, string]
  middle?: string
}): Row {
  const [a, b] = ends
  const quiet = (text: string) => ({ text, fg: palette.border })
  if (middle === undefined) {
    return [blank(LEAD), quiet(a), blank(Math.max(1, width - a.length - b.length)), quiet(b)]
  }
  const before = Math.max(1, Math.round(width / 2) - Math.floor(middle.length / 2) - a.length)
  const after = Math.max(1, width - a.length - before - middle.length - b.length)
  return [blank(LEAD), quiet(a), blank(before), quiet(middle), blank(after), quiet(b)]
}

/** The question's title in the mode's colour, and what it is about, quiet, at the right. */
export function titleRow({
  palette,
  mode,
  title,
  aside,
  width = LEAD + TITLE_WIDTH,
}: {
  palette: Palette
  mode: ShellMode
  title: string
  aside?: string | undefined
  /** The terminal's width; the row ends at the title width or there, whichever is first. */
  width?: number
}): Row {
  const end = Math.min(width, LEAD + TITLE_WIDTH)
  const row: Row = [blank(LEAD), { text: title, fg: modeColours(palette, mode).fg, bold: true }]
  if (!aside) return row
  const gap = end - LEAD - stringWidth(title) - stringWidth(aside)
  if (gap < 1) return row
  return [...row, blank(gap), { text: aside, fg: palette.border }]
}
