/**
 * Your own tools, round five (2026-10-22), from the user's answers to round four:
 *
 * - transcribe: the need moves into the field, in place of "or paste another
 *   link", so it sits beside the field's ↵ install chip;
 * - elsewhere (Boost…): the row over the keys stays, and gains the same chip
 *   at its far end, in the mode's colour;
 * - /extensions: "Check this Mac" looks for every outside tool and switches
 *   to what it finds (deleting Forge's own copy); a tool it cannot find takes
 *   a dropped or typed path.
 *
 * Settled in round four, carried with a badge: you have the tool (F1); a video
 * with no ffmpeg (F4).
 *
 *   npx tsx scripts/own-tools-mockup-r5.ts   → mockups/own-tools-2026-10-round5.html
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
const FIELD = '#242424'
const PILL = '#e7e7e7'
const INK = '#0c1d22'
const EDIT = modePalette(DARK, 'edit').accent
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
/** A chip as the field's: ` ↵ words ` on `bg`, ink on it, ending at column `end`. */
function chipAt(g: Grid, r: number, end: number, words: string, bg: string): void {
  const text = ` ↵ ${words} `
  put(g, r, end - [...text].length, [
    [' ', undefined, bg],
    ['↵', INK, bg, true],
    [' ', undefined, bg],
    [words, INK, bg, true],
    [' ', undefined, bg],
  ])
}
/** The field's words, from where its placeholder starts, the placeholder gone. */
function fieldSays(g: Grid, segs: Seg[]): void {
  blank(g, 16, 8, 80, FIELD)
  put(g, 16, 8, segs)
}
function ytNeeds(): Grid {
  const g = urlOnly()
  chip(g, 'install')
  fieldSays(g, needs('YouTube links', 'yt-dlp', '37.1 MB', true))
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
  fieldSays(g, band('yt-dlp', 6.2, 37.1))
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
  chipAt(g, NEED, R, 'install', EDIT)
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

/* /extensions: check this Mac */
const CHECK = 'Check this Mac'
/**
 * /extensions with "Check this Mac" under the tools, a row apart; `marks`
 * says which tools show ✓, `on` where the cursor is, `sheet` the rows right of the rule.
 */
function extList(on: string, marks: string[], sheet: Seg[][], to = 9): Grid {
  const g = G('extYtAbsent')
  for (let r = 4; r <= 17; r++) blank(g, r, L, R, PANEL)
  const rows: Array<[number, string]> = [
    ...TOOLS.map((t, i): [number, string] => [4 + i, t]),
    [9, CHECK],
  ]
  for (const [r, name] of rows) {
    if (name === on) {
      blank(g, r, 8, 35, BAND)
      put(g, r, 8, [['▌', GOLD], [' '], [name, FG, undefined, true]])
    } else put(g, r, 10, [[name, DIM]])
    if (marks.includes(name)) put(g, r, 33, [['✓', DIM]])
  }
  sheet.forEach((segs, i) => {
    put(g, 4 + i, S, segs)
  })
  for (let r = 4; r <= Math.max(to, 4 + sheet.length - 1); r++)
    (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}
const pill = (words: string): Seg[] => [
  [' ', undefined, PILL],
  ...words.split(/( )/).map((t): Seg => [t, INK, PILL, true]),
  [' ', undefined, PILL],
]
function checkStart(): Grid {
  const g = extList(
    CHECK,
    ['Video and audio', 'YouTube links'],
    [
      [[CHECK, FG, undefined, true]],
      [['Looks for ffmpeg, yt-dlp and LibreOffice', DIM]],
      [],
      pill('↵ check'),
    ],
  )
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'check'],
    ],
    EXT_FOOT,
  )
  return g
}
const found = (tool: string, where: string): Seg[] => [
  ['✓ ', OK],
  [tool.padEnd(13), FG],
  [where, QUIET],
]
function checkFound(): Grid {
  const g = extList(
    CHECK,
    ['Video and audio', 'YouTube links'],
    [
      [[CHECK, FG, undefined, true]],
      [['Looks for ffmpeg, yt-dlp and LibreOffice', DIM]],
      [],
      found('ffmpeg', '/opt/homebrew/bin · 8.0'),
      found('yt-dlp', '/opt/homebrew/bin · 2026.10.03'),
      [
        ['  ', undefined],
        ['LibreOffice'.padEnd(13), QUIET],
        ['not found', QUIET],
      ],
      [],
      [
        ["Now uses your yt-dlp · Forge's copy deleted, ", DIM],
        ['37.1 MB', FG, undefined, true],
        [' freed', DIM],
      ],
    ],
  )
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
/** The sheet's path field: three rows of the field's fill, `segs` on the middle one, a gold chip at its end. */
function pathField(g: Grid, top: number, segs: Seg[], chipWords: string) {
  for (const r of [top, top + 1, top + 2]) blank(g, r, S, R - 2, FIELD)
  put(g, top + 1, S + 1, [['› ', GOLD, undefined, true], ...segs])
  chipAt(g, top + 1, R - 3, chipWords, GOLD)
}
function notFound(): Grid {
  const g = extList(
    'YouTube links',
    ['Video and audio'],
    [
      [['YouTube links', FG, undefined, true]],
      [['Transcribe YouTube videos: yt-dlp fetches their sound', DIM]],
      [],
      [['Not found on this Mac', QUIET]],
    ],
    10,
  )
  pathField(g, 8, [['Drop it here, or type its path', QUIET]], 'install 37.1 MB')
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
function typed(): Grid {
  const g = extList(
    'YouTube links',
    ['Video and audio'],
    [
      [['YouTube links', FG, undefined, true]],
      [['Transcribe YouTube videos: yt-dlp fetches their sound', DIM]],
      [],
      [['Not found on this Mac', QUIET]],
    ],
    10,
  )
  pathField(g, 8, [['~/tools/yt-dlp', FG]], 'use it')
  keys(
    g,
    [['↵', 'use it']],
    [
      ['esc', 'clear'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}
function pointed(): Grid {
  const g = extList(
    'YouTube links',
    ['Video and audio', 'YouTube links'],
    [
      [['YouTube links', FG, undefined, true]],
      [['Transcribe YouTube videos: yt-dlp fetches their sound', DIM]],
      [],
      [
        ['✓', OK],
        [' Uses your yt-dlp', FG],
      ],
      [['  ~/tools · 2026.10.03', QUIET]],
    ],
  )
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
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
    id: 'F2',
    section:
      'FLOW 2 — a tool is missing. Transcribe says it in the field; ↵ install is right beside it.',
    name: 'Transcribe — a YouTube link',
    idea: 'The need takes the place of “or paste another link”, next to the field’s ↵ install. The download shows there too; once yt-dlp is in, Forge goes straight on to Transcribe to.',
    html: flow(
      step(1, 'Paste a link', ytNeeds()),
      step(2, '↵ — the download, in the field', ytInstalling()),
      step(3, 'Installed — straight on to Transcribe to', G('transcribeTo')),
    ),
  },
  {
    id: 'F3',
    section:
      'FLOW 2, everywhere else — the row over the keys, with the same ↵ install at its far end, in the mode’s colour',
    name: 'Edit — Boost resolution',
    idea: 'Message on the left, ↵ install on the right of the same row. Then the band on that row; then Forge lands on the 2×/3×/4× choice, the one decision left.',
    html: flow(
      step(1, 'Choose Boost resolution', boostNeeds()),
      step(2, '↵ — the download, on the same row', boostInstalling()),
      step(3, 'Installed — on the scale', G('boostInstalled')),
    ),
  },
  {
    id: 'F5',
    section: 'FLOW 3 — /extensions: check this Mac',
    name: 'Check this Mac — found',
    idea: 'Last in the list, a row apart: Check this Mac. ↵ looks in the same places Forge always does, says what it found, and switches to it — deleting Forge’s own copy where there was one.',
    html: flow(
      step(1, '/extensions — Check this Mac', checkStart()),
      step(2, '↵ — what it found, used from now on', checkFound()),
    ),
  },
  {
    id: 'F6',
    name: 'Not found — drop it or type where it is',
    idea: 'A tool the check could not find gets a field on its sheet: drop the file in, or type its path. Empty, ↵ installs Forge’s copy, as the chip says; with a path in it, ↵ uses yours.',
    html: flow(
      step(1, 'YouTube links, after the check', notFound()),
      step(2, 'Drop the file in, or type its path', typed()),
      step(3, '↵ — yours, from now on', pointed()),
    ),
  },
  {
    id: 'F1',
    earlier: 'like',
    section: 'SETTLED in round 4',
    name: 'You already have the tool',
    idea: 'It just works; /extensions says it uses yours.',
    html: flow(
      step(1, 'Paste a link — straight to the video', noNote(G('linkReady'))),
      step(2, '/extensions', haveYt()),
    ),
  },
  {
    id: 'F4',
    earlier: 'like',
    name: 'Convert — a video, with no ffmpeg',
    idea: 'No download of Forge’s yet: the row gives the command; Forge looks again by itself and carries on.',
    html: flow(
      step(1, 'Drop a video', videoNeeds()),
      step(2, 'brew finishes — Forge carries on', G('videoPicker')),
    ),
  },
]

const before = `<div class="box"><h3>What changed</h3><ol>
<li><b>Transcribe:</b> “YouTube links need yt-dlp” moves into the field, beside ↵ install.</li>
<li><b>Everywhere else:</b> the row over the keys keeps the message and gains ↵ install at its far end.</li>
<li><b>/extensions:</b> Check this Mac, and a place to drop or type a path when it finds nothing.</li>
<li><b>Never two copies:</b> when Forge switches to yours, it deletes its own.</li>
</ol></div>
<div class="box"><h3>Words to approve</h3><p>“Check this Mac”, “Looks for ffmpeg, yt-dlp and LibreOffice”, “↵ check”, “not found” (F5) · “Now uses your yt-dlp · Forge’s copy deleted, 37.1 MB freed” (F5) · “Not found on this Mac”, “Drop it here, or type its path”, “↵ install 37.1 MB”, “↵ use it” (F6).</p></div>
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
  'mockups/own-tools-2026-10-round5.html',
  feedbackPage({
    page: 'own-tools-2026-10-round5',
    title: 'Forge · tools you already have, round 5',
    heading: 'Tools you already have',
    lede: 'Round four with your answers: the install button beside its message, and Check this Mac in /extensions. What you settled last round is at the bottom, badged.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round5.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
