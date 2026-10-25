/**
 * Your own tools, round three (2026-10-22). Round two offered four models and
 * three placements side by side; the user could not see the vision for the
 * pieces. This round is one flow, the way a person meets it, in three cases:
 * you have the tool, you don't, you have both. Pattern taken from integration
 * pages (Calendly, MagicPath, Rows on Mobbin): a status, one line on which
 * one is used, and nothing asked that the app can answer itself.
 *
 * Frames: scripts/own-tools-r2-capture.tsx (100 × 24) and
 * scripts/own-tools-r3-capture.tsx (the link that just works).
 *
 *   npx tsx scripts/own-tools-mockup-r3.ts   → mockups/own-tools-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as Record<string, Raw[][]>
const frames = { ...load('./own-tools-r2-frames.json'), ...load('./own-tools-r3-frames.json') }
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
const CAP = '#333333'
const CANVAS = '#1e1e1e'

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
const copyRow = (g: Grid, to: number, from: number) => {
  g[to] = (g[from] as Cell[]).map((c) => ({ ...c }))
}

/** The key row: caps on the key grey, words dim; the foot right-aligned. */
function keys(g: Grid, main: Array<[string, string]>, foot: Array<[string, string]>): void {
  blank(g, 23, 0, N, CANVAS)
  let at = L
  for (const [k, w] of main) {
    put(g, 23, at, [
      [' ', undefined, CAP],
      [k, FG, CAP, true],
      [' ', undefined, CAP],
      [` ${w}`, DIM],
    ])
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

/** The sheet's first column, right of the list's rule. */
const S = 39
const TOOLS = ['Boost resolution', 'Remove background', 'Video and audio', 'YouTube links'] as const
type Tool = (typeof TOOLS)[number]
const SHEETS: Record<'Video and audio' | 'YouTube links', [string, string, string]> = {
  'Video and audio': ['Converts, compresses and trims video and sound', 'ffmpeg', 'Homebrew · 8.0'],
  'YouTube links': [
    'Transcribe YouTube videos: yt-dlp fetches their sound',
    'yt-dlp',
    'Homebrew · 2026.10.03',
  ],
}

/**
 * /extensions with every tool Forge can use in the list — Video and audio
 * joins it, ffmpeg being found — the cursor on `on`, and `status` under
 * the sheet's name and line.
 */
function extensions(on: 'Video and audio' | 'YouTube links', status: Seg[][]): Grid {
  const g = G('extYtAbsent')
  for (let r = 4; r <= 17; r++) blank(g, r, L, R, PANEL)
  TOOLS.forEach((name: Tool, i) => {
    const r = 4 + i
    const ready = name === 'Video and audio' || name === 'YouTube links'
    if (name === on) {
      blank(g, r, 8, 35, BAND)
      put(g, r, 8, [['▌', GOLD], [' '], [name, FG, undefined, true]])
    } else put(g, r, 10, [[name, DIM]])
    if (ready) put(g, r, 33, [['✓', DIM]])
  })
  const [gives] = SHEETS[on]
  put(g, 4, S, [[on, FG, undefined, true]])
  put(g, 5, S, [[gives, DIM]])
  status.forEach((segs, i) => {
    put(g, 7 + i, S, segs)
  })
  // The rule is the sheet's left border: it runs the taller of list and sheet.
  const to = Math.max(4 + TOOLS.length - 1, 7 + status.length - 1)
  for (let r = 4; r <= to; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}
const yours = (on: 'Video and audio' | 'YouTube links'): Seg[][] => {
  const [, tool, where] = SHEETS[on]
  return [
    [
      ['✓', OK],
      [` Uses your ${tool}`, FG],
    ],
    [[`  ${where}`, QUIET]],
  ]
}

function haveYt(): Grid {
  const g = extensions('YouTube links', yours('YouTube links'))
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
function haveFfmpeg(): Grid {
  const g = extensions('Video and audio', yours('Video and audio'))
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
function both(): Grid {
  const g = extensions('YouTube links', [
    ...yours('YouTube links'),
    [],
    [["Forge's copy isn't used any more · 37.1 MB", QUIET]],
  ])
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['x', "remove Forge's copy"],
    ],
    EXT_FOOT,
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
function needs(): Grid {
  const g = urlOnly()
  put(g, 21, L, [
    ['YouTube links need yt-dlp', DIM],
    [' · ', QUIET],
    ['37.1 MB', FG, undefined, true],
    [' download', DIM],
  ])
  keys(
    g,
    [
      ['↵', 'install'],
      ['esc', 'clear'],
    ],
    HOME_FOOT,
  )
  return g
}
/** The download on the menu row: the G1 band, bytes of the catalogue's count, as /extensions draws it. */
function installing(): Grid {
  const g = urlOnly()
  const k = Math.round((6.2 / 37.1) * 16)
  put(g, 21, L, [
    ['Installing yt-dlp  ', DIM],
    [' '.repeat(k), undefined, P.trackFill],
    [' '.repeat(16 - k), undefined, P.track],
    ['  6.2', FG, undefined, true],
    [' of 37.1 MB', DIM],
  ])
  keys(g, [['esc', 'stop']], HOME_FOOT)
  return g
}

/* --------------------------------------------------------------- page */

const drawn: Grid[] = []
const shot = (g: Grid) => {
  drawn.push(g)
  return termHtml(P, g)
}
const step = (n: number, words: string, g: Grid) =>
  `<figure class="fr"><figcaption class="step"><span class="n">${n}</span>${words}</figcaption>${shot(g)}</figure>`
const flow = (...parts: string[]) =>
  `<div class="stack">${parts.join('<div class="down">↓</div>')}</div>`

const concepts: PageConcept[] = [
  {
    id: 'F1',
    section: 'FLOW 1 — you already have the tool (yt-dlp and ffmpeg from Homebrew)',
    name: 'It just works',
    idea: 'Nothing to install and nothing asked. /extensions shows the tool as ready and says it is yours — like an integration page’s “Connected as …”. Same for every tool.',
    html: flow(
      step(1, 'Paste a link — it goes straight to the video', G('linkReady')),
      step(2, 'Curious? /extensions says it uses yours', haveYt()),
      step(3, 'The same for ffmpeg: Video and audio is in the list now too', haveFfmpeg()),
    ),
  },
  {
    id: 'F2',
    section: 'FLOW 2 — you don’t have it',
    name: 'Forge offers its own copy, on the menu row',
    idea: 'Your idea: the card keeps only the link; the menu row says what is missing and its size, then shows the download. ↵ installs, as today.',
    html: flow(
      step(1, 'Paste a link', needs()),
      step(2, '↵ — the download, on the same row', installing()),
      step(3, 'Done — the link goes on', G('linkReady')),
    ),
  },
  {
    id: 'F3',
    section: 'FLOW 3 — you have both (Forge downloaded its copy, later you installed your own)',
    name: 'Yours wins; Forge’s copy can go',
    idea: 'Forge switches to yours by itself and tells you, in /extensions, that its own copy is no longer used — x frees the space. This is the double copy, made visible and one key to undo.',
    html: flow(step(1, '/extensions', both())),
  },
]

const before = `<div class="box"><h3>The idea, in three rules</h3><ol>
<li><b>Forge looks on your Mac first.</b> If the tool is there, it is used. No download, no question.</li>
<li><b>Only when it is missing</b> does Forge offer its own copy — said on the menu row, not inside the card.</li>
<li><b>/extensions lists every tool</b> Forge uses and says where each comes from, so you can see — and undo — a second copy.</li>
</ol>
<p class="note">Applies to the tools you could already have: ffmpeg, yt-dlp, LibreOffice, and later Ghostscript. Boost resolution and Remove background are Forge’s own, so they stay downloads.</p></div>
<div class="box"><h3>Borrowed from</h3><ul>
<li><a href="https://mobbin.com/screens/25f3f8e9-bd9d-4ebb-9be6-7d6f5a045eb3">Calendly · integrations</a> — every tool shows one status (✓ Connected); nothing to do when it is.</li>
<li><a href="https://mobbin.com/screens/d1209570-1bd3-49db-9c89-23bd6aa03f47">MagicPath · integrations</a> — one quiet line under the status says which one: “Connected as …” → “Uses your yt-dlp · Homebrew”.</li>
<li><a href="https://mobbin.com/screens/a84dd376-0f86-4b5a-9cc5-9f249b8b01a9">Rows · connected integrations</a> — two connections of one kind, one marked as the one in use → yours, and Forge’s copy that isn’t.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>Does each flow feel right? (verdicts below)</li>
<li><b>New words to approve:</b> “Uses your yt-dlp” / “Uses your ffmpeg”, “Homebrew · 2026.10.03” (F1) · “YouTube links need yt-dlp · 37.1 MB download”, “Installing yt-dlp · 6.2 of 37.1 MB” (F2) · “Forge’s copy isn’t used any more”, “remove Forge’s copy” (F3).</li>
</ol></div>
<style>
.stack{display:flex;flex-direction:column;gap:10px}
.stack .down{font-size:22px;color:#4a4f5a;padding-left:24px}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr .step{font:600 15px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:10px}
.fr .step .n{display:inline-flex;width:24px;height:24px;border-radius:12px;background:#2a2d35;align-items:center;justify-content:center;font-size:13px}
.box .note{color:#a9aebb;margin:10px 0 0}
.box a{color:#8fe3f0}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10-round3.html',
  feedbackPage({
    page: 'own-tools-2026-10-round3',
    title: 'Forge · tools you already have, round 3',
    heading: 'Tools you already have',
    lede: 'One flow, in the three cases a person meets: you have the tool, you don’t, you have both. Real app screens at 100 columns, only the changed cells redrawn.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round3.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
