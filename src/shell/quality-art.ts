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
  marks = [],
  warn = false,
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
  /**
   * The only values the band stops at (A3·a): each one not under the thumb
   * is a dot in the middle of where its thumb would be.
   */
  marks?: readonly number[]
  /**
   * The value may look different (W1, the lowest of a PNG's points): the
   * thumb in `larger` orange and the band after it in the soft orange tint.
   */
  warn?: boolean
}): Row {
  const label = ` ${value}${unit} `
  const w = stringWidth(label)
  const room = Math.max(0, width - w)
  const at = (v: number) => {
    const ratio = max === min ? 0 : (Math.min(max, Math.max(min, v)) - min) / (max - min)
    return Math.round(ratio * room)
  }
  const k = at(value)
  const dots = new Set(marks.filter((v) => v !== value).map((v) => at(v) + Math.floor(w / 2)))
  /** `n` cells of the band from `from`, a dot wherever a mark falls. */
  const stretch = (
    from: number,
    n: number,
    cell: string,
    dot: Omit<Row[number], 'text'>,
    base: Omit<Row[number], 'text'>,
  ) => {
    const out: Row = []
    let run = ''
    for (let c = from; c < from + n; c++) {
      if (!dots.has(c)) {
        run += cell
        continue
      }
      if (run) out.push({ text: run, ...base })
      out.push({ text: '•', ...dot })
      run = ''
    }
    if (run) out.push({ text: run, ...base })
    return out
  }
  const after = w + k
  const rest = width - after
  if (plain) {
    return [
      blank(LEAD),
      ...stretch(0, k, '━', { fg: palette.dim }, { fg: palette.dim }),
      { text: label, fg: palette.fg, bold: true },
      ...stretch(after, rest, '─', { fg: palette.border }, { fg: palette.border }),
    ].filter((r) => r.text !== '')
  }
  const track = warn ? palette.defaultTagBg : palette.track
  const onTrack = warn ? palette.defaultTag : palette.trackFill
  return [
    blank(LEAD),
    ...stretch(0, k, ' ', { fg: palette.track, bg: palette.trackFill }, { bg: palette.trackFill }),
    { text: label, fg: palette.ink, bg: warn ? palette.larger : palette.thumb, bold: true },
    ...stretch(after, rest, ' ', { fg: onTrack, bg: track }, { bg: track }),
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
