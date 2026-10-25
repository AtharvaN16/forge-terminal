/**
 * /extensions: the space taken, round two (2026-10-23). The user: "the
 * division should be forge install size and extension size". So the first
 * split is Forge itself — the app, 34.5 MB on disk for 0.4.5 (measured: the
 * image library ~18 MB, the PDF engine ~11 MB) — against its extensions,
 * 52.0 MB; inside the extensions, the tool the cursor is on lights gold.
 *
 * Same captured screens as round one (scripts/extensions-space-capture.tsx).
 *
 *   npx tsx scripts/extensions-space-mockup-r2.ts   → mockups/extensions-space-2026-10-round2.html
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
const OK = '#6fcf7f'
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
const size = (b: number) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${(b / 1000).toFixed(1)} KB`)

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
const APP = '#b0b0b0'
/** An extension the cursor is not on. */
const EXT = '#5f5f5f'
const exts = TOOLS.filter((t) => t.bytes > 0)
const EXTS = total(exts)
const ALL = FORGE + EXTS

/** The bar's cells: Forge, a gap, then each extension, at least a cell each. */
function split(width: number): { forge: number; parts: Array<{ key: string; n: number }> } {
  const forge = Math.round((FORGE / ALL) * (width - 1))
  return { forge, parts: barCells(exts, width - 1 - forge) }
}
const extColour = (key: string, on: string) => (key === on ? GOLD : EXT)
const right = (g: Grid, r: number, text: string, colour = DIM, bold = false) =>
  put(g, r, X + COL - text.length, [[text, colour, undefined, bold]])

/** A · one bar, Forge then a gap then the extensions; a legend of the two, the cursor's tool under its group. */
function a(on: string): Grid {
  const g = G(on)
  put(g, 9, X + 2, [
    [size(ALL), FG, undefined, true],
    ['  on this Mac', DIM],
  ])
  const W = COL - 2
  const { forge, parts } = split(W)
  let at = X + 2
  put(g, 10, at, [[' '.repeat(forge), undefined, APP]])
  at += forge + 1
  for (const p of parts) {
    put(g, 10, at, [[' '.repeat(p.n), undefined, extColour(p.key, on)]])
    at += p.n
  }
  put(g, 12, X + 2, [
    [' ', undefined, APP],
    ['  Forge', DIM],
  ])
  right(g, 12, size(FORGE))
  put(g, 13, X + 2, [
    [' ', undefined, EXT],
    ['  Extensions', DIM],
  ])
  right(g, 13, size(EXTS))
  const t = TOOLS.find((x) => x.key === on)
  if (t && t.bytes > 0) {
    put(g, 14, X + 5, [
      [' ', undefined, GOLD],
      [` ${t.tag}`, FG, undefined, true],
    ])
    right(g, 14, size(t.bytes), FG, true)
  }
  return g
}

/** B · two bars, one per group, against the bigger; the cursor's tool gold inside Extensions. */
function b(on: string): Grid {
  const g = G(on)
  const BAR = 11
  const most = Math.max(FORGE, EXTS)
  const nF = Math.round((FORGE / most) * BAR)
  put(g, 9, X + 2, [['Forge', DIM]])
  put(g, 9, X + 13, [[' '.repeat(nF), undefined, APP]])
  right(g, 9, size(FORGE))
  put(g, 10, X + 2, [['Extensions', DIM]])
  let at = X + 13
  for (const p of barCells(exts, Math.round((EXTS / most) * BAR))) {
    put(g, 10, at, [[' '.repeat(p.n), undefined, extColour(p.key, on)]])
    at += p.n
  }
  right(g, 10, size(EXTS))
  put(g, 12, X + 2, [['Total', QUIET]])
  right(g, 12, size(ALL), FG, true)
  return g
}

/** C · a square a megabyte: Forge's first in its grey, then the extensions', the cursor's in gold. */
function c(on: string): Grid {
  const g = G(on)
  const cells: string[] = []
  for (let i = 0; i < Math.round(FORGE / MB); i++) cells.push(APP)
  for (const t of [...exts].sort((x, y) => y.bytes - x.bytes)) {
    const n = Math.max(1, Math.round(t.bytes / MB))
    for (let i = 0; i < n; i++) cells.push(extColour(t.key, on))
  }
  const PER = 13
  cells.forEach((fg, i) => {
    put(g, 9 + Math.floor(i / PER), X + 2 + (i % PER) * 2, [['▀', fg]])
  })
  const r = 9 + Math.ceil(cells.length / PER)
  put(g, r, X + 2, [
    ['▀', APP],
    [' Forge  ', DIM],
    ['▀', EXT],
    [' Extensions', DIM],
  ])
  put(g, r + 1, X + 2, [
    [size(ALL), FG, undefined, true],
    ['  · a square a MB', QUIET],
  ])
  return g
}

/** Whole units, so a size fits where the ✓ was: "15 MB", "33 KB". */
const short = (n: number) => (n >= MB ? `${Math.round(n / MB)} MB` : `${Math.round(n / 1000)} KB`)

/** D · numbers only: each extension's size in its row, then Forge, Extensions and the total under a rule. */
function d(on: string): Grid {
  const g = G(on)
  TOOLS.forEach((t, i) => {
    const r = 4 + i
    const text = t.yours ? 'yours' : short(t.bytes)
    put(g, r, X + COL - 6, [[' '.repeat(6), undefined, g[r]?.[X + 20]?.bg]])
    put(g, r, X + COL - 1 - text.length, [[text, t.key === on ? FG : QUIET]])
  })
  put(g, 9, X + 2, [['─'.repeat(COL - 3), '#4d4d4d']])
  const row = (r: number, label: string, n: number, bold = false) => {
    put(g, r, X + 2, [[label, bold ? FG : DIM, undefined, bold]])
    const text = short(n)
    put(g, r, X + COL - 1 - text.length, [[text, bold ? FG : DIM, undefined, bold]])
  }
  row(10, 'Forge', FORGE)
  row(11, 'Extensions', EXTS)
  row(13, 'Total', ALL, true)
  return g
}

