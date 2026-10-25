/**
 * Your own tools, round seven (2026-10-23): one tool's sheet in /extensions,
 * as one panel whose lines change in place. Round six's flow 1 was liked;
 * flows 2 and 3 each redrew the sheet their own way (a boxed field, a ‹ ›
 * picker), so nothing carried from one to the next.
 *
 * The sheet now has three slots under the tool's name, the same in every state:
 *
 * - line 1: what ↵ does (a white pill), or what is true once it is done (✓);
 * - line 2: where that copy is — folder · version — or why there is none;
 * - line 4: the one other thing you can do, with its key.
 *
 * As Roku's device search (Mobbin) swaps "searching", "no devices found"
 * and "connected" into the same place, the question, the spinner, the
 * field and the other copy all take line 4.
 *
 *   npx tsx scripts/own-tools-mockup-r7.ts   → mockups/own-tools-2026-10-round7.html
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
const _EDIT = modePalette(DARK, 'edit').accent
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
const _copyRow = (g: Grid, to: number, from: number) => {
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
const _HOME_FOOT: Array<[string, string]> = [
  ['1–6', ''],
  ['←→', 'mode'],
  ['ctrl-c', 'quit'],
]

/* ------------------------------------------------------- /extensions */

/** The sheet's first column, right of the list's rule. */
const S = 39
const TOOLS = ['Boost resolution', 'Remove background', 'Video and audio', 'YouTube links'] as const
const YT = 'YouTube links'
const GIVES = 'Transcribe YouTube videos: yt-dlp fetches their sound'
const SPIN = '⠹'
/** The ‹ › picker's fill, as Boost's scale and Transcribe to's detail draw it. */
const PICK = '#414141'

/**
 * /extensions on YouTube links: the list with `marks`, the sheet's name and
 * line, then `rows` from the sheet's fourth row; the rule runs the taller side.
 */
