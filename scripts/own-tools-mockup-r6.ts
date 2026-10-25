/**
 * Your own tools, round six (2026-10-23): /extensions, one tool at a time.
 * Round five's "Check this Mac" was one row for every tool; the user wants it
 * on each tool's own sheet:
 *
 * - Forge looks by itself when the sheet opens; found, it is used;
 * - not found: "Do you already have this?" with c check this Mac — a
 *   spinner while it looks; found, ↵ use it; not, drop it or type its path;
 * - with both copies, the sheet picks which one is used (‹ Yours ›, the
 *   app's own ‹ › picker) and x deletes Forge's.
 *
 * The rest of round five stands; this page is only /extensions.
 *
 *   npx tsx scripts/own-tools-mockup-r6.ts   → mockups/own-tools-2026-10-round6.html
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
function pathField(g: Grid, top: number, segs: Seg[], chipWords: string) {
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
const picker = (value: string, first: boolean): Seg[] => [
  [' ', undefined, PICK],
  ['‹', first ? QUIET : GOLD, PICK, !first],
  [' ', undefined, PICK],
  [value, FG, PICK, true],
  [' ', undefined, PICK],
  ['›', first ? GOLD : QUIET, PICK, first],
  [' ', undefined, PICK],
]

/* 1 · not found by itself */
function ask(): Grid {
  const g = sheet([
    [...pill('↵ install'), ['  37.1 MB', DIM]],
    [],
    [['Do you already have this?  ', DIM], ...cap('c', 'check this Mac')],
  ])
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
function checking(): Grid {
  const g = sheet([
    [
      [`${SPIN} `, GOLD],
      ['Checking this Mac', DIM],
    ],
  ])
  keys(g, [['esc', 'stop']], [['ctrl-c', 'quit']])
  return g
}
function found(): Grid {
  const g = sheet([
    [
      ['✓', OK],
      [' Found yt-dlp', FG, undefined, true],
    ],
    [['  /opt/homebrew/bin · 2026.10.03', QUIET]],
    [],
    pill('↵ use it'),
  ])
  keys(
    g,
    [['↵', 'use it']],
    [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}
function inUse(): Grid {
  const g = sheet(
    [
      [
        ['✓', OK],
        [' Uses your yt-dlp', FG],
      ],
      [['  /opt/homebrew/bin · 2026.10.03', QUIET]],
    ],
    ['Video and audio', YT],
  )
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}

/* 2 · not found at all */
function notFound(): Grid {
  const g = sheet([[['Not found on this Mac', QUIET]]])
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
  const g = sheet([[['Not found on this Mac', QUIET]]])
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
  const g = sheet(
    [
      [
        ['✓', OK],
        [' Uses your yt-dlp', FG],
      ],
      [['  ~/tools · 2026.10.03', QUIET]],
    ],
    ['Video and audio', YT],
  )
  keys(g, [['↑↓', 'choose']], EXT_FOOT)
  return g
}

/* 3 · both copies */
function both(which: 'Yours' | "Forge's"): Grid {
  const yours = which === 'Yours'
  const g = sheet(
    [
      [['Uses  ', DIM], ...picker(which, yours)],
      [[yours ? '      /opt/homebrew/bin · 2026.10.03' : '      2026.08.19 · 37.1 MB', QUIET]],
      ...(yours ? [[], [["      Forge's copy isn't used · 37.1 MB", QUIET]] as Seg[]] : []),
    ],
    ['Video and audio', YT],
  )
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['←→', 'copy'],
      ...(yours ? ([['x', "delete Forge's copy"]] as Array<[string, string]>) : []),
    ],
    EXT_FOOT,
  )
  return g
}
function deleted(): Grid {
  const g = sheet(
    [
      [
        ['✓', OK],
        [' Uses your yt-dlp', FG],
      ],
      [['  /opt/homebrew/bin · 2026.10.03', QUIET]],
      [],
      [
        ["✓ Forge's copy deleted · ", DIM],
        ['37.1 MB', FG, undefined, true],
        [' freed', DIM],
      ],
    ],
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
const step = (n: number, words: string, g: Grid) =>
  `<figure class="fr"><figcaption class="step"><span class="n">${n}</span>${words}</figcaption>${shot(g)}</figure>`
const flow = (...parts: string[]) =>
  `<div class="stack">${parts.join('<div class="down">↓</div>')}</div>`

const concepts: PageConcept[] = [
  {
    id: 'E1',
    section: 'FLOW 1 — Forge didn’t find it by itself; you have it',
    name: 'Do you already have this?',
    idea: 'Under install, the sheet asks. c checks this Mac, with the spinner while it looks; found, ↵ use it, and the sheet says it uses yours.',
    html: flow(
      step(1, '/extensions → YouTube links', ask()),
      step(2, 'c — checking', checking()),
      step(3, 'Found', found()),
      step(4, '↵ — yours, from now on', inUse()),
    ),
  },
  {
    id: 'E2',
    section: 'FLOW 2 — the check finds nothing',
    name: 'Drop it here, or type its path',
    idea: 'The sheet turns into a field. Empty, ↵ installs Forge’s copy, as its chip says; with a path in it, the chip says ↵ use it.',
    html: flow(
      step(1, 'Not found', notFound()),
      step(2, 'Drop the file in, or type its path', typed()),
      step(3, '↵ — yours, from now on', pointed()),
    ),
  },
  {
    id: 'E3',
    section: 'FLOW 3 — you have both: yours, and a copy Forge downloaded',
    name: 'Pick which copy; delete Forge’s',
    idea: 'One line says which copy is used, in the ‹ › picker Boost’s scale already uses: ←→ switches. While yours is used, x deletes Forge’s copy and says what it freed.',
    html: flow(
      step(1, 'Uses ‹ Yours ›', both('Yours')),
      step(2, '← — or Forge’s', both("Forge's")),
      step(3, 'x on Yours — Forge’s copy deleted', deleted()),
    ),
  },
]

const before = `<div class="box"><h3>How it works, per tool</h3><ol>
<li><b>Forge looks by itself</b> when you open a tool in /extensions. Found: it uses yours and says so. Nothing to press.</li>
<li><b>Not found:</b> the sheet asks “Do you already have this?” — <b>c</b> checks this Mac (a spinner while it looks).</li>
<li><b>Found:</b> ↵ use it. <b>Still not found:</b> drop the file in, or type its path.</li>
<li><b>Both copies:</b> pick which one is used; <b>x</b> deletes Forge’s.</li>
</ol>
<p class="note">Only on tools you could have yourself — YouTube links (yt-dlp), Video and audio (ffmpeg); drawn with YouTube links. Boost resolution and Remove background are Forge’s own and keep today’s sheet. Everything else from round five stands.</p></div>
<div class="box"><h3>Words to approve</h3><p>“Do you already have this?”, “c check this Mac”, “Checking this Mac” (E1) · “Found yt-dlp”, “↵ use it”, “Uses your yt-dlp” (E1) · “Not found on this Mac”, “Drop it here, or type its path”, “↵ install 37.1 MB” (E2) · “Uses ‹ Yours ›” / “‹ Forge’s ›”, “Forge’s copy isn’t used”, “x delete Forge’s copy”, “Forge’s copy deleted · 37.1 MB freed” (E3).</p></div>
<style>
.stack{display:flex;flex-direction:column;gap:10px}
.stack .down{font-size:22px;color:#4a4f5a;padding-left:24px}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr .step{font:600 15px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:10px}
.fr .step .n{display:inline-flex;width:24px;height:24px;border-radius:12px;background:#2a2d35;align-items:center;justify-content:center;font-size:13px}
.box .note{color:#a9aebb;margin:10px 0 0}
</style>`

writeFileSync(
  'mockups/own-tools-2026-10-round6.html',
  feedbackPage({
    page: 'own-tools-2026-10-round6',
    title: 'Forge · tools you already have, round 6',
    heading: '/extensions, one tool at a time',
    lede: 'Check this Mac moves onto each tool’s own sheet. Three flows: Forge didn’t find yours but you have it; you don’t; you have both.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round6.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
