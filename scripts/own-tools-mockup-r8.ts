/**
 * Your own tools, round eight (2026-10-23). Round seven's three bare lines
 * had no hierarchy or grouping. And two rules changed:
 *
 * - Forge removes its own copy once yours is used (one copy, always; it can
 *   download again if yours goes) — so no copy picker, no switch;
 * - one key updates the tool, yours included (Homebrew's, run for you).
 *
 * A tool's sheet now reads in three levels, as extension pages do
 * (Airtable, Twenty on Mobbin):
 *
 * 1. header — name and what it gives, with the one action on the right;
 * 2. a card of facts — Status, From, Version — the app's own bordered card
 *    with its tag in the top edge, as the file card is;
 * 3. under the card, the one other thing you can do.
 *
 *   npx tsx scripts/own-tools-mockup-r8.ts   → mockups/own-tools-2026-10-round8.html
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
function _sheet(rows: Seg[][], marks: string[] = ['Video and audio']): Grid {
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

/* -------------------------------------------- header · card · under */

type Fact = [label: string, value: Seg[]]
interface Sheet {
  /** The header's action, a white pill at the right of the name; none once nothing is to do. */
  action?: string
  facts: Fact[]
  /** The fact whose value is a field (drop or type a path), by label. */
  field?: string
  /** Under the card: the one other thing. */
  under?: Seg[]
  /** The list's mark on YouTube links. */
  mark?: string
}
const CARD_L = S
const CARD_R = R - 3
const LABEL = 10

