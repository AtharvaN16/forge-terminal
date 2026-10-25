/**
 * Presets UX, round four (2026-10-22). Earlier rounds: presets-ux-2026-10.html,
 * -round2.html, -round3.html.
 *
 * Round three, in chat and on the page: T1 (rule tabs) liked — the shown tab
 * gets a fill, "Presets (3)" in brackets, "Convert to" renamed Formats, tab's
 * key at the far end of the tabs' row. Home: M1, M3, M6 potential; M2, M4,
 * M7 hated; M5 disliked — still unsure, so the potentials are crossed and
 * pushed. Continue editing: J1 has potential and wants more visual
 * exploration; its list lacked Convert to / Quality / Compress (edit mode's
 * own picker has none) — every variant here lists them all, and every step
 * reruns from the original in one encode, so the hub shows the original.
 * J2 disliked; J3's working disliked; J4 folds into J1.
 *
 *   npx tsx scripts/presets-ux-mockup-r4.ts   → mockups/presets-ux-2026-10-round4.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { trailBarRow } from '../src/shell/bar-art.js'
import { windowOver } from '../src/shell/colour/system-art.js'
import type { Row, Run } from '../src/shell/home-art.js'
import { DARK, modePalette, type ShellMode } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, rowOf, termHtml, toGrid } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const load = (file: string) =>
  Object.fromEntries(
    Object.entries(
      JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as Record<string, Raw[][]>,
    ).map(([k, v]) => [
      k,
      v.map((r) =>
        r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
      ),
    ]),
  ) as Record<string, Grid>
const F1 = load('./presets-ux-frames.json')
const F2 = load('./presets-ux-frames-r2.json')
const F3 = load('./presets-ux-frames-r3.json')

const P = modePalette(DARK, 'convert')
const N = 80
const L = 4
const R = N - 4
const CANVAS = P.canvas
const ACCENT = P.accent
const COMPRESS = modePalette(DARK, 'compress').accent
const EDIT = modePalette(DARK, 'edit').accent
const INK = '#0c1d22'
const SEL = '#323232'
const SHELF = '#242424'
const ZONE = '#2c2c2c'
const CAP = P.keycapBg

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: CANVAS }))
const copy = (row: Cell[] | undefined): Cell[] => (row ?? blankRow()).map((c) => ({ ...c }))
const dup = (g: Grid): Grid => g.map(copy)
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)
const rlen = (row: Row) => row.reduce((n, r) => n + [...r.text].length, 0)
function put(row: Cell[], at: number, segs: Seg[]): Cell[] {
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg ?? CANVAS, b: !!bold }
      i++
    }
  return row
}
function clear(row: Cell[], from: number, to: number, bg: string): Cell[] {
  for (let i = from; i < to; i++) row[i] = { ch: ' ', bg }
  return row
}
const line = (at: number, segs: Seg[]) => put(blankRow(), at, segs)
const cap = (k: string, words: string): Seg[] => [
  [' ', undefined, CAP],
  [k, P.fg, CAP, true],
  [' ', undefined, CAP],
  [` ${words}`, P.dim],
]
function keyRow(
  main: Array<[string, string]>,
  foot: Array<[string, string]> = [
    ['esc', 'back'],
    ['ctrl-c', 'quit'],
  ],
): Cell[] {
  const left: Seg[] = main.flatMap(([k, w], i) => (i ? [['  '] as Seg, ...cap(k, w)] : cap(k, w)))
  const right: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[' · ', P.border]] as Seg[]) : []),
    [k, P.fg] as Seg,
    ...(w ? ([[` ${w}`, P.border]] as Seg[]) : []),
  ])
  // As the key row does when it runs out of room: the footnote's last item goes first.
  if (foot.length > 1 && len(left) + len(right) + 3 > R - L) return keyRow(main, foot.slice(0, -1))
  return put(put(blankRow(), L, left), R - len(right), right)
}
/** The lit row's button: quiet — the key grey, dim words — so it never pulls the eye. */
const SELECT: Seg[] = [[' ↵ select ', P.dim, CAP]]
const selectRuns: Run[] = [run(' ↵ select ', P.dim, CAP)]

const shot = (g: Grid) => termHtml(P, g)
const RULE = copy((F1.done as Grid)[22])
const chainSegs = (parts: string[], bg?: string): Seg[] =>
  parts.flatMap((t, i) =>
    i === 0 ? [[t, P.dim, bg] as Seg] : [[' → ', P.faint, bg] as Seg, [t, P.fg, bg, true] as Seg],
  )
const chainRuns = (parts: string[]): Run[] =>
  chainSegs(parts).map(([t, fg, bg, b]) => run(t, fg, bg, b))
/** A preset's steps alone, no source: `JPEG 80 → under 300 KB`. */
const stepSegs = (steps: string[], bg?: string): Seg[] =>
  steps.flatMap((t, i) =>
    i ? [[' → ', P.faint, bg] as Seg, [t, P.fg, bg, true] as Seg] : [[t, P.fg, bg, true] as Seg],
  )
const quiet = (segs: Seg[]): Seg[] => segs.map(([t, , bg]) => [t, P.border, bg, false])

function fit(H: number, rows: Cell[][], keys: Cell[]): Grid {
  const room = H - 2
  const out = rows.map(copy)
  while (out.length < room) out.push(blankRow())
  return [...out.slice(0, room), copy(RULE), keys]
}
/** The header bar as the app draws it, for a trail of our own. */
function header(mode: ShellMode, answers: string[], current: string, drift?: number): Cell[] {
  const bar = trailBarRow({
    width: N - 4,
    palette: DARK,
    mode,
    trail: { answers, current },
    slanted: false,
    ...(drift === undefined ? {} : { drift }),
  })
  return (
    toGrid([[run('  '), ...bar]], N)[0]?.map((c) => ({ ...c, bg: c.bg ?? CANVAS })) ?? blankRow()
  )
}
/** The file's card, rewritten: its kind in the top edge, its name and facts. */
function card(
  g: Grid,
  kind: string,
  name: string,
  facts: string,
  accent = ACCENT,
  at = 3,
  bg = CANVAS,
  x = 4,
): void {
  const top = g[at] as Cell[]
  const end = x + 50
  for (let i = x + 2; i < end; i++) top[i] = { ch: '─', fg: P.border, bg }
  put(top, x + 2, [
    [' ', undefined, bg],
    [kind, accent, bg],
    [' ', undefined, bg],
  ])
  put(clear(g[at + 1] as Cell[], x + 2, end, bg), x + 2, [[name, P.fg, bg]])
  put(clear(g[at + 2] as Cell[], x + 2, end, bg), x + 2, [[facts, P.fg, bg]])
}

