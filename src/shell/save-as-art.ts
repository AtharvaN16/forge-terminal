import stringWidth from 'string-width'
import type { Row, Run } from './home-art.js'
import type { Palette } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * Save as (P1, mockups/flow-parts-2-2026-10.html tab 7): Save to and Name as
 * one question, read as a sentence in today's filled field —
 * `› header.jpg   in  Desktop ▾`. Tab opens the field downward: the folders
 * appear inside it, their names under the folder's, the one you are on a
 * white pill in the sentence and a grey band in the list.
 *
 * Every row here is exactly the field wide, and starts at the field's left
 * edge. Where there are no fills (the first-run palette, NO_COLOR) the same
 * rows are drawn without them, and the pill is bracketed instead, so which
 * folder you are on still reads by shape.
 */

/** The field's width at 80 columns, as the kit draws it. */
export const FIELD_WIDTH = 76
/** The width a folder's name is padded to in the list. */
export const NAME_COLUMN = 12
/** What the list keeps for itself when a long name would push it off the edge. */
const LIST_MIN = 30
/** `   in `, between the extension and the folder. */
const IN = '   in '
/** The tag on the default folder, and the cell after it. */
const TAG = ' default '

/** Where in `sentenceRow`'s runs the sentence goes on after the name and its extension. */
export const SENTENCE_TAIL = 5

/** The fill a row is drawn on, or none without colour. */
const fillOf = (palette: Palette, plain: boolean) =>
  plain || palette.selectionBg === '' ? undefined : palette.selectionBg

/** A blank row of the field's fill: the padding above and below what it holds. */
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

/**
 * The name as the sentence can show it: cut from the middle when a long one
 * would leave the folder list too little room.
 */
function fitName(name: string, ext: string, width: number): string {
  const room = width - LIST_MIN - 2 - (3 + stringWidth(ext) + IN.length - 1)
  return middleEllipsis(name, Math.max(1, room))
}

/**
 * Where in the field the folder list starts: one column left of the folder's
 * pill, so the strip sits there and the names line up under the pill's text.
 */
export function listAt(name: string, ext: string, width = FIELD_WIDTH): number {
  return 3 + stringWidth(fitName(name, ext, width)) + stringWidth(ext) + IN.length - 1
}

/**
 * The sentence. `folder` is what the folder's place shows: its name, or, with
 * `query`, what has been typed to find one — the caret after it.
 *
 * - `focus: 'name'`: the name in fg, the folder on a light grey fill, ▾ after.
 * - `focus: 'folder'`: the name dim, the folder a white pill.
 *
 * `pillBg` overrides the pill's fill, for the flash a dropped path makes.
 * The first five runs are the lead, the marker, a space, the name and the
 * extension — `SENTENCE_TAIL` is where what follows the name begins.
 */
export function sentenceRow({
  palette,
  width,
  name,
  ext,
  focus,
  folder,
  query = false,
  pillBg,
  plain = false,
}: {
  palette: Palette
  width: number
  name: string
  ext: string
  focus: 'name' | 'folder'
  folder: string
  query?: boolean
  pillBg?: string | undefined
  plain?: boolean
}): Row {
  const bg = fillOf(palette, plain)
  const shown = fitName(name, ext, width)
  const row: Row = [
    { text: ' ', bg },
    { text: '›', fg: palette.accent, bg },
    { text: ' ', bg },
    { text: shown, fg: focus === 'name' ? palette.fg : palette.dim, bg },
    { text: ext, fg: palette.border, bg },
    { text: IN, fg: palette.border, bg },
  ]
  const used = 3 + stringWidth(shown) + stringWidth(ext) + IN.length
  row.push(...folderPart({ palette, focus, folder, query, pillBg, plain, room: width - used - 1 }))
  return padTo(row, width, bg)
}

/**
 * The folder's place in the sentence, `room` cells at most: a chip with ▾
 * while the name is focused, a pill once the folder is.
 */