function tool(s: Sheet): Grid {
  const g = G('extYtAbsent')
  for (let r = 4; r <= 17; r++) blank(g, r, L, R, PANEL)
  TOOLS.forEach((name, i) => {
    const r = 4 + i
    if (name === YT) {
      blank(g, r, 8, 35, BAND)
      put(g, r, 8, [['▌', GOLD], [' '], [name, FG, undefined, true]])
      if (s.mark) put(g, r, 35 - 1 - s.mark.length, [[s.mark, DIM]])
    } else put(g, r, 10, [[name, DIM]])
    if (name === 'Video and audio') put(g, r, 33, [['✓', DIM]])
  })
  // 1 · header
  put(g, 4, S, [[YT, FG, undefined, true]])
  put(g, 5, S, [[GIVES, DIM]])
  if (s.action) {
    const p = pill(s.action)
    put(g, 4, CARD_R + 1 - len(p), p)
  }
  // 2 · the card: top edge with its tag, a row per fact, bottom edge
  const top = 7
  const edge = (r: number, l: string, rr: string) => {
    put(g, r, CARD_L, [[l + '─'.repeat(CARD_R - CARD_L - 1) + rr, QUIET]])
  }
  edge(top, '╭', '╮')
  put(g, top, CARD_L + 2, [[' '], ['yt-dlp', GOLD, undefined, true], [' ']])
  s.facts.forEach(([label, value], i) => {
    const r = top + 1 + i
    put(g, r, CARD_L, [['│', QUIET]])
    put(g, r, CARD_R, [['│', QUIET]])
    put(g, r, CARD_L + 2, [[label.padEnd(LABEL), QUIET]])
    if (s.field === label) {
      blank(g, r, CARD_L + 2 + LABEL, CARD_R - 1, FIELD)
      put(g, r, CARD_L + 3 + LABEL, [['› ', GOLD, undefined, true], ...value])
    } else put(g, r, CARD_L + 2 + LABEL, value)
  })
  const bottom = top + 1 + s.facts.length
  edge(bottom, '╰', '╯')
  // 3 · under the card
  if (s.under) put(g, bottom + 2, S, s.under)
  const to = s.under ? bottom + 2 : bottom
  for (let r = 4; r <= to; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}
const ok = (text: string): Seg[] => [
  ['✓', OK],
  [` ${text}`, FG],
]
const spin = (text: string): Seg[] => [
  [`${SPIN} `, GOLD],
  [text, DIM],
]
const v = (text: string, colour = DIM): Seg[] => [[text, colour]]
const FROM: Fact = ['From', v('Homebrew · /opt/homebrew/bin')]
const BACK: Array<[string, string]> = [
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]
const LIST: Array<[string, string]> = [['↑↓', 'choose']]

/* J1 · find yours, or install Forge's */
function ask(): Grid {
  const g = tool({
    action: '↵ install',
    facts: [
      ['Status', v('Not installed')],
      ['Size', v('37.1 MB download')],
    ],
    under: [['Do you already have this?  ', DIM], ...cap('c', 'check this Mac')],
  })
  keys(g, [...LIST, ['↵', 'install'], ['c', 'check this Mac']], EXT_FOOT)
  return g
}
function checking(): Grid {
  const g = tool({
    action: '↵ install',
    facts: [
      ['Status', spin('Checking this Mac')],
      ['Size', v('37.1 MB download')],
    ],
  })
  keys(g, [['esc', 'stop']], [['ctrl-c', 'quit']])
  return g
}
function found(): Grid {
  const g = tool({
    action: '↵ use it',
    facts: [['Status', ok('Found on this Mac')], FROM, ['Version', v('2026.10.03')]],
  })
  keys(g, [['↵', 'use it']], BACK)
  return g
}
function notFound(): Grid {
  const g = tool({
    action: '↵ install',
    facts: [
      ['Status', v('Not found on this Mac')],
      ['From', v('Drop it here, or type its path', QUIET)],
    ],
    field: 'From',
  })
  keys(g, [['↵', 'install']], BACK)
  return g
}
function typed(): Grid {
  const g = tool({
    action: '↵ use it',
    facts: [
      ['Status', v('Not found on this Mac')],
      ['From', v('~/tools/yt-dlp', FG)],
    ],
    field: 'From',
  })
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
function inUse(from: Fact = FROM, freed = true): Grid {
  const g = tool({
    facts: [['Status', ok('Uses your copy')], from, ['Version', v('2026.10.03 · latest')]],
    ...(freed
      ? {
          under: [
            ["Forge's copy removed · ", DIM],
            ['37.1 MB', FG, undefined, true],
            [' freed', DIM],
          ] as Seg[],
        }
      : {}),
    mark: '✓',
  })
  keys(g, LIST, EXT_FOOT)
  return g
}

/* J2 · update */
function update(): Grid {
  const g = tool({
    action: '↵ update',
    facts: [
      ['Status', ok('Uses your copy')],
      FROM,
      [
        'Version',
        [
          ['2026.10.03', DIM],
          ['  →  ', QUIET],
          ['2026.11.02', FG, undefined, true],
          [' available', DIM],
        ],
      ],
    ],
    mark: 'update',
  })
  keys(g, [...LIST, ['↵', 'update']], EXT_FOOT)
  return g
}
function updating(): Grid {
  const g = tool({
    facts: [['Status', spin('Updating with Homebrew · 0:12')], FROM, ['Version', v('2026.10.03')]],
    mark: SPIN,
  })
  keys(g, [['esc', 'stop']], [['ctrl-c', 'quit']])
  return g
}
function updated(): Grid {
  const g = tool({
    facts: [['Status', ok('Uses your copy')], FROM, ['Version', v('2026.11.02 · latest')]],
    mark: '✓',
  })
  keys(g, LIST, EXT_FOOT)
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
    section: 'JOURNEY 1 — find yours, or install Forge’s',
    name: 'Header · facts card · one other thing',
    idea: 'Every state is the same three blocks. The header’s button is what ↵ does; the card’s Status changes in place (not installed → checking → found / not found → uses your copy); under the card, the one other thing. Using yours removes Forge’s copy.',
    html: flow(
      step('1', 'Open YouTube links — Forge didn’t find yours by itself', ask()),
      step('2', 'c — Status turns into the search', checking()),
      fork(
        flow(step('3a', 'Found', found()), step('4', '↵ — yours; Forge’s copy removed', inUse())),
        flow(
          step('3b', 'Not found — From takes a path', notFound()),
          step('4', 'Drop it in or type it — ↵ now uses it', typed()),
          step('5', '↵ — yours', inUse(['From', v('~/tools')], false)),
        ),
      ),
    ),
  },
  {
    id: 'J2',
    section: 'JOURNEY 2 — an update, one key',
    name: 'Update in place',
    idea: 'A newer version shows on the Version line and on the list (update). ↵ updates it — Homebrew’s copy through Homebrew, Forge’s by download — with its clock, then back to latest.',
    html: flow(
      step('1', 'A new version', update()),
      step('2', '↵ — updating', updating()),
      step('3', 'Up to date', updated()),
    ),
  },
]

const before = `<div class="box"><h3>How a tool’s sheet reads</h3><ol>
<li><b>Header</b> — the tool’s name and what it gives; on the right, the one button: what ↵ does.</li>
<li><b>A card of facts</b> — Status, From, Version — the app’s own bordered card, tagged with the tool, as the file card is.</li>
<li><b>Under the card</b> — the one other thing you can do.</li>
</ol>
<p class="note">Rules: Forge looks for yours by itself; using yours removes Forge’s copy (it downloads again if yours goes); one key updates either. Only for tools you could have yourself (yt-dlp, ffmpeg); Boost and Remove background keep today’s sheet. Layout borrowed from extension pages — <a href="https://mobbin.com/screens/64d78d44-74cd-452c-b1f3-33e153192145">Airtable</a>, <a href="https://mobbin.com/screens/8d3e5f06-0057-454c-a24d-fad8b3c99407">Twenty</a>: name, one line, button on the right, labelled facts.</p></div>
<div class="box"><h3>Words to approve</h3><p>Labels “Status”, “From”, “Size”, “Version” · “Not installed”, “37.1 MB download”, “Do you already have this?”, “c check this Mac”, “Checking this Mac” · “Found on this Mac”, “Homebrew · /opt/homebrew/bin”, “↵ use it” · “Not found on this Mac”, “Drop it here, or type its path” · “Uses your copy”, “· latest”, “Forge’s copy removed · 37.1 MB freed” · “→ 2026.11.02 available”, “↵ update”, “Updating with Homebrew · 0:12”.</p></div>
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
  'mockups/own-tools-2026-10-round8.html',
  feedbackPage({
    page: 'own-tools-2026-10-round8',
    title: 'Forge · tools you already have, round 8',
    heading: 'A tool’s sheet, with hierarchy',
    lede: 'Header, a card of facts, one other thing — the same three blocks in every state. Two journeys: getting the tool, and updating it.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round8.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