/* ===================================================== 1 · tabs in the picker */

const PRESETS = [
  { name: 'webblog', steps: ['JPEG 80', 'under 300 KB'], size: '297 KB' },
  { name: 'social', steps: ['1080 wide', '1:1'], size: '214 KB' },
  { name: 'thumbs', steps: ['WebP', '400 wide'], size: '18 KB' },
]
const FORMATS = ['JPEG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PDF']
const top10 = () => (F2.picker as Grid).slice(0, 10).map(copy)
const pickKeys = (extra: Array<[string, string]> = []) =>
  keyRow(
    [['↑↓', 'choose'], ...extra, ['↵', 'confirm']],
    [
      ['esc', 'remove file'],
      ['ctrl-c', 'quit'],
    ],
  )

function listRow(
  name: string,
  lit: boolean,
  rest: Seg[] = [],
  o: { at?: number; to?: number; from?: number; accent?: string } = {},
): Cell[] {
  const from = o.from ?? 4
  const r = blankRow()
  if (lit) {
    clear(r, from, o.to ?? 56, SEL)
    put(r, from, [
      ['▌', o.accent ?? ACCENT, SEL],
      [' ', undefined, SEL],
      [name, P.fg, SEL, true],
    ])
    put(
      r,
      o.at ?? 22,
      rest.map(([t, fg, , b]) => [t, fg, SEL, b] as Seg),
    )
  } else {
    put(r, from + 2, [[name, P.fg]])
    put(r, o.at ?? 22, rest)
  }
  return r
}
const formatRows = (lit: boolean, o: { from?: number; to?: number } = {}) =>
  FORMATS.map((f, i) =>
    listRow(
      f,
      lit && i === 0,
      lit && i === 0
        ? [
            ['708 KB', P.fg, undefined, true],
            ['  96% smaller', P.ok],
          ]
        : [],
      { at: (o.from ?? 4) + 31, ...o },
    ),
  )
const presetRows = (lit: boolean, o: { from?: number; to?: number; at?: number } = {}) =>
  PRESETS.map((p, i) =>
    listRow(
      p.name,
      lit && i === 0,
      [
        ...(lit && i === 0 ? chainSegs(p.steps) : quiet(chainSegs(p.steps))),
        ...(lit && i === 0 ? ([[`   ${p.size}`, P.fg, undefined, true]] as Seg[]) : []),
      ],
      { at: (o.from ?? 4) + 18, ...o },
    ),
  )