/** E · with your own yt-dlp: Forge, the extensions still Forge's, and what yours saved, hatched. */
function e(): Grid {
  const g = G('ytOwn')
  const ext = 14_866_325 + 32_600
  const saved = 37_146_048
  const W = COL - 2
  const sum = FORGE + ext + saved
  const nF = Math.round((FORGE / sum) * W)
  const nE = Math.round((ext / sum) * W)
  put(g, 9, X + 2, [
    [size(FORGE + ext), FG, undefined, true],
    ['  on this Mac', DIM],
  ])
  put(g, 10, X + 2, [
    [' '.repeat(nF), undefined, APP],
    [' '],
    [' '.repeat(nE), undefined, EXT],
    ['╱'.repeat(W - nF - nE - 1), OK],
  ])
  put(g, 12, X + 2, [
    [' ', undefined, APP],
    ['  Forge', DIM],
  ])
  right(g, 12, size(FORGE))
  put(g, 13, X + 2, [
    [' ', undefined, EXT],
    ['  Extensions', DIM],
  ])
  right(g, 13, size(ext))
  put(g, 14, X + 2, [
    ['╱', OK],
    ['  saved by yours', DIM],
  ])
  right(g, 14, size(saved), OK, true)
  return g
}

/* --------------------------------------------------------------- page */

/** The list's side of the screen, where the graphic lives. */
const crop = (g: Grid): Grid => g.slice(1, 18).map((r) => r.slice(2, 66))
const shot = (g: Grid) => termHtml(P, crop(g))
const fig = (g: Grid, cap: string) =>
  `<figure class="fr">${shot(g)}<figcaption>${cap}</figcaption></figure>`
const pair = (...f: string[]) => `<div class="pair">${f.join('')}</div>`

const concepts: PageConcept[] = [
  {
    id: 'A2',
    section:
      'OPTIONS — Forge itself, then its extensions. Cursor on YouTube links: its part of Extensions lights gold. Pick one.',
    name: 'One bar: Forge | Extensions',
    idea: 'The total, one bar split in two by a gap — Forge in light grey, the extensions after it — then a legend of the two. The cursor’s tool sits under Extensions, in gold.',
    html: pair(fig(a('yt'), 'cursor on YouTube links'), fig(a('boost'), 'cursor on Boost')),
  },
  {
    id: 'B2',
    name: 'Two bars, one per group',
    idea: 'Forge and Extensions each get a bar against the bigger of the two, their sizes at the end, the total under them. The cursor’s tool is the gold share of the Extensions bar.',
    html: pair(fig(b('yt'), 'cursor on YouTube links'), fig(b('boost'), 'cursor on Boost')),
  },
  {
    id: 'C2',
    name: 'One square a megabyte',
    idea: 'Forge’s 35 squares first, in its grey; the extensions’ after, the cursor’s tool in gold. The two parts are something you can count.',
    html: pair(fig(c('yt'), 'cursor on YouTube links'), fig(c('boost'), 'cursor on Boost')),
  },
  {
    id: 'D2',
    name: 'Just the numbers',
    idea: 'Each extension’s size where its ✓ was; under a rule, Forge, Extensions, and the total. No graphic at all.',
    html: pair(fig(d('yt'), 'cursor on YouTube links'), fig(d('boost'), 'cursor on Boost')),
  },
  {
    id: 'E2',
    section: 'AND — once you use your own yt-dlp',
    name: 'What yours saved',
    idea: 'Forge, the extensions that are still Forge’s, and — hatched in green — the 37.1 MB your own yt-dlp saved. Goes with any of A–D.',
    html: pair(fig(e(), 'yt-dlp is yours')),
  },
]

const before = `<div class="box"><h3>What changed</h3>
<p>The split is now <b>Forge itself</b> against <b>its extensions</b>. Forge 0.4.5 takes 34.5 MB on disk, measured on this Mac (most of it the image library and the PDF engine). The extensions take 52.0 MB: Boost 14.9 MB, Remove background 32.6 KB, yt-dlp 37.1 MB; ffmpeg is your own, so it takes nothing of Forge’s. Forge is the light grey; inside the extensions, the tool the cursor is on is gold.</p></div>
<div class="box"><h3>Words to approve</h3><p>“on this Mac” · “Forge” · “Extensions” · “Total” · “a square a MB” · “saved by yours” · the tool names Boost, Cutout, yt-dlp (A).</p></div>
<style>
.pair{display:flex;flex-direction:column;gap:14px}
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr figcaption{font-size:13px;color:#a9aebb}
</style>`

writeFileSync(
  'mockups/extensions-space-2026-10-round2.html',
  feedbackPage({
    page: 'extensions-space-2026-10-round2',
    title: 'Forge · space: Forge and its extensions',
    heading: '/extensions — Forge and its extensions',
    lede: 'The first split is Forge itself against its extensions. Four ways to draw it under the list, and the saving from using your own copy.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/extensions-space-2026-10-round2.html')
if (process.env.DUMP)
  for (const g of [a('yt'), b('yt'), c('yt'), d('yt'), e()])
    console.log(
      `${g
        .slice(8, 18)
        .map((r) =>
          r
            .slice(4, 40)
            .map((x) => x.ch)
            .join(''),
        )
        .join('\n')}\n${'='.repeat(36)}`,
    )
