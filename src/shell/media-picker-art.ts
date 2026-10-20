import { FORMATS } from '../core/formats.js'
import type { FormatId } from '../core/types.js'
import { blank, type Row, type Run } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * A video's Convert to (video spec §3.2, round 3 "Convert"): what it can
 * become, drawn as boxes side by side — `video` (MP4, HEVC, WebM, GIF) and
 * `sound only` (MP3, M4A, WAV) — each grouped by its format's own `media`,
 * so nothing here lists a format (invariant 2). The box the chosen one is in
 * is drawn in the mode's colour. Pure: rows of runs.
 */

export interface PickerBox {
  name: string
  ids: FormatId[]
}

/** The targets, grouped into boxes by what they hold; empty boxes left out. */
export function mediaBoxes(targets: readonly FormatId[]): PickerBox[] {
  const boxes: PickerBox[] = [
    { name: 'video', ids: targets.filter((id) => FORMATS[id].media === 'video') },
    { name: 'audio only', ids: targets.filter((id) => FORMATS[id].media === 'sound') },
  ]
  return boxes.filter((b) => b.ids.length > 0)
}

/** Where `id` is: its box and its row in it. */
export function placeOf(boxes: PickerBox[], id: FormatId): { box: number; row: number } {
  for (const [box, b] of boxes.entries()) {
    const row = b.ids.indexOf(id)
    if (row !== -1) return { box, row }
  }
  return { box: 0, row: 0 }
}

const GAP = 2

export function mediaPickerRows({
  palette,
  boxes,
  chosen,
  width,
}: {
  palette: Palette
  boxes: PickerBox[]
  chosen: FormatId
  width: number
}): Row[] {
  const W = Math.floor((width - GAP * (boxes.length - 1)) / boxes.length)
  const inner = W - 2
  const tall = Math.max(...boxes.map((b) => b.ids.length))
  const drawn = boxes.map((b): Row[] => {
    const has = b.ids.includes(chosen)
    const edge = has ? palette.accent : palette.border
    const rows: Row[] = [
      [
        { text: '╭─ ', fg: edge },
        { text: b.name, fg: has ? palette.accent : palette.dim, bold: has },
        { text: ` ${'─'.repeat(Math.max(0, W - 5 - b.name.length))}╮`, fg: edge },
      ],
    ]
    for (let i = 0; i < tall; i++) {
      const id = b.ids[i]
      if (!id) {
        rows.push([{ text: '│', fg: edge }, blank(inner), { text: '│', fg: edge }])
        continue
      }
      const on = id === chosen
      const label = FORMATS[id].label
      const cell: Run[] = [
        { text: on ? '▌' : ' ', fg: palette.accent },
        blank(1),
        { text: label, fg: palette.fg, bold: on },
        blank(Math.max(0, inner - 2 - label.length)),
      ]
      rows.push([
        { text: '│', fg: edge },
        ...(on ? cell.map((r) => ({ ...r, bg: palette.listBand })) : cell),
        { text: '│', fg: edge },
      ])
    }
    rows.push([{ text: `╰${'─'.repeat(inner)}╯`, fg: edge }])
    return rows
  })
  return Array.from({ length: tall + 2 }, (_, i) =>
    drawn.flatMap((rows, k) => [...(k ? [blank(GAP)] : []), ...(rows[i] ?? [])]),
  )
}

/** The line under the boxes: the chosen format, then what is in it. */
export function mediaDetailRow(palette: Palette, chosen: FormatId, detail: Run[]): Row {
  return [{ text: FORMATS[chosen].label, fg: palette.fg, bold: true }, blank(3), ...detail]
}

/** What the chosen format holds, as its detail line says it. */
export const mediaHint = (id: FormatId): string =>
  id === 'gif' ? '256 colours · no sound' : FORMATS[id].hint
