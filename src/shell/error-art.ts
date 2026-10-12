import { wrapWords } from './done-art.js'
import { blank, type Row, type Run, width } from './home-art.js'
import { type Palette, SYMBOLS } from './theme.js'
import { endEllipsis } from './width.js'

/**
 * Errors (mockups/flow-parts-2-2026-10.html tab "9 · Errors ✓"), two sizes of
 * one object: red text appears only on a dark red tint, and the rest of the
 * words stay white and grey.
 *
 * - E5, for a run or a refusal that ends in the scrollback: a "failed" tab
 *   sitting on the top edge of a tinted panel, as K3·a's tabs do. Title in
 *   white bold, the detail white, the way forward grey.
 * - E5·b, for a refusal of what was just typed or dropped: the panel at one
 *   row, the title in red bold and the reason in white. No tab.
 *
 * Without a fill (the first-run palette, `plain` for NO_COLOR) the tint
 * cannot say "error", so the shape does: the tab reads `✕ failed` and the
 * row starts with `✕ `.
 *
 * Every row starts at column 0 and is exactly `width` wide where it is
 * filled; the component adds the margin.
 */

/** The tint as a run's fill: none where the palette has none, or when plain. */
const fillOf = (palette: Palette, plain: boolean) =>
  plain || palette.failTint === '' ? undefined : palette.failTint

/** `runs` on `bg`, padded with the fill to `columns`. */
function filled(runs: Run[], columns: number, bg: string): Row {
  const row: Row = runs.map((run) => ({ ...run, bg }))
  return [...row, { ...blank(columns - width(row)), bg }]
}

/**
 * E5: the tab, then the panel — a blank row, the title, the detail, the
 * hint if there is one, a blank row — each wrapped to the width less a cell
 * of padding each side.
 */
export function errorPanel({
  palette,
  title,
  detail,
  hint,
  width: columns,
  plain = false,
}: {
  palette: Palette
  title: string
  detail: string
  hint?: string | undefined
  width: number
  plain?: boolean
}): Row[] {
  const bg = fillOf(palette, plain)
  // Without a fill there is no panel to pad inside: the words start flush.
  const lead = bg === undefined ? '' : ' '
  const room = Math.max(1, columns - 2 * lead.length)
  const line = (text: string, fg: string, bold = false): Row => {
    const runs: Run[] = [{ text: lead }, { text, fg, bold }]
    return bg === undefined ? runs : filled(runs, columns, bg)
  }
  const gap: Row = bg === undefined ? [{ text: ' ' }] : filled([], columns, bg)
  const tab: Row =
    bg === undefined
      ? [{ text: `${SYMBOLS.fail} failed`, fg: palette.fail, bold: true }]
      : [
          { text: ' ', bg },
          { text: 'failed', fg: palette.fail, bg, bold: true },
          { text: ' ', bg },
        ]

  return [
    tab,
    gap,
    ...wrapWords(title, room).map((l) => line(l, palette.fg, true)),
    ...wrapWords(detail, room).map((l) => line(l, palette.fg)),
    ...(hint ? wrapWords(hint, room).map((l) => line(l, palette.dim)) : []),
    gap,
  ]
}

/**
 * E5·b: one row — the title in `fail` bold, three cells, then the reason in
 * `fg`. A reason that does not fit is cut at the end; the title never is.
 */
export function errorLine({
  palette,
  title,
  reason,
  width: columns,
  plain = false,
}: {
  palette: Palette
  title: string
  reason: string
  width: number
  plain?: boolean
}): Row {
  const bg = fillOf(palette, plain)
  const lead = bg === undefined ? `${SYMBOLS.fail} ` : ' '
  const gap = '   '
  // A cell of padding on the right, as the panel has.
  const room = columns - lead.length - width([{ text: title }]) - gap.length - 1
  const runs: Run[] = [
    { text: lead },
    { text: title, fg: palette.fail, bold: true },
    { text: gap },
    { text: endEllipsis(reason, room), fg: palette.fg },
  ]
  return bg === undefined ? runs : filled(runs, columns, bg)
}
