/**
 * Your own tools, round two (2026-10-22). Round one (own-tools-2026-10.html)
 * was drawn at 80 columns, where /extensions stacks its sheet under the list,
 * and spent three tabs on transcribe; none of it landed. This round:
 *
 * - 100 columns, so /extensions is the split layout the user knows;
 * - one model for every tool Forge uses, not one per mode;
 * - the "needs a tool" words leave the YouTube card for the menu row (the
 *   user's idea), with two other places beside it.
 *
 * Frames from scripts/own-tools-r2-capture.tsx; only changed cells redrawn.
 *
 *   npx tsx scripts/own-tools-mockup-r2.ts   → mockups/own-tools-2026-10-round2.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./own-tools-r2-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const G = (k: string): Grid =>
  (frames[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

const P = modePalette(DARK, 'transcribe')
const N = 100
const L = 4
const R = N - 4
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const FAINT = '#4d4d4d'
const OK = '#6fcf7f'
const GOLD = '#e5a23c'
const PANEL = '#2c2c2c'
const BAND = '#323232'
const FIELD = '#242424'
const CAP = '#333333'
const CANVAS = '#1e1e1e'
const PILL = '#e7e7e7'
const INK = '#0c1d22'

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)

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
function blank(g: Grid, r: number, from = 0, to = N, bg?: string): void {
  const row = g[r] as Cell[]
  for (let i = from; i < to; i++) row[i] = { ch: ' ', bg: bg ?? row[i]?.bg }
}
const copyRow = (g: Grid, to: number, from: number, src: Grid = g) => {
  g[to] = (src[from] as Cell[]).map((c) => ({ ...c }))
}
const cap = (k: string): Seg[] => [
  [' ', undefined, CAP],
  [k, FG, CAP, true],
  [' ', undefined, CAP],
]
const pill = (text: string): Seg[] => [
  [' ', undefined, PILL],
  ...text.split(/( )/).map((t): Seg => [t, INK, PILL, true]),
  [' ', undefined, PILL],
]

/** The key row: caps on the key grey, words dim; the foot right-aligned. */
function keys(g: Grid, main: Array<[string, string]>, foot: Array<[string, string]>): void {
  blank(g, 23, 0, N, CANVAS)
  let at = L
  for (const [k, w] of main) {
    put(g, 23, at, [...cap(k), [` ${w}`, DIM]])
    at += [...k].length + 3 + w.length + 2
  }
  const segs: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[foot[i - 1]?.[1] ? ' · ' : ' ', QUIET]] as Seg[]) : []),
    [k, FG] as Seg,
    ...(w ? ([[` ${w}`, QUIET]] as Seg[]) : []),
  ])
  put(g, 23, R - len(segs), segs)
}
const EXT_FOOT: Array<[string, string]> = [
  ['i', 'about'],
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]
const HOME_FOOT: Array<[string, string]> = [
  ['1–6', ''],
  ['←→', 'mode'],
  ['ctrl-c', 'quit'],
]

/* ------------------------------------------------------- /extensions */

