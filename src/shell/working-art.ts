import stringWidth from 'string-width'
import { FORMATS } from '../core/formats.js'
import { clockOf } from '../core/timecode.js'
import type { Job, Phase } from '../core/types.js'
import { displayName } from '../utils/display-path.js'
import { blank, clip, HOME_MARGIN, mix, type Row, type Run } from './home-art.js'
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
const LEAD = HOME_MARGIN
/** The line's width from `LEAD`: its right end, where the clock sits, is the title's. */
export const LINE_WIDTH = 64
/** The count rows sit two cells further in than the line. */
const COUNT_LEAD = HOME_MARGIN + 2
/** The page bar's width, a full cell tall. */
export const PAGE_BAR = 30
/** The clock appears once a job has run this long (W5: only a long job shows it). */
export const CLOCK_AFTER_MS = 3000

/**
 * A real time, said the way a person reads one (T1, mockups/transcribe-2026-10-round3.html,
 * 2026-10-22): seconds to a tenth under a minute, "4m 12s" under an hour, "1h 03m" past it.
 */
export function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  if (s < 60) return `${(ms / 1000).toFixed(1)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`
}

/** The real time a job has run, once it is long enough to say; `undefined` before. */
export function clockFor(ms: number): string | undefined {
  return ms < CLOCK_AFTER_MS ? undefined : elapsed(ms)
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
 * A step that is done, above the one working now (transcribe's Transcribing
 * once notes start, decided 2026-10-22): a green ✓, its name in plain type,
 * and the time it took where the working line keeps its clock.
 */
export function doneLine({
  palette,
  label,
  took,
  width = LEAD + LINE_WIDTH,
}: {
  palette: Palette
  label: string
  took: string
  width?: number
}): Row {
  const end = Math.min(width, LEAD + LINE_WIDTH)
  const lead = LEAD + 2
  const shown = clip(label, Math.max(1, end - lead - stringWidth(took) - 1))
  const gap = end - lead - stringWidth(shown) - stringWidth(took)
  return [
    blank(LEAD),
    { text: '✓', fg: palette.ok, bold: true },
    blank(1),
    { text: shown, fg: palette.fg },
    blank(Math.max(1, gap)),
    { text: took, fg: palette.border },
  ]
}

/** A step still to come, under the one working now: its name alone, faint, where labels start. */
export function nextLine({ palette, label }: { palette: Palette; label: string }): Row {
  return [blank(LEAD + 2), { text: label, fg: palette.faint }]
}

/**
 * Parts of a known count (transcribe's notes, W3): a square per part, two
 * cells wide because a cell is twice as tall as it is wide. Written parts in
 * the mode's colour, the one being written half way to the canvas, the rest
 * the track's; then the count. `done` parts are finished — the one after them
 * is the one in hand. The count is known before the first part starts, so
 * nothing here is estimated (invariant 7).
 */
export function partsRow({
  palette,
  mode,
  done,
  of,
}: {
  palette: Palette
  mode: ShellMode
  done: number
  of: number
}): Row {
  const n = Math.max(0, Math.min(done, of))
  const fg = modeColours(palette, mode).fg
  const now = mix(fg, palette.canvas || '#000000', 0.55)
  const squares: Run[] = []
  for (let i = 0; i < of; i++) {
    if (i) squares.push(blank(1))
    squares.push({ text: '██', fg: i < n ? fg : i === n ? now : palette.track })
  }
  const unit = of === 1 ? 'part' : 'parts'
  return [blank(COUNT_LEAD), ...squares, { text: `  ${n} of ${of} ${unit}`, fg: palette.dim }]
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
  unit,
  says,
}: {
  palette: Palette
  mode: ShellMode
  done: number
  total: number
  /** No colours will show (NO_COLOR): the rest of the bar must differ in shape. */
  plain?: boolean
  /** What is counted when it is not pages: a folder's files, "9 of 24 images". */
  unit?: string | undefined
  /** The count in other words, when it is not whole things: "23:10 of 1:01:57", "18.2 of 59.6 MB". */
  says?: string | undefined
}): Row {
  const k = total > 0 ? Math.round((Math.max(0, Math.min(done, total)) / total) * PAGE_BAR) : 0
  const rest = plain ? '░' : '█'
  return [
    blank(COUNT_LEAD),
    { text: '█'.repeat(k), fg: modeColours(palette, mode).fg },
    { text: rest.repeat(PAGE_BAR - k), fg: palette.track },
    {
      text:
        says !== undefined
          ? `  ${says}`
          : unit === undefined
            ? `  page ${done} of ${total}`
            : `  ${done} of ${total} ${unit}`,
      fg: palette.dim,
    },
  ].filter((r) => r.text !== '')
}

