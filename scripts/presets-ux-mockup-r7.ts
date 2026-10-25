/**
 * Presets UX, round seven (2026-10-23). Earlier: presets-ux-2026-10.html,
 * -round2…6.html.
 *
 * Round six, in chat: Done as the hub is a good idea (locked, with its three
 * rules) — but nothing on screen says you are building a multi-step chain,
 * so saving it as a preset does not read as "these steps, in order". This
 * round keeps the flow and varies only how the chain is drawn, each
 * direction at the same five moments: Done after one step, choosing the
 * next, Done after two, saving, and running the preset next time.
 *
 *   npx tsx scripts/presets-ux-mockup-r7.ts   → mockups/presets-ux-2026-10-round7.html
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

/**
 * A run of ▔ drawn as the terminal draws the glyph — a hairline at the very
 * top of the cell — rather than as a font's dash, so it meets the row above.
 */
const shot = (g: Grid) =>
  termHtml(P, g).replace(
    /<span style="([^"]*?)color:(#[0-9a-fA-F]{6})([^"]*)">(▔+)<\/span>/g,
    (_m, a: string, fg: string, b: string, bars: string) =>
      `<span style="${a}color:${fg}${b};background:linear-gradient(to bottom, ${fg} 2px, transparent 2px)">${' '.repeat(bars.length)}</span>`,
  )
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

/* ===================================================== 1 · tabs, no gap, no stroke */

type Join = 'line' | 'band'
/**
 * T7 as asked in round four: the shown tab on the grey, no blue stroke under
 * it, and nothing between the tab and the divider. `line`: the divider is ▔,
 * which sits at the very top of its cell, so it meets the tab. `band`: no
 * divider at all — the tabs' row is itself a band, the shown tab lighter.
 */
function tabRows2(on: Tab, join: Join, video = false): [Cell[], Cell[]] {
  const names = blankRow()
  const rule = blankRow()
  if (join === 'band') clear(names, 4, R, '#262626')
  const tabs: Array<[string, boolean]> = [
    ['Formats', on === 'formats'],
    [video ? 'Presets (2)' : 'Presets (3)', on === 'presets'],
  ]
  let x = 4
  for (const [t, lit] of tabs) {
    put(names, x, [
      [
        `  ${t}  `,
        lit ? P.fg : P.dim,
        lit ? P.panelBand : join === 'band' ? '#262626' : undefined,
        lit,
      ],
    ])
    x += t.length + 4
  }
  if (join === 'line') put(rule, 4, [['▔'.repeat(R - 4), P.border]])
  put(names, R - 5, [[' tab ', P.dim, CAP]])
  return [names, rule]
}
function t1x(on: Tab, join: Join, video = false): Grid {
  const rows = video ? (F2.videoPicker as Grid).slice(0, 10).map(copy) : top10()
  const [names, rule] = tabRows2(on, join, video)
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
const strip2 = (join: Join) =>
  `<div class="strips">${(['formats', 'presets'] as Tab[])
    .map(
      (on) =>
        `<div class="strip"><span class="mlabel">${on === 'formats' ? 'Formats shown' : 'Presets shown'}</span>${shot(tabRows2(on, join))}</div>`,
    )
    .join('')}</div>`

/* ===================================================== 2 · N5, by the kind of file */

interface Offer {
  name: string
  steps: string[]
  of?: string
}
/** N5 on any staged file: the quiet p presets chip beside ↵ enter, and — p — only the presets that can run on it. */
function n5For(base: Grid, offers: Offer[], open: boolean, onWhat: string): Grid {
  const g = dup(base)
  const f = g[16] as Cell[]
  put(f, 74 - 9 - 13, [
    [' p presets ', P.dim, CAP],
    ['  ', undefined, SHELF],
  ])
  if (!open) return g
  const W = 52
  const lines: Row[] = [
    [],
    ...offers.map((p, i): Row => {
      const lit = i === 0
      const bg = lit ? P.panelBand : undefined
      const row: Row = [
        run(lit ? ' › ' : '   ', ACCENT, bg, true),
        run(p.name.padEnd(10), P.fg, bg, lit),
        ...stepSegs(p.steps).map(([t, fg, b2, b]) =>
          run(t, lit ? fg : P.border, b2 ?? bg, lit && b),
        ),
        ...(p.of ? [run(`   ${p.of}`, lit ? P.dim : P.faint, bg)] : []),
      ]
      return [...row, run(' '.repeat(Math.max(0, W - 2 - rlen(row))), undefined, bg)]
    }),
    [],
  ]
  const under = base.slice(2, 22).map(rowOf)
  const top = 14 - lines.length - 2 + 1
  const mid = windowOver(P, under, {
    title: 'Presets',
    lines,
    width: W,
    columns: N,
    top,
    left: R - W,
  }).slice(0, 20)
  return [
    copy(base[0]),
    copy(base[1]),
    ...toGrid(mid, N).map((row) => row.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
    copy(base[22]),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', `run on ${onWhat}`],
      ],
      [['esc', 'close']],
    ),
  ]
}
const PHOTO_OFFERS: Offer[] = PRESETS.map((p) => ({ name: p.name, steps: p.steps }))
const VIDEO_OFFERS: Offer[] = [
  { name: 'clips', steps: ['MP4', '720p'] },
  { name: 'voice', steps: ['M4A'] },
]
const FOLDER_OFFERS: Offer[] = [
  { name: 'webblog', steps: ['JPEG 80', 'under 300 KB'], of: '13 of 15' },
  { name: 'social', steps: ['1080 wide', '1:1'], of: '13 of 15' },
  { name: 'clips', steps: ['MP4', '720p'], of: '2 of 15' },
]
/** The folder staged, mixed: thirteen photos and two videos. */
function mixedFolder(): Grid {
  const g = dup(F2.folder as Grid)
  const facts = g[11] as Cell[]
  clear(facts, 15, 63, ZONE)
  put(facts, 15, [['13 images · 2 videos · 9.8 MB', P.fg, ZONE]])
  return g
}

