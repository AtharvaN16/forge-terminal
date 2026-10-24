/**
 * What PP-OCR finds is lines; what Forge's page layout takes is what Vision's
 * document reader gives — paragraphs, lists and tables, each with a box
 * (core/transcribe/page-text.ts). This turns one into the other, for one
 * page, in its pixels. Forge still orders the blocks and picks the headings.
 */

export interface OcrLine {
  text: string
  /** The text itself, tight: x, y, width, height in the page's pixels. */
  box: readonly [number, number, number, number]
}

type Box = readonly [number, number, number, number]

export type Block =
  | { kind: 'text'; text: string; title: boolean; lines: number; lineHeight: number; box: Box }
  | { kind: 'list'; items: Array<{ marker: Marker; text: string }>; box: Box }
  | { kind: 'table'; rows: string[][]; box: Box }

type Marker = 'bullet' | 'hyphen' | 'decimal' | 'lowercase' | 'uppercase'

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number)
}

const right = (b: Box) => b[0] + b[2]
const bottom = (b: Box) => b[1] + b[3]

function union(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b[0]))
  const y0 = Math.min(...boxes.map((b) => b[1]))
  const x1 = Math.max(...boxes.map(right))
  const y1 = Math.max(...boxes.map(bottom))
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Lines that share a band across the page, left to right. */
function rowsOf(lines: readonly OcrLine[]): OcrLine[][] {
  const rows: OcrLine[][] = []
  for (const line of [...lines].sort(
    (a, b) => a.box[1] + a.box[3] / 2 - (b.box[1] + b.box[3] / 2),
  )) {
    const mid = line.box[1] + line.box[3] / 2
    const row = rows.find((r) => {
      const first = r[0] as OcrLine
      const rMid = first.box[1] + first.box[3] / 2
      return Math.abs(rMid - mid) < Math.min(first.box[3], line.box[3]) * 0.5
    })
    if (row) row.push(line)
    else rows.push([line])
  }
  for (const r of rows) r.sort((a, b) => a.box[0] - b.box[0])
  return rows.sort((a, b) => (a[0] as OcrLine).box[1] - (b[0] as OcrLine).box[1])
}

/**
 * Tables: three or more rows in a run, each with two or more cells, whose
 * cells start at the same places down the page. Their lines are taken out of
 * the paragraphs.
 */
function tablesOf(
  rows: readonly OcrLine[][],
  body: number,
): { tables: Block[]; used: Set<OcrLine> } {
  const used = new Set<OcrLine>()
  const tables: Block[] = []
  const lefts = (r: readonly OcrLine[]) => r.map((l) => l.box[0])
  const aligned = (a: readonly OcrLine[], b: readonly OcrLine[]) => {
    if (a.length !== b.length || a.length < 2) return false
    const la = lefts(a)
    const lb = lefts(b)
    // Left edges, or right edges for numbers set right, within two line heights.
    return a.every((l, i) => {
      const m = b[i] as OcrLine
      return (
        Math.abs((la[i] as number) - (lb[i] as number)) < body * 2 ||
        Math.abs(right(l.box) - right(m.box)) < body * 2
      )
    })
  }
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && aligned(rows[i] as OcrLine[], rows[j] as OcrLine[])) j++
    // Prose set in columns lines up too; a table's cells are short.
    const words = rows
      .slice(i, j)
      .flat()
      .map((l) => l.text.split(/\s+/).length)
    if (j - i >= 3 && median(words) <= 4) {
      const run = rows.slice(i, j)
      for (const r of run) for (const l of r) used.add(l)
      tables.push({
        kind: 'table',
        rows: run.map((r) => r.map((l) => l.text)),
        box: union(run.flat().map((l) => l.box)),
      })
      i = j
    } else i++
  }
  return { tables, used }
}

const BULLET = /^([•·▪◦‣∙*]|[-–—])\s+(.*)$/u
const WEAK_BULLET = /^[.,]\s+\S/

const NUMBERED = /^((\d{1,3})|([a-z])|([A-Z]))[.)]\s+(.*)$/

function markerFor(text: string): { marker: Marker; rest: string } | undefined {
  if (WEAK_BULLET.test(text)) return { marker: 'bullet', rest: text.slice(1).trim() }
  const b = BULLET.exec(text)
  if (b) return { marker: /[-–—]/.test(b[1] as string) ? 'hyphen' : 'bullet', rest: b[2] as string }
  const n = NUMBERED.exec(text)
  if (n)
    return { marker: n[2] ? 'decimal' : n[3] ? 'lowercase' : 'uppercase', rest: n[5] as string }
  return undefined
}

/** Lines joined as prose: a word broken by a hyphen at a line's end is mended. */
function join(texts: readonly string[]): string {
  let out = ''
  for (const t of texts) {
    if (out === '') out = t
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t
    else out = `${out} ${t}`
  }
  return out
}

/**
 * Paragraphs: lines one under another — close in height, the gap under the
 * last less than a line, overlapping across — read top to bottom. A list is
 * a paragraph whose lines start with markers; a line without one goes on the
 * item above it.
 */
/**
 * A numbered line is a list item only beside its neighbour in the count: the
 * next number (or the one before) starting where it does, a line or two away.
 * Prose wraps onto "15. Column…" now and then; a list counts on.
 */
