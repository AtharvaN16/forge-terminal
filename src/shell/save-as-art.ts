import stringWidth from 'string-width'
import { mix, type Row, type Run } from './home-art.js'
import type { Palette } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * Save as (V10c, mockups/round-5-2026-10.html): one block with an edge in the
 * mode's colour. The name sits at the top on the mode's tint, underlined, and
 * a rule parts it from the folders under it. The folders are lean — a name
 * each — but the highlighted one, which wears today's white bar, its path,
 * and the default's tag at the far end. The last row takes a path: typed,
 * completed with tab, or dropped.
 *
 * Every row here is exactly the field wide and starts at the field's left
 * edge. Where there are no fills (the first-run palette, NO_COLOR) the same
 * rows are drawn without them; the strip, the underline and the words still
 * say which is which.
 */

/** The field's width at 80 columns. */
export const FIELD_WIDTH = 76
/** The name's box, and its underline. */
export const NAME_WIDTH = 26
/** "name    ", "to      ": the labels' column. */
const LABEL_WIDTH = 8
/** Where a row's words start: the edge, two cells, the label. */
export const CONTENT_AT = 1 + 2 + LABEL_WIDTH
/** A folder's name is padded to this on the highlighted row, so the paths line up. */
const NAME_COLUMN = 16
/** The tag on the default folder. */
const TAG = ' default '
/** The tag on a path that does not exist yet: a save there makes it. */
const NEW_TAG = ' new folder '

/** The fill a row is drawn on, or none without colour. */
const fillOf = (palette: Palette, plain: boolean) =>
  plain || palette.selectionBg === '' ? undefined : palette.selectionBg

/**
 * A blank row of the plain filled field (the one `FilledField` draws for any
 * one-line answer): the padding above and below what it holds.
 */
export function fieldBlank({
  palette,
  width,
  plain = false,
}: {
  palette: Palette
  width: number
  plain?: boolean
}): Row {
  return [{ text: ' '.repeat(width), bg: fillOf(palette, plain) }]
}

/** The block's left edge: the mode's colour stepped back into the field's fill. */
export function edgeColour(palette: Palette, plain = false): string | undefined {
  const fill = fillOf(palette, plain)
  return fill ? mix(fill, palette.accent, 0.7) : undefined
}

/** `row` filled out to `width` cells on `bg`, or cut there. */
export function padTo(row: Row, width: number, bg: string | undefined): Row {
  const used = row.reduce((n, r) => n + stringWidth(r.text), 0)
  if (used >= width) return used === width ? row : cut(row, width)
  return [...row, { text: ' '.repeat(width - used), bg }]
}

function cut(row: Row, width: number): Row {
  const out: Row = []
  let left = width
  for (const run of row) {
    if (left <= 0) break
    const w = stringWidth(run.text)
    if (w <= left) {
      out.push(run)
      left -= w
    } else {
      out.push({ ...run, text: Array.from(run.text).slice(0, left).join('') })
      left = 0
    }
  }
  return out
}

/**
 * A row of the block: the edge, two cells, then `runs` on the field's fill
 * (a run with no fill of its own takes it), padded to `width`.
 */
export function fieldRow({
  palette,
  width,
  runs = [],
  plain = false,
}: {
  palette: Palette
  width: number
  runs?: Row
  plain?: boolean
}): Row {
  const fill = fillOf(palette, plain)
  const edge = edgeColour(palette, plain)
  const lead: Run = edge ? { text: ' ', bg: edge } : { text: '│', fg: palette.border }
  const body = runs.map((r) => (r.bg ? r : { ...r, bg: fill }))
  return padTo([lead, { text: '  ', bg: fill }, ...body], width, fill)
}

/** A label for the labels' column, or the column's blank. */
export const label = (palette: Palette, text = ''): Run => ({
  text: text.padEnd(LABEL_WIDTH),
  fg: palette.border,
})