/** The sheet's columns: right of the list's rule. */
const S = 39
/** The sheet's rows from `top`, emptied. */
function clearSheet(g: Grid, from = 4, to = 17) {
  for (let r = from; r <= to; r++) blank(g, r, S - 1, R, PANEL)
}
/** The list's rule, which is the sheet's left border: it runs the sheet's height, down to `to`. */
function rule(g: Grid, to: number) {
  // Unfilled, as captured: Ink draws the border without the panel's fill.
  for (let r = 4; r <= to; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
}
const sheetHead = (g: Grid, name: string, gives: string) => {
  put(g, 4, S, [[name, FG, undefined, true]])
  put(g, 5, S, [[gives, DIM]])
}
const YT = ['YouTube links', 'Transcribe YouTube videos: yt-dlp fetches their sound'] as const
const markYt = (g: Grid, mark: string) => put(g, 6, 33, [[mark, DIM]])

/* B · point to it */
function b1(): Grid {
  const g = G('extYtAbsent')
  clearSheet(g)
  sheetHead(g, ...YT)
  put(g, 7, S, [...pill('↵ install'), ['  37.1 MB', DIM]])
  put(g, 9, S, [...cap('o'), [' use one on this Mac', DIM]])
  rule(g, 9)
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'install'],
      ['o', 'use one on this Mac'],
    ],
    EXT_FOOT,
  )
  return g
}
function b2(): Grid {
  const g = G('extYtAbsent')
  clearSheet(g)
  sheetHead(g, ...YT)
  for (const r of [7, 8, 9]) blank(g, r, S, R - 2, FIELD)
  put(g, 8, S + 1, [
    ['› ', GOLD, undefined, true],
    ['yt-dlp', FG],
  ])
  put(g, 11, S - 1, [['▌', GOLD, BAND]])
  blank(g, 11, S, R - 2, BAND)
  put(g, 11, S + 1, [['/opt/homebrew/bin/yt-dlp', FG, undefined, true]])
  put(g, 11, R - 2 - 12, [['2026.10.03', DIM]])
  put(g, 12, S + 1, [['~/.local/bin/yt-dlp', DIM]])
  put(g, 12, R - 2 - 12, [['2025.06.30', QUIET]])
  rule(g, 12)
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'use it'],
    ],
    [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}
function b3(): Grid {
  const g = G('extYtAbsent')
  markYt(g, '✓')
  clearSheet(g)
  sheetHead(g, ...YT)
  put(g, 7, S, [
    ['✓', OK],
    [' yours · ', DIM],
    ['/opt/homebrew/bin/yt-dlp', DIM],
  ])
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['x', 'stop using it'],
    ],
    EXT_FOOT,
  )
  return g
}

/* C · one table */
function c1(): Grid {
  const g = G('extYtAbsent')
  for (let r = 4; r <= 17; r++) blank(g, r, L, R, PANEL)
  const cols = [10, 34, 58, 82]
  const head = ['Tool', 'Used for', 'From', 'Space']
  head.forEach((h, i) => {
    put(g, 4, cols[i] as number, [[h, QUIET]])
  })
  const rows: Array<[string, string, Seg[], string]> = [
    ['ffmpeg', 'Video and audio', [['this Mac · Homebrew', DIM]], '—'],
    ['yt-dlp', 'YouTube links', [['this Mac · Homebrew', DIM]], '—'],
    ['LibreOffice', 'Word documents', [['this Mac', DIM]], '—'],
    ['Boost resolution', 'edit', [['Forge', DIM]], '14.9 MB'],
    ['Remove background', 'edit', [['not installed', QUIET]], '32 KB'],
  ]
  rows.forEach(([tool, use, from, size], i) => {
    const r = 6 + i
    const on = i === 1
    if (on) {
      blank(g, r, 8, R - 4, BAND)
      put(g, r, 8, [['▌', GOLD]])
    }
    put(g, r, cols[0] as number, [[tool, on ? FG : DIM, undefined, on]])
    put(g, r, cols[1] as number, [[use, on ? FG : DIM]])
    put(g, r, cols[2] as number, from)
    put(g, r, cols[3] as number, [[size, DIM]])
  })
  put(g, 12, cols[2] as number, [['Forge’s downloads', QUIET]])
  put(g, 12, cols[3] as number, [['14.9 MB', FG, undefined, true]])
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}

