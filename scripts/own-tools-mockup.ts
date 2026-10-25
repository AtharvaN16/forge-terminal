/**
 * Your own tools, round one (2026-10-22): when the Mac already has yt-dlp,
 * Forge should use it rather than download a second copy, as it already
 * does for ffmpeg. Four moments change: /extensions, pasting a link, a copy
 * that is too old, and a copy that fails on a video.
 *
 * "Today" is captured from the app (scripts/own-tools-capture.tsx, with a
 * stand-in yt-dlp in a temp HOME). Every option is the captured screen with
 * only the changed cells redrawn, in the app's own colours.
 *
 *   npx tsx scripts/own-tools-mockup.ts   → mockups/own-tools-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { errorPanel } from '../src/shell/error-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, cellsOf, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./own-tools-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
/** A fresh copy of a captured screen. */
const G = (k: string): Grid =>
  (frames[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

const P = modePalette(DARK, 'transcribe')
const N = 80
const L = 4
const R = N - 4
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const OK = '#6fcf7f'
const GOLD = '#e5a23c'
const RED = '#e63946'
const PANEL = '#2c2c2c'
const BAND = '#323232'
const CAP = '#333333'
const CANVAS = '#1e1e1e'
const PILL = '#e7e7e7'
const INK = '#0c1d22'

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)

/** `segs` on row `r` from column `at`; a cell keeps its fill unless the segment has one. */
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
/** Columns `from`–`to` of row `r` emptied, each keeping its fill (or taking `bg`). */
function blank(g: Grid, r: number, from = 0, to = N, bg?: string): void {
  const row = g[r] as Cell[]
  for (let i = from; i < to; i++) row[i] = { ch: ' ', bg: bg ?? row[i]?.bg }
}
/** Row `to` becomes a copy of row `from` of grid `src`. */
const copyRow = (g: Grid, to: number, src: Grid, from: number) => {
  g[to] = (src[from] as Cell[]).map((c) => ({ ...c }))
}

/** The key row as the app draws it: caps on the key grey, words dim; the foot right-aligned. */
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

/** A list row: the cursor's band and gold bar, or a dim name; its mark at the far end. */
function listRow(g: Grid, r: number, name: string, o: { on?: boolean; mark?: string } = {}) {
  blank(g, r, L, R, PANEL)
  if (o.on) {
    blank(g, r, 8, 35, BAND)
    put(g, r, 8, [['▌', GOLD], [' '], [name, FG, undefined, true]])
  } else put(g, r, 10, [[name, DIM]])
  if (o.mark) put(g, r, 33, [[o.mark, DIM]])
}
/** A group's heading in the list, as the menu heads its groups. */
function groupRow(g: Grid, r: number, name: string) {
  blank(g, r, L, R, PANEL)
  put(g, r, 8, [[name, DIM, undefined, true], [' '], ['─'.repeat(35 - 8 - name.length - 1), QUIET]])
}
/** The sheet: name, what it gives, a blank, then `status` rows, from row `top`. */
function sheet(g: Grid, top: number, name: string, gives: string, status: Seg[][]) {
  for (let r = top; r < 18; r++) blank(g, r, L, R, PANEL)
  put(g, top, 8, [[name, FG, undefined, true]])
  put(g, top + 1, 8, [[gives, DIM]])
  status.forEach((segs, i) => put(g, top + 3 + i, 8, segs))
}
const YT = ['YouTube links', 'Transcribe YouTube videos: yt-dlp fetches their sound'] as const
/** The installed capture with Forge's copy's size as it would really be. */
function extInstalled(): Grid {
  const g = G('extInstalled')
  sheet(g, 8, ...YT, [
    [
      ['✓', OK],
      [' installed · 37.1 MB', DIM],
    ],
  ])
  return g
}

function x1(): Grid {
  const g = G('extInstalled')
  sheet(g, 8, ...YT, [
    [
      ['✓', OK],
      [' ready', DIM],
    ],
  ])
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
function x2(): Grid {
  const g = G('extInstalled')
  sheet(g, 8, ...YT, [
    [
      ['✓', OK],
      [' on this Mac · 2026.10.03', DIM],
    ],
    [['  /opt/homebrew/bin/yt-dlp', QUIET]],
  ])
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
function x3(): Grid {
  const g = G('extAbsent')
  listRow(g, 4, 'Boost resolution', { on: true })
  listRow(g, 5, 'Remove background')
  blank(g, 6, L, R, PANEL)
  sheet(
    g,
    7,
    'Boost resolution',
    'Sharpen, or boost resolution 2x or 4x, with a local AI model',
    [],
  )
  put(g, 10, 8, [
    [' ', undefined, PILL],
    ['↵', INK, PILL, true],
    [' ', undefined, PILL],
    ['install', INK, PILL, true],
    [' ', undefined, PILL],
    ['  14.9 MB', DIM],
  ])
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'install'],
    ],
    EXT_FOOT,
  )
  return g
}
function x4(): Grid {
  const g = G('extInstalled')
  groupRow(g, 4, 'Downloads')
  listRow(g, 5, 'Boost resolution')
  listRow(g, 6, 'Remove background')
  blank(g, 7, L, R, PANEL)
  groupRow(g, 8, 'On this Mac')
  listRow(g, 9, 'Video and audio', { mark: '✓' })
  listRow(g, 10, 'Word documents', { mark: '✓' })
  listRow(g, 11, 'YouTube links', { on: true, mark: '✓' })
  sheet(g, 13, ...YT, [
    [
      ['✓', OK],
      [' yt-dlp 2026.10.03 · /opt/homebrew/bin', DIM],
    ],
  ])
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
function x5(): Grid {
  const g = G('extInstalled')
  sheet(g, 8, ...YT, [
    [
      ['✓', OK],
      [' using yours · 2026.10.03', DIM],
    ],
    [["  Forge's copy · 37.1 MB", QUIET]],
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

/* ------------------------------------------------- transcribe's home */

/** The card's second line (columns 15–62), in dim. */
function cardLine(g: Grid, segs: Seg[]): void {
  const room = 48
  if (len(segs) > room)
    throw new Error(`card line too long (${len(segs)}): ${segs.map((s) => s[0]).join('')}`)
  blank(g, 11, 15, 63)
  put(g, 11, 15, segs)
}
const homeKeys = (g: Grid, main: Array<[string, string]>) => keys(g, main, HOME_FOOT)
/** The link's card, its URL, and `line` under it. */
function linkCard(line: Seg[]): Grid {
  const g = G('needsYtDlp')
  cardLine(g, line)
  return g
}
/** The card's tag in its top edge, `tag` instead of "YouTube". */
function cardTag(g: Grid, tag: Seg[]): void {
  const row = g[9] as Cell[]
  for (let i = 15; i < 64; i++) row[i] = { ch: '─', fg: QUIET, bg: PANEL }
  put(g, 9, 15, [[' '], ...tag, [' ']])
}

const y1 = () => G('linkReady')
function y2(): Grid {
  const g = G('linkReady')
  cardTag(g, [
    ['YouTube', RED, undefined, true],
    [' · your yt-dlp', DIM],
  ])
  return g
}

function o1(): Grid {
  const g = linkCard([['Your yt-dlp is too old · 37.1 MB · ↵ installs', DIM]])
  homeKeys(g, [
    ['↵', 'install'],
    ['esc', 'clear'],
  ])
  return g
}
function o2(): Grid {
  const g = linkCard([
    ['Your yt-dlp is too old · ', DIM],
    ['brew upgrade yt-dlp', FG, undefined, true],
  ])
  homeKeys(g, [['esc', 'clear']])
  return g
}
/** E5·b under the field, as a refused path is said; the card does not open. */
function o3(): Grid {
  const g = G('linkFailed')
  blank(g, 19, L, R, '#2e2020')
  put(g, 19, 5, [
    ['Your yt-dlp is too old', '#e8796d', undefined, true],
    ['   brew upgrade yt-dlp, then paste the link again', FG],
  ])
  return g
}
function o4(): Grid {
  const g = linkCard([
    ['Too old · ', DIM],
    ['brew upgrade yt-dlp', FG, undefined, true],
    [", or ↵ for Forge's", DIM],
  ])
  homeKeys(g, [
    ['↵', "install Forge's · 37.1 MB"],
    ['esc', 'clear'],
  ])
  return g
}
function o5a(): Grid {
  const g = linkCard([['Your yt-dlp is too old · ↵ updates it with brew', DIM]])
  homeKeys(g, [
    ['↵', 'update'],
    ['esc', 'clear'],
  ])
  return g
}
function o5b(): Grid {
  const g = linkCard([
    ['⠹ ', RED],
    ['brew upgrade yt-dlp · 0:12', DIM],
  ])
  homeKeys(g, [['esc', 'stop']])
  return g
}

/* ---------------------------------------------------- a failed fetch */

function f1(): Grid {
  const g = G('linkFailed')
  blank(g, 19, L, R, '#2e2020')
  put(g, 19, 5, [
    ['Cannot transcribe this link', '#e8796d', undefined, true],
    ['   Try ', FG],
    ['brew upgrade yt-dlp', FG, undefined, true],
  ])
  return g
}
/**
 * E5 under the field, home making room as it does for a note: the drop
 * surface keeps its two words, the rest of the window goes to the panel.
 */
function f2(): Grid {
  const src = G('linkFailed')
  const g = G('linkFailed')
  copyRow(g, 9, src, 10)
  copyRow(g, 10, src, 11)
  copyRow(g, 11, src, 12)
  for (let r = 12; r < 22; r++) blank(g, r, 0, N, CANVAS)
  copyRow(g, 13, src, 15)
  copyRow(g, 14, src, 16)
  copyRow(g, 15, src, 17)
  const rows = errorPanel({
    palette: P,
    title: 'yt-dlp could not fetch this video',
    detail: 'YouTube said: Sign in to confirm you are not a bot.',
    hint: 'Your yt-dlp may be out of date: brew upgrade yt-dlp',
    width: R - L,
  })
  rows.forEach((row, i) => {
    const cells = cellsOf(row)
    const r = 16 + i
    if (r > 21) return
    cells.forEach((c, j) => {
      ;(g[r] as Cell[])[L + j] = { ...c, bg: c.bg ?? CANVAS }
    })
  })
  return g
}
function f3(): Grid {
  const g = linkCard([["Your yt-dlp could not fetch it · ↵ try Forge's", DIM]])
  homeKeys(g, [
    ['↵', "install Forge's · 37.1 MB"],
    ['esc', 'clear'],
  ])
  return g
}

/* --------------------------------------------------------------- page */

const shot = (g: Grid) => termHtml(P, g)
const dumped: Grid[] = []
const frameOf = (g: Grid, caption?: string) =>
  void dumped.push(g) ||
  `<figure class="fr">${shot(g)}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`
const row = (...parts: string[]) =>
  `<div class="flow">${parts.join('<div class="arrow">→</div>')}</div>`

const concepts: PageConcept[] = [
  /* 1 · /extensions */
  {
    id: 'X1',
    tab: '1 · /extensions',
    section:
      'OPTIONS — /extensions when this Mac already has yt-dlp (Forge has not downloaded its own). Pick one.',
    name: 'Just ✓ ready',
    idea: 'The row gets its ✓ like an installed tool; the sheet says ready, with no size and no remove, since nothing of Forge’s is on disk. Quietest; does not say where it comes from.',
    html: frameOf(x1()),
  },
  {
    id: 'X2',
    name: 'Says it is yours, and where',
    idea: 'MY PICK. ✓ on this Mac, its version, and its path under it in grey. Answers “did Forge download this?” at a glance, and the version makes “too old” (tab 3) make sense.',
    html: frameOf(x2()),
  },
  {
    id: 'X3',
    name: 'The row goes',
    idea: 'Nothing to install, so nothing to show: YouTube links leaves the list while your yt-dlp is found. Cleanest list — but nowhere says YouTube links work, or why.',
    html: frameOf(x3()),
  },
  {
    id: 'X4',
    name: 'Two groups: Downloads, On this Mac',
    idea: 'Also shows what is invisible today: your ffmpeg (Video and audio) and LibreOffice (Word documents) appear under On this Mac, beside yt-dlp. The one screen that says everything Forge uses.',
    html: frameOf(x4()),
  },
  {
    id: 'X5',
    section: 'SCREEN — you have both: yours, and a copy Forge downloaded earlier',
    name: 'Uses yours; Forge’s copy can go',
    idea: 'Goes with any of X1–X4. Forge uses yours; its own copy is listed under it, and x frees its 37.1 MB. This is the double-space case, made visible and one key to undo.',
    html: frameOf(x5()),
  },

  /* 2 · pasting a link */
  {
    id: 'Y1',
    tab: '2 · Pasting a link',
    section:
      'OPTIONS — a YouTube link, with your yt-dlp found. Today, with no yt-dlp, this card offers a 37.1 MB download.',
    name: 'Nothing new: straight to the video',
    idea: 'MY PICK. The card looks the link up and shows the title, exactly as with Forge’s copy. Your yt-dlp is never mentioned because nothing is asked of you.',
    html: frameOf(y1()),
  },
  {
    id: 'Y2',
    name: 'The card’s tag says whose',
    idea: 'The tag on the card’s edge reads YouTube · your yt-dlp. Tells you no download happened, every time — which you may not care about after the first.',
    html: frameOf(y2()),
  },

  /* 3 · too old */
  {
    id: 'O1',
    tab: '3 · Yours is too old',
    section:
      'OPTIONS — your yt-dlp is older than the one this Forge is tested with (2026.08.19). Known before anything runs.',
    name: 'Offer Forge’s copy',
    idea: 'The card offers the download as today. Just works; costs the 37.1 MB this round is trying to save, and leaves your old copy old.',
    html: frameOf(o1()),
  },
  {
    id: 'O2',
    name: 'Say how to update yours',
    idea: 'The card names the one command. No download, your copy gets fixed for everything else you use it for — but you have to leave Forge to run it.',
    html: frameOf(o2()),
  },
  {
    id: 'O3',
    name: 'Refuse, as a refused path is',
    idea: 'No card: the E5·b row under the field, red on the tint, with the command. Treats it as an error, which it is not quite.',
    html: frameOf(o3()),
  },
  {
    id: 'O4',
    name: 'Both ways on the card',
    idea: 'MY PICK. The free fix in the card (the command), the paid one on ↵ (Forge’s copy, its size on the key). You choose space or convenience.',
    html: frameOf(o4()),
  },
  {
    id: 'O5',
    name: 'Forge runs the update for you',
    idea: 'With your OK, ↵ runs brew upgrade yt-dlp and shows its clock. Easiest — but Forge runs your package manager, which can take minutes and update other things too.',
    html: row(frameOf(o5a(), 'the link'), frameOf(o5b(), '↵')),
  },
  {
    id: 'O6',
    name: 'Don’t check, just try',
    idea: 'No version check at all: an older yt-dlp often still works. Only if it fails does Forge say anything (tab 4). Fewest words; the failure comes later, after the wait.',
    html: frameOf(y1(), 'the same as Y1 — until a video fails'),
  },

  /* 4 · fails */
  {
    id: 'F1',
    tab: '4 · Yours fails on a video',
    section:
      'OPTIONS — your yt-dlp ran and could not fetch the video, most likely because YouTube changed. Today: Cannot transcribe this link · yt-dlp could not fetch this video: Sign…',
    name: 'Today’s row, the fix as its reason',
    idea: 'MY PICK. Same one-line refusal; the reason becomes the command. yt-dlp’s own words go (they were cut off anyway).',
    html: frameOf(f1()),
  },
  {
    id: 'F2',
    name: 'The full panel: cause, then fix',
    idea: 'The E5 panel under the field, home making room: what YouTube said, then the command in the panel’s grey. Room for both, at the cost of a bigger red block.',
    html: frameOf(f2()),
  },
  {
    id: 'F3',
    name: 'Offer Forge’s copy instead',
    idea: 'The card stays and offers Forge’s copy, which updates itself when YouTube breaks it. Gets you the video now; costs the 37.1 MB.',
    html: frameOf(f3()),
  },
]

const before = `<div class="box"><h3>Where this stands</h3><ul>
<li><b>ffmpeg already works this way.</b> Forge uses yours (PATH, then Homebrew) and never downloads one. LibreOffice too. Nothing here changes them, unless you like X4.</li>
<li><b>yt-dlp is the only double copy.</b> Today Forge always downloads its own 37.1 MB, even when you have one.</li>
<li><b>Bug found while capturing:</b> on an 80-column window the install card cuts its own line in the middle — <code>YouTube links need yt-dl…B download</code> — so the size never shows. Fixed whatever you pick here.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>How does /extensions show a yt-dlp you already have?</b> (tab 1)</li>
<li><b>Does pasting a link say anything?</b> (tab 2)</li>
<li><b>Your copy is too old:</b> download Forge’s, or tell you how to update yours? (tab 3)</li>
<li><b>Your copy fails on a video:</b> what does Forge say? (tab 4)</li>
<li><b>New words to approve</b> (each appears in a screen): “ready” (X1) · “on this Mac” (X2) · “Downloads”, “On this Mac”, “Word documents” (X4) · “using yours”, “Forge’s copy”, “remove Forge’s copy” (X5) · “your yt-dlp” (Y2) · “Your yt-dlp is too old” (O1–O3, O5) · “Too old”, “or ↵ for Forge’s”, “install Forge’s” (O4) · “updates it with brew”, “update” (O5) · “then paste the link again” (O3) · “Try brew upgrade yt-dlp” (F1) · “Your yt-dlp may be out of date” (F2) · “Your yt-dlp could not fetch it”, “try Forge’s” (F3).</li>
<li><b>Small calls I’d make unless you object:</b>
  <ul>
  <li>Yours wins whenever it is new enough, as ffmpeg does today. “New enough” = at least the version this Forge is tested with.</li>
  <li>Forge never updates, moves or deletes your copy.</li>
  <li>The command matches how you installed it: <code>brew upgrade yt-dlp</code> for Homebrew, <code>pipx upgrade yt-dlp</code>, <code>python3 -m pip install -U yt-dlp</code>, else <code>yt-dlp -U</code>.</li>
  <li>/about’s Attributions lists only what Forge downloaded; your own tools are not Forge’s to credit.</li>
  </ul></li>
</ol></div>
<h2 style="margin-top:48px">Today</h2>
<p class="lede" style="margin-top:6px">Captured from the app (dark, 80 × 24) with no yt-dlp, then with Forge’s copy.</p>
${row(
  frameOf(G('needsYtDlp'), 'a link, no yt-dlp: the size is cut out of the line'),
  frameOf(G('extAbsent'), '/extensions, not installed'),
)}
${row(frameOf(extInstalled(), '/extensions, Forge’s copy installed'), frameOf(G('linkFailed'), 'a link yt-dlp could not fetch'))}
<style>
.flow{display:flex;gap:14px;align-items:flex-start;overflow-x:auto;padding:18px 0 10px}
.flow .arrow{font-size:28px;color:#4a4f5a;align-self:center}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr figcaption{font-size:13.5px;color:#a9aebb;max-width:690px}
.stack{display:flex;flex-direction:column;gap:18px}
code{background:#1b1d22;padding:1px 5px;border-radius:4px}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10.html',
  feedbackPage({
    page: 'own-tools-2026-10',
    title: 'Forge · using the tools you already have',
    heading: 'Your own yt-dlp, not a second copy',
    lede: 'When your Mac already has yt-dlp, Forge should use it instead of downloading 37.1 MB more — as it already does for ffmpeg. Four moments change; one tab each. Every screen is the real app, captured, with only the changed cells redrawn.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10.html')
if (process.env.DUMP)
  for (const g of dumped)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(80)}`)