/** The line under the name's box, in the mode's colour. */
export function underlineRow({
  palette,
  width,
  plain = false,
}: {
  palette: Palette
  width: number
  plain?: boolean
}): Row {
  return fieldRow({
    palette,
    width,
    plain,
    runs: [label(palette), { text: '▔'.repeat(NAME_WIDTH), fg: palette.accent }],
  })
}

/** The rule between the name and the folders. */
export function ruleRow({
  palette,
  width,
  plain = false,
}: {
  palette: Palette
  width: number
  plain?: boolean
}): Row {
  return fieldRow({
    palette,
    width,
    plain,
    runs: [{ text: '─'.repeat(Math.max(0, width - 6)), fg: palette.faint }],
  })
}

/** In place of a name, when the save writes many files: what they will be called. */
export function filesRow({
  palette,
  width,
  names,
  plain = false,
}: {
  palette: Palette
  width: number
  names: string
  plain?: boolean
}): Row {
  const room = Math.max(1, width - CONTENT_AT - 2)
  return fieldRow({
    palette,
    width,
    plain,
    runs: [label(palette, 'files'), { text: middleEllipsis(names, room), fg: palette.dim }],
  })
}

/** How wide the list is, after the labels' column, with a cell to spare at the end. */
const listWidth = (width: number) => Math.max(0, width - CONTENT_AT - 1)

/**
 * A list row, `first` carrying the "to" label: `body` on `band` the list's
 * width, `right` at its far end with a cell after it, where the default's
 * tag sits.
 */
function listRow({
  palette,
  width,
  first,
  body,
  right = [],
  band,
  plain,
}: {
  palette: Palette
  width: number
  first: boolean
  body: Row
  right?: Row
  band: string | undefined
  plain: boolean
}): Row {
  const w = listWidth(width)
  const tail = right.length ? [...right, { text: ' ', bg: band }] : []
  const used = tail.reduce((n, r) => n + stringWidth(r.text), 0)
  const banded = (r: Row) => r.map((x) => (x.bg ? x : { ...x, bg: band }))
  return fieldRow({
    palette,
    width,
    plain,
    runs: [
      label(palette, first ? 'to' : ''),
      ...padTo(banded(body), Math.max(0, w - used), band),
      ...banded(tail),
    ],
  })
}

export interface FolderRowSpec {
  palette: Palette
  width: number
  /** The first of the list: it carries the "to" label. */
  first?: boolean
  label: string
  /** Where it is, shown on the highlighted row only. */
  path: string
  selected?: boolean
  isDefault?: boolean
  /** A place that does not exist yet: quieter than the rest. */
  quiet?: boolean
  /** False in the compact band: names only. */
  showPath?: boolean
  plain?: boolean
}

/**
 * One folder. The highlighted one is on a grey band with the white strip at
 * its left, its name bold and its path after it; the rest are a name each.
 * The default carries its tag at the far end, whichever row is highlighted.
 */
export function folderRow({
  palette,
  width,
  first = false,
  label: name,
  path,
  selected = false,
  isDefault = false,
  quiet = false,
  showPath = true,
  plain = false,
}: FolderRowSpec): Row {
  const fill = fillOf(palette, plain)
  const bare = fill === undefined
  const band = bare ? undefined : selected ? palette.fieldBand : fill
  const tag: Row = isDefault
    ? [bare ? { text: TAG } : { text: TAG, fg: palette.defaultTag, bg: palette.defaultTagBg }]
    : []
  const room = listWidth(width) - 2 - (isDefault ? TAG.length + 1 : 0) - 1
  const shown = middleEllipsis(name, Math.max(1, Math.min(room, NAME_COLUMN * 3)))
  const body: Row = selected
    ? [
        { text: '▌', fg: palette.fg },
        { text: ' ' },
        { text: shown.padEnd(NAME_COLUMN), fg: palette.fg, bold: true },
        ...(showPath
          ? [
              {
                text: middleEllipsis(
                  path,
                  Math.max(1, room - Math.max(NAME_COLUMN, stringWidth(shown))),
                ),
                fg: palette.border,
              },
            ]
          : []),
      ]
    : [{ text: '  ' }, { text: shown, fg: quiet ? palette.border : palette.dim }]
  return listRow({ palette, width, first, body, right: tag, band, plain })
}

