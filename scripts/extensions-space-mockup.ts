/**
 * /extensions: how much space the tools take, drawn under the list
 * (2026-10-23). Five ways, each over the real screen captured with the
 * tools at their real sizes (scripts/extensions-space-capture.tsx): Boost
 * 14.9 MB, Remove background 32.6 KB, yt-dlp 37.1 MB of Forge's, ffmpeg the
 * user's own. In every one, the tool the cursor is on lights in the menu's
 * gold; the rest stay grey (the user dislikes colour overload).
 *
 * References (Mobbin): WhatsApp's Manage storage (a total, a bar, a legend),
 * Google One and SoundCloud (one bar over sized rows), PlayStation (each
 * item's own size).
 *
 *   npx tsx scripts/extensions-space-mockup.ts   → mockups/extensions-space-2026-10.html
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
function colours(on: string, tools: Tool[]): Record<string, string> {
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

/* ------------------------------------------------------------ the five */

/** A · WhatsApp's: the total, one bar, a legend with each size. */
function a(on: string): Grid {
  const g = G(on)
  const c = colours(on, TOOLS)
  put(g, 9, X + 2, [
    [size(total(TOOLS)), FG, undefined, true],
    ['  on this Mac', DIM],
  ])
  let at = X + 2
  for (const p of barCells(TOOLS, COL - 2)) {
    put(g, 10, at, [[' '.repeat(p.n), undefined, c[p.key]]])
    at += p.n
  }
  TOOLS.forEach((t, i) => {
    const r = 12 + i
    const mark: Seg = t.yours ? ['  ', undefined] : [' ', undefined, c[t.key]]
    const right = t.yours ? 'yours' : size(t.bytes)
    put(g, r, X + 2, [
      mark,
      [t.yours ? '' : ' '],
      [t.tag, t.key === on ? FG : DIM, undefined, t.key === on],
    ])
    put(g, r, X + COL - right.length, [[right, t.key === on ? FG : DIM, undefined, t.key === on]])
  })
  return g
}

/** B · one bar per tool, the PlayStation way: each its own length, its own size. */
function b(on: string): Grid {
  const g = G(on)
  const most = Math.max(...TOOLS.map((t) => t.bytes))
  const BAR = 10
  TOOLS.forEach((t, i) => {
    const r = 9 + i
    const me = t.key === on
    put(g, r, X + 2, [[t.tag.padEnd(7), me ? FG : DIM, undefined, me]])
    if (t.yours) {
      put(g, r, X + 9, [['yours', QUIET]])
      return
    }
    const n = Math.max(1, Math.round((t.bytes / most) * BAR))
    put(g, r, X + 9, [
      [' '.repeat(n), undefined, me ? GOLD : GREYS[1]],
      [' '.repeat(BAR - n), undefined, '#3a3a3a'],
    ])
    const s = size(t.bytes)
    put(g, r, X + COL - s.length, [[s, me ? FG : DIM, undefined, me]])
  })
  put(g, 14, X + 2, [['Total', QUIET]])
  const t = size(total(TOOLS))
  put(g, 14, X + COL - t.length, [[t, FG, undefined, true]])
  return g
}

/** C · a waffle: one cell a megabyte, so the size is something to count. */
function c(on: string): Grid {
  const g = G(on)
  const col = colours(on, TOOLS)
  const cells: string[] = []
  for (const t of [...TOOLS].filter((x) => x.bytes > 0).sort((x, y) => y.bytes - x.bytes)) {
    const n = Math.max(1, Math.round(t.bytes / MB))
    for (let i = 0; i < n; i++) cells.push(col[t.key] as string)
  }
  const PER = 13
  cells.forEach((bg, i) => {
    const r = 9 + Math.floor(i / PER)
    const x = X + 2 + (i % PER) * 2
    // The top half of the cell: about square, with a gap under it and beside it.
    put(g, r, x, [['▀', bg]])
  })
  const rows = Math.ceil(cells.length / PER)
  put(g, 9 + rows + 1, X + 2, [
    [size(total(TOOLS)), FG, undefined, true],
    ['  · a square a MB', QUIET],
  ])
  return g
}

/** Whole units, so a size fits where the ✓ was: "15 MB", "33 KB". */
const short = (b: number) => (b >= MB ? `${Math.round(b / MB)} MB` : `${Math.round(b / 1000)} KB`)

/** D · just the numbers: each row says its size where the ✓ was, the total under them. */
function d(on: string): Grid {
  const g = G(on)
  TOOLS.forEach((t, i) => {
    const r = 4 + i
    const right = t.yours ? 'yours' : short(t.bytes)
    const me = t.key === on
    put(g, r, X + COL - 6, [[' '.repeat(6), undefined, g[r]?.[X + 20]?.bg]])
    put(g, r, X + COL - 1 - right.length, [[right, me ? FG : QUIET, undefined, false]])
  })
  put(g, 9, X + 2, [['─'.repeat(COL - 3), '#4d4d4d']])
  const s = short(total(TOOLS))
  put(g, 10, X + 2, [['Total', QUIET]])
  put(g, 10, X + COL - 1 - s.length, [[s, FG, undefined, true]])
  return g
}