function sheet(rows: Seg[][], marks: string[] = ['Video and audio']): Grid {
  const g = G('extYtAbsent')
  for (let r = 4; r <= 17; r++) blank(g, r, L, R, PANEL)
  TOOLS.forEach((name, i) => {
    const r = 4 + i
    if (name === YT) {
      blank(g, r, 8, 35, BAND)
      put(g, r, 8, [['▌', GOLD], [' '], [name, FG, undefined, true]])
    } else put(g, r, 10, [[name, DIM]])
    if (marks.includes(name)) put(g, r, 33, [['✓', DIM]])
  })
  put(g, 4, S, [[YT, FG, undefined, true]])
  put(g, 5, S, [[GIVES, DIM]])
  rows.forEach((segs, i) => {
    put(g, 7 + i, S, segs)
  })
  for (let r = 4; r <= Math.max(7, 7 + rows.length - 1); r++)
    (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}
const pill = (words: string): Seg[] => [
  [' ', undefined, PILL],
  ...words.split(/( )/).map((t): Seg => [t, INK, PILL, true]),
  [' ', undefined, PILL],
]
const cap = (k: string, words: string): Seg[] => [
  [' ', undefined, CAP],
  [k, FG, CAP, true],
  [' ', undefined, CAP],
  [` ${words}`, DIM],
]
/** The sheet's path field: three rows of the field's fill, the words on the middle one, a gold chip at its end. */
function _pathField(g: Grid, top: number, segs: Seg[], chipWords: string) {
  for (const r of [top, top + 1, top + 2]) blank(g, r, S, R - 2, FIELD)
  put(g, top + 1, S + 1, [['› ', GOLD, undefined, true], ...segs])
  const text = ` ↵ ${chipWords} `
  put(g, top + 1, R - 3 - [...text].length, [
    [' ', undefined, GOLD],
    ['↵', INK, GOLD, true],
    [' ', undefined, GOLD],
    [chipWords, INK, GOLD, true],
    [' ', undefined, GOLD],
  ])
  for (let r = 4; r <= top + 2; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
}
/** The ‹ › picker: ‹ faint at the first choice, › in the screen's gold while there is another. */
const _picker = (value: string, first: boolean): Seg[] => [
  [' ', undefined, PICK],
  ['‹', first ? QUIET : GOLD, PICK, !first],
  [' ', undefined, PICK],
  [value, FG, PICK, true],
  [' ', undefined, PICK],
  ['›', first ? GOLD : QUIET, PICK, first],
  [' ', undefined, PICK],
]

/* --------------------------------------------- the sheet's three slots */

type Slots = { main: Seg[]; where?: Seg[]; other?: Seg[]; field?: Seg[] }
/** The three slots on rows 7, 8 and 10; `field` puts line 4 on the field's fill. */
function panel(s: Slots, marks: string[] = ['Video and audio']): Grid {
  // Under a ✓ line, the lines below start where its words start.
  const pad = (segs: Seg[] | undefined): Seg[] =>
    segs && segs.length > 0 && s.main[0]?.[0] === '✓' ? [['  '], ...segs] : (segs ?? [])
  const g = sheet([s.main, pad(s.where), [], s.field ? [] : pad(s.other)], marks)
  if (s.field) {
    blank(g, 10, S, R - 2, FIELD)
    put(g, 10, S + 1, [['› ', GOLD, undefined, true], ...s.field])
  }
  return g
}
const where = (text: string): Seg[] => [[text, QUIET]]
const done = (text: string): Seg[] => [
  ['✓', OK],
  [` ${text}`, FG],
]
const BACK: Array<[string, string]> = [
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]

const ask = () => {
  const g = panel({
    main: [...pill('↵ install'), ['  37.1 MB', DIM]],
    other: [['Do you already have this?  ', DIM], ...cap('c', 'check this Mac')],
  })
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'install'],
      ['c', 'check this Mac'],
    ],
    EXT_FOOT,
  )
  return g
}
const checking = () => {
  const g = panel({
    main: [...pill('↵ install'), ['  37.1 MB', DIM]],
    other: [
      [`${SPIN} `, GOLD],
      ['Checking this Mac', DIM],
    ],
  })
  keys(g, [['esc', 'stop']], BACK)
  return g
}
const found = () => {
  const g = panel({
    main: pill('↵ use yours'),
    where: [
      ['✓', OK],
      [' found  ', DIM],
      ['/opt/homebrew/bin · 2026.10.03', QUIET],
    ],
    other: [['or  ', DIM], ...cap('i', "install Forge's copy · 37.1 MB")],
  })
  keys(
    g,
    [
      ['↵', 'use yours'],
      ['i', "install Forge's"],
    ],
    BACK,
  )
  return g
}
const inUse = (path = '/opt/homebrew/bin · 2026.10.03') => {
  const g = panel({ main: done('Uses your yt-dlp'), where: where(path) }, ['Video and audio', YT])
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}
const notFound = () => {
  const g = panel({
    main: [...pill('↵ install'), ['  37.1 MB', DIM]],
    where: where('Not found on this Mac'),
    field: [['Drop it here, or type its path', QUIET]],
  })
  keys(g, [['↵', 'install']], BACK)
  return g
}
const typed = () => {
  const g = panel({
    main: pill('↵ use yours'),
    where: where('Not found on this Mac'),
    field: [['~/tools/yt-dlp', FG]],
  })
  keys(
    g,
    [['↵', 'use yours']],
    [
      ['esc', 'clear'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}
const both = () => {
  const g = panel(
    {
      main: done('Uses your yt-dlp'),
      where: where('/opt/homebrew/bin · 2026.10.03'),
      other: [
        ["Forge's copy · 37.1 MB   ", DIM],
        ...cap('s', 'use it instead'),
        ['  '],
        ...cap('x', 'delete'),
      ],
    },
    ['Video and audio', YT],
  )
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['s', 'switch'],
      ['x', "delete Forge's copy"],
    ],
    EXT_FOOT,
  )
  return g
}
const switched = () => {
  const g = panel(
    {
      main: done("Uses Forge's copy"),
      where: where('2026.08.19 · 37.1 MB'),
      other: [['Your yt-dlp · /opt/homebrew/bin   ', DIM], ...cap('s', 'use it instead')],
    },
    ['Video and audio', YT],
  )
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['s', 'switch'],
    ],
    EXT_FOOT,
  )
  return g
}
const deleted = () => {
  const g = panel(
    {
      main: done('Uses your yt-dlp'),
      where: where('/opt/homebrew/bin · 2026.10.03'),
      other: [
        ["Forge's copy deleted · ", DIM],
        ['37.1 MB', FG, undefined, true],
        [' freed', DIM],
      ],
    },
    ['Video and audio', YT],
  )
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}

/* --------------------------------------------------------------- page */