/* D · install looks first */
function d1(): Grid {
  return G('extYtAbsent')
}
function d2(): Grid {
  const g = G('extYtAbsent')
  clearSheet(g)
  sheetHead(g, ...YT)
  put(g, 7, S, [
    ['Found on this Mac', FG, undefined, true],
    ['  2026.10.03', DIM],
  ])
  put(g, 8, S, [['/opt/homebrew/bin/yt-dlp', QUIET]])
  put(g, 10, S, [
    ...pill('↵ use it'),
    ['   ', DIM],
    ...cap('d'),
    [' download anyway · 37.1 MB', DIM],
  ])
  rule(g, 10)
  keys(
    g,
    [
      ['↵', 'use it'],
      ['d', 'download anyway'],
    ],
    [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}

/* --------------------------------------------- transcribe's link card */

/** The card with its URL alone: the bottom edge moves up a row, the dots close under it. */
function urlOnly(): Grid {
  const g = G('needsYtDlp')
  copyRow(g, 11, 12)
  copyRow(g, 12, 13)
  return g
}
/** The menu row's left end: words from the block's edge, "/ menu" kept at the right. */
const menuRow = (g: Grid, segs: Seg[]) => put(g, 21, L, segs)
/** The mode's note stays where it was captured; keys redrawn ahead of it. */
function linkKeys(g: Grid, main: Array<[string, string]>) {
  keys(g, main, HOME_FOOT)
}

/* A · ask when first needed */
function a1(): Grid {
  const g = urlOnly()
  menuRow(g, [
    ['yt-dlp is on this Mac', FG, undefined, true],
    ['  /opt/homebrew/bin', QUIET],
  ])
  linkKeys(g, [
    ['↵', 'use it'],
    ['d', 'download Forge’s · 37.1 MB'],
    ['esc', 'clear'],
  ])
  return g
}

/* Tab 2 · when a tool is missing */
function m1(): Grid {
  const g = urlOnly()
  menuRow(g, [
    ['YouTube links need yt-dlp', DIM],
    [' · ', QUIET],
    ['37.1 MB', FG, undefined, true],
    [' download', DIM],
  ])
  linkKeys(g, [
    ['↵', 'install'],
    ['esc', 'clear'],
  ])
  return g
}
function m2(): Grid {
  const g = urlOnly()
  linkKeys(g, [
    ['↵', 'install yt-dlp · 37.1 MB'],
    ['esc', 'clear'],
  ])
  return g
}
function m3(): Grid {
  const g = urlOnly()
  blank(g, 21, 0, N, CANVAS)
  const segs: Seg[] = [
    ['needs yt-dlp', DIM],
    [' · ', QUIET],
    ['37.1 MB', FG, undefined, true],
  ]
  put(g, 21, R - len(segs), segs)
  linkKeys(g, [
    ['↵', 'install'],
    ['esc', 'clear'],
  ])
  return g
}
/** The same words for ffmpeg: the picker's detail row is empty, the menu row says it. */
function m1Video(): Grid {
  const g = G('videoNoFfmpeg')
  blank(g, 9, 37, R, CANVAS)
  put(g, 21, L, [
    ['Video needs ffmpeg', DIM],
    [' · ', QUIET],
    ['brew install ffmpeg', FG, undefined, true],
  ])
  return g
}

/* --------------------------------------------------------------- page */

const dumped: Grid[] = []
const shot = (g: Grid) => termHtml(P, g)
const frameOf = (g: Grid, caption?: string) =>
  void dumped.push(g) ||
  `<figure class="fr">${caption ? `<figcaption class="step">${caption}</figcaption>` : ''}${shot(g)}</figure>`
const flow = (...parts: string[]) =>
  `<div class="stack">${parts.join('<div class="down">↓</div>')}</div>`

const concepts: PageConcept[] = [
  {
    id: 'A',
    tab: '1 · Using a tool you already have',
    section:
      'OPTIONS — four ways for Forge to use a tool that is already on your Mac. Same for every tool; drawn with yt-dlp. Pick one.',
    name: 'Ask the first time it’s needed',
    idea: 'The first YouTube link finds yt-dlp on your Mac and asks once, on the menu row: use it, or download Forge’s. The answer is kept; later links just go. Same for ffmpeg on the first video.',
    html: flow(frameOf(a1(), 'Step 1 · paste a link — asked once')),
  },
  {
    id: 'B',
    name: 'Point Forge to it yourself',
    idea: 'Your first idea. Each tool in /extensions gets a second way in beside install: o use one on this Mac. A field opens with the copies Forge found (you can type a path too); ↵ picks one. Nothing is used until you say so.',
    html: flow(
      frameOf(b1(), 'Step 1 · /extensions'),
      frameOf(b2(), 'Step 2 · o — the copies found, or type a path'),
      frameOf(b3(), 'Step 3 · ↵ — yours, from now on'),
    ),
  },
  {
    id: 'C',
    name: 'One table of every tool',
    idea: '/extensions becomes a table of everything Forge uses — your own and its downloads — with where each comes from and the space it takes. The total at the bottom is only what Forge downloaded.',
    html: flow(frameOf(c1(), '/extensions')),
  },
  {
    id: 'D',
    name: 'Install looks first',
    idea: 'Nothing changes until you press install — in /extensions, or on a YouTube link’s ↵. Then Forge looks before it downloads: found one, ↵ use it, or d download anyway.',
    html: flow(
      frameOf(d1(), 'Step 1 · /extensions, as today'),
      frameOf(d2(), 'Step 2 · ↵ install — it looked first'),
    ),
  },

  {
    id: 'M1',
    tab: '2 · When a tool is missing',
    section:
      'OPTIONS — the words that today crowd the YouTube card (“YouTube links need yt-dl…B download · ↵ installs”). The card keeps only the link. Pick one.',
    name: 'On the menu row',
    idea: 'Your idea. The menu row’s empty left end says what is needed and its size; ↵ install stays on the key row. The second frame is the same rule for a video with no ffmpeg.',
    html: flow(frameOf(m1(), 'a YouTube link'), frameOf(m1Video(), 'a video, no ffmpeg')),
  },
  {
    id: 'M2',
    name: 'On the key only',
    idea: 'No sentence at all: the key says it — ↵ install yt-dlp · 37.1 MB. Fewest words; the card and the menu row stay as they are.',
    html: flow(frameOf(m2())),
  },
  {
    id: 'M3',
    name: 'Where “/ menu” sits, while it matters',
    idea: 'The words take the menu row’s right end, where / menu is, until the link is cleared or installed. Close to ↵ enter above it.',
    html: flow(frameOf(m3())),
  },
]

const before = `<div class="box"><h3>What this is</h3><ul>
<li>Forge needs a few outside tools. When your Mac already has one, Forge should use yours instead of downloading a second copy.</li>
<li><b>Which tools this can apply to:</b> ffmpeg (video and audio), yt-dlp (YouTube links), LibreOffice (Word documents), and later Ghostscript (PDF). Boost resolution and Remove background are Forge’s own — nothing on a Mac can stand in for them, so they stay downloads.</li>
<li><b>Today:</b> ffmpeg and LibreOffice are already used from your Mac, silently. yt-dlp is always downloaded.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>How should Forge use a tool you already have?</b> (tab 1: A, B, C or D)</li>
<li><b>Where should “needs this tool” be said?</b> (tab 2: M1 — your idea, M2 or M3)</li>
<li><b>New words to approve</b>: “yt-dlp is on this Mac”, “use it”, “download Forge’s” (A) · “use one on this Mac”, “yours”, “stop using it” (B) · “Tool”, “Used for”, “From”, “Space”, “this Mac · Homebrew”, “not installed”, “Forge’s downloads” (C) · “Found on this Mac”, “download anyway” (D) · “YouTube links need yt-dlp”, “Video needs ffmpeg” (M1) · “install yt-dlp” (M2) · “needs yt-dlp” (M3).</li>
<li><b>Small calls I’d make unless you object:</b>
  <ul>
  <li>Forge never updates, moves or deletes your copy.</li>
  <li>If yours is too old, or fails on a video, the same place as tab 2 says how to update it (<code>brew upgrade yt-dlp</code>, matched to how you installed it), and ↵ still offers Forge’s copy.</li>
  <li>/about credits only what Forge downloaded.</li>
  </ul></li>
</ol></div>
<style>
.stack{display:flex;flex-direction:column;gap:10px}
.stack .down{font-size:22px;color:#4a4f5a;padding-left:24px}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr .step{font:600 14px -apple-system,sans-serif;color:#e2e4ea}
code{background:#1b1d22;padding:1px 5px;border-radius:4px}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10-round2.html',
  feedbackPage({
    page: 'own-tools-2026-10-round2',
    title: 'Forge · tools you already have, round 2',
    heading: 'Tools you already have — round 2',
    lede: 'Two questions, one tab each. Drawn at 100 columns, so /extensions is the split layout; every screen is the real app, captured, with only the changed cells redrawn.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round2.html')
if (process.env.DUMP)
  for (const g of dumped)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
