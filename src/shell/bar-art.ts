import stringWidth from 'string-width'
import { blank, clip, HOME_MARGIN, hatch, mix, type Row, type Run, width } from './home-art.js'
import { modeColours, modeGradient, type Palette, type ShellMode } from './theme.js'

/**
 * What the header bar says after the mode: every answer given so far, then
 * the question on screen now. Either may be empty — a file waiting at the
 * field has its name and no question.
 */
export interface Trail {
  answers: string[]
  current?: string | undefined
  /** A dim word before `current`, in its part: /about's "by". */
  lead?: string | undefined
}

/** The chip of a screen that is not a mode, drawn as a mode's would be. */
export interface BarChip {
  label: string
  colour: string
  stops: readonly string[]
}

/** Powerline's slants: the chip's ends lean the same way as the hatching. */
const SLANT_IN = ''
const SLANT_OUT = ''
/** Hatching after the trail, as the home band keeps two cells after its version. */
const TAIL = 2

/**
 * How bright the hatching is at column `c`, `t` seconds into a drift: a slow
 * wave moving right, like a barber's pole (W5). Never below 0.55, so the bar
 * still reads as the mode's at its darkest.
 */
export function driftAt(c: number, t: number): number {
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((c - t * 9) / 2.2))
}

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
  drift,
  chip,
}: {
  width: number
  palette: Palette
  mode: ShellMode
  trail: Trail
  slanted: boolean
  /** Seconds into the drift while a job runs; the hatching is still without it. */
  drift?: number | undefined
  /** A screen that is not a mode (`/extensions`): its own chip label, colour and gradient. */
  chip?: BarChip | undefined
}): Row {
  const M = HOME_MARGIN
  const end = columns - M
  const span = columns + 8
  const stops = chip?.stops ?? modeGradient(palette, mode)
  const colour = chip?.colour ?? modeColours(palette, mode).fg
  // Each hatch cell is one run, so its column is where the run starts plus its index.
  const fill = (from: number, n: number): Run[] =>
    hatch(from, n, 0, span, stops).map((run, i) =>
      drift === undefined
        ? run
        : { ...run, fg: mix(palette.canvas, run.fg ?? '', driftAt(from + i, drift)) },
    )
  const label: Run = { text: ` ${chip?.label ?? mode} `, fg: palette.ink, bg: colour, bold: true }
  const chipRuns: Run[] = slanted
    ? [{ text: SLANT_IN, fg: colour }, label, { text: SLANT_OUT, fg: colour }]
    : [label]
  const row: Row = [blank(M), ...chipRuns]
  const from = M + width(chipRuns)
  if (from >= end) return row

  const part = (text: string, current: boolean): Run =>
    current
      ? { text: ` ${trail.lead ? `${trail.lead} ` : ''}${text} `, fg: palette.fg, bold: true }
      : { text: ` ${text} `, fg: palette.dim }
  /** The current part, its lead split off dim. */
  const runsOf = (p: Run): Run[] => {
    const lead = trail.lead ? ` ${trail.lead} ` : ''
    if (!lead || !p.bold || !p.text.startsWith(lead)) return [p]
    return [
      { text: lead, fg: palette.dim },
      { ...p, text: p.text.slice(lead.length) },
    ]
  }
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

  if (shown.length === 0) return [...row, ...fill(from, end - from)]
  const start = end - TAIL - runWidth(shown)
  row.push(...fill(from, start - from))
  let c = start
  shown.forEach((p, i) => {
    if (i > 0) {
      row.push(...fill(c, 1))
      c += 1
    }
    row.push(...runsOf(p))
    c += stringWidth(p.text)
  })
  row.push(...fill(c, TAIL))
  return row
}