const drawn: Grid[] = []
const shot = (g: Grid) => {
  drawn.push(g)
  return termHtml(P, g)
}
const step = (n: string, words: string, g: Grid) =>
  `<figure class="fr"><figcaption class="step"><span class="n">${n}</span>${words}</figcaption>${shot(g)}</figure>`
const flow = (...parts: string[]) =>
  `<div class="stack">${parts.join('<div class="down">↓</div>')}</div>`
const fork = (a: string, b: string) => `<div class="fork">${a}${b}</div>`

const concepts: PageConcept[] = [
  {
    id: 'J1',
    section: 'ONE JOURNEY — YouTube links in /extensions, from nothing to the copy you want',
    name: 'Find yours, or install Forge’s',
    idea: 'Start: install, or check this Mac. The question becomes the spinner in the same place; then either Found (↵ use yours) or Not found (the same line becomes a field to drop or type a path). Both end on ✓ Uses your yt-dlp.',
    html: flow(
      step('1', 'Open YouTube links — Forge didn’t find yours by itself', ask()),
      step('2', 'c — the question turns into the search, in place', checking()),
      fork(
        flow(step('3a', 'Found', found()), step('4', '↵ — yours, from now on', inUse())),
        flow(
          step('3b', 'Not found — the same line takes a path', notFound()),
          step('4', 'Drop it in or type it — ↵ now uses yours', typed()),
          step('5', '↵ — yours, from now on', inUse('~/tools · 2026.10.03')),
        ),
      ),
    ),
  },
  {
    id: 'J2',
    section: 'LATER — you have both copies (Forge’s from before, yours now)',
    name: 'The other copy, on the same line',
    idea: 'Line 4 names the copy not in use, with what you can do to it: s uses it instead, x deletes Forge’s. Forge never deletes yours, so on Forge’s copy only s is offered.',
    html: flow(
      step('1', 'Both copies', both()),
      fork(
        step('s', 'Switched to Forge’s', switched()),
        step('x', 'Forge’s copy deleted', deleted()),
      ),
    ),
  },
]

const before = `<div class="box"><h3>One panel, three lines</h3>
<p>Every state of a tool’s sheet uses the same three lines under its name — only their words change:</p>
<ol>
<li><b>What ↵ does</b> — a white pill (install, use yours) — or, once done, what is true (✓ Uses your yt-dlp).</li>
<li><b>Where it is</b> — folder · version — or why there is none.</li>
<li><b>The one other thing you can do</b>, with its key: check this Mac → the search → a field for a path → the other copy.</li>
</ol>
<p class="note">Borrowed from <a href="https://mobbin.com/flows/1d3f175c-1289-4aa7-85c7-60869e6b7c52">Roku · connecting a device</a> (searching, no devices found and connected all take the same place) and <a href="https://mobbin.com/screens/8c9b4a22-2d88-4a27-b78c-51892a141f97">Coda · connected accounts</a> (each account’s own actions on one line under it). Only for tools you could have yourself (yt-dlp, ffmpeg); Boost and Remove background keep today’s sheet.</p></div>
<div class="box"><h3>Words to approve</h3><p>“Do you already have this?”, “c check this Mac”, “Checking this Mac” · “↵ use yours”, “✓ found”, “or i install Forge’s copy · 37.1 MB” · “Not found on this Mac”, “Drop it here, or type its path” · “✓ Uses your yt-dlp” / “✓ Uses Forge’s copy” · “Forge’s copy · 37.1 MB”, “s use it instead”, “x delete”, “Your yt-dlp · /opt/homebrew/bin”, “Forge’s copy deleted · 37.1 MB freed”.</p></div>
<style>
.stack{display:flex;flex-direction:column;gap:10px}
.stack .down{font-size:22px;color:#4a4f5a;padding-left:24px}
.fork{display:flex;gap:28px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr .step{font:600 15px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:10px}
.fr .step .n{display:inline-flex;min-width:24px;height:24px;padding:0 6px;box-sizing:border-box;border-radius:12px;background:#2a2d35;align-items:center;justify-content:center;font-size:13px}
.box .note{color:#a9aebb;margin:10px 0 0}
.box a{color:#8fe3f0}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10-round7.html',
  feedbackPage({
    page: 'own-tools-2026-10-round7',
    title: 'Forge · tools you already have, round 7',
    heading: 'One tool’s sheet, one panel',
    lede: 'Round six’s flow 1, carried through: the same three lines in every state, changing in place. Where the journey splits (found / not found, switch / delete), the two ways sit side by side.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round7.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