type Tab = 'formats' | 'presets'
/** T1: /about's rule tabs — the title is the first tab, heavy rule under the one shown. */
function t1(on: Tab, video = false): Grid {
  const rows = video ? (F2.videoPicker as Grid).slice(0, 10).map(copy) : top10()
  const names = clear(rows[8] as Cell[], 0, N, CANVAS)
  const rule = clear(rows[9] as Cell[], 0, N, CANVAS)
  const tabs: Array<[string, boolean]> = [
    ['Convert to', on === 'formats'],
    [video ? 'Presets 2' : 'Presets 3', on === 'presets'],
  ]
  let x = 4
  for (const [t, lit] of tabs) {
    const w = t.length + 4
    put(names, x, [[`  ${t}  `, lit ? P.fg : P.dim, undefined, lit]])
    put(rule, x, [[(lit ? '━' : '─').repeat(w), lit ? ACCENT : P.faint]])
    x += w
  }
  put(rule, x, [['─'.repeat(R - x), P.faint]])
  let body: Cell[][]
  if (video) {
    body =
      on === 'formats'
        ? (F2.videoPicker as Grid).slice(10, 18).map(copy)
        : [
            blankRow(),
            listRow('clips', true, chainSegs(['MP4', '720p'])),
            listRow('voice', false, quiet(chainSegs(['M4A']))),
          ]
  } else body = [blankRow(), ...(on === 'formats' ? formatRows(true) : presetRows(true))]
  return fit(
    24,
    [...rows, ...body],
    keyRow(
      [
        [video && on === 'formats' ? '↑↓←→' : '↑↓', 'choose'],
        ['tab', on === 'formats' ? 'presets' : 'formats'],
        ['↵', 'confirm'],
      ],
      [
        ['esc', 'remove file'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}

/* ===================================================== 2 · presets on home */

const HOME = F3.home as Grid
const STAGED = F2.staged as Grid
const homeKeysIdle = () => copy(HOME[23])
/** The staged keys, as home draws them. */
const stagedKeys = () => copy(STAGED[23])

/** M1: a seventh tab, presets; shown, its list stands where the drop zone's dots were. */
function m1(open: boolean): Grid {
  const g = dup(HOME)
  const row = clear(g[7] as Cell[], 4, 76, CANVAS)
  const tabs: Array<[string, string]> = [
    ['1', 'convert'],
    ['2', 'compress'],
    ['3', 'pdf'],
    ['4', 'edit'],
    ['5', 'transcribe'],
    ['6', 'colour'],
    ['7', 'presets'],
  ]
  let x = 4
  for (const [n, t] of tabs) {
    const on = open ? t === 'presets' : t === 'convert'
    if (on) {
      if (x > 4) x -= 1
      const bg = '#262626'
      put(row, x, [
        [' ', undefined, bg],
        [n, ACCENT, bg, true],
        [' ', undefined, bg],
        [t, P.fg, bg, true],
        [' ', undefined, bg],
      ])
      x += n.length + t.length + 3 + 1
    } else {
      put(row, x, [[n, P.border], [' '], [t, P.dim]])
      x += n.length + 1 + t.length + 2
    }
  }
  if (open) {
    for (let r = 8; r <= 14; r++) clear(g[r] as Cell[], 4, 76, ZONE)
    PRESETS.forEach((p, i) => {
      const r = g[10 + i] as Cell[]
      const lit = i === 0
      if (lit) clear(r, 6, 74, '#383838')
      const bg = lit ? '#383838' : ZONE
      put(r, 6, [
        [lit ? '▌ ' : '  ', ACCENT, bg],
        [p.name.padEnd(12), P.fg, bg, lit],
        ...(lit ? stepSegs(p.steps, bg) : quiet(stepSegs(p.steps, bg))),
      ])
    })
  }
  return g
}

/** M3: a quiet shelf of presets under the field, above the menu's corner. */
function m3(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  const r = g[19] as Cell[]
  const segs: Seg[] = []
  PRESETS.forEach((p, i) => {
    const off = staged && i === 2
    if (i) segs.push(['  '])
    segs.push([` ${p.name} `, off ? P.faint : P.dim, CAP])
  })
  put(r, 6, segs)
  return g
}

/** M6: nothing shown but a key, beside / menu; p opens the presets as / opens the menu. */
function m6(open: boolean): Grid {
  const g = dup(HOME)
  const r = g[21] as Cell[]
  put(r, 54, [
    [' p ', P.fg, CAP],
    [' presets', P.dim],
  ])
  if (!open) return g
  const lines: Row[] = [
    [],
    ...PRESETS.map((p, i): Row => {
      const lit = i === 0
      const bg = lit ? P.panelBand : undefined
      const row: Row = [
        run(lit ? ' › ' : '   ', ACCENT, bg, true),
        run(p.name.padEnd(10), P.fg, bg, lit),
        ...stepSegs(p.steps).map(([t, fg, bg, b]) => run(t, lit ? fg : P.border, bg, lit && b)),
      ]
      const w = rlen(row)
      return [...row, run(' '.repeat(Math.max(0, 38 - w)), undefined, bg)]
    }),
    [],
  ]
  const under = HOME.slice(2, 22).map(rowOf)
  const mid = windowOver(P, under, {
    title: 'Presets',
    lines,
    width: 40,
    columns: N,
    top: 12,
    left: 36,
  }).slice(0, 20)
  return [
    copy(HOME[0]),
    copy(HOME[1]),
    ...toGrid(mid, N).map((row) => row.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
    copy(HOME[22]),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'run on a file'],
      ],
      [['esc', 'close']],
    ),
  ]
}

/* ===================================================== 3 · continue editing, end to end */

const DONE_NEW = F3.done as Grid
const TRAIL = ['JPEG', '80', 'Desktop', 'IMG_2041.jpg']

/** A list row in the flows: the band and ▌ when lit, the quiet ↵ select at its far end. */
function flowRow(
  name: string,
  lit: boolean,
  rest: Seg[] = [],
  o: { accent?: string; to?: number; at?: number } = {},
): Cell[] {
  const to = o.to ?? 76
  const r = listRow(name, lit, rest, { accent: o.accent ?? ACCENT, to, at: o.at ?? 24 })
  if (lit) put(r, to - len(SELECT) - 1, SELECT)
  return r
}

/** The working screen as every job shows it: the header drifting, the card, one line, a clock. */
function working(
  mode: ShellMode,
  answers: string[],
  current: string,
  cardKind: string,
  cardFacts: string,
  what: Seg[],
  clock: string,
): Grid {
  const g = dup(F2.working as Grid)
  g[1] = header(mode, answers, current, 1.2)
  card(g, cardKind, 'IMG_2041.jpg', cardFacts, modePalette(DARK, mode).accent)
  const w = clear(g[8] as Cell[], 0, N, CANVAS)
  put(w, 6, what)
  put(w, 64, [[clock, P.border]])
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [],
      [
        ['esc', 'stop'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}

/* J1: edit mode, carried on */
function j1Picker(stage: 'open' | 'after' | 'leave'): Grid {
  const g = dup(F3.editPicker as Grid)
  g[1] = header(
    'edit',
    stage === 'open' ? ['JPEG 80', 'IMG_2041.jpg'] : ['JPEG 80', 'IMG_2041.jpg', 'Resize'],
    stage === 'leave' ? 'Done' : 'Edit',
  )
  if (stage !== 'open') card(g, 'JPEG', 'IMG_2041.jpg', '1920×1280 · 402 KB', EDIT)
  const t = clear(g[8] as Cell[], 0, N, CANVAS)
  put(t, 4, [['Edit JPEG', EDIT, undefined, true]])
  const steps = stage === 'open' ? ['PNG', 'JPEG 80'] : ['PNG', 'JPEG 80', '1920 wide']
  put(t, R - len(chainSegs(steps)), chainSegs(steps))
  for (let i = 10; i <= 21; i++) clear(g[i] as Cell[], 0, N, CANVAS)
  if (stage === 'leave') {
    const rows: Array<[string, Seg[]]> = [
      ['Save as preset', quiet(chainSegs(steps))],
      ['Keep IMG_2041.jpg', []],
    ]
    rows.forEach(
      ([n, rest], i) =>
        (g[10 + i] = flowRow(n, i === 0, i === 0 ? chainSegs(steps) : rest, {
          accent: EDIT,
          at: 26,
        })),
    )
    ;(g[23] as Cell[]).splice(
      0,
      N,
      ...keyRow(
        [
          ['↑↓', 'choose'],
          ['↵', 'select'],
        ],
        [
          ['esc', 'back to edit'],
          ['ctrl-c', 'quit'],
        ],
      ),
    )
    return g
  }
  const items: Array<[string, string]> = [
    ['Done', stage === 'open' ? '1 step' : '2 steps'],
    ['', ''],
    ['Sharpen', ''],
    ['Boost resolution', ''],
    ['Remove background', ''],
    ['Trim edges', 'no empty edges'],
    ['Resize', stage === 'after' ? '✓ 1920 wide' : ''],
    ['Crop to shape', ''],
  ]
  items.forEach(([n, v], i) => {
    if (!n) return
    const lit = stage === 'after' ? n === 'Done' : n === 'Resize'
    const tone = v.startsWith('✓') ? P.ok : n === 'Trim edges' ? P.faint : P.dim
    g[10 + i] = flowRow(n, lit, v ? [[v, tone]] : [], { accent: EDIT })
  })
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'select'],
      ],
      [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}
function j1Resize(): Grid {
  const g = dup(F3.resize as Grid)
  g[1] = header('edit', ['JPEG 80', 'IMG_2041.jpg', 'Resize'], 'Size')
  return g
}

/* --------------------------------------------------------------- figures */

const fr = (g: Grid, caption?: string) =>
  `<figure class="fr">${caption ? `<div class="ft">${caption}</div>` : ''}${shot(g)}</figure>`
const pair = (...parts: string[]) => `<div class="pair">${parts.join('')}</div>`
const flow = (...steps: Array<[Grid, string]>) =>
  `<div class="flow">${steps.map(([g, c]) => fr(g, c)).join('<div class="arrow">→</div>')}</div>`

/* ===================================================== 1 · T1, refined */

type Fill = 'grey' | 'tint' | 'solid'
/**
 * T1 as asked in round three: the tabs are Formats and Presets (3), the one
 * shown on a fill of its own above the heavy rule, and tab's cap at the far
 * end of the tabs' row instead of on the key row.
 */
function tabRows(on: Tab, fill: Fill, video = false): [Cell[], Cell[]] {
  const names = blankRow()
  const rule = blankRow()
  const tabs: Array<[string, boolean]> = [
    ['Formats', on === 'formats'],
    [video ? 'Presets (2)' : 'Presets (3)', on === 'presets'],
  ]
  let x = 4
  for (const [t, lit] of tabs) {
    const w = t.length + 4
    const [fg, bg]: [string, string | undefined] = !lit
      ? [P.dim, undefined]
      : fill === 'grey'
        ? [P.fg, P.panelBand]
        : fill === 'tint'
          ? [ACCENT, P.modeConvertBg]
          : [INK, ACCENT]
    put(names, x, [[`  ${t}  `, fg, bg, lit]])
    put(rule, x, [[(lit ? '━' : '─').repeat(w), lit ? ACCENT : P.faint]])
    x += w
  }
  put(rule, x, [['─'.repeat(R - x), P.faint]])
  put(names, R - 5, [[' tab ', P.dim, CAP]])
  return [names, rule]
}
function t1r(on: Tab, fill: Fill, video = false): Grid {
  const rows = video ? (F2.videoPicker as Grid).slice(0, 10).map(copy) : top10()
  const [names, rule] = tabRows(on, fill, video)
  rows[8] = names
  rows[9] = rule
  let body: Cell[][]
  if (video) {
    body =
      on === 'formats'
        ? (F2.videoPicker as Grid).slice(10, 18).map(copy)
        : [
            blankRow(),
            listRow('clips', true, chainSegs(['MP4', '720p'])),
            listRow('voice', false, quiet(chainSegs(['M4A']))),
          ]
  } else body = [blankRow(), ...(on === 'formats' ? formatRows(true) : presetRows(true))]
  return fit(
    24,
    [...rows, ...body],
    keyRow(
      [
        [video && on === 'formats' ? '↑↓←→' : '↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      [
        ['esc', 'remove file'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}
/** The tabs' two rows alone, both states, for the fills side by side at a size the eye can compare. */
const strip = (fill: Fill) =>
  `<div class="strips">${(['formats', 'presets'] as Tab[])
    .map(
      (on) =>
        `<div class="strip"><span class="mlabel">${on === 'formats' ? 'Formats shown' : 'Presets shown'}</span>${shot(tabRows(on, fill))}</div>`,
    )
    .join('')}</div>`

/* ===================================================== 2 · presets on home, again */

const pill = (name: string, o: { lit?: boolean; off?: boolean } = {}): Seg => [
  ` ${name} `,
  o.lit ? P.fg : o.off ? P.faint : P.dim,
  o.lit ? P.panelBand : CAP,
  !!o.lit,
]

/** N1: M3's shelf with a key — p before the pills, p puts you in them. */
function n1(focused: boolean): Grid {
  const g = dup(focused ? STAGED : HOME)
  const r = g[19] as Cell[]
  const segs: Seg[] = [[' p ', P.fg, CAP, true], ['  ']]
  PRESETS.forEach((p, i) => {
    if (i) segs.push([' '])
    segs.push(pill(p.name, { lit: focused && i === 0 }))
  })
  put(r, 4, segs)
  if (focused) put(g[20] as Cell[], 9, stepSegs(PRESETS[0]?.steps ?? []))
  if (focused)
    (g[23] as Cell[]).splice(
      0,
      N,
      ...keyRow(
        [
          ['←→', 'choose'],
          ['↵', 'run on IMG_2041.png'],
        ],
        [
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ],
      ),
    )
  return g
}

/** N2: nothing until it can run — idle home is today's; a staged file brings the shelf, only what applies. */
function n2(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  if (!staged) return g
  const r = g[19] as Cell[]
  const segs: Seg[] = [[' p ', P.fg, CAP, true], ['  ']]
  PRESETS.slice(0, 2).forEach((p, i) => {
    if (i) segs.push([' '])
    segs.push(pill(p.name))
  })
  put(r, 4, segs)
  return g
}

/** N3: the seventh tab, only once there are presets; shown, the drop zone stays and the list sits under the field. */
function n3(staged: boolean): Grid {
  const g = m1(false)
  if (staged) {
    for (const r of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) g[r] = copy(STAGED[r])
  }
  // Presets lit in the tab row.
  const row = clear(g[7] as Cell[], 4, 76, CANVAS)
  const tabs: Array<[string, string]> = [
    ['1', 'convert'],
    ['2', 'compress'],
    ['3', 'pdf'],
    ['4', 'edit'],
    ['5', 'transcribe'],
    ['6', 'colour'],
    ['7', 'presets'],
  ]
  let x = 4
  for (const [n, t] of tabs) {
    if (t === 'presets') {
      x -= 1
      const bg = '#262626'
      put(row, x, [
        [' ', undefined, bg],
        [n, ACCENT, bg, true],
        [' ', undefined, bg],
        [t, P.fg, bg, true],
        [' ', undefined, bg],
      ])
    } else put(row, x, [[n, P.border], [' '], [t, P.dim]])
    x += n.length + 1 + t.length + 2
  }
  PRESETS.forEach((p, i) => {
    const r = g[18 + i] as Cell[]
    const lit = i === 0
    if (lit) clear(r, 4, 60, SEL)
    put(r, 4, [
      [lit ? '▌ ' : '  ', ACCENT, lit ? SEL : undefined],
      [p.name.padEnd(12), P.fg, lit ? SEL : undefined, lit],
      ...(lit ? stepSegs(p.steps, SEL) : quiet(stepSegs(p.steps))),
    ])
  })
  if (staged)
    (g[23] as Cell[]).splice(
      0,
      N,
      ...keyRow(
        [
          ['↑↓', 'choose'],
          ['↵', 'run on IMG_2041.png'],
        ],
        [
          ['1–7 ←→', 'mode'],
          ['ctrl-c', 'quit'],
        ],
      ),
    )
  return g
}

/** N4: p opens the / menu at its Presets — the place presets already live — instead of a home of their own. */
function n4(open: boolean): Grid {
  if (!open) {
    const g = dup(HOME)
    put(g[21] as Cell[], 54, [
      [' p ', P.fg, CAP],
      [' presets', P.dim],
    ])
    return g
  }
  const g = dup(F1.menu as Grid)
  const GOLD = '#e5a23c'
  const MSHELF = '#2c2c2c'
  const section = (name: string, row: number) => {
    const r = clear(g[row] as Cell[], 4, 72, MSHELF)
    put(r, 8, [
      [name, GOLD, MSHELF, true],
      [' ', undefined, MSHELF],
      ['─'.repeat(72 - 9 - name.length), P.faint, MSHELF],
    ])
  }
  const item = (row: number, cmd: string, words: string, lit: boolean) => {
    const bg = lit ? P.panelBand : MSHELF
    const r = clear(g[row] as Cell[], lit ? 6 : 4, 72, bg)
    if (lit)
      put(r, 4, [
        ['  ', undefined, MSHELF],
        ['▌', GOLD, bg],
        [' ', undefined, bg],
      ])
    put(r, 8, [
      [cmd, P.fg, bg, lit],
      [' '.repeat(Math.max(1, 14 - cmd.length)), undefined, bg],
      [words, lit ? P.dim : P.border, bg],
    ])
  }
  for (let row = 4; row <= 16; row++) clear(g[row] as Cell[], 4, 72, MSHELF)
  section('Presets', 4)
  item(6, '/webblog', 'JPEG 80 → under 300 KB', true)
  item(7, '/social', '1080 wide → 1:1', false)
  item(8, '/thumbs', 'WebP → 400 wide', false)
  section('Settings', 10)
  for (const [i, c] of ['/theme', '/extensions', '/right-click', '/cli', '/update'].entries())
    item(12 + i, c, '', false)
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'open'],
      ],
      [
        ['esc', 'close'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}

/** N5: p presets as a key chip in the field's far end, beside ↵ enter; p opens them just above the field. */
function n5(open: boolean): Grid {
  const g = dup(STAGED)
  const f = g[16] as Cell[]
  const chipAt = 74 - 9
  put(f, chipAt - 13, [
    [' p presets ', P.dim, CAP],
    ['  ', undefined, SHELF],
  ])
  if (!open) return g
  const lines: Row[] = [
    [],
    ...PRESETS.slice(0, 2).map((p, i): Row => {
      const lit = i === 0
      const bg = lit ? P.panelBand : undefined
      const row: Row = [
        run(lit ? ' › ' : '   ', ACCENT, bg, true),
        run(p.name.padEnd(10), P.fg, bg, lit),
        ...stepSegs(p.steps).map(([t, fg, b2, b]) =>
          run(t, lit ? fg : P.border, b2 ?? bg, lit && b),
        ),
      ]
      return [...row, run(' '.repeat(Math.max(0, 38 - rlen(row))), undefined, bg)]
    }),
    [],
  ]
  const under = STAGED.slice(2, 22).map(rowOf)
  const mid = windowOver(P, under, {
    title: 'Presets',
    lines,
    width: 40,
    columns: N,
    top: 8,
    left: 34,
  }).slice(0, 20)
  return [
    copy(STAGED[0]),
    copy(STAGED[1]),
    ...toGrid(mid, N).map((row) => row.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
    copy(STAGED[22]),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'run on IMG_2041.png'],
      ],
      [['esc', 'close']],
    ),
  ]
}

/* ===================================================== 3 · J1, drawn several ways */

type Stage = 'open' | 'working' | 'after' | 'leave'
interface Op {
  group: string
  name: string
  value: string
  on?: boolean
  dead?: boolean
}
function opsAt(stage: Stage): Op[] {
  const resized = stage === 'after' || stage === 'leave'
  return [
    { group: 'Format', name: 'Convert to', value: 'JPEG', on: true },
    { group: 'Format', name: 'Quality', value: '80', on: true },
    { group: 'Format', name: 'Compress', value: '' },
    {
      group: 'Size and shape',
      name: 'Resize',
      value: resized || stage === 'working' ? '1920 wide' : '',
      on: resized,
    },
    { group: 'Size and shape', name: 'Crop to shape', value: '' },
    { group: 'Size and shape', name: 'Trim edges', value: 'no empty edges', dead: true },
    { group: 'On-device models', name: 'Sharpen', value: 'not added', dead: true },
    { group: 'On-device models', name: 'Boost resolution', value: 'not added', dead: true },
    { group: 'On-device models', name: 'Remove background', value: 'not added', dead: true },
  ]
}
const stepsAt = (stage: Stage) =>
  stage === 'open' || stage === 'working' ? ['PNG', 'JPEG 80'] : ['PNG', 'JPEG 80', '1920 wide']
const nowAt = (stage: Stage) => (stage === 'open' || stage === 'working' ? '708 KB' : '402 KB')

/** One operation as a row: ▌ and the band when lit, ✓ and its value when it is one of your steps, quiet select at the end. */
function opLine(
  op: Op,
  o: { lit?: boolean; spin?: boolean; faint?: boolean; from?: number; to?: number } = {},
): Cell[] {
  const from = o.from ?? 4
  const to = o.to ?? 76
  const r = blankRow()
  const bg = o.lit ? SEL : undefined
  if (o.lit) clear(r, from, to, SEL)
  const tone = o.faint || op.dead ? P.faint : op.on || o.lit ? P.fg : P.dim
  put(r, from, [
    [o.lit ? '▌' : ' ', ACCENT, bg],
    [' ', undefined, bg],
    [op.name.padEnd(19), tone, bg, !!o.lit && !o.faint],
  ])
  const value: Seg[] = o.spin
    ? [
        ['⠹ ', ACCENT, bg, true],
        [op.value, P.fg, bg],
      ]
    : op.on
      ? [
          ['✓ ', o.faint ? P.faint : P.ok, bg, true],
          [op.value, o.faint ? P.faint : P.fg, bg],
        ]
      : op.value
        ? [['  '], [op.value, op.dead || o.faint ? P.faint : P.border, bg]]
        : []
  put(r, from + 2 + 19, value)
  if (o.lit) put(r, to - len(SELECT) - 1, SELECT)
  return r
}
const doneLine = (stage: Stage, lit: boolean, o: { from?: number; to?: number } = {}) =>
  opLine(
    {
      group: '',
      name: 'Done',
      value: stage === 'open' || stage === 'working' ? '1 step' : '2 steps',
    },
    { lit, ...o },
  )

function hubFrame(stage: Stage, top: Cell[][], body: Cell[][], keys?: Cell[]): Grid {
  const head = header(
    'convert',
    ['JPEG', '80', 'IMG_2041.jpg'],
    stage === 'working' ? 'Resizing' : stage === 'leave' ? 'Done' : 'Continue editing',
    stage === 'working' ? 1.2 : undefined,
  )
  const k =
    keys ??
    (stage === 'working'
      ? keyRow(
          [],
          [
            ['esc', 'stop'],
            ['ctrl-c', 'quit'],
          ],
        )
      : keyRow(
          [
            ['↑↓', 'choose'],
            ['↵', 'select'],
          ],
          [
            ['esc', stage === 'leave' ? 'back to steps' : 'back to Done'],
            ['ctrl-c', 'quit'],
          ],
        ))
  return fit(24, [blankRow(), head, blankRow(), ...top, ...body], k)
}
/** The file line every variant opens with: the original, and what it is now. */
function fileLine(stage: Stage): Cell[] {
  const r = blankRow()
  put(r, 4, [
    ['IMG_2041.png', P.fg, undefined, true],
    ['   16 MB', P.dim],
  ])
  const now: Seg[] =
    stage === 'working'
      ? [
          ['now ', P.border],
          [nowAt(stage), P.fg, undefined, true],
          ['  →  ', P.faint],
          ['…', P.dim],
        ]
      : [
          ['now ', P.border],
          [nowAt(stage), P.ok, undefined, true],
        ]
  put(r, R - len(now), now)
  return r
}
function leaveRows(stage: Stage): Cell[][] {
  return [
    opLine({ group: '', name: 'Save as preset', value: '' }, { lit: true }),
    opLine({ group: '', name: 'Keep IMG_2041.jpg', value: '' }),
  ]
}

/** J5: one list of everything, in three groups; your steps ticked with their values. */
function j5(stage: Stage): Grid {
  const top = [fileLine(stage), put(blankRow(), 4, chainSegs(stepsAt(stage))), blankRow()]
  if (stage === 'leave') return hubFrame(stage, top, leaveRows(stage))
  const body: Cell[][] = [doneLine(stage, stage === 'after')]
  let group = ''
  for (const op of opsAt(stage)) {
    if (op.group !== group) {
      group = op.group
      body.push(blankRow(), put(blankRow(), 6, [[group, P.border]]))
    }
    const lit = stage === 'open' ? op.name === 'Resize' : false
    body.push(
      opLine(op, {
        lit,
        spin: stage === 'working' && op.name === 'Resize',
        faint: stage === 'working' && op.name !== 'Resize',
      }),
    )
  }
  return hubFrame(stage, top, body)
}

/** J6: your steps as pills along the top; the list below is only what can be added. */
function j6(stage: Stage): Grid {
  const pills: Seg[] = []
  stepsAt(stage)
    .slice(1)
    .forEach((s, i) => {
      if (i) pills.push([' '])
      pills.push([` ${s} `, P.fg, CAP])
    })
  const r = blankRow()
  put(r, 4, [['PNG', P.dim], ['  ']])
  put(r, 9, pills)
  const top = [fileLine(stage), r, blankRow()]
  if (stage === 'leave') return hubFrame(stage, top, leaveRows(stage))
  const body: Cell[][] = [doneLine(stage, stage === 'after'), blankRow()]
  for (const op of opsAt(stage).filter((o) =>
    !o.on && !(stage === 'working' && o.name === 'Resize')
      ? true
      : stage === 'working' && o.name === 'Resize',
  )) {
    const lit = stage === 'open' && op.name === 'Resize'
    body.push(
      opLine(
        { ...op, on: false, value: op.dead ? op.value : '' },
        {
          lit,
          spin: stage === 'working' && op.name === 'Resize',
          faint: stage === 'working' && op.name !== 'Resize',
        },
      ),
    )
  }
  return hubFrame(stage, top, body)
}

/** J7: two columns — your steps on the left with Done under them, what to add on the right. */
function j7(stage: Stage): Grid {
  const top = [fileLine(stage), blankRow()]
  if (stage === 'leave')
    return hubFrame(
      stage,
      [...top, put(blankRow(), 4, chainSegs(stepsAt(stage))), blankRow()],
      leaveRows(stage),
    )
  const body: Cell[][] = Array.from({ length: 12 }, blankRow)
  put(body[0] as Cell[], 6, [['Your steps', P.border]])
  put(body[0] as Cell[], 42, [['Add', P.border]])
  const mine = opsAt(stage).filter((o) => o.on)
  mine.forEach((op, i) => {
    const line = opLine(op, { from: 4, to: 38, faint: stage === 'working' })
    for (let x = 4; x < 38; x++) (body[2 + i] as Cell[])[x] = line[x] as Cell
  })
  const done = doneLine(stage, stage === 'after', { from: 4, to: 38 })
  for (let x = 4; x < 38; x++) (body[3 + mine.length] as Cell[])[x] = done[x] as Cell
  const rest = opsAt(stage).filter((o) => !o.on)
  rest.forEach((op, i) => {
    const lit = stage === 'open' && op.name === 'Resize'
    const line = opLine(
      { ...op, value: op.dead ? op.value : '' },
      {
        from: 40,
        to: 76,
        lit,
        spin: stage === 'working' && op.name === 'Resize',
        faint: stage === 'working' && op.name !== 'Resize',
      },
    )
    for (let x = 40; x < 76; x++) (body[2 + i] as Cell[])[x] = line[x] as Cell
  })
  for (let i = 0; i < 12; i++) put(body[i] as Cell[], 39, [['│', P.faint]])
  return hubFrame(
    stage,
    top,
    body,
    stage === 'working'
      ? undefined
      : keyRow(
          [
            ['↑↓', 'choose'],
            ['←→', 'steps · add'],
            ['↵', 'select'],
          ],
          [
            ['esc', 'back to Done'],
            ['ctrl-c', 'quit'],
          ],
        ),
  )
}

/** J8: was and now as two bars on top, the way Done says it; the list under them. */
function j8(stage: Stage): Grid {
  const BAR = 56
  const was = blankRow()
  put(was, 4, [
    ['was ', P.border],
    ['16 MB'.padEnd(8), P.fg, undefined, true],
  ])
  put(was, 17, [[' '.repeat(BAR), undefined, ZONE]])
  const now = blankRow()
  const kb = stage === 'open' || stage === 'working' ? 708 : 402
  const w = Math.max(1, Math.round((BAR * kb) / 16000))
  put(now, 4, [
    ['now ', P.border],
    [nowAt(stage).padEnd(8), stage === 'working' ? P.fg : P.ok, undefined, true],
  ])
  put(now, 17, [
    [' '.repeat(w), undefined, P.modeConvertBg === '' ? ACCENT : '#2a6a78'],
    ...(stage === 'working' ? ([['  ⠹', ACCENT, undefined, true]] as Seg[]) : []),
  ])
  const top = [was, now, blankRow(), put(blankRow(), 4, chainSegs(stepsAt(stage))), blankRow()]
  if (stage === 'leave') return hubFrame(stage, top, leaveRows(stage))
  const body: Cell[][] = [doneLine(stage, stage === 'after'), blankRow()]
  for (const op of opsAt(stage)) {
    const lit = stage === 'open' && op.name === 'Resize'
    body.push(
      opLine(op, {
        lit,
        spin: stage === 'working' && op.name === 'Resize',
        faint: stage === 'working' && op.name !== 'Resize',
      }),
    )
  }
  return hubFrame(stage, top, body)
}

/* ------------------------------------------------------------ concepts */

const j1Flow = flow(
  [DONE_NEW, '1 · Done — e'],
  [j1Picker('open'), '2 · edit’s picker, on the JPEG'],
  [j1Resize(), '3 · Resize, its own screen'],
  [
    working(
      'edit',
      ['JPEG 80', 'IMG_2041.jpg', 'Resize', '1920 wide'],
      'Resizing',
      'JPEG',
      '3000×2000 · 708 KB',
      [
        ['Resizing', P.fg, undefined, true],
        [' to 1920 wide', P.dim],
      ],
      '0.8s',
    ),
    '4 · working, as every job',
  ],
  [j1Picker('after'), '5 · back, ✓ Resize'],
  [j1Picker('leave'), '6 · Done — save or keep'],
)
const variant = (f: (s: Stage) => Grid, withWorking = false) =>
  flow(
    [f('open'), '2 · e — everything, one list'],
    ...(withWorking
      ? ([[f('working'), '3 · Resize set — it works here']] as Array<[Grid, string]>)
      : []),
    [f('after'), `${withWorking ? '4' : '3'} · back, ✓ Resize`],
    [f('leave'), `${withWorking ? '5' : '4'} · Done — save or keep`],
  )

const concepts: PageConcept[] = [
  /* 1 · tabs */
  {
    id: 'T1',
    tab: '1 · Tabs',
    section: 'Liked in round three',
    earlier: 'like',
    name: 'Rule tabs, as /about has (round three)',
    idea: 'As drawn in round three, for comparison.',
    html: pair(fr(t1('formats'), 'formats'), fr(t1('presets'), 'tab — presets')),
  },
  {
    id: 'T7',
    section:
      'T1 as you asked: Formats and Presets (3), the shown tab filled, tab’s key at the far end of the tabs’ row. Only the fill differs',
    name: 'Grey fill',
    idea: 'MY PICK. The shown tab on the lifted grey the app uses for a lit row in a window (#404040), white words; the heavy rule stays in the mode colour under it. Quiet, like Done’s focused button.',
    html: `${strip('grey')}${pair(fr(t1r('formats', 'grey'), 'formats'), fr(t1r('presets', 'grey'), 'tab — presets'))}${pair(fr(t1r('formats', 'grey', true), 'a video'), fr(t1r('presets', 'grey', true), 'a video — presets'))}`,
  },
  {
    id: 'T8',
    name: 'Mode tint fill',
    idea: 'The shown tab on the mode’s tint, its words in the mode colour — the same pair Home’s button wears on Done.',
    html: `${strip('tint')}${pair(fr(t1r('formats', 'tint'), 'formats'), fr(t1r('presets', 'tint'), 'tab — presets'))}`,
  },
  {
    id: 'T9',
    name: 'Solid fill',
    idea: 'The shown tab solid in the mode colour, dark words, running straight into its heavy rule. The loudest.',
    html: `${strip('solid')}${pair(fr(t1r('formats', 'solid'), 'formats'), fr(t1r('presets', 'solid'), 'tab — presets'))}`,
  },

  /* 2 · home */
  {
    id: 'M1',
    tab: '2 · Presets on home',
    section: 'Potential in round three',
    earlier: 'potential',
    name: 'A seventh tab (round three)',
    idea: 'As drawn in round three.',
    html: pair(fr(m1(false), 'idle'), fr(m1(true), '7 — presets')),
  },
  {
    id: 'M3',
    earlier: 'potential',
    name: 'A quiet shelf under the field (round three)',
    idea: 'As drawn in round three.',
    html: pair(fr(m3(false), 'idle'), fr(m3(true), 'a photo staged')),
  },
  {
    id: 'M6',
    earlier: 'potential',
    name: 'One key, beside / menu (round three)',
    idea: 'As drawn in round three.',
    html: pair(fr(m6(false), 'idle'), fr(m6(true), 'p')),
  },
  {
    id: 'N1',
    section: 'The three, pushed and crossed',
    name: 'The shelf, with its key',
    idea: 'MY PICK. M3’s quiet pills under the field, led by p — M6’s key. p puts you in the shelf, ←→ moves along it, the lit one’s steps show under it, ↵ runs it on the staged file.',
    html: pair(fr(n1(false), 'idle'), fr(n1(true), 'a photo staged — p')),
  },
  {
    id: 'N2',
    name: 'Only once a file is staged',
    idea: 'Idle home stays exactly as today. Stage a file and the shelf appears with just the presets that can run on it (here two of three).',
    html: pair(fr(n2(false), 'idle — as today'), fr(n2(true), 'a photo staged')),
  },
  {
    id: 'N3',
    name: 'The seventh tab, keeping the drop zone',
    idea: 'M1, but showing presets keeps the drop zone and the field as they are; the list sits under the field. The tab only appears once you have a preset.',
    html: pair(fr(n3(false), '7 — presets'), fr(n3(true), 'a photo staged')),
  },
  {
    id: 'N4',
    name: 'p opens the menu at its presets',
    idea: 'M6’s key, but no new window: p opens the / menu, where presets already live (round one), straight at its Presets section.',
    html: pair(fr(n4(false), 'idle'), fr(n4(true), 'p')),
  },
  {
    id: 'N5',
    name: 'p presets in the field, beside ↵ enter',
    idea: 'M6’s key moves into the field, as a quiet chip next to ↵ enter, so it sits right where the file is. p opens the presets that apply just above the field.',
    html: pair(fr(n5(false), 'a photo staged'), fr(n5(true), 'p')),
  },

  /* 3 · J1 */
  {
    id: 'J1',
    tab: '3 · Continue editing (J1)',
    section: 'Potential in round three',
    earlier: 'potential',
    name: 'Edit mode, carried on (round three)',
    idea: 'As drawn in round three. Its list was edit mode’s own — no Convert to, Quality or Compress, which is why it differed from the others. The variants below list everything.',
    html: j1Flow,
  },
  {
    id: 'J5',
    section:
      'J1, drawn several ways. Every variant lists every operation and shows the original — each step reruns from it in one encode, so nothing is compressed twice. Between “e” and “back”, each step runs its own screen and the working screen, as in J1 above (except J9)',
    name: 'One list, in groups',
    idea: 'MY PICK. The original and what it is now on top, your steps under it, then Done and every operation in three groups — Format, Size and shape, On-device models. Your steps carry a ✓ and their value.',
    html: variant(j5),
  },
  {
    id: 'J6',
    name: 'Your steps as pills, the list is what’s left',
    idea: 'Your steps sit along the top as grey pills; the list below only holds what you can still add. Two things, kept apart.',
    html: variant(j6),
  },
  {
    id: 'J7',
    name: 'Two columns: your steps, and add',
    idea: 'Left: your steps, Done under them. Right: what you can add. ←→ between them.',
    html: variant(j7),
  },
  {
    id: 'J8',
    name: 'Was and now on top',
    idea: 'Two bars on top — the original and the file as it is now — the way Done says it, so each step’s effect is seen at once. The list under them.',
    html: variant(j8),
  },
  {
    id: 'J9',
    name: 'J5, working in place',
    idea: 'J5, but once a step’s value is set it works right here: its row spins, the others go faint, “now” waits — no separate working screen.',
    html: variant(j5, true),
  },
]

const before = `<div class="box"><h3>Your questions from round three</h3><ul>
<li><b>Why J1’s options differed:</b> J1 reused edit mode’s own picker, which has only edit operations — Convert to, Quality and Compress live in other modes. Every J1 variant here lists them all.</li>
<li><b>Compressing a file already converted:</b> it never happens. Continue editing reruns every step from the original in one encode — Compress means “aim that one JPEG at a size”, never a second pass over the JPEG, and since b91c125 it never goes above the Quality you chose. Round three’s J1, J2 and J4 showed the new JPEG on the card, which suggested otherwise; the variants here show the original.</li>
<li><b>J1 vs J4:</b> the same screens; J1 is a list you come back to (every step and operation in view), J4 asked “another, save, done” after each step. J4’s result screen is J1’s list, so J4 folds into J1.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>Tabs</b> (tab 1): which fill?</li>
<li><b>Home</b> (tab 2): which, now?</li>
<li><b>Continue editing</b> (tab 3): which way to draw J1’s list?</li>
<li><b>New words to approve:</b> “Formats”, “Presets (3)” · “run on IMG_2041.png” (N1, N3, N5) · “p presets” (N4, N5) · “Format”, “Size and shape”, “On-device models” (J5) · “Your steps”, “Add”, “steps · add” (J7) · “was”, “now” (J8) · “back to Done”, “back to steps”, “Keep IMG_2041.jpg”, “1 step”, “2 steps”, “Continue editing” as the header’s last chip.</li>
</ol></div>
<style>
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr .ft{font:600 13px -apple-system,sans-serif;color:#a9aebb}
.pair{display:flex;gap:18px;align-items:flex-start;margin-bottom:18px}
.pair .t{zoom:.82}
.flow{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:12px;max-width:1500px}
.flow .t{zoom:.62}
.flow .arrow{font-size:24px;color:#4a4f5a;align-self:center}
.strips{display:flex;flex-direction:column;gap:12px;margin-bottom:18px}
.strip{display:flex;flex-direction:column;gap:6px}
.strip .t{zoom:1.35;padding:6px 10px}
.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1}
.concept{flex-direction:column-reverse;gap:14px}
.figure{flex-direction:column;max-width:100%}
.side{max-width:1100px}
.verdicts{flex-direction:row !important;flex-wrap:wrap}
.verdicts button{padding:7px 12px}
.why{max-width:700px}
</style>`

writeFileSync(
  'mockups/presets-ux-2026-10-round4.html',
  feedbackPage({
    page: 'presets-ux-r4',
    title: 'Forge · presets and continue editing, round four',
    heading: 'Presets and Continue editing, round four',
    lede: 'T1 as you asked it, with three fills; the home ideas that had potential, pushed and crossed; and J1’s list drawn five ways, every operation in it. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/presets-ux-2026-10-round4.html')
