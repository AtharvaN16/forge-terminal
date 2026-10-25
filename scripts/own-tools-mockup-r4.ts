/**
 * Your own tools, round four (2026-10-22). Round three's one flow, with the
 * user's answers on it:
 *
 * - Forge never keeps two copies: when yours is used, its own goes (flow 3
 *   is gone);
 * - a missing tool reads the same in every mode — the row over the key rule
 *   says what is needed, ↵ installs, and Forge carries on by itself;
 * - the field's chip reads ↵ install while ↵ installs;
 * - the English note no longer shares a key row with keys (fixed in KeyRow).
 *
 * Frames: own-tools-r2/r3/r4-capture (100 × 24); Boost's band and the step
 * after it are the app's own, installed for real into a temp HOME.
 *
 *   npx tsx scripts/own-tools-mockup-r4.ts   → mockups/own-tools-2026-10-round4.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as Record<string, Raw[][]>
const frames = {
  ...load('./own-tools-r2-frames.json'),
  ...load('./own-tools-r3-frames.json'),
  ...load('./own-tools-r4-frames.json'),
}
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
/* ------------------------------------------------- a missing tool */

/** The row over the key rule, where a missing tool is said in every mode. */
const NEED = 21
const need = (g: Grid, segs: Seg[]) => {
  blank(g, NEED, 0, N, CANVAS)
  put(g, NEED, L, segs)
}
/** "<what> need(s) <tool> · <size> download"; `plural` for "YouTube links". */
const needs = (what: string, tool: string, size: string, plural = false): Seg[] => [
  [`${what} ${plural ? 'need' : 'needs'} ${tool}`, DIM],
  [' · ', QUIET],
  [size, FG, undefined, true],
  [' download', DIM],
]
/** The download on the same row: the G1 band, bytes of the catalogue's count. */
const band = (what: string, got: number, of: number): Seg[] => {
  const k = Math.round((got / of) * 16)
  return [
    [`Installing ${what}  `, DIM],
    [' '.repeat(k), undefined, P.trackFill],
    [' '.repeat(16 - k), undefined, P.track],
    [`  ${got.toFixed(1)}`, FG, undefined, true],
    [` of ${of} MB`, DIM],
  ]
}
/** The key row as captured, less the English note: it no longer sits beside keys. */
function noNote(g: Grid): Grid {
  const row = g[23] as Cell[]
  const text = row.map((c) => c.ch).join('')
  const at = text.indexOf('Currently only English is supported')
  if (at >= 0) blank(g, 23, at - 2, at + 35, CANVAS)
  return g
}