/* ===================================================== 3 · continue editing, simply */

/** The working screen as Continue editing shows it: the original is what is being redone. */
function redoing(): Grid {
  const g = working(
    'convert',
    ['JPEG', '80', 'IMG_2041.jpg', 'Resize', '1920 wide'],
    'Resizing',
    'PNG',
    '3000×2000 · 16 MB',
    [
      ['Resizing', P.fg, undefined, true],
      [' to 1920 wide', P.dim],
    ],
    '0.8s',
  )
  put(clear(g[4] as Cell[], 6, 54, CANVAS), 6, [['IMG_2041.png', P.fg]])
  return g
}

const slideshow = (slides: Array<[Grid, string]>) =>
  `<div class="show">${slides
    .map(
      ([g, c], i) =>
        `<figure class="slide${i === 0 ? ' on' : ''}"><div class="ft">${i + 1} of ${slides.length} · ${c}</div>${shot(g)}</figure>`,
    )
    .join(
      '',
    )}<div class="ctl"><button class="prev">← back</button><button class="next">next →</button><span class="hint">or ← → on the keyboard</span></div></div>`

const walk = slideshow([
  [DONE_NEW, 'Done. Press e — Continue editing'],
  [
    j5('open'),
    'One list of everything. Your steps so far (Convert to JPEG, Quality 80) are ticked. Choose Resize, ↵',
  ],
  [j1Resize(), 'Resize asks its size on its own screen, as edit mode does. Type 1920, ↵'],
  [
    redoing(),
    'It works on the working screen every job shows — redone from the original, in one go',
  ],
  [j5('after'), 'Back on the list: Resize ✓ 1920 wide, the file now 402 KB. Done is lit — ↵'],
  [
    j5('leave'),
    'Two ways out: Save as preset (keeps the steps under a name) or Keep IMG_2041.jpg (just this file)',
  ],
])

const big = (g: Grid, caption: string) =>
  `<figure class="fr big"><div class="ft">${caption}</div>${shot(g)}</figure>`

/* ===================================================== round six: Done is the hub */

const TRAIL3 = ['JPEG', '80', 'IMG_2041.jpg']
/** The Done buttons' columns on row 19, as the app lays them out. */
const BUTTON: Record<'o' | 'f' | 'p' | 'e', [number, number]> = {
  o: [4, 12],
  f: [13, 23],
  p: [24, 42],
  e: [44, 64],
}

/**
 * Done as the app draws it (Y31), with this file's steps in its strip, its
 * sizes, and — optionally — one button lifted as focused, or Save as preset
 * replaced by the name it was saved under.
 */