function listLines(lines: readonly OcrLine[]): Set<OcrLine> {
  const out = new Set<OcrLine>()
  const numbered = lines.flatMap((l) => {
    const n = /^(\d{1,3})[.)]\s/.exec(l.text)
    return n ? [{ l, n: Number(n[1]) }] : []
  })
  for (const l of lines) if (BULLET.test(l.text)) out.add(l)
  // A bullet read as a full stop or comma: a list item only between bullets.
  for (const l of lines)
    if (
      WEAK_BULLET.test(l.text) &&
      [...out].some(
        (b) =>
          Math.abs(b.box[0] - l.box[0]) < l.box[3] &&
          Math.abs(b.box[1] - l.box[1]) < l.box[3] * 2.5,
      )
    )
      out.add(l)
  for (const a of numbered)
    if (
      numbered.some(
        (b) =>
          Math.abs(b.n - a.n) === 1 &&
          Math.abs(b.l.box[0] - a.l.box[0]) < a.l.box[3] &&
          Math.abs(b.l.box[1] - a.l.box[1]) < a.l.box[3] * 3.5,
      )
    )
      out.add(a.l)
  return out
}

function paragraphsOf(lines: readonly OcrLine[], page: { height: number }): Block[] {
  const listed = listLines(lines)
  const markerOf = (l: OcrLine) => (listed.has(l) ? markerFor(l.text) : undefined)
  const left = [...lines].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
  const groups: OcrLine[][] = []
  for (const line of left) {
    const marked = markerOf(line) !== undefined
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1] as OcrLine
      const first = grp[0] as OcrLine
      const gap = line.box[1] - bottom(last.box)
      const overlap =
        Math.min(right(last.box), right(line.box)) - Math.max(last.box[0], line.box[0])
      // Against the paragraph's usual line: descenders vary a line by a fifth, a heading by more.
      const usual = median(grp.map((l) => l.box[3]))
      const similar = Math.abs(line.box[3] - usual) < usual * 0.25
      // A gap well over the paragraph's own leading is a break: the space before a heading.
      const gaps = grp.slice(1).map((l, k) => l.box[1] - bottom((grp[k] as OcrLine).box))
      const leading = gaps.length > 0 ? median(gaps) : undefined
      const steady =
        leading === undefined || gap < Math.max(leading * 1.6, leading + line.box[3] * 0.25)
      // Taller than the paragraph's lines and less than half as wide: a heading, not its next line.
      const width = Math.max(...grp.map((l) => l.box[2]))
      const heading = line.box[3] > usual * 1.12 && line.box[2] < width * 0.5
      const fits =
        gap >= -line.box[3] * 0.3 &&
        gap < line.box[3] * 0.9 &&
        overlap > 0 &&
        similar &&
        steady &&
        !heading
      if (!fits) return false
      const list = markerOf(first) !== undefined
      // A marked line goes on a list whose items start where it does; prose never takes one.
      if (marked) return list && Math.abs(line.box[0] - first.box[0]) < line.box[3]
      // An unmarked line goes on prose, or on a list item it is indented under.
      return !list || line.box[0] > first.box[0] + line.box[3] * 0.3
    })
    if (g) g.push(line)
    else groups.push([line])
  }
  return groups.map((g): Block => {
    const box = union(g.map((l) => l.box))
    if (g.some((l) => markerOf(l) !== undefined)) {
      const items: Array<{ marker: Marker; text: string }> = []
      for (const l of g) {
        const m = markerOf(l)
        if (m) items.push({ marker: m.marker, text: m.rest })
        else if (items.length > 0) {
          const last = items[items.length - 1] as { marker: Marker; text: string }
          last.text = join([last.text, l.text])
        } else items.push({ marker: 'bullet', text: l.text })
      }
      return { kind: 'list', items, box }
    }
    return {
      kind: 'text',
      text: join(g.map((l) => l.text)),
      title: false,
      lines: g.length,
      lineHeight: median(g.map((l) => l.box[3])) / page.height,
      box,
    }
  })
}

/**
 * The page's blocks, boxes normalised to it. The page's title is a short
 * block at the top, set larger than anything else on it, as Vision's is.
 */
export function blocksOf(
  lines: readonly OcrLine[],
  page: { width: number; height: number },
): Block[] {
  if (lines.length === 0) return []
  const body = median(lines.map((l) => l.box[3]))
  const { tables, used } = tablesOf(rowsOf(lines), body)
  const blocks = [
    ...tables,
    ...paragraphsOf(
      lines.filter((l) => !used.has(l)),
      page,
    ),
  ]
  const texts = blocks.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
  const top = [...texts].sort((a, b) => a.box[1] - b.box[1])[0]
  const tallest = Math.max(...texts.map((t) => t.lineHeight))
  if (
    top &&
    top.lines <= 2 &&
    top.lineHeight === tallest &&
    top.lineHeight * page.height > body * 1.25
  )
    top.title = true
  const norm = (b: Box): Box => [
    b[0] / page.width,
    b[1] / page.height,
    b[2] / page.width,
    b[3] / page.height,
  ]
  return blocks.map((b) => ({ ...b, box: norm(b.box) }))
}
