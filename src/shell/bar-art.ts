import stringWidth from 'string-width'
import { blank, clip, HOME_MARGIN, hatch, type Row, type Run, width } from './home-art.js'
import { modeColours, modeGradient, type Palette, type ShellMode } from './theme.js'

/**
 * What the header bar says after the mode: every answer given so far, then
 * the question on screen now. Either may be empty — a file waiting at the
 * field has its name and no question.
 */
export interface Trail {
  answers: string[]
  current?: string | undefined
}

/** Powerline's slants: the chip's ends lean the same way as the hatching. */
const SLANT_IN = ''
const SLANT_OUT = ''
/** Hatching after the trail, as the home band keeps two cells after its version. */
const TAIL = 2

/**
 * The header bar (mockups/flow-parts-2026-10.html, tab 4, section 04): one
 * row the width of the home band, filled with `╱` hatching in the mode's
 * gradient, coloured by absolute column so it lines up with the band on
 * home. The mode opens it as a chip in its own colour — slanted ends where
 * the terminal can draw them (`slantedChips`), plain where not — with no
 * hatching before or after it. The trail is knocked out of the hatching at
 * the far end, two cells in: the answers dim, the question bold, each
 * separated by a single `╱`. The chip never moves; the trail grows leftward,
 * and gives up its oldest answers first when the row runs out.
 */
export function trailBarRow({
  width: columns,
  palette,
  mode,
  trail,
  slanted,
}: {
  width: number
  palette: Palette
  mode: ShellMode
  trail: Trail
  slanted: boolean
}): Row {
  const M = HOME_MARGIN
  const end = columns - M
  const span = columns + 8
  const stops = modeGradient(palette, mode)
  const colour = modeColours(palette, mode).fg
  const label: Run = { text: ` ${mode} `, fg: palette.ink, bg: colour, bold: true }
  const chip: Run[] = slanted
    ? [{ text: SLANT_IN, fg: colour }, label, { text: SLANT_OUT, fg: colour }]
    : [label]
  const row: Row = [blank(M), ...chip]
  const from = M + width(chip)
  if (from >= end) return row

  const part = (text: string, current: boolean): Run =>
    current
      ? { text: ` ${text} `, fg: palette.fg, bold: true }
      : { text: ` ${text} `, fg: palette.dim }
  const runWidth = (parts: Run[]) => width(parts) + Math.max(0, parts.length - 1)
  // At least one ╱ between the chip and the trail, so the trail reads as knocked out.
  const room = end - TAIL - from - 1
  let answers = [...trail.answers]
  const parts = () => [
    ...answers.map((a) => part(a, false)),
    ...(trail.current ? [part(trail.current, true)] : []),
  ]
  while (answers.length > 0 && runWidth(parts()) > room) answers = answers.slice(1)
  let shown = parts()
  if (runWidth(shown) > room) {
    shown = trail.current && room >= 4 ? [part(clip(trail.current, room - 2), true)] : []
  }

  if (shown.length === 0) return [...row, ...hatch(from, end - from, 0, span, stops)]
  const start = end - TAIL - runWidth(shown)
  row.push(...hatch(from, start - from, 0, span, stops))
  let c = start
  shown.forEach((p, i) => {
    if (i > 0) {
      row.push(...hatch(c, 1, 0, span, stops))
      c += 1
    }
    row.push(p)
    c += stringWidth(p.text)
  })
  row.push(...hatch(c, TAIL, 0, span, stops))
  return row
}