function done(o: {
  steps: string[]
  now: string
  saved?: string
  shed: string
  focus?: 'p' | 'e'
  mode?: ShellMode
  answers?: string[]
}): Grid {
  const g = dup(DONE_NEW)
  g[1] = header(o.mode ?? 'convert', o.answers ?? ['JPEG', '80', 'Desktop', 'IMG_2041.jpg'], 'Done')
  const strip = g[5] as Cell[]
  clear(strip, 4, 76, ZONE)
  put(strip, 5, chainSegs(o.steps, ZONE))
  const shed: Seg[] = [[o.shed, P.ok, ZONE, true]]
  put(strip, 75 - len(shed), shed)
  const sizes = clear(g[15] as Cell[], 0, N, CANVAS)
  put(sizes, 4, [
    ['now ', P.dim],
    [o.now, P.ok, undefined, true],
  ])
  put(sizes, 67, [
    ['was ', P.border],
    ['16 MB', P.fg, undefined, true],
  ])
  if (o.saved) {
    const [a, b] = BUTTON.p
    for (const r of [18, 19, 20]) clear(g[r] as Cell[], a, b, SHELF)
    put(g[19] as Cell[], a + 1, [
      ['✓ ', P.ok, SHELF, true],
      [o.saved, P.ok, SHELF, true],
    ])
  }
  if (o.focus) {
    const [a, b] = BUTTON[o.focus]
    for (const r of [18, 19, 20])
      for (let x = a; x < b; x++)
        (g[r] as Cell[])[x] = { ...((g[r] as Cell[])[x] as Cell), bg: CAP }
    const row = g[19] as Cell[]
    for (let x = a; x < b; x++) {
      const c = row[x] as Cell
      if (c.ch !== ' ') row[x] = { ...c, fg: P.fg, b: true }
    }
  }
  return g
}

