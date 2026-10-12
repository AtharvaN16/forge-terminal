import { basename } from 'node:path'
import stringWidth from 'string-width'
import { FORMATS } from '../core/formats.js'
import type { Job } from '../core/types.js'
import { blank, clip, type Row, type Run } from './home-art.js'
import { modeColours, type Palette, type ShellMode } from './theme.js'

/**
 * Working (W5, mockups/flow-parts-2-2026-10.html tab 5): what sits under the
 * file card while a job runs. One line — the spinner in the mode's colour and
 * the true phase in bold, the clock at its right end once the job has run
 * long enough to ask "is it stuck?" — and, where there is a real count, one
 * row under it: a dot per try of the size search, or a bar of pages.
 *
 * The rows start one cell in from the card's edge, as the kit draws them.
 */
const LEAD = 1
/** The line's width from `LEAD`: its right end, where the clock sits, is the title's. */
export const LINE_WIDTH = 64
/** The count rows sit two cells further in than the line. */
const COUNT_LEAD = 3
/** The page bar's width, a full cell tall. */
export const PAGE_BAR = 30
/** The clock appears once a job has run this long (W5: only a long job shows it). */
export const CLOCK_AFTER_MS = 3000

/** The real time a job has run, once it is long enough to say; `undefined` before. */
export function clockFor(ms: number): string | undefined {
  return ms < CLOCK_AFTER_MS ? undefined : `${(ms / 1000).toFixed(1)}s`
}

/**
 * The spinner, a space, the label in bold, and the clock right-aligned to the
 * line's end. Without a spinner (motion off) the label stands alone, in the
 * same place. A line too wide for the terminal clips the label, never the clock.
 */
export function workLine({
  palette,
  mode,
  spinner,
  label,
  clock,
  width = LEAD + LINE_WIDTH,
}: {
  palette: Palette
  mode: ShellMode
  spinner?: string | undefined
  label: string
  clock?: string | undefined
  /** The terminal's width; the line ends at `LEAD + LINE_WIDTH` or there, whichever is first. */
  width?: number
}): Row {
  const end = Math.min(width, LEAD + LINE_WIDTH)
  const head: Run[] = spinner
    ? [{ text: spinner, fg: modeColours(palette, mode).fg, bold: true }, blank(1)]
    : [blank(2)]
  const lead = LEAD + 2
  const shown = clip(label, Math.max(1, end - lead - (clock ? stringWidth(clock) + 1 : 0)))
  const row: Row = [blank(LEAD), ...head, { text: shown, fg: palette.fg, bold: true }]
  if (!clock) return row
  const gap = end - lead - stringWidth(shown) - stringWidth(clock)
  return [...row, blank(Math.max(1, gap)), { text: clock, fg: palette.border }]
}

/**
 * The size search, one dot per try: filled in the mode's colour for each
 * done, faint for each it may still take. `of` is the search's own bound for
 * this rung, known before it starts, so the row is a real bounded sequence
 * and never a bar towards an invented total (invariant 7).
 */
export function triesRow({
  palette,
  mode,
  n,
  of,
}: {
  palette: Palette
  mode: ShellMode
  n: number
  of: number
}): Row {
  const done = Math.max(0, Math.min(n, of))
  return [
    blank(COUNT_LEAD),
    { text: '● '.repeat(done), fg: modeColours(palette, mode).fg },
    { text: '○ '.repeat(Math.max(0, of - done)), fg: palette.faint },
  ].filter((r) => r.text !== '')
}

/**
 * Pages done of a known total: a solid bar a full cell tall, with no knob —
 * it fills, it cannot be dragged — then the count in words. Without a track
 * colour the rest of the bar is drawn lighter in shape, so it still reads as
 * empty where colour is gone.
 */
export function pagesRow({
  palette,
  mode,
  done,
  total,
  plain = palette.track === '',
}: {
  palette: Palette
  mode: ShellMode
  done: number
  total: number
  /** No colours will show (NO_COLOR): the rest of the bar must differ in shape. */
  plain?: boolean
}): Row {
  const k = total > 0 ? Math.round((Math.max(0, Math.min(done, total)) / total) * PAGE_BAR) : 0
  const rest = plain ? '░' : '█'
  return [
    blank(COUNT_LEAD),
    { text: '█'.repeat(k), fg: modeColours(palette, mode).fg },
    { text: rest.repeat(PAGE_BAR - k), fg: palette.track },
    { text: `  page ${done} of ${total}`, fg: palette.dim },
  ].filter((r) => r.text !== '')
}

/**
 * A phase the engine reported, as the working line says it: the format being
 * encoded and the file being written are named, from the job itself.
 */
export function phaseLabel(
  job: Job,
  phase: 'reading' | 'decoding' | 'encoding' | 'writing',
): string {
  switch (phase) {
    case 'reading':
      return 'Reading'
    case 'decoding':
      return 'Decoding'
    case 'encoding':
      return job.op === 'convert' ? `Encoding ${FORMATS[job.target].label}` : 'Encoding'
    case 'writing': {
      const [only] = job.outputs
      return job.outputs.length === 1 && only
        ? `Writing ${basename(only)}`
        : `Writing ${job.outputs.length} files`
    }
  }
}