/* transcribe */
/** The card with its URL alone: the bottom edge moves up a row, the dots close under it. */
function urlOnly(): Grid {
  const g = G('needsYtDlp')
  copyRow(g, 11, 12)
  copyRow(g, 12, 13)
  return g
}
/** The field's chip, ending where ↵ enter ends: " ↵ install " in the mode's colour. */
function chip(g: Grid, words: string | undefined): void {
  const row = g[16] as Cell[]
  const red = (row[86] as Cell).bg
  const ink = (row[86] as Cell).fg
  blank(g, 16, 80, 94, '#242424')
  if (!words) return
  const text = ` ↵ ${words} `
  put(g, 16, 94 - [...text].length, [
    [' ', undefined, red],
    ['↵', ink, red, true],
    [' ', undefined, red],
    [words, ink, red, true],
    [' ', undefined, red],
  ])
}
function ytNeeds(): Grid {
  const g = urlOnly()
  chip(g, 'install')
  put(g, NEED, L, needs('YouTube links', 'yt-dlp', '37.1 MB', true))
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
function ytInstalling(): Grid {
  const g = urlOnly()
  chip(g, undefined)
  put(g, NEED, L, band('yt-dlp', 6.2, 37.1))
  keys(g, [['esc', 'stop']], HOME_FOOT)
  return g
}

/* edit */
/** Edit's picker on Boost resolution, its sheet without the download line. */
function boostBase(k: string): Grid {
  const g = G(k)
  blank(g, 14, 41, R, CANVAS)
  return g
}
function boostNeeds(): Grid {
  const g = boostBase('editBoost')
  need(g, needs('Boost resolution', 'its on-device model', '14.9 MB'))
  return g
}
function boostInstalling(): Grid {
  const g = boostBase('editBoost')
  need(g, band('Boost resolution', 6.2, 14.9))
  keys(
    g,
    [['esc', 'stop']],
    [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}

/* convert, a video */
/** No ffmpeg, and no download of Forge's yet: the row gives the command; Forge looks again by itself. */
function videoNeeds(): Grid {
  const g = G('videoNoFfmpeg')
  blank(g, 9, 37, R, CANVAS)
  need(g, [
    ['Video needs ffmpeg', DIM],
    [' · ', QUIET],
    ['brew install ffmpeg', FG, undefined, true],
  ])
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
    section: 'FLOW 1 — you already have the tool',
    name: 'It just works',
    idea: 'Forge found yt-dlp and ffmpeg where your terminal finds them. Nothing to install, nothing asked. /extensions lists every tool and says which ones are yours.',
    html: flow(
      step(1, 'Paste a link — straight to the video', noNote(G('linkReady'))),
      step(2, '/extensions: it uses yours', haveYt()),
      step(3, 'Every tool is listed — ffmpeg too', haveFfmpeg()),
    ),
  },
  {
    id: 'F2',
    section:
      'FLOW 2 — a tool is missing: the same three steps in every mode. Said on the row over the keys; ↵ installs; Forge carries on by itself.',
    name: 'Transcribe — a YouTube link',
    idea: 'The card keeps only the link; the field’s chip and the key say ↵ install. Once yt-dlp is in, Forge looks the link up and goes straight to Transcribe to — no second ↵.',
    html: flow(
      step(1, 'Paste a link', ytNeeds()),
      step(2, '↵ — the download, on the same row', ytInstalling()),
      step(3, 'Installed — straight on to Transcribe to', G('transcribeTo')),
    ),
  },
  {
    id: 'F3',
    name: 'Edit — Boost resolution',
    idea: 'The same row, the same words. Boost still has a choice to make (2×, 3×, 4×), so Forge lands on it, ready; Sharpen and Remove background have none and go straight to Save as.',
    html: flow(
      step(1, 'Choose Boost resolution', boostNeeds()),
      step(2, '↵ — the download, on the same row', boostInstalling()),
      step(3, 'Installed — on the scale, the one choice left', G('boostInstalled')),
    ),
  },
  {
    id: 'F4',
    name: 'Convert — a video, with no ffmpeg',
    idea: 'ffmpeg has no download of Forge’s yet, so the row gives the one command. Forge looks again by itself while you run it, and carries on to Convert to once it is there.',
    html: flow(
      step(1, 'Drop a video', videoNeeds()),
      step(2, 'brew finishes — Forge carries on', G('videoPicker')),
    ),
  },
]

const before = `<div class="box"><h3>The idea</h3><ol>
<li><b>Forge looks on your Mac first</b> — in the folders your terminal searches when you type a command (your PATH), then in Homebrew’s two folders, which a terminal opened from Finder can miss. A copy counts if it runs and is new enough: Forge runs <code>yt-dlp --version</code>, as it already runs <code>ffmpeg -version</code> today.</li>
<li><b>Found: it is used.</b> No download, no question. <b>Never two copies</b>: if Forge downloaded its own earlier, it deletes it the moment it starts using yours.</li>
<li><b>Missing: the row over the keys says so</b> — what needs what, and the size. ↵ installs. Once it is in, Forge carries on with what you were doing.</li>
<li><b>/extensions lists every tool</b> and which ones are yours.</li>
</ol>
<p class="note">Your own copy can only stand in for outside tools — ffmpeg, yt-dlp, LibreOffice, later Ghostscript. Boost resolution and Remove background are Forge’s own, so for them flow 2 is the whole story.</p></div>
<div class="box"><h3>Borrowed from</h3><ul>
<li><a href="https://mobbin.com/screens/25f3f8e9-bd9d-4ebb-9be6-7d6f5a045eb3">Calendly · integrations</a> — one status per tool; nothing to do when it is connected.</li>
<li><a href="https://mobbin.com/screens/d1209570-1bd3-49db-9c89-23bd6aa03f47">MagicPath · integrations</a> — one quiet line says which one: “Connected as …” → “Uses your yt-dlp · Homebrew”.</li>
</ul></div>
<div class="box"><h3>Words to approve</h3><p>“Uses your yt-dlp / ffmpeg”, “Homebrew · 2026.10.03” (F1) · “YouTube links need yt-dlp”, “Boost resolution needs its on-device model”, “Video needs ffmpeg” and “· 14.9 MB download” (F2–F4) · “Installing yt-dlp”, “Installing Boost resolution” (F2, F3) · “↵ install” on the field’s chip (F2).</p></div>
<style>
.stack{display:flex;flex-direction:column;gap:10px}
.stack .down{font-size:22px;color:#4a4f5a;padding-left:24px}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr .step{font:600 15px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:10px}
.fr .step .n{display:inline-flex;width:24px;height:24px;border-radius:12px;background:#2a2d35;align-items:center;justify-content:center;font-size:13px}
.box .note{color:#a9aebb;margin:10px 0 0}
.box a{color:#8fe3f0}
code{background:#1b1d22;padding:1px 5px;border-radius:4px}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10-round4.html',
  feedbackPage({
    page: 'own-tools-2026-10-round4',
    title: 'Forge · tools you already have, round 4',
    heading: 'Tools you already have',
    lede: 'Two flows: you have the tool, or you don’t — the second drawn in three modes, so you can see it is one pattern. Real app screens at 100 columns, only the changed cells redrawn.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round4.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