/** What the path row is showing. */
export type PathLine =
  /** Not highlighted, nothing in it: the invitation. */
  | { kind: 'rest' }
  /** Highlighted, nothing typed yet: the caret on the invitation. */
  | { kind: 'empty' }
  /**
   * Text being typed: the caret after it, the rest of a matching folder dim
   * (`ghost`), and at the far end what a save there means.
   */
  | {
      kind: 'typing'
      text: string
      ghost?: string | undefined
      note?: 'complete' | 'new' | 'nomatch' | undefined
      highlighted: boolean
    }
  /** A dropped folder or file: its name (or "Next to x.png") and where it is. */
  | { kind: 'place'; label: string; path: string; highlighted: boolean }

/**
 * The last row: where a path goes. At rest it invites one; highlighted, it
 * takes typing (the caret a cell of the text's colour); a drop fills it.
 */
export function pathRow({
  palette,
  width,
  line,
  first = false,
  showPath = true,
  plain = false,
}: {
  palette: Palette
  width: number
  line: PathLine
  first?: boolean
  showPath?: boolean
  plain?: boolean
}): Row {
  const fill = fillOf(palette, plain)
  // Without fills — NO_COLOR, or a palette with none — the caret is a glyph.
  const bare = fill === undefined
  const highlighted = line.kind === 'empty' || (line.kind !== 'rest' && line.highlighted)
  const band = bare ? undefined : highlighted ? palette.fieldBand : fill
  const caret: Run = bare ? { text: '▏', fg: palette.fg } : { text: ' ', bg: palette.fg }
  const strip: Row = highlighted ? [{ text: '▌', fg: palette.fg }, { text: ' ' }] : [{ text: '  ' }]
  const listRoom = listWidth(width) - 2

  if (line.kind === 'rest' || line.kind === 'empty') {
    // Highlighted with nothing typed, the caret sits on the invitation's first letter.
    const words: Row =
      line.kind !== 'empty'
        ? [{ text: 'T', fg: palette.dim }]
        : bare
          ? [caret, { text: 'T', fg: palette.dim }]
          : [{ text: 'T', fg: palette.canvas, bg: palette.dim }]
    return listRow({
      palette,
      width,
      first,
      band,
      plain,
      body: [
        ...strip,
        ...words,
        { text: 'ype the path here', fg: palette.dim },
        { text: '  or drop a folder', fg: palette.border },
      ],
    })
  }

  if (line.kind === 'place') {
    const name = middleEllipsis(line.label, Math.max(1, listRoom - 2))
    return listRow({
      palette,
      width,
      first,
      band,
      plain,
      body: [
        ...strip,
        { text: name.padEnd(NAME_COLUMN + 4), fg: palette.fg, bold: true },
        ...(showPath ? [{ text: line.path, fg: palette.border }] : []),
      ],
    })
  }

  const right: Row =
    line.note === 'new'
      ? [bare ? { text: NEW_TAG } : { text: NEW_TAG, fg: palette.newTag, bg: palette.newTagBg }]
      : line.note === 'complete'
        ? [{ text: 'tab completes', fg: palette.border }]
        : line.note === 'nomatch'
          ? [{ text: 'no match', fg: palette.border }]
          : []
  const rightWidth = right.reduce((n, r) => n + stringWidth(r.text), 0)
  const room = Math.max(1, listRoom - rightWidth - 3 - stringWidth(line.ghost ?? ''))
  // A long path keeps its end, where the typing is.
  const text =
    stringWidth(line.text) > room
      ? `…${Array.from(line.text)
          .slice(-(room - 1))
          .join('')}`
      : line.text
  return listRow({
    palette,
    width,
    first,
    band,
    plain,
    right,
    body: [
      ...strip,
      { text, fg: palette.fg, bold: true },
      ...(line.highlighted ? [caret] : []),
      ...(line.ghost ? [{ text: line.ghost, fg: palette.border }] : []),
    ],
  })
}
