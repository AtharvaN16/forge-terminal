/**
 * Your own tools, round ten (2026-10-23): round nine's page with the user's
 * copy edits — the line under the name is only "Transcribe YouTube videos",
 * the card's From is now Path (the file itself), and the line under the
 * card is drawn with each wording on offer: a chip row repaints every
 * place it shows.
 *
 * Round nine, round eight reorganised (2026-10-23): the same screens as
 * own-tools-2026-10-round8.html, told as one story — where it lives, how the
 * panel is built (labelled), journey 1 with its two outcomes in lanes,
 * journey 2 — with each step cropped to the panel, keys in its caption.
 *
 * Round eight (2026-10-23). Round seven's three bare lines
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
 *   npx tsx scripts/own-tools-mockup-r10.ts   → mockups/own-tools-2026-10-round10.html
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
const GIVES = 'Transcribe YouTube videos'
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
const FROM: Fact = ['Path', v('/opt/homebrew/bin/yt-dlp')]
const BACK: Array<[string, string]> = [
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]
const LIST: Array<[string, string]> = [['↑↓', 'choose']]

/* J1 · find yours, or install Forge's */
/** The wordings on offer for the line under the card; '' is the key alone. */
const ASKS = [
  'Already have yt-dlp?',
  'Have your own copy?',
  'Installed it yourself?',
  'Using your own yt-dlp?',
  '',
] as const
function ask(words: string = ASKS[0]): Grid {
  const g = tool({
    action: '↵ install',
    facts: [
      ['Status', v('Not installed')],
      ['Size', v('37.1 MB download')],
    ],
    under: words
      ? [[`${words}  `, DIM], ...cap('c', 'check this Mac')]
      : cap('c', 'look for it on this Mac'),
  })
  keys(
    g,
    [...LIST, ['↵', 'install'], ['c', words ? 'check this Mac' : 'look for it on this Mac']],
    EXT_FOOT,
  )
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
      ['Path', v('Drop it here, or type it', QUIET)],
    ],
    field: 'Path',
  })
  keys(g, [['↵', 'install']], BACK)
  return g
}
function typed(): Grid {
  const g = tool({
    action: '↵ use it',
    facts: [
      ['Status', v('Not found on this Mac')],
      ['Path', v('~/tools/yt-dlp', FG)],
    ],
    field: 'Path',
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
/** The panel alone: right of the list's rule, under the header bar, down to `to`. */
const crop = (g: Grid, to = 15): Grid => g.slice(3, to + 1).map((r) => r.slice(37, R))
const full = (g: Grid) => {
  drawn.push(g)
  return termHtml(P, g)
}
const small = (g: Grid) => {
  drawn.push(g)
  return termHtml(P, crop(g)).replace('class="t"', 'class="t sm"')
}
/** Every wording's version of `draw`, only the chosen one shown (the chips switch them). */
const variants = (draw: (g: Grid) => string) =>
  ASKS.map(
    (w, i) => `<div class="cv" data-cv="${i}"${i === 0 ? '' : ' hidden'}>${draw(ask(w))}</div>`,
  ).join('')
/** A step: its number and name over the panel, its keys under it. */
const card = (n: string, name: string, g: Grid | string, keysText: string) =>
  `<figure class="st"><figcaption><span class="n">${n}</span>${name}</figcaption>${typeof g === 'string' ? g : small(g)}<div class="k">${keysText}</div></figure>`
const arrow = '<div class="ar">→</div>'
const lane = (label: string, ...cards: string[]) =>
  `<div class="lane">${label ? `<div class="ll">${label}</div>` : ''}<div class="row">${cards.join(arrow)}</div></div>`

/** The panel, labelled: badges on the left at its three blocks' rows. */
function anatomy(): string {
  const html = variants((g) => {
    drawn.push(g)
    return termHtml(P, crop(g)).replace('class="t"', 'class="t sm"')
  })
  // Crop row i sits at 14px padding + i × 14px (the small rows).
  const at = (row: number) => 10 + (row - 3) * 14
  const badge = (n: number, row: number) => `<span class="bd" style="top:${at(row)}px">${n}</span>`
  return `<div class="anat"><div class="pin">${html}${badge(1, 4)}${badge(2, 8)}${badge(3, 12)}</div>
<ol class="legend">
<li><b>Header</b> — the tool’s name and what it does. The button on the right is what ↵ does.</li>
<li><b>Facts</b> — Status, Path, Version, in the app’s bordered card. Status changes in place.</li>
<li><b>One more thing</b> — the only other action, with its key.</li>
</ol></div>`
}

const chips = `<div class="pick"><div class="pq">The line under the card — pick its words <span>(repaints every screen below)</span></div><div class="chips">${ASKS.map(
  (w, i) =>
    `<button class="chip${i === 0 ? ' on' : ''}" data-cv="${i}">${w ? `${w}  <b>c</b> check this Mac` : '<b>c</b> look for it on this Mac'}</button>`,
).join('')}</div></div>`

const story = `
${chips}
<div class="sec"><h2><span class="sn">1</span>Where this lives</h2>
<p class="lead">/extensions → YouTube links. Every step below shows only the panel on the right.</p>
${variants(full)}
</div>

<div class="sec"><h2><span class="sn">2</span>How the panel is built</h2>
<p class="lead">Three blocks, the same in every step. Only their words change.</p>
${anatomy()}
</div>

<div class="sec"><h2><span class="sn">3</span>Journey 1 — getting the tool</h2>
<p class="lead">Forge looks for yours by itself. If it didn’t find it, you can ask it to look, or install Forge’s copy.</p>
${lane('', card('1', 'Not installed', variants(small), '↵ install · c check this Mac'), card('2', 'Checking this Mac', checking(), 'esc stop'))}
${lane('If it’s found', card('3', 'Found on this Mac', found(), '↵ use it'), card('4', 'Uses your copy — Forge’s copy removed', inUse(), 'nothing to do'))}
${lane('If it’s not found', card('3', 'Drop it in, or type its path', notFound(), '↵ install Forge’s copy'), card('4', 'A path is in', typed(), '↵ use it'), card('5', 'Uses your copy', inUse(['Path', v('~/tools/yt-dlp')], false), 'nothing to do'))}
</div>

<div class="sec"><h2><span class="sn">4</span>Journey 2 — updating</h2>
<p class="lead">One key, for your copy too (Homebrew’s runs through Homebrew). The list marks the tool “update” meanwhile.</p>
${lane('', card('1', 'A new version', update(), '↵ update'), card('2', 'Updating', updating(), 'esc stop'), card('3', 'Up to date', updated(), 'nothing to do'))}
</div>

<div class="sec"><h2><span class="sn">5</span>Rules</h2>
<ul class="rules">
<li>Forge looks for yours by itself, in the places your terminal looks.</li>
<li>Using yours removes Forge’s copy. If yours goes, Forge offers its download again.</li>
<li>Only for tools you could have yourself: yt-dlp, ffmpeg. Boost and Remove background keep today’s panel.</li>
</ul>
<h3 class="wt">Words to approve</h3>
<p class="words">Transcribe YouTube videos · Status · Path · Size · Version · Not installed · 37.1 MB download · the chosen line under the card · c check this Mac · Checking this Mac · Found on this Mac · ↵ use it · Not found on this Mac · Drop it here, or type it · Uses your copy · latest · Forge’s copy removed · 37.1 MB freed · 2026.11.02 available · ↵ update · Updating with Homebrew</p>
</div>

<h2 class="vh">Your verdicts</h2>
<style>
.sec{margin:40px 0 0;padding:26px 0 0;border-top:1px solid #23252c}
.sec h2{display:flex;align-items:center;gap:12px;margin:0 0 6px;font-size:22px;padding-top:0;border-top:0}
.sec .sn{display:inline-flex;width:30px;height:30px;border-radius:15px;background:#e5a23c;color:#0c1d22;align-items:center;justify-content:center;font-size:15px;font-weight:700}
.sec .lead{color:#a9aebb;margin:0 0 18px;font-size:15px}
.t.sm{font-size:11px;padding:10px 12px}
.t.sm .r{height:14px}
.t.sm .r > span{height:14px;line-height:14px}
.lane{margin:0 0 22px}
.lane .ll{font:700 13px -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#e5a23c;margin:0 0 10px}
.lane .row{display:flex;align-items:flex-start;gap:14px;overflow-x:auto;padding-bottom:4px}
.ar{align-self:center;font-size:24px;color:#4a4f5a}
.st{margin:0;display:flex;flex-direction:column;gap:7px;flex:none}
.st figcaption{font:600 14px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:8px}
.st .n{display:inline-flex;width:22px;height:22px;border-radius:11px;background:#2a2d35;align-items:center;justify-content:center;font-size:12px}
.st .k{font:12.5px ui-monospace,Menlo,monospace;color:#8f94a1}
.anat{display:flex;gap:36px;align-items:flex-start}
.pin{position:relative;padding-left:34px}
.bd{position:absolute;left:0;display:inline-flex;width:24px;height:24px;border-radius:12px;background:#e5a23c;color:#0c1d22;font:700 13px -apple-system,sans-serif;align-items:center;justify-content:center;transform:translateY(-4px)}
.legend{margin:0;padding-left:20px;max-width:420px;font-size:15px;line-height:1.6;color:#d6d9e0}
.legend li{margin:0 0 10px}
.rules{font-size:15px;line-height:1.7;color:#d6d9e0;margin:0}
.wt{margin:22px 0 6px;font-size:15px}
.words{color:#a9aebb;font-size:14px;line-height:1.7;margin:0}
.vh{margin:56px 0 0;padding-top:26px;border-top:1px solid #23252c}
.pick{position:sticky;top:0;z-index:3;background:#0d0e11;padding:14px 0 12px;margin:24px 0 0}
.pq{font:600 14px -apple-system,sans-serif;color:#e2e4ea;margin:0 0 10px}
.pq span{color:#8f94a1;font-weight:400}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font:13px ui-monospace,Menlo,monospace;color:#d6d9e0;background:#1b1d22;border:1px solid #2c2f37;border-radius:8px;padding:8px 12px;cursor:pointer}
.chip b{background:#333;color:#e7e7e7;padding:0 5px;border-radius:3px}
.chip.on{border-color:#e5a23c;background:#2a2112;color:#f3d39d}
</style>
<script>
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => {
  for (const x of document.querySelectorAll('.chip')) x.classList.toggle('on', x === c)
  for (const v of document.querySelectorAll('.cv')) v.hidden = v.dataset.cv !== c.dataset.cv
})
</script>`

const concepts: PageConcept[] = [
  {
    id: 'J1',
    name: 'Journey 1 — getting the tool',
    idea: 'Section 3: not installed → checking → found / not found → uses your copy.',
    html: small(inUse()),
  },
  {
    id: 'J2',
    name: 'Journey 2 — updating',
    idea: 'Section 4: a new version → updating → up to date.',
    html: small(updated()),
  },
]

writeFileSync(
  'mockups/own-tools-2026-10-round10.html',
  feedbackPage({
    page: 'own-tools-2026-10-round10',
    title: 'Forge · tools you already have, round 10',
    heading: 'Tools you already have — /extensions',
    lede: 'When your Mac already has a tool Forge needs, Forge uses yours instead of downloading its own. Five short sections, top to bottom.',
    before: story,
    concepts,
    compact: true,
  }),
)
console.log('wrote mockups/own-tools-2026-10-round10.html')
if (process.env.DUMP)
  for (const g of drawn)
    console.log(`${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}\n${'='.repeat(N)}`)
