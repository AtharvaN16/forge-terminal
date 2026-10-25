/**
 * /extensions: the space taken, round three (2026-10-23). From round two the
 * user kept D2 (numbers only) and asked for more options, simple and not
 * distracting, with no size per extension. So every new option says three
 * things at most — Forge, Extensions, the total — in quiet greys with white
 * numbers, and nothing follows the cursor.
 *
 * D2 is carried as drawn, badged. Same captured screens as rounds one and two.
 *
 *   npx tsx scripts/extensions-space-mockup-r3.ts   → mockups/extensions-space-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./extensions-space-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const G = (k: string): Grid =>
  (frames[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

const P = modePalette(DARK, 'menu')
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const GOLD = '#e5a23c'
const _OK = '#6fcf7f'
/** Pure greys for the tools the cursor is not on, brightest for the biggest. */
const GREYS = ['#8c8c8c', '#666666', '#4f4f4f']
/** The list's column: names start at 10, the column is 8–34. */
const X = 8
const COL = 27

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
function put(g: Grid, r: number, at: number, segs: Seg[]): void {
  const row = g[r] as Cell[]
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg, b: !!bold }
      i++
    }
}

interface Tool {
  key: string
  name: string
  tag: string
  bytes: number
  yours?: boolean
}
const MB = 1_000_000
const TOOLS: Tool[] = [
  { key: 'boost', name: 'Boost resolution', tag: 'Boost', bytes: 14_866_325 },
  { key: 'cutout', name: 'Remove background', tag: 'Cutout', bytes: 32_600 },
  { key: 'yt', name: 'YouTube links', tag: 'yt-dlp', bytes: 37_146_048 },
  { key: 'video', name: 'Video and audio', tag: 'ffmpeg', bytes: 0, yours: true },
]
const _size = (b: number) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${(b / 1000).toFixed(1)} KB`)

/** Each tool's colour: gold on the cursor's, greys by size for the rest. */
function _colours(on: string, tools: Tool[]): Record<string, string> {
  const rest = tools.filter((t) => t.key !== on && t.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const out: Record<string, string> = { [on]: GOLD }
  rest.forEach((t, i) => {
    out[t.key] = GREYS[Math.min(i, GREYS.length - 1)] as string
  })
  return out
}

/**
 * A bar `width` cells long split by bytes, each tool at least one cell when
 * it has any (a sliver, so a 32 KB tool is still there to point at).
 */
function barCells(tools: Tool[], width: number): Array<{ key: string; n: number }> {
  const real = tools.filter((t) => t.bytes > 0)
  const total = real.reduce((s, t) => s + t.bytes, 0)
  const parts = real.map((t) => ({
    key: t.key,
    n: Math.max(1, Math.round((t.bytes / total) * width)),
  }))
  let over = parts.reduce((s, p) => s + p.n, 0) - width
  for (const p of [...parts].sort((a, b) => b.n - a.n)) {
    if (over <= 0) break
    const take = Math.min(over, p.n - 1)
    p.n -= take
    over -= take
  }
  return parts
}

const total = (tools: Tool[]) => tools.reduce((s, t) => s + t.bytes, 0)

/* ---------------------------------------------- Forge | Extensions */

/** Forge 0.4.5 as installed, measured on disk (npm's global folder): 34.5 MB. */
const FORGE = 34_500_000
/** Forge itself: the lightest grey, apart from every extension. */
const _APP = '#b0b0b0'
/** An extension the cursor is not on. */
const EXT = '#5f5f5f'
const exts = TOOLS.filter((t) => t.bytes > 0)
const EXTS = total(exts)
const ALL = FORGE + EXTS

/** The bar's cells: Forge, a gap, then each extension, at least a cell each. */
function _split(width: number): { forge: number; parts: Array<{ key: string; n: number }> } {
  const forge = Math.round((FORGE / ALL) * (width - 1))
  return { forge, parts: barCells(exts, width - 1 - forge) }
}
const _extColour = (key: string, on: string) => (key === on ? GOLD : EXT)
const _right = (g: Grid, r: number, text: string, colour = DIM, bold = false) =>
  put(g, r, X + COL - text.length, [[text, colour, undefined, bold]])

/** Whole units, as D2 has them: "35 MB". */
const short = (n: number) => (n >= MB ? `${Math.round(n / MB)} MB` : `${Math.round(n / 1000)} KB`)
const RULE = '#4d4d4d'
/** Column end for right-aligned numbers: a cell short of the list's edge, as D2. */
const END = X + COL - 1
const atEnd = (g: Grid, r: number, segs: Seg[]) =>
  put(g, r, END - segs.reduce((n, [t]) => n + [...t].length, 0), segs)

/** D2 as drawn in round two: each extension's size in its row, then Forge, Extensions, the total. */
function d2(): Grid {
  const g = G('yt')
  TOOLS.forEach((t, i) => {
    const r = 4 + i
    const text = t.yours ? 'yours' : short(t.bytes)
    put(g, r, X + COL - 6, [[' '.repeat(6), undefined, g[r]?.[X + 20]?.bg]])
    put(g, r, END - text.length, [[text, t.key === 'yt' ? FG : QUIET]])
  })
  put(g, 9, X + 2, [['─'.repeat(COL - 3), RULE]])
  const row = (r: number, label: string, n: number, bold = false) => {
    put(g, r, X + 2, [[label, bold ? FG : DIM, undefined, bold]])
    atEnd(g, r, [[short(n), bold ? FG : DIM, undefined, bold]])
  }
  row(10, 'Forge', FORGE)
  row(11, 'Extensions', EXTS)
  row(13, 'Total', ALL, true)
  return g
}

/** N1 · D2 without the sizes in the rows: the rule, Forge, Extensions, the total. */
function n1(): Grid {
  const g = G('yt')
  put(g, 9, X + 2, [['─'.repeat(COL - 3), RULE]])
  put(g, 10, X + 2, [['Forge', DIM]])
  atEnd(g, 10, [[short(FORGE), DIM]])
  put(g, 11, X + 2, [['Extensions', DIM]])
  atEnd(g, 11, [[short(EXTS), DIM]])
  put(g, 13, X + 2, [['Total', FG, undefined, true]])
  atEnd(g, 13, [[short(ALL), FG, undefined, true]])
  return g
}

/** N2 · two quiet lines, nothing else: no rule, no total. */
function n2(): Grid {
  const g = G('yt')
  put(g, 9, X + 2, [['Forge', QUIET]])
  atEnd(g, 9, [[short(FORGE), DIM]])
  put(g, 10, X + 2, [['Extensions', QUIET]])
  atEnd(g, 10, [[short(EXTS), DIM]])
  return g
}

/** N3 · the total, and under it what it is made of, fainter. */
function n3(): Grid {
  const g = G('yt')
  put(g, 9, X + 2, [
    [short(ALL), FG, undefined, true],
    [' on this Mac', DIM],
  ])
  put(g, 10, X + 2, [
    [`${Math.round(FORGE / MB)} Forge`, QUIET],
    [' · ', RULE],
    [`${Math.round(EXTS / MB)} extensions`, QUIET],
  ])
  return g
}

/** N4 · two figures side by side, the label over the number. */
function n4(): Grid {
  const g = G('yt')
  put(g, 9, X + 2, [['Forge', QUIET]])
  put(g, 9, X + 15, [['Extensions', QUIET]])
  put(g, 10, X + 2, [[short(FORGE), FG, undefined, true]])
  put(g, 10, X + 15, [[short(EXTS), FG, undefined, true]])
  return g
}

/** N5 · a thin line in two greys, each end's label and figure under it. */
function n5(): Grid {
  const g = G('yt')
  const W = COL - 3
  const nF = Math.round((FORGE / ALL) * W)
  // ▄: half a cell tall, so the line stays thin.
  put(g, 9, X + 2, [
    ['▄'.repeat(nF), '#9a9a9a'],
    ['▄'.repeat(W - nF), '#555555'],
  ])
  put(g, 10, X + 2, [['Forge', QUIET]])
  atEnd(g, 10, [['Extensions', QUIET]])
  put(g, 11, X + 2, [[short(FORGE), DIM]])
  atEnd(g, 11, [[short(EXTS), DIM]])
  return g
}

/** N6 · at the foot of the list's column, out of the way, where the panel ends. */
function n6(): Grid {
  const g = G('yt')
  put(g, 15, X + 2, [['─'.repeat(COL - 3), RULE]])
  put(g, 16, X + 2, [['Forge', QUIET]])
  atEnd(g, 16, [[short(FORGE), DIM]])
  put(g, 17, X + 2, [['Extensions', QUIET]])
  atEnd(g, 17, [[short(EXTS), DIM]])
  return g
}

/** N7 · the total alone, the rule above it; Forge and Extensions only in i about. */
function n7(): Grid {
  const g = G('yt')
  put(g, 9, X + 2, [['─'.repeat(COL - 3), RULE]])
  put(g, 10, X + 2, [['Space', QUIET]])
  atEnd(g, 10, [[short(ALL), DIM]])
  return g
}

/* --------------------------------------------------------------- page */

/** The list's side of the screen, where the numbers live. */
const crop = (g: Grid): Grid => g.slice(1, 18).map((r) => r.slice(2, 66))
const shot = (g: Grid) => termHtml(P, crop(g))

const concepts: PageConcept[] = [
  {
    id: 'D2',
    earlier: 'love',
    section: 'YOUR PICK FROM ROUND 2',
    name: 'Just the numbers',
    idea: 'As drawn in round two: each extension’s size in its row, then Forge, Extensions, the total.',
    html: shot(d2()),
  },
  {
    id: 'N1',
    section:
      'NEW — Forge, Extensions, the total at most. No size per extension, nothing follows the cursor. Pick one.',
    name: 'D2, without the row sizes',
    idea: 'D2 as you liked it, less the size in each row: the rows keep their ✓; under a rule, Forge, Extensions, and the total.',
    html: shot(n1()),
  },
  {
    id: 'N2',
    name: 'Two quiet lines',
    idea: 'Right under the list, Forge and Extensions with their sizes, in the list’s own greys. No rule, no total.',
    html: shot(n2()),
  },
  {
    id: 'N3',
    name: 'The total, then what it is',
    idea: '87 MB on this Mac in white, and under it, fainter: 35 Forge · 52 extensions.',
    html: shot(n3()),
  },
  {
    id: 'N4',
    name: 'Two figures, label over number',
    idea: 'Forge and Extensions side by side, each a quiet label over its number. Reads like a stat at a glance.',
    html: shot(n4()),
  },
  {
    id: 'N5',
    name: 'A thin line in two greys',
    idea: 'The only graphic left: a thin bar, Forge’s part lighter, the extensions’ darker; each end’s label and size under it.',
    html: shot(n5()),
  },
  {
    id: 'N6',
    name: 'At the foot of the column',
    idea: 'Forge and Extensions moved down to where the panel ends, under a rule — out of the way of the list entirely.',
    html: shot(n6()),
  },
  {
    id: 'N7',
    name: 'The total only',
    idea: 'One row under a rule: Space 87 MB. The split into Forge and Extensions would live in i about.',
    html: shot(n7()),
  },
]

const before = `<div class="box"><h3>What changed</h3>
<p>D2 stays, badged. Everything else from round two is gone. The new options say at most three things — Forge (34.5 MB), Extensions (52.0 MB), the total — rounded to whole megabytes as D2 is, in quiet greys with white numbers. No size per extension, and nothing changes as the cursor moves.</p></div>
<div class="box"><h3>Words to approve</h3><p>“Forge” · “Extensions” · “Total” · “on this Mac” (N3) · “Space” (N7).</p></div>`

writeFileSync(
  'mockups/extensions-space-2026-10-round3.html',
  feedbackPage({
    page: 'extensions-space-2026-10-round3',
    title: 'Forge · space, round 3',
    heading: '/extensions — the space, simply',
    lede: 'Your D2, then seven quieter ways: Forge and Extensions only, no size per extension.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/extensions-space-2026-10-round3.html')
if (process.env.DUMP)
  for (const g of [d2(), n1(), n2(), n3(), n4(), n5(), n6(), n7()])
    console.log(
      `${g
        .slice(3, 18)
        .map((r) =>
          r
            .slice(4, 40)
            .map((x) => x.ch)
            .join(''),
        )
        .join('\n')}\n${'='.repeat(36)}`,
    )