/** E · what using yours saved: Forge's bytes solid, the space yours saved hatched beside them. */
function e(): Grid {
  const g = G('ytOwn')
  const used = 14_866_325 + 32_600
  const saved = 37_146_048
  const W = COL - 2
  const nUsed = Math.round((used / (used + saved)) * W)
  put(g, 9, X + 2, [
    [size(used), FG, undefined, true],
    ['  on this Mac', DIM],
  ])
  put(g, 10, X + 2, [
    [' '.repeat(nUsed), undefined, GREYS[1]],
    ['╱'.repeat(W - nUsed), OK],
  ])
  put(g, 12, X + 2, [
    [' ', undefined, GREYS[1]],
    ['  Forge’s tools', DIM],
  ])
  put(g, 12, X + COL - size(used).length, [[size(used), DIM]])
  put(g, 13, X + 2, [
    ['╱', OK],
    ['  saved by yours', DIM],
  ])
  put(g, 13, X + COL - size(saved).length, [[size(saved), OK, undefined, true]])
  return g
}

/* --------------------------------------------------------------- page */

/** The list's side of the screen, where the graphic lives: the bar's row down to the panel's end. */
const crop = (g: Grid): Grid => g.slice(1, 18).map((r) => r.slice(2, 66))
const shot = (g: Grid) => termHtml(P, crop(g))
const fig = (g: Grid, cap: string) =>
  `<figure class="fr">${shot(g)}<figcaption>${cap}</figcaption></figure>`
const pair = (...f: string[]) => `<div class="pair">${f.join('')}</div>`

const concepts: PageConcept[] = [
  {
    id: 'A',
    section:
      'OPTIONS — the space the tools take, under the list. Cursor on YouTube links; its part lights gold. Pick one.',
    name: 'A total, one bar, a legend',
    idea: 'WhatsApp’s storage screen: the total first, one bar split by tool, then each tool’s size. Reads top-down: how much, what of it, which.',
    html: pair(
      fig(a('yt'), 'cursor on YouTube links'),
      fig(a('boost'), 'cursor on Boost — its part lights instead'),
    ),
  },
  {
    id: 'B',
    name: 'A bar per tool',
    idea: 'Each tool its own bar against the biggest, its size at the end, the total under them. Easiest to compare two tools; no legend to match colours against.',
    html: pair(fig(b('yt'), 'cursor on YouTube links'), fig(b('boost'), 'cursor on Boost')),
  },
  {
    id: 'C',
    name: 'One square a megabyte',
    idea: 'A waffle: 52 squares for 52 MB, the cursor’s tool in gold. The size becomes something you can count; 32 KB still gets its one square.',
    html: pair(fig(c('yt'), 'cursor on YouTube links'), fig(c('boost'), 'cursor on Boost')),
  },
  {
    id: 'D',
    name: 'Just the numbers',
    idea: 'No graphic: each list row says its size where the ✓ was (“yours” for your own copies), a rule, and the total. The quietest; the list itself is the chart.',
    html: pair(fig(d('yt'), 'cursor on YouTube links'), fig(d('boost'), 'cursor on Boost')),
  },
  {
    id: 'E',
    section: 'AND — once you use your own yt-dlp',
    name: 'What yours saved',
    idea: 'Ties to using your own tools: Forge’s bytes solid, the space your own yt-dlp saved hatched in green beside them. Goes with any of A–D, or on its own.',
    html: pair(fig(e(), 'yt-dlp is yours: 37.1 MB not downloaded')),
  },
]

const before = `<div class="box"><h3>What this is</h3>
<p>Under the list in /extensions, how much space Forge’s tools take. Real sizes: Boost 14.9 MB, Remove background 32.6 KB, yt-dlp 37.1 MB; ffmpeg is your own (Homebrew), so it takes nothing of Forge’s. In every option the tool the cursor is on lights in the menu’s gold; the rest stay grey.</p>
<p class="note">References: <a href="https://mobbin.com/screens/ebf83f57-3966-439a-bae2-63e77e25846a">WhatsApp · Manage storage</a> (total, bar, legend) · <a href="https://mobbin.com/screens/9887379e-abd7-42c1-ac14-0b2809caf976">Google One</a> and <a href="https://mobbin.com/screens/04ffeafa-4fd7-4553-b2ee-4e2695f67667">SoundCloud</a> (one bar over sized rows) · <a href="https://mobbin.com/screens/7594dd9f-306b-4549-9aee-ed20061bde20">PlayStation</a> (each item’s own size).</p></div>
<div class="box"><h3>Words to approve</h3><p>“on this Mac” (A, E) · the short names Boost, Cutout, yt-dlp, ffmpeg (A–C) · “yours” (A, B, D) · “Total” (B, D) · “a square a MB” (C) · “Forge’s tools”, “saved by yours” (E).</p></div>
<style>
.pair{display:flex;flex-direction:column;gap:14px}
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr figcaption{font-size:13px;color:#a9aebb}
.box .note{color:#a9aebb}
.box a{color:#8fe3f0}
</style>`

writeFileSync(
  'mockups/extensions-space-2026-10.html',
  feedbackPage({
    page: 'extensions-space-2026-10',
    title: 'Forge · how much space the extensions take',
    heading: '/extensions — the space they take',
    lede: 'Five ways to show it under the list, over the real screen at real sizes.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/extensions-space-2026-10.html')
if (process.env.DUMP)
  for (const g of [a('yt'), b('yt'), c('yt'), d('yt'), e()])
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