/** When the time left is first said: before then the speed is not yet known. */
export const TIME_LEFT_AFTER_MS = 5000

/**
 * A video's or sound file's bar (video spec §3.6): the page bar's look, filled
 * to the seconds encoded of the seconds the output will have — a true total,
 * which is why it may be drawn at all (invariant 7). After 5 s it says the
 * time left, from the speed this pass has kept so far.
 */
export function timeRow({
  palette,
  mode,
  done,
  total,
  elapsedMs,
  plain = palette.track === '',
}: {
  palette: Palette
  mode: ShellMode
  done: number
  total: number
  /** Since this pass began. */
  elapsedMs: number
  plain?: boolean
}): Row {
  // The page bar's own cells, without its words.
  const bar = pagesRow({ palette, mode, done, total, plain, unit: '' }).slice(0, -1)
  const row: Row = [...bar, { text: `  ${clockOf(done)} of ${clockOf(total)}`, fg: palette.dim }]
  return [...row, ...timeLeftRun(palette, done, total, elapsedMs)]
}

/**
 * Said once the speed is known (`TIME_LEFT_AFTER_MS`): the time left at the
 * pace this pass has kept so far. Nothing before then, and nothing at either
 * end, where there is no pace or no time left.
 */
function timeLeftRun(palette: Palette, done: number, total: number, elapsedMs: number): Row {
  if (elapsedMs < TIME_LEFT_AFTER_MS || done <= 0 || done >= total) return []
  const left = ((total - done) / done) * (elapsedMs / 1000)
  const said = left < 60 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`
  return [{ text: `  ·  about ${said} left`, fg: palette.border }]
}

/**
 * Tiles done of the tiles a picture was cut into (Sharpen, Boost resolution):
 * the page bar's look, then "12 of 48" and, after 5 s, the time left. The total
 * is a fact — the grid is laid out before the first tile — so the bar may be
 * drawn (invariant 7). `elapsedMs` is since the first count arrived, so the
 * model's start-up is not counted in the pace.
 */
export function tilesRow({
  palette,
  mode,
  done,
  total,
  elapsedMs,
  plain = palette.track === '',
}: {
  palette: Palette
  mode: ShellMode
  done: number
  total: number
  elapsedMs: number
  plain?: boolean
}): Row {
  return [
    ...pagesRow({ palette, mode, done, total, plain, says: `${done} of ${total}` }),
    ...timeLeftRun(palette, done, total, elapsedMs),
  ]
}

/**
 * A phase the engine reported, as the working line says it: the format being
 * encoded and the file being written are named, from the job itself.
 */
export function phaseLabel(job: Job, phase: Phase): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting for another window'
    case 'reading':
      return 'Reading'
    case 'decoding':
      return 'Decoding'
    case 'encoding':
      // An extension's child is running: what it is doing, not an encode.
      if (job.op === 'boost') return 'Running the model'
      if (job.op === 'remove-background') return 'Finding the subject'
      return job.op === 'convert' ? `Encoding ${FORMATS[job.target].label}` : 'Encoding'
    case 'writing': {
      const [only] = job.outputs
      return job.outputs.length === 1 && only
        ? `Writing ${displayName(only)}`
        : `Writing ${job.outputs.length} files`
    }
  }
}