function folderPart({
  palette,
  focus,
  folder,
  query,
  pillBg,
  plain,
  room,
}: {
  palette: Palette
  focus: 'name' | 'folder'
  folder: string
  query: boolean
  pillBg: string | undefined
  plain: boolean
  room: number
}): Run[] {
  if (focus === 'name') {
    const label = middleEllipsis(folder, Math.max(1, room - 4))
    if (plain) return [{ text: ` ${label} ▾ ` }]
    return [
      { text: ` ${label} `, fg: palette.fg, bg: palette.folderChip, bold: true },
      { text: '▾ ', fg: palette.dim, bg: palette.folderChip },
    ]
  }
  const label = middleEllipsis(folder, Math.max(1, room - (query ? 3 : 2)))
  if (plain) return [{ text: query ? `[${label}▏]` : `[${label}]` }]
  const fill = pillBg ?? palette.pill
  if (!query) return [{ text: ` ${label} `, fg: palette.ink, bg: fill, bold: true }]
  return [
    { text: ` ${label}`, fg: palette.ink, bg: fill, bold: true },
    // The caret: a cell of the pill's ink, where the next letter lands.
    { text: ' ', bg: palette.ink },
    { text: ' ', bg: fill },
  ]
}

export interface FolderRowSpec {
  palette: Palette
  width: number
  /** Where the row starts in the field: `listAt`. */
  at: number
  label: string
  /** Where it is, shown on the highlighted row only. */
  path: string
  selected?: boolean
  isDefault?: boolean
  /** A place that does not exist yet, or no place at all: quieter than the rest. */
  quiet?: boolean
  /** Shown whether highlighted or not, in place of a path: what "no match" means. */
  note?: string | undefined
  /** False in the compact band: names only. */
  showPath?: boolean
  plain?: boolean
}

/**
 * One folder in the list, inside the field. The highlighted one is on a grey
 * band with the strip at its left, its name bold and its path after it; the
 * default carries its tag at the far end, one cell inside the list's edge,
 * whichever row is highlighted.
 */
export function folderRow({
  palette,
  width,
  at,
  label,
  path,
  selected = false,
  isDefault = false,
  quiet = false,
  note,
  showPath = true,
  plain = false,
}: FolderRowSpec): Row {
  const fill = fillOf(palette, plain)
  const band = plain ? undefined : selected ? palette.fieldBand : fill
  const listWidth = Math.max(0, width - at - 2)
  const tagWidth = isDefault ? TAG.length + 1 : 0

  const nameRoom = Math.max(1, listWidth - 2 - tagWidth - 1)
  const name = middleEllipsis(label, nameRoom)
  const nameWidth = Math.min(
    nameRoom,
    stringWidth(name) < NAME_COLUMN ? NAME_COLUMN : stringWidth(name) + 2,
  )
  const nameFg = selected ? palette.fg : quiet ? palette.border : palette.dim

  const list: Row = [
    selected ? { text: '▌', fg: palette.fg, bg: band } : { text: ' ', bg: band },
    { text: ' ', bg: band },
    { text: name, fg: nameFg, bg: band, bold: selected },
    { text: ' '.repeat(nameWidth - stringWidth(name)), bg: band },
  ]
  const after = note ?? (selected && showPath ? path : '')
  const afterRoom = listWidth - 2 - nameWidth - tagWidth - 1
  if (after && afterRoom > 0) {
    list.push({ text: middleEllipsis(after, afterRoom), fg: palette.border, bg: band })
  }
  if (isDefault) {
    const used = list.reduce((n, r) => n + stringWidth(r.text), 0)
    list.push({ text: ' '.repeat(Math.max(0, listWidth - used - tagWidth)), bg: band })
    list.push(
      plain ? { text: TAG } : { text: TAG, fg: palette.defaultTag, bg: palette.defaultTagBg },
      { text: ' ', bg: band },
    )
  }
  return padTo(
    [{ text: ' '.repeat(at), bg: fill }, ...padTo(list, listWidth, band), { text: '  ', bg: fill }],
    width,
    fill,
  )
}

/** `row` filled out to `width` cells on `bg`, or cut there. */
function padTo(row: Row, width: number, bg: string | undefined): Row {
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