/** The one list Continue editing opens: everything that can be done next, in plain words, as any Forge picker. */
function nextUp(o: { now: string; lit: string; undo?: string; facts: string }): Grid {
  const g = dup(F2.picker as Grid)
  g[1] = header('convert', TRAIL3, 'Continue editing')
  card(g, 'JPEG', 'IMG_2041.jpg', o.facts)
  const t = clear(g[8] as Cell[], 0, N, CANVAS)
  put(t, 4, [['Continue editing', ACCENT, undefined, true]])
  for (let i = 9; i <= 21; i++) clear(g[i] as Cell[], 0, N, CANVAS)
  const rows: Array<[string, Seg[], boolean?]> = [
    ...(o.undo
      ? ([
          [`Undo ${o.undo}`, [], false],
          ['', []],
        ] as Array<[string, Seg[], boolean?]>)
      : []),
    ['Compress', []],
    ['Resize', []],
    ['Crop to shape', []],
    ['Trim edges', [['no empty edges', P.faint]], true],
    ['Convert to another format', []],
    ['Sharpen', [['not added · 41 MB', P.faint]]],
    ['Remove background', [['not added · 30 MB', P.faint]]],
  ]
  rows.forEach(([name, rest, dead], i) => {
    if (!name) {
      put(g[10 + i] as Cell[], 6, [['─'.repeat(30), P.faint]])
      return
    }
    const lit = name === o.lit
    const r = listRow(name, lit, rest, { at: 34, to: 76 })
    if (dead && !lit) for (const c of r) if (c.fg === P.fg) c.fg = P.faint
    if (lit) put(r, 76 - len(SELECT) - 1, SELECT)
    g[10 + i] = r
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
        ['esc', 'back to Done'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}

/** Resize's own screen, as edit mode has it, set to 1920 wide. */
function resizeTo(): Grid {
  const g = dup(F3.resize as Grid)
  g[1] = header('convert', [...TRAIL3, 'Continue editing'], 'Resize')
  // In convert's colour: the step belongs to the convert it carries on.
  for (const c of g[8] as Cell[]) if (c.fg === EDIT) c.fg = ACCENT
  const s = g[10] as Cell[]
  clear(s, 4, 52, '#2e2e2e')
  clear(s, 4, 17, '#515151')
  put(s, 17, [[' 64% ', INK, P.fg, true]])
  const msg = clear(g[13] as Cell[], 0, N, CANVAS)
  put(msg, 3, [
    ['1920 × 1280', P.fg, undefined, true],
    ['  · about 402 KB', P.dim],
  ])
  return g
}

const resizing = () =>
  working(
    'convert',
    [...TRAIL3, 'Resize', '1920 wide'],
    'Resizing',
    'JPEG',
    '3000×2000 · 708 KB',
    [
      ['Resizing', P.fg, undefined, true],
      [' to 1920 wide', P.dim],
    ],
    '0.8s',
  )

/** Save as preset over Done: the steps it keeps on top, then the name and where it saves, as the app's window has them. */
function saveOverDone(): Grid {
  const g = F1.saveTyped as Grid
  const lines: Row[] = [[], [run('   '), ...chainRuns(['PNG', 'JPEG 80', '1920 wide'])], []]
  for (let r = 7; r <= 16; r++) lines.push(rowOf((g[r] as Cell[]).slice(7, 73)))
  while (lines.length && rlen(lines[lines.length - 1] as Row) === 0) lines.pop()
  const base = done({
    steps: ['PNG', 'JPEG 80', '1920 wide'],
    now: '402 KB',
    shed: '15.6 MB saved · 97.5% smaller',
  })
  const under = base.slice(2, 22).map(rowOf)
  const mid = windowOver(P, under, {
    title: 'Save as preset',
    lines,
    width: 68,
    columns: N,
    top: 1,
  }).slice(0, 20)
  return [
    copy(base[0]),
    copy(base[1]),
    ...toGrid(mid, N).map((row) => row.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
    copy(RULE),
    keyRow(
      [
        ['↵', 'save'],
        ['↑↓', 'folder'],
        ['/', 'new folder'],
      ],
      [['esc', 'cancel']],
    ),
  ]
}

/** Convert to, next time, with the tabs (T11) on Presets. */
const pickerPresets = () => {
  const g = t1x('presets', 'band')
  const [names] = tabRows2('presets', 'band')
  const fixed = names.map((c) => ({ ...c, ch: c.ch === '3' ? '1' : c.ch }))
  g[8] = fixed
  for (let i = 12; i <= 13; i++) g[i] = blankRow()
  g[11] = listRow(
    'webblog',
    true,
    [...stepSegs(['JPEG 80', '1920 wide']), ['   402 KB', P.fg, undefined, true]],
    { at: 22, to: 76 },
  )
  return g
}

/* --------------------------------------------------------------- figures */

const step = (n: number, g: Grid, what: string) =>
  `<figure class="st"><div class="sn">${n}</div><div class="sc">${what}</div>${shot(g)}</figure>`
const steps = (...s: string[]) => `<div class="steps">${s.join('')}</div>`

/* ===================================================== round seven: the chain, drawn */

interface Link {
  short: string
  long: string
  size: string
  kb: number
}
const LINKS: Link[] = [
  { short: 'JPEG 80', long: 'Convert to JPEG 80', size: '708 KB', kb: 708 },
  { short: '1920 wide', long: 'Resize to 1920 wide', size: '402 KB', kb: 402 },
]
const ORIGINAL = { name: 'IMG_2041.png', size: '16 MB', kb: 16000 }
const PILL = P.panelBand
type Dir = 'chain' | 'stepper' | 'recipe' | 'timeline' | 'card'

/** Done with its body cleared — header and buttons as the app draws them — for each direction to fill. */
function doneShell(n: number): Grid {
  const g = dup(DONE_NEW)
  g[1] = header('convert', ['JPEG', '80', 'Desktop', 'IMG_2041.jpg'], 'Done')
  for (let r = 2; r <= 17; r++) g[r] = blankRow()
  void n
  return g
}
const SHED = (n: number) =>
  n === 1 ? '15.3 MB saved · 95.6% smaller' : '15.6 MB saved · 97.5% smaller'
const NOW = (n: number) => (n === 1 ? '708 KB' : '402 KB')
/** Done's strip: its own grey, three rows, the words in the middle, the saving at its right. */
function stripAt(g: Grid, at: number, words: Seg[], n: number): void {
  for (const r of [at, at + 1, at + 2]) g[r] = clear(blankRow(), 4, 76, ZONE)
  put(g[at + 1] as Cell[], 5, words)
  const shed: Seg[] = [[SHED(n), P.ok, ZONE, true]]
  put(g[at + 1] as Cell[], 75 - len(shed), shed)
}
/** Done's bar, as captured: `rows` of it, cut at `to`. */
function barAt(g: Grid, at: number, rows: number[], to = 76): void {
  rows.forEach((src, i) => {
    const row = copy((DONE_NEW as Grid)[src])
    for (let x = to; x < N; x++) row[x] = { ch: ' ', bg: CANVAS }
    g[at + i] = row
  })
}
function sizesAt(g: Grid, at: number, n: number): void {
  const r = (g[at] = blankRow())
  put(r, 4, [
    ['now ', P.dim],
    [NOW(n), P.ok, undefined, true],
  ])
  put(r, 67, [
    ['was ', P.border],
    ['16 MB', P.fg, undefined, true],
  ])
}
const words = (n: number): Seg[] =>
  chainSegs(['PNG', ...LINKS.slice(0, n).map((l) => l.short)], ZONE)

/* -- the pieces each direction draws with -- */

type State = 'done' | 'now' | 'next' | 'plain'
/** A link as a pill: plain on the lifted grey; done ticked; now spinning in the mode colour; next an empty slot. */
const linkPill = (text: string, s: State, bg = PILL): Seg[] =>
  s === 'done'
    ? [
        [' ✓ ', P.ok, bg, true],
        [`${text} `, P.fg, bg, true],
      ]
    : s === 'now'
      ? [
          [` ${SPIN_GLYPH} `, ACCENT, bg, true],
          [`${text} `, ACCENT, bg, true],
        ]
      : s === 'next'
        ? [[` ${text} `, P.dim, CAP]]
        : [[` ${text} `, P.fg, bg, true]]
const SPIN_GLYPH = '⠹'
const link = (bg?: string): Seg => [' ─▸ ', P.border, bg]
/** C1's chain: the source, then each step a pill joined by arrows, then the slot for the next. */
function chainSegsOf(states: Array<[string, State]>, bg?: string, source = 'PNG'): Seg[] {
  const out: Seg[] = [[source, P.dim, bg]]
  for (const [t, s] of states) out.push(link(bg), ...linkPill(t, s))
  return out
}
/** C6's stepper: numbered nodes on a line, done in the mode colour, the next one hollow. */
function stepperSegs(states: Array<[string, State]>, gap = 6): Seg[] {
  const nums = ['①', '②', '③', '④']
  const out: Seg[] = []
  states.forEach(([t, s], i) => {
    if (i) out.push([` ${'─'.repeat(gap)} `, s === 'next' ? P.faint : P.border])
    const tone = s === 'next' ? P.faint : s === 'now' ? ACCENT : ACCENT
    out.push([nums[i] ?? '○', tone, undefined, true], [' '])
    if (s === 'now') out.push([`${SPIN_GLYPH} `, ACCENT, undefined, true])
    out.push([
      t,
      s === 'next' ? P.dim : s === 'done' || s === 'now' ? P.fg : P.fg,
      undefined,
      s !== 'next',
    ])
    if (s === 'done') out.push([' ✓', P.ok, undefined, true])
  })
  return out
}
/** C2's recipe line: the number, the step in words, the size it leaves. */
function recipeLine(i: number, l: Link | undefined, s: State, from = 6, sizeAt = 40): Cell[] {
  const r = blankRow()
  if (!l) {
    put(r, from, [
      [`${i}`, P.faint],
      ['  '],
      ['+ ', P.border],
      ['Continue editing', P.dim],
      ['  e', P.faint],
    ])
    return r
  }
  put(r, from, [
    [`${i}`, s === 'next' ? P.faint : ACCENT, undefined, true],
    ['  '],
    [l.long, P.fg, undefined, s === 'now'],
  ])
  const right: Seg[] =
    s === 'now'
      ? [[SPIN_GLYPH, ACCENT, undefined, true]]
      : s === 'done'
        ? [
            [l.size, P.fg, undefined, true],
            ['  ✓', P.ok, undefined, true],
          ]
        : [[l.size, P.fg, undefined, true]]
  put(r, sizeAt, right)
  return r
}
/** C3's timeline: a node per version of the file, joined by │, each with its size and a bar for it. */
function timelineRows(
  nodes: Array<{ name: string; size?: string; kb?: number; s: State }>,
  from = 6,
  barAtCol = 44,
  barW = 28,
): Cell[][] {
  const out: Cell[][] = []
  nodes.forEach((nd, i) => {
    if (i) out.push(put(blankRow(), from, [[nd.s === 'next' ? '┆' : '│', P.border]]))
    const r = blankRow()
    const dot: Seg =
      nd.s === 'next'
        ? ['○', P.faint]
        : nd.s === 'now'
          ? [SPIN_GLYPH, ACCENT, undefined, true]
          : ['●', i === nodes.length - 1 || nodes[i + 1]?.s === 'next' ? ACCENT : P.border]
    put(r, from, [
      dot,
      ['  '],
      [nd.name, nd.s === 'next' ? P.dim : P.fg, undefined, nd.s !== 'next' && i > 0],
    ])
    if (nd.size) put(r, barAtCol - 10, [[nd.size.padStart(8), P.fg, undefined, true]])
    if (nd.kb) {
      const w = Math.max(1, Math.round((barW * nd.kb) / 16000))
      put(r, barAtCol, [[' '.repeat(w), undefined, i === 0 ? ZONE : '#2a6a78']])
    }
    out.push(r)
  })
  return out
}
/** C4's card: a recipe that builds from the first step, on the shelf grey. */
function cardRows(lines: Seg[][], w: number, h: number): Cell[][] {
  const out: Cell[][] = []
  for (let i = 0; i < h; i++) {
    const r = clear(blankRow(), 0, w, SHELF)
    const l = lines[i]
    if (l)
      put(
        r,
        2,
        l.map(([t, fg, , b]) => [t, fg, SHELF, b] as Seg),
      )
    out.push(r)
  }
  return out
}
const paste = (g: Grid, at: number, rows: Cell[][], x: number, w: number) =>
  rows.forEach((src, i) => {
    const row = g[at + i] as Cell[]
    for (let k = 0; k < w; k++) row[x + k] = src[k] ?? { ch: ' ', bg: CANVAS }
  })

/* -- moment 1 and 3: Done after one step, and after two -- */

function doneDir(d: Dir, n: number): Grid {
  const g = doneShell(n)
  const states = (extra: boolean): Array<[string, State]> => [
    ...LINKS.slice(0, n).map((l): [string, State] => [l.short, 'plain']),
    ...(extra ? ([['+', 'next']] as Array<[string, State]>) : []),
  ]
  if (d === 'chain') {
    stripAt(g, 4, chainSegsOf(states(true), ZONE), n)
    barAt(g, 7, [7, 8, 9, 10, 11, 12, 13])
    sizesAt(g, 15, n)
  } else if (d === 'stepper') {
    put(
      g[2] as Cell[],
      5,
      stepperSegs([
        ...LINKS.slice(0, n).map((l): [string, State] => [l.short, 'done']),
        ['next', 'next'],
      ]),
    )
    stripAt(g, 4, words(n), n)
    barAt(g, 7, [7, 8, 9, 10, 11, 12, 13])
    sizesAt(g, 15, n)
  } else if (d === 'recipe') {
    stripAt(g, 2, words(n), n)
    barAt(g, 5, [9, 10, 11])
    LINKS.slice(0, n).forEach((l, i) => (g[9 + i] = recipeLine(i + 1, l, 'plain', 6, 44)))
    g[9 + n] = recipeLine(n + 1, undefined, 'next')
  } else if (d === 'timeline') {
    stripAt(g, 2, words(n), n)
    const nodes = [
      { name: ORIGINAL.name, size: ORIGINAL.size, kb: ORIGINAL.kb, s: 'plain' as State },
      ...LINKS.slice(0, n).map((l) => ({
        name: l.short,
        size: l.size,
        kb: l.kb,
        s: 'plain' as State,
      })),
      { name: 'next  e', s: 'next' as State },
    ]
    timelineRows(nodes).forEach((r, i) => (g[6 + i] = r))
  } else {
    stripAt(g, 4, words(n), n)
    barAt(g, 7, [7, 8, 9, 10, 11, 12, 13], 46)
    const lines: Seg[][] = [
      [
        ['Recipe', P.fg, undefined, true],
        [`  ${n} ${n === 1 ? 'step' : 'steps'}`, P.border],
      ],
      [],
      ...LINKS.slice(0, n).map((l, i): Seg[] => [
        [`${i + 1} `, ACCENT, undefined, true],
        [l.short, P.fg],
      ]),
      [
        ['+ ', P.border],
        ['next', P.dim],
        ['  e', P.faint],
      ],
    ]
    paste(g, 7, cardRows(lines, 28, 7), 48, 28)
    sizesAt(g, 15, n)
  }
  return g
}

/* -- moment 2: choosing the next step -- */

function pickDir(d: Dir): Grid {
  const g = nextUp({ now: '708 KB', lit: 'Resize', facts: '3000×2000 · 708 KB' })
  const t = g[8] as Cell[]
  if (d === 'chain') {
    const c = chainSegsOf([
      ['JPEG 80', 'plain'],
      ['?', 'now'],
    ])
    c.splice(c.length - 2, 2, [' ? ', ACCENT, CAP, true])
    put(t, R - len(c), c)
  } else if (d === 'stepper') {
    const s = stepperSegs(
      [
        ['JPEG 80', 'done'],
        ['?', 'next'],
      ],
      4,
    )
    s.splice(s.length - 3, 3, ['②', ACCENT, undefined, true], [' '], ['?', ACCENT, undefined, true])
    put(t, R - len(s), s)
  } else if (d === 'recipe') {
    clear(t, 0, N, CANVAS)
    put(t, 4, [['Step 2', ACCENT, undefined, true]])
    const done1: Seg[] = [
      ['1 ', ACCENT, undefined, true],
      ['Convert to JPEG 80', P.dim],
      ['  ✓', P.ok, undefined, true],
    ]
    put(t, R - len(done1), done1)
  } else if (d === 'timeline') {
    const nodes = timelineRows(
      [
        { name: '16 MB', s: 'plain' },
        { name: 'JPEG 80', s: 'plain' },
        { name: '?', s: 'next' },
      ],
      60,
      0,
      0,
    )
    nodes.forEach((r, i) => {
      const row = g[2 + i] as Cell[]
      for (let x = 58; x < 76; x++) row[x] = r[x] as Cell
    })
  } else {
    const lines: Seg[][] = [
      [['Recipe', P.fg, undefined, true]],
      [
        ['1 ', ACCENT, undefined, true],
        ['JPEG 80', P.fg],
      ],
      [
        ['2 ', ACCENT, undefined, true],
        ['?', ACCENT, undefined, true],
      ],
    ]
    paste(g, 3, cardRows(lines, 18, 4), 58, 18)
  }
  return g
}

/* -- moment 4: saving -- */

function saveDir(d: Dir): Grid {
  const top: Row[] =
    d === 'chain'
      ? [
          [
            run('   '),
            ...chainSegsOf([
              ['JPEG 80', 'plain'],
              ['1920 wide', 'plain'],
            ]).map(([t, fg, bg, b]) => run(t, fg, bg, b)),
          ],
        ]
      : d === 'stepper'
        ? [
            [
              run('   '),
              ...stepperSegs([
                ['JPEG 80', 'done'],
                ['1920 wide', 'done'],
              ]).map(([t, fg, bg, b]) => run(t, fg, bg, b)),
            ],
          ]
        : d === 'recipe'
          ? LINKS.map(
              (l, i): Row => [
                run('   '),
                run(`${i + 1}`, ACCENT, undefined, true),
                run('  '),
                run(l.long, P.fg),
              ],
            )
          : d === 'timeline'
            ? [
                [run('   '), run('●', P.border), run('  any photo', P.dim)],
                [run('   │')],
                [run('   '), run('●', P.border), run('  JPEG 80', P.fg, undefined, true)],
                [run('   │')],
                [run('   '), run('●', ACCENT), run('  1920 wide', P.fg, undefined, true)],
              ]
            : [
                [run('   '), run('Recipe', P.fg, undefined, true), run('  2 steps', P.border)],
                ...LINKS.map(
                  (l, i): Row => [
                    run('   '),
                    run(`${i + 1} `, ACCENT, undefined, true),
                    run(l.short, P.fg),
                  ],
                ),
              ]
  const g = F1.saveTyped as Grid
  const lines: Row[] = [[], ...top, []]
  for (let r = 7; r <= 16; r++) lines.push(rowOf((g[r] as Cell[]).slice(7, 73)))
  while (lines.length && rlen(lines[lines.length - 1] as Row) === 0) lines.pop()
  const base = doneDir(d, 2)
  const under = base.slice(2, 22).map(rowOf)
  const mid = windowOver(P, under, {
    title: 'Save as preset',
    lines,
    width: 68,
    columns: N,
    top: 0,
  }).slice(0, 20)
  return [
    copy(base[0]),
    copy(base[1]),
    ...toGrid(mid, N).map((row) => row.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
    copy(RULE),
    keyRow(
      [
        ['↵', 'save'],
        ['↑↓', 'folder'],
        ['/', 'new folder'],
      ],
      [['esc', 'cancel']],
    ),
  ]
}

/* -- moment 5: the preset running on next week's photo -- */

function runDir(d: Dir): Grid {
  const g = dup(F2.working as Grid)
  g[1] = header('convert', ['webblog', 'Desktop', 'IMG_2051.jpg'], 'Working', 1.2)
  card(g, 'PNG', 'IMG_2051.png', '3000×2000 · 15 MB')
  for (let r = 8; r <= 20; r++) g[r] = blankRow()
  put(g[8] as Cell[], 6, [
    ['webblog', P.fg, undefined, true],
    ['  step 2 of 2', P.dim],
  ])
  put(g[8] as Cell[], 64, [['1.1s', P.border]])
  if (d === 'chain')
    put(
      g[10] as Cell[],
      6,
      chainSegsOf([
        ['JPEG 80', 'done'],
        ['1920 wide', 'now'],
      ]),
    )
  else if (d === 'stepper')
    put(
      g[10] as Cell[],
      6,
      stepperSegs([
        ['JPEG 80', 'done'],
        ['1920 wide', 'now'],
      ]),
    )
  else if (d === 'recipe') {
    g[10] = recipeLine(1, { ...(LINKS[0] as Link), size: '690 KB' }, 'done', 6, 44)
    g[11] = recipeLine(2, LINKS[1], 'now', 6, 44)
  } else if (d === 'timeline') {
    timelineRows([
      { name: 'IMG_2051.png', size: '15 MB', kb: 15000, s: 'plain' },
      { name: 'JPEG 80', size: '690 KB', kb: 690, s: 'plain' },
      { name: '1920 wide', s: 'now' },
    ]).forEach((r, i) => (g[10 + i] = r))
  } else {
    const lines: Seg[][] = [
      [
        ['webblog', P.fg, undefined, true],
        ['  2 steps', P.border],
      ],
      [],
      [
        ['1 ', ACCENT, undefined, true],
        ['JPEG 80', P.fg],
        ['   ✓', P.ok, undefined, true],
      ],
      [
        ['2 ', ACCENT, undefined, true],
        ['1920 wide', ACCENT, undefined, true],
        [`   ${SPIN_GLYPH}`, ACCENT, undefined, true],
      ],
    ]
    paste(g, 10, cardRows(lines, 30, 5), 6, 30)
  }
  return g
}

/* --------------------------------------------------------------- figures */

const moment = (n: number, g: Grid, what: string) =>
  `<figure class="st"><div class="sn">${n}</div><div class="sc">${what}</div>${shot(g)}</figure>`
const direction = (d: Dir) =>
  `<div class="moments">${[
    moment(1, doneDir(d, 1), 'Done after the convert'),
    moment(2, pickDir(d), 'e — choosing step 2'),
    moment(3, doneDir(d, 2), 'Done after step 2'),
    moment(4, saveDir(d), 'p — saving the chain'),
    moment(5, runDir(d), 'next week: the preset runs'),
  ].join('')}</div>`

/* ------------------------------------------------------------ concepts */

const concepts: PageConcept[] = [
  {
    id: 'C1',
    tab: 'Five ways to draw the chain',
    section: 'The same five moments in each — only how the chain is drawn changes',
    name: 'A chain of links, with a slot for the next',
    idea: 'MY PICK. Done’s strip becomes the chain itself: PNG ─▸ [JPEG 80] ─▸ [1920 wide] ─▸ [ + ]. The empty + slot at the end is the next link — what e fills. Choosing a step shows the chain with a ? where it will go; saving shows the same chain; running lights the links one by one.',
    html: direction('chain'),
  },
  {
    id: 'C2',
    name: 'Numbered steps, as a recipe',
    idea: 'Done lists the steps in order, numbered, each with the size it leaves — 1 Convert to JPEG 80, 2 Resize to 1920 wide, 3 + Continue editing. The bar shrinks to three rows to make room. Choosing is “Step 2”; saving lists the numbered steps; running ticks them off.',
    html: direction('recipe'),
  },
  {
    id: 'C3',
    name: 'A timeline of the file',
    idea: 'Each version of the file is a dot on a line, like a history: the original, after JPEG 80, after 1920 wide — each with its size and a bar for it, so you see the file shrink as the chain grows. The next dot is hollow. It replaces Done’s bar.',
    html: direction('timeline'),
  },
  {
    id: 'C4',
    name: 'A recipe card, from the first step',
    idea: 'From the first step, Done carries a small card at its right: Recipe · 2 steps, numbered, + next. It reads like a cart you are filling — and Save as preset is saving that card.',
    html: direction('card'),
  },
  {
    id: 'C5',
    name: 'A stepper',
    idea: 'The classic multi-step progress line above Done’s strip: ① JPEG 80 ✓ ── ② 1920 wide ✓ ── ③ next. Familiar from checkouts and sign-ups; saving shows the same stepper; running fills it.',
    html: direction('stepper'),
  },
]

const before = `<div class="box"><h3>Locked from round six</h3><ol>
<li><b>Done is the hub.</b> Continue editing does one more thing to the file and brings you back to Done.</li>
<li><b>Done shows what you did; Save as preset saves exactly that.</b></li>
<li><b>Every step is redone from the original.</b></li>
</ol></div>
<div class="box"><h3>The one open question</h3><p style="margin:4px 0 0">You said nothing makes it feel like a multi-step process — so saving doesn’t read as “these steps, in order”. Each direction below draws the chain differently, at the same five moments: <b>1</b> Done after the convert · <b>2</b> choosing step 2 · <b>3</b> Done after step 2 · <b>4</b> saving · <b>5</b> the preset running on another photo.</p></div>
<div class="box"><h3>Words to approve</h3><p style="margin:4px 0 0">“step 2 of 2” · “Step 2” (C2) · “Recipe”, “2 steps”, “next” (C4) · “next” (C3, C5) · “any photo” (C3’s save).</p></div>
<style>
.moments{display:grid;grid-template-columns:repeat(3,max-content);gap:18px 18px}
.st{margin:0;display:flex;flex-direction:column;gap:6px}
.st .sn{font:700 13px "SF Mono",ui-monospace,Menlo,monospace;color:#55c7d9}
.st .sc{font-size:14px;color:#d7dae2}
.st .t{zoom:.62}
.concept{flex-direction:column-reverse;gap:14px}
.figure{flex-direction:column;max-width:100%}
.side{max-width:1100px}
.verdicts{flex-direction:row !important;flex-wrap:wrap}
.verdicts button{padding:7px 12px}
.why{max-width:700px}
h2 + .concept{margin-top:18px}
.concept + .concept{margin-top:64px;padding-top:24px;border-top:1px solid #23252c}
</style>`

writeFileSync(
  'mockups/presets-ux-2026-10-round7.html',
  feedbackPage({
    page: 'presets-ux-r7',
    title: 'Forge · continue editing, round seven',
    heading: 'Continue editing: showing the chain',
    lede: 'Done stays the hub. What changes is how the chain of steps is drawn — five directions, each at the same five moments, so you can see whether it reads as one process you can save.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/presets-ux-2026-10-round7.html')
