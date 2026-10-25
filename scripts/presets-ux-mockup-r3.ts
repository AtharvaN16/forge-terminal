/**
 * Presets UX, round three (2026-10-22). Earlier: presets-ux-2026-10.html,
 * presets-ux-2026-10-round2.html.
 *
 * Round two, in chat: P3 (tabs in the picker) liked — more visualisations
 * of tabs. None of the home-field concepts (too crowded): presets belong on
 * home itself, broad explorations wanted. Continue editing was hard to
 * follow; K1 has potential, K2 disliked, K3 not understood; the row's button
 * must not draw the eye (no accent) and says "select", not "add". None of
 * the working options: design Continue editing, its working state and
 * leaving together, as whole journeys.
 *
 * Done is now the button row (Open · Finder · Save as preset · Continue
 * editing · Home, Y31 on dev), Continue editing on e; flows start there.
 *
 * Captures: presets-ux-frames.json (r1), -r2.json, -r3.json (home, the new
 * Done, edit and compress run on the JPEG a convert made).
 *
 *   npx tsx scripts/presets-ux-mockup-r3.ts   → mockups/presets-ux-2026-10-round3.html
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
/** P3 as round two drew it (liked). */
function p3(on: Tab): Grid {
  const rows = top10()
  const title = clear(rows[8] as Cell[], 0, N, CANVAS)
  const tab = (t: string, lit: boolean): Seg[] =>
    lit ? [[` ${t} `, P.fg, SEL, true]] : [[` ${t} `, P.dim]]
  put(title, 4, [
    ['Convert to', ACCENT, undefined, true],
    ['   '],
    ...tab('formats', on === 'formats'),
    [' '],
    ...tab('presets 3', on === 'presets'),
  ])
  return fit(
    24,
    [...rows, ...(on === 'formats' ? formatRows(true) : presetRows(true))],
    pickKeys([['tab', on === 'formats' ? 'presets' : 'formats']]),
  )
}
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
/** T2: the list in a frame, its tabs written into the frame's top edge, as windows carry titles. */
function t2(on: Tab): Grid {
  const rows = top10()
  const W = 54
  const x0 = 4
  const edge = P.border
  const topRow = blankRow()
  const labels: Seg[] = [
    ['╭─ ', edge],
    ['formats', on === 'formats' ? P.fg : P.dim, undefined, on === 'formats'],
    [' ─ ', edge],
    ['presets 3', on === 'presets' ? P.fg : P.dim, undefined, on === 'presets'],
    [' ', edge],
  ]
  put(topRow, x0, [...labels, ['─'.repeat(W - len(labels) - 1), edge], ['╮', edge]])
  // A heavy mark under the shown tab's name, in the edge itself.
  const markAt = on === 'formats' ? x0 + 3 : x0 + 3 + 7 + 3
  const markW = on === 'formats' ? 7 : 9
  const list =
    on === 'formats'
      ? formatRows(true, { from: x0 + 1, to: x0 + W - 1 })
      : presetRows(true, { from: x0 + 1, to: x0 + W - 1 })
  const body = list.map((r) => put(put(r, x0, [['│', edge]]), x0 + W - 1, [['│', edge]]))
  const bottom = put(blankRow(), x0, [
    ['╰', edge],
    ['─'.repeat(W - 2), edge],
    ['╯', edge],
  ])
  void markAt
  void markW
  return fit(
    24,
    [...rows, topRow, ...body, bottom],
    pickKeys([['tab', on === 'formats' ? 'presets' : 'formats']]),
  )
}
/** T3: one segmented pill at the title's right, the shown half lifted. */
function t3(on: Tab): Grid {
  const rows = top10()
  const t = rows[8] as Cell[]
  const seg = (s: string, lit: boolean): Seg => [
    ` ${s} `,
    lit ? P.fg : P.dim,
    lit ? '#404040' : ZONE,
    lit,
  ]
  const pill: Seg[] = [seg('formats', on === 'formats'), seg('presets 3', on === 'presets')]
  put(t, R - len(pill), pill)
  if (on === 'presets') {
    clear(t, 0, 40, CANVAS)
    put(t, 4, [['Convert to', ACCENT, undefined, true]])
  }
  return fit(
    24,
    [...rows, ...(on === 'formats' ? formatRows(true) : presetRows(true))],
    pickKeys([['tab', on === 'formats' ? 'presets' : 'formats']]),
  )
}
/** T4: tabs in home's own look — the shown one on the mode tabs' chip, the other bare. */
function t4(on: Tab): Grid {
  const rows = top10()
  const t = clear(rows[8] as Cell[], 0, N, CANVAS)
  const chip = (s: string, lit: boolean): Seg[] =>
    lit ? [[` ${s} `, P.fg, '#262626', true]] : [[` ${s} `, P.dim]]
  put(t, 3, [
    ...chip('Convert to', on === 'formats'),
    ['  '],
    ...chip('Presets', on === 'presets'),
    [' 3', P.border],
  ])
  return fit(
    24,
    [...rows, ...(on === 'formats' ? formatRows(true) : presetRows(true))],
    pickKeys([['tab', on === 'formats' ? 'presets' : 'formats']]),
  )
}
/** T5: the tabs stand down the left, the list beside them. */
function t5(on: Tab): Grid {
  const rows = top10()
  const list =
    on === 'formats'
      ? formatRows(true, { from: 18, to: 70 })
      : presetRows(true, { from: 18, to: 70 })
  const side: Array<[string, boolean]> = [
    ['formats', on === 'formats'],
    ['presets 3', on === 'presets'],
  ]
  list.forEach((r, i) => {
    const s = side[i]
    if (s) {
      if (s[1])
        put(clear(r, 4, 15, CANVAS), 4, [['▎', ACCENT], [' '], [s[0], P.fg, undefined, true]])
      else put(r, 6, [[s[0], P.dim]])
    }
    put(r, 16, [['│', P.faint]])
  })
  return fit(24, [...rows, ...list], pickKeys([['←→', on === 'formats' ? 'presets' : 'formats']]))
}
/** T6: barely there — the other list is a quiet word at the title's right, tab flips them. */
function t6(on: Tab): Grid {
  const rows = top10()
  const t = clear(rows[8] as Cell[], 0, N, CANVAS)
  put(t, 4, [[on === 'formats' ? 'Convert to' : 'Presets', ACCENT, undefined, true]])
  const other: Seg[] = [
    [' tab ', P.fg, CAP, true],
    [on === 'formats' ? ' presets 3' : ' formats', P.dim],
  ]
  put(t, R - len(other), other)
  return fit(24, [...rows, ...(on === 'formats' ? formatRows(true) : presetRows(true))], pickKeys())
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

/** M2: presets as modes of their own — a quiet second row of tabs under the modes, numbered on. */
function m2(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  // The blank row above the modes: the drop zone owns the rows under them.
  const r = g[6] as Cell[]
  const items: Seg[] = [['presets', P.faint], ['   ']]
  PRESETS.forEach((p, i) => {
    const off = staged && i === 2
    items.push(
      [`${7 + i}`, off ? P.faint : P.border],
      [' '],
      [p.name, off ? P.faint : P.dim],
      ['   '],
    )
  })
  put(r, 5, items)
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

/** M4: in FORGE's band, the presets knocked out of the hatching. */
function m4(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  const r = g[3] as Cell[]
  const segs: Seg[] = []
  PRESETS.forEach((p, i) => {
    const off = staged && i === 2
    segs.push([' '], [` ${p.name} `, off ? P.faint : P.fg, ZONE, !off], [' '])
  })
  put(r, 74 - len(segs), segs)
  return g
}

/** M5: the drop zone's last dotted row names them; a staged file's card sits above. */
function m5(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  const r = clear(g[13] as Cell[], 4, 76, ZONE)
  const segs: Seg[] = []
  PRESETS.forEach((p, i) => {
    const off = staged && i === 2
    if (i) segs.push([' · ', P.faint, ZONE])
    segs.push([p.name, off ? P.faint : P.dim, ZONE, !off && staged && i === 0])
  })
  const label: Seg[] = [['or run  ', P.faint, ZONE], ...segs]
  put(r, Math.floor((N - len(label)) / 2), label)
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

/** M7: the block splits — the drop zone narrows, a presets panel stands at its right. */
function m7(staged: boolean): Grid {
  const g = dup(staged ? STAGED : HOME)
  const DOT = '#3e636c'
  const Z0 = 4
  const Z1 = 51
  for (let r = 8; r <= 14; r++) {
    const row = g[r] as Cell[]
    clear(row, Z0, Z1, ZONE)
    clear(row, Z1, 53, CANVAS)
    clear(row, 53, 76, SHELF)
  }
  const dots = (r: number, from: number, to: number) => {
    for (let x = from; x <= to; x += 3) put(g[r] as Cell[], x, [['·', DOT, ZONE]])
  }
  if (!staged) {
    for (const r of [9, 12, 13]) dots(r, 7, 48)
    dots(10, 7, 13)
    dots(10, 42, 48)
    const drop: Seg[] = [
      ['↓', ACCENT, ZONE, true],
      ['  ', undefined, ZONE],
      ['Drop a file here', P.fg, ZONE, true],
    ]
    put(g[10] as Cell[], Z0 + Math.floor((Z1 - Z0 - len(drop)) / 2), drop)
    const kinds: Seg[] = [['Images · Video · Audio · Documents', P.dim, ZONE]]
    put(g[11] as Cell[], Z0 + Math.floor((Z1 - Z0 - len(kinds)) / 2), kinds)
  } else {
    for (const r of [9, 10, 11, 12]) dots(r, 7, 10)
    for (const r of [9, 10, 11, 12]) dots(r, 45, 48)
    dots(13, 7, 48)
    const W = 30
    const x = 13
    const edge = P.border
    put(g[9] as Cell[], x, [
      ['╭─ ', edge, ZONE],
      ['PNG', ACCENT, ZONE],
      [` ${'─'.repeat(W - 7)}╮`, edge, ZONE],
    ])
    put(g[10] as Cell[], x, [
      ['│ ', edge, ZONE],
      ['IMG_2041.png'.padEnd(W - 3), P.fg, ZONE, true],
      ['│', edge, ZONE],
    ])
    put(g[11] as Cell[], x, [
      ['│ ', edge, ZONE],
      ['3000×2000 · 16 MB'.padEnd(W - 3), P.fg, ZONE],
      ['│', edge, ZONE],
    ])
    put(g[12] as Cell[], x, [
      ['╰', edge, ZONE],
      ['─'.repeat(W - 2), edge, ZONE],
      ['╯', edge, ZONE],
    ])
  }
  put(g[9] as Cell[], 55, [['Presets', P.dim, SHELF, true]])
  PRESETS.forEach((p, i) => {
    const off = staged && i === 2
    put(g[10 + i] as Cell[], 55, [[p.name, off ? P.faint : P.fg, SHELF]])
  })
  return g
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

/* J2: home again, the file staged, the steps carried */
function j2Home(): Grid {
  const g = dup(STAGED)
  // Compress lit: the user pressed 2.
  const tabs = clear(g[7] as Cell[], 4, 76, CANVAS)
  const names: Array<[string, string]> = [
    ['1', 'convert'],
    ['2', 'compress'],
    ['3', 'pdf'],
    ['4', 'edit'],
    ['5', 'transcribe'],
    ['6', 'colour'],
  ]
  let x = 5
  for (const [n, t] of names) {
    const on = t === 'compress'
    if (on)
      put(tabs, x - 1, [
        [' ', undefined, '#262626'],
        [n, COMPRESS, '#262626', true],
        [' ', undefined, '#262626'],
        [t, P.fg, '#262626', true],
        [' ', undefined, '#262626'],
      ])
    else put(tabs, x, [[n, P.border], [' '], [t, P.dim]])
    x += n.length + t.length + 4
  }
  card(g, 'JPEG', 'IMG_2041.jpg', '3000×2000 · 708 KB', COMPRESS, 9, ZONE, 13)
  // The steps so far in the card's top edge, at its right.
  const steps = chainSegs(['PNG', 'JPEG 80'], ZONE)
  put(g[9] as Cell[], 62 - len(steps), [[' ', undefined, ZONE], ...steps, [' ', undefined, ZONE]])
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↵', 'compress'],
        ['esc', 'clear'],
      ],
      [
        ['1–6 ←→', 'mode'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}
function j2Slider(inConvert = false): Grid {
  const g = dup(F3.compressSlider as Grid)
  if (inConvert) g[1] = header('convert', [...TRAIL, 'Compress'], 'Quality')
  card(g, 'JPEG', 'IMG_2041.jpg', '3000×2000 · 708 KB', COMPRESS)
  const steps = chainSegs(['PNG', 'JPEG 80'])
  put(g[3] as Cell[], 54 - len(steps) - 2, [[' '], ...steps, [' ']])
  // The slider at 60.
  const s = g[10] as Cell[]
  clear(s, 4, 52, '#2e2e2e')
  clear(s, 4, 30, '#515151')
  put(s, 30, [[' 60 ', INK, P.fg, true]])
  const msg = clear(g[13] as Cell[], 0, N, CANVAS)
  put(msg, 4, [
    ['412 KB', P.fg, undefined, true],
    ['  42% smaller', P.ok],
  ])
  return g
}
function j2Done(): Grid {
  const g = dup(DONE_NEW)
  g[1] = header('compress', ['By quality', '60', 'Desktop', 'IMG_2041-small.jpg'], 'Done')
  const strip = g[5] as Cell[]
  clear(strip, 4, 76, ZONE)
  put(strip, 5, chainSegs(['PNG', 'JPEG 80', 'quality 60'], ZONE))
  const saved: Seg[] = [['15.6 MB saved · 97.5% smaller', P.ok, ZONE, true]]
  put(strip, 75 - len(saved), saved)
  const sizes = clear(g[15] as Cell[], 0, N, CANVAS)
  put(sizes, 4, [
    ['now ', P.dim],
    ['412 KB', P.ok, undefined, true],
  ])
  put(sizes, 67, [
    ['was ', P.border],
    ['16 MB', P.fg, undefined, true],
  ])
  // The focus on Save as preset: its button lifted, Home back to its tint at rest.
  const b = g[19] as Cell[]
  for (let i = 24; i <= 41; i++)
    for (const r of [18, 19, 20])
      (g[r] as Cell[])[i] = { ...((g[r] as Cell[])[i] as Cell), bg: CAP }
  put(b, 25, [
    ['p', P.fg, CAP, true],
    [' Save as preset', P.fg, CAP, true],
  ])
  return g
}

/* J3: one window, everything in it */
const UNDER: Row[] = (F1.done as Grid).slice(2, 22).map((r, i) => (i === 18 ? [] : rowOf(r)))
const INNER = 66
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  run(' '.repeat(Math.max(0, n - rlen(row))), undefined, bg),
]
function opRow(
  name: string,
  value: string,
  o: {
    on?: boolean
    lit?: boolean
    dead?: boolean
    button?: boolean
    spin?: boolean
    faint?: boolean
  } = {},
): Row {
  const bg = o.lit ? P.panelBand : undefined
  const tone = o.faint ? P.faint : undefined
  const head: Row = [
    run(o.lit ? ' › ' : '   ', ACCENT, bg, true),
    run(o.on ? '✓ ' : '  ', tone ?? ACCENT, bg, true),
    run(name.padEnd(19), tone ?? (o.dead ? P.faint : o.on || o.lit ? P.fg : P.dim), bg, !!o.lit),
    ...(o.spin ? [run('⠹ ', ACCENT, bg, true)] : []),
    run(value, tone ?? (o.dead ? P.faint : o.on ? P.fg : P.faint), bg, !!o.lit && !!o.on),
  ]
  if (!o.button) return pad(head, INNER, bg)
  return [...pad(head, INNER - rlen(selectRuns) - 2, bg), ...selectRuns, run('  ', undefined, bg)]
}
function j3Lines(o: { compress?: string; lit?: number; busy?: boolean; foot: Row[] }): Row[] {
  const rows: Array<[string, string, { on?: boolean; dead?: boolean }]> = [
    ['Convert to', 'JPEG', { on: true }],
    ['Quality', '80', { on: true }],
    ['Compress', o.compress ?? '—', { on: !!o.compress }],
    ['Resize', '—', {}],
    ['Crop to shape', '—', {}],
    ['Sharpen', 'not added', { dead: true }],
    ['Boost resolution', 'not added', { dead: true }],
  ]
  return [
    [],
    ...rows.map(([n, v, s], i) =>
      opRow(n, v, {
        ...s,
        lit: !o.busy && i === o.lit,
        button: !o.busy && i === o.lit,
        spin: !!o.busy && n === 'Compress',
        faint: !!o.busy && n !== 'Compress',
      }),
    ),
    [],
    ...o.foot,
    [],
  ]
}
const overDone = (
  title: string,
  lines: Row[],
  under: Row[] = UNDER,
  o: { width?: number; top?: number; left?: number } = {},
): Row[] =>
  windowOver(P, under, {
    title,
    lines,
    width: o.width ?? 68,
    columns: N,
    top: o.top ?? Math.max(0, Math.floor((21 - (lines.length + 2)) / 2) - 1),
    ...(o.left === undefined ? {} : { left: o.left }),
  }).slice(0, 20)
const winScreen = (middle: Row[], keys: Cell[]): Grid => [
  copy((F1.done as Grid)[0]),
  copy((F1.done as Grid)[1]),
  ...toGrid(middle, N).map((r) => r.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
  copy(RULE),
  keys,
]
const fileFoot = (bytes: string, change: string): Row => [
  run('   '),
  run('✓ ', P.ok, undefined, true),
  run('IMG_2041.jpg', P.fg, undefined, true),
  run('   708 KB', P.dim),
  run('  →  ', P.faint),
  run(bytes, P.fg, undefined, true),
  run(`   ${change}`, P.ok, undefined, true),
]
function j3Open(): Grid {
  return winScreen(
    overDone(
      'Continue editing',
      j3Lines({
        lit: 2,
        foot: [
          [
            run('   '),
            run('✓ ', P.ok, undefined, true),
            run('IMG_2041.jpg', P.fg, undefined, true),
            run('   708 KB', P.fg, undefined, true),
          ],
        ],
      }),
    ),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'select'],
      ],
      [['esc', 'done']],
    ),
  )
}
function j3Sub(): Grid {
  const lines = j3Lines({
    lit: 2,
    foot: [
      [
        run('   '),
        run('✓ ', P.ok, undefined, true),
        run('IMG_2041.jpg', P.fg, undefined, true),
        run('   708 KB', P.fg, undefined, true),
      ],
    ],
  })
  const base = overDone('Continue editing', lines)
  const top = Math.max(0, Math.floor((21 - (lines.length + 2)) / 2) - 1) + 1 + 1 + 2 + 1
  const sub: Row[] = [
    [],
    pad(
      [
        run(' › ', ACCENT, P.panelBand, true),
        run('To a target size   ', P.fg, P.panelBand, true),
        run(' 300 ', P.fg, P.band, true),
        run(' ', undefined, P.fg),
        run(' KB', P.dim, P.panelBand),
      ],
      40,
      P.panelBand,
    ),
    pad([run('   '), run('By quality', P.dim)], 40),
    [],
  ]
  const mid = windowOver(P, base, {
    title: 'Compress',
    lines: sub,
    width: 42,
    columns: N,
    top,
    left: Math.floor((N - 68) / 2) + 1 + 3 + 2 + 19 - 2,
  }).slice(0, 20)
  return winScreen(
    mid,
    keyRow(
      [
        ['0–9', 'size'],
        ['↵', 'select'],
      ],
      [['esc', 'back']],
    ),
  )
}
function j3Busy(): Grid {
  const foot: Row[] = [
    [
      run('   '),
      run('PNG', P.dim),
      run(' ── ', P.faint),
      run('✓ ', P.ok, undefined, true),
      run('JPEG 80', P.fg, undefined, true),
      run(' ── ', P.faint),
      run('⠹ ', ACCENT, undefined, true),
      run('under 300 KB', ACCENT, undefined, true),
      run(' ── ', P.faint),
      run('IMG_2041.jpg', P.faint),
    ],
    [run('                         '), run('trying quality 41 · 3 of 8', P.dim)],
  ]
  return winScreen(
    overDone('Continue editing', j3Lines({ compress: 'under 300 KB', busy: true, foot })),
    keyRow([], [['esc', 'stop']]),
  )
}
function j3Leave(): Grid {
  const foot: Row[] = [
    fileFoot('297 KB', '58% smaller'),
    [],
    opRow('Save as preset', '', { lit: true, button: true }),
    opRow('Keep IMG_2041.jpg', ''),
  ]
  const lines = j3Lines({ compress: 'under 300 KB', lit: 99, foot }).map((row, i) =>
    i >= 1 && i <= 7
      ? row.map((r) => (r.fg && r.fg !== ACCENT ? { ...r, fg: P.faint, bold: false } : r))
      : row,
  )
  return winScreen(
    overDone('Continue editing', lines),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'select'],
      ],
      [['esc', 'back to steps']],
    ),
  )
}

/* J4: one question per screen, as a convert asks */
function j4Next(): Grid {
  const g = dup(F2.picker as Grid)
  g[1] = header('convert', TRAIL, 'Next step')
  card(g, 'JPEG', 'IMG_2041.jpg', '3000×2000 · 708 KB')
  const steps = chainSegs(['PNG', 'JPEG 80'])
  put(g[3] as Cell[], 54 - len(steps) - 2, [[' '], ...steps, [' ']])
  const t = clear(g[8] as Cell[], 0, N, CANVAS)
  put(t, 4, [['Next step', ACCENT, undefined, true]])
  for (let i = 10; i <= 21; i++) clear(g[i] as Cell[], 0, N, CANVAS)
  const items: Array<[string, string]> = [
    ['Compress', 'smaller file'],
    ['Resize', ''],
    ['Crop to shape', ''],
    ['Convert to', 'another format'],
    ['Sharpen', 'not added'],
    ['Remove background', 'not added'],
  ]
  items.forEach(
    ([n, v], i) =>
      (g[10 + i] = flowRow(n, i === 0, v ? [[v, v === 'not added' ? P.faint : P.border]] : [])),
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
        ['esc', 'back to Done'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}
function j4Result(): Grid {
  const g = dup(F2.picker as Grid)
  g[1] = header('convert', [...TRAIL, 'Compress', '60'], 'Next step')
  card(g, 'JPEG', 'IMG_2041.jpg', '3000×2000 · 412 KB')
  const t = clear(g[8] as Cell[], 0, N, CANVAS)
  put(t, 4, [['Next step', ACCENT, undefined, true]])
  const steps = chainSegs(['PNG', 'JPEG 80', 'quality 60'])
  put(t, R - len(steps), steps)
  for (let i = 9; i <= 21; i++) clear(g[i] as Cell[], 0, N, CANVAS)
  put(g[9] as Cell[], R - 22, [
    ['708 KB', P.dim],
    ['  →  ', P.faint],
    ['412 KB', P.fg, undefined, true],
    ['  −42%', P.ok],
  ])
  const items: Array<[string, Seg[]]> = [
    ['Save as preset', []],
    ['Another step', []],
    ['Done', [['keep IMG_2041.jpg', P.border]]],
  ]
  items.forEach(([n, rest], i) => (g[11 + i] = flowRow(n, i === 0, rest)))
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'select'],
      ],
      [
        ['esc', 'undo the step'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}

/* --------------------------------------------------------------- figures */

const fr = (g: Grid, caption?: string) =>
  `<figure class="fr">${caption ? `<div class="ft">${caption}</div>` : ''}${shot(g)}</figure>`
const pair = (...parts: string[]) => `<div class="pair">${parts.join('')}</div>`
const flow = (...steps: Array<[Grid, string]>) =>
  `<div class="flow">${steps.map(([g, c]) => fr(g, c)).join('<div class="arrow">→</div>')}</div>`

/* ------------------------------------------------------------ concepts */

const concepts: PageConcept[] = [
  /* 1 · tabs */
  {
    id: 'P3',
    tab: '1 · Tabs in the picker',
    section: 'Liked in round two',
    earlier: 'like',
    name: 'Two tabs on the title row (round two)',
    idea: 'As drawn in round two: two small tabs after “Convert to”, the shown one on the band’s grey. tab switches.',
    html: pair(fr(p3('formats'), 'formats'), fr(p3('presets'), 'tab — presets')),
  },
  {
    id: 'T1',
    section:
      'More ways to draw the tabs — the same two lists, tab switches, never taller than today',
    name: 'Rule tabs, as /about has',
    idea: 'MY PICK. The title itself becomes the first tab: “Convert to” and “Presets 3” on a rule, heavy in the mode colour under the one shown — the tabs /about already uses. The rule takes the blank row under the title, so no row is added. A video’s boxes sit under the same tabs.',
    html: `${pair(fr(t1('formats'), 'formats'), fr(t1('presets'), 'tab — presets'))}${pair(fr(t1('formats', true), 'a video'), fr(t1('presets', true), 'a video — presets'))}`,
  },
  {
    id: 'T2',
    name: 'Tabs in the list’s frame',
    idea: 'The list sits in a frame and the tabs are written into its top edge, the way every window carries its title. The shown one is bright, the other dim. The frame costs two rows.',
    html: pair(fr(t2('formats'), 'formats'), fr(t2('presets'), 'tab — presets')),
  },
  {
    id: 'T3',
    name: 'One segmented pill',
    idea: 'A single pill at the title row’s right, two halves; the shown half lifted to a lighter grey. Reads as a switch, not as two headings.',
    html: pair(fr(t3('formats'), 'formats'), fr(t3('presets'), 'tab — presets')),
  },
  {
    id: 'T4',
    name: 'In the mode tabs’ look',
    idea: 'The two tabs drawn like home’s mode tabs: the shown one on their dark chip, the other bare, the count after it. The same idea people already use on home.',
    html: pair(fr(t4('formats'), 'formats'), fr(t4('presets'), 'tab — presets')),
  },
  {
    id: 'T5',
    name: 'Tabs down the side',
    idea: 'The tabs stand in a narrow column at the left, the list beside them past a faint │; ←→ moves between them. Room for more tabs later.',
    html: pair(fr(t5('formats'), 'formats'), fr(t5('presets'), '← — presets')),
  },
  {
    id: 'T6',
    name: 'Barely there',
    idea: 'One tab only ever shows: the title is the list you are in, and the other is a quiet tab-key hint at the right. The quietest; the presets are easy to miss.',
    html: pair(fr(t6('formats'), 'formats'), fr(t6('presets'), 'tab — presets')),
  },

  /* 2 · home */
  {
    id: 'M1',
    tab: '2 · Presets on home',
    section:
      'OPTIONS — where presets live on home itself, not in the field. Each drawn idle and with a photo staged (or open)',
    name: 'A seventh tab',
    idea: 'presets joins the modes. Shown, its list stands in the drop zone; drop a file and the lit preset runs on it. Seven tabs only just fit 80 columns.',
    html: pair(fr(m1(false), 'idle'), fr(m1(true), '7 — presets')),
  },
  {
    id: 'M2',
    name: 'Presets as modes, a row above the modes',
    idea: 'Each preset numbered on from the modes (7, 8, 9) on the blank row just above the tabs, quiet — the drop zone owns the rows under them. Pressing 7 makes webblog the mode. With a file staged, the ones that do not apply go faint.',
    html: pair(fr(m2(false), 'idle'), fr(m2(true), 'a photo staged')),
  },
  {
    id: 'M3',
    name: 'A quiet shelf under the field',
    idea: 'The presets as grey pills low on home, above the menu’s corner — out of the way until wanted. Staged, the ones that apply stay; the rest fade.',
    html: pair(fr(m3(false), 'idle'), fr(m3(true), 'a photo staged')),
  },
  {
    id: 'M4',
    name: 'In FORGE’s band',
    idea: 'Knocked out of the band’s hatching at its right, beside the name: the presets as part of the app’s own sign. Takes no row at all.',
    html: pair(fr(m4(false), 'idle'), fr(m4(true), 'a photo staged')),
  },
  {
    id: 'M5',
    name: 'Said by the drop zone',
    idea: 'The drop zone’s last dotted row names them — “or run webblog · social · thumbs” — so dropping and choosing a preset read as one act.',
    html: pair(fr(m5(false), 'idle'), fr(m5(true), 'a photo staged')),
  },
  {
    id: 'M6',
    name: 'One key, beside / menu',
    idea: 'Nothing on home but p presets beside / menu; p opens them in a small window, as / opens the menu. The emptiest home.',
    html: pair(fr(m6(false), 'idle'), fr(m6(true), 'p')),
  },
  {
    id: 'M7',
    name: 'A panel beside the drop zone',
    idea: 'When there are presets, the block splits: the drop zone narrows and a presets panel stands at its right, on the field’s shelf grey.',
    html: pair(fr(m7(false), 'idle'), fr(m7(true), 'a photo staged')),
  },

  /* 3 · continue editing, end to end */
  {
    id: 'J1',
    tab: '3 · Continue editing, end to end',
    section:
      'Every journey starts on Done: e Continue editing. Each option is the whole way through — choosing, the step working, and leaving',
    earlier: 'potential',
    name: 'Edit mode, carried on (round two’s K1)',
    idea: 'MY PICK. e opens edit’s own picker on the file just made, steps so far at the top right. Each operation runs its own screen and the working screen every job shows, then comes back with a ✓. Done (the first row) ends it: two rows, Save as preset or Keep IMG_2041.jpg.',
    html: flow(
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
    ),
  },
  {
    id: 'J2',
    name: 'Home again, the file and its steps carried',
    idea: 'e goes home with the new file already staged and its steps in the card’s edge. Pick any mode — here 2 compress — and its usual screens run. Done adds the step to the strip, and Done’s own Save as preset keeps them all. Nothing new to learn anywhere.',
    html: flow(
      [DONE_NEW, '1 · Done — e'],
      [j2Home(), '2 · home, IMG_2041.jpg staged — 2'],
      [j2Slider(), '3 · compress, as ever'],
      [
        working(
          'compress',
          ['By quality', '60', 'Desktop', 'IMG_2041-small.jpg'],
          'Compressing',
          'JPEG',
          '3000×2000 · 708 KB',
          [
            ['Compressing', P.fg, undefined, true],
            [' at quality 60', P.dim],
          ],
          '1.1s',
        ),
        '4 · working',
      ],
      [j2Done(), '5 · Done — the steps, p to save'],
    ),
  },
  {
    id: 'J3',
    name: 'One window, all in it',
    idea: 'Everything happens in one window over Done: ↵ selects a row (the quiet button), its own window asks the value, the rows go faint while the step works and a line of stations says where it is, then the window ends in its two ways out.',
    html: flow(
      [DONE_NEW, '1 · Done — e'],
      [j3Open(), '2 · the window'],
      [j3Sub(), '3 · Compress, its value'],
      [j3Busy(), '4 · working'],
      [j3Leave(), '5 · ↵ — save or keep'],
    ),
  },
  {
    id: 'J4',
    name: 'One question at a time, as a convert asks',
    idea: 'Like the convert flow: a full-screen Next step list, then the step’s own screen, then the working screen, then a result screen — before → after — with Save as preset, Another step, or Done.',
    html: flow(
      [DONE_NEW, '1 · Done — e'],
      [j4Next(), '2 · Next step'],
      [j2Slider(true), '3 · its own screen'],
      [
        working(
          'convert',
          [...TRAIL, 'Compress', '60'],
          'Compressing',
          'JPEG',
          '3000×2000 · 708 KB',
          [
            ['Compressing', P.fg, undefined, true],
            [' at quality 60', P.dim],
          ],
          '1.1s',
        ),
        '4 · working',
      ],
      [j4Result(), '5 · the result — save, another, done'],
    ),
  },
]

const before = `<div class="box"><h3>Decided so far</h3><ul>
<li><b>Presets live</b> in the / menu, in each mode’s picker as <b>tabs</b> (round two’s P3), <b>on home itself</b> (not in the field), and in Finder’s Quick Actions.</li>
<li><b>No space to select.</b> The lit row carries a quiet <b>↵ select</b> — the key grey, dim words, no accent.</li>
<li><b>Continue editing, the step working, and leaving are one journey</b> — drawn together below. Done is now the button row; Continue editing is <b>e</b>.</li>
<li><b>Gone:</b> the field concepts (H1–H3), K2, K3, the separate working options (R1–R5).</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>Tabs</b> (tab 1): which way to draw them?</li>
<li><b>Home</b> (tab 2): where do presets live?</li>
<li><b>Continue editing</b> (tab 3): which journey?</li>
<li><b>New words to approve:</b> “Presets 3” / “presets 3” · “presets” (M1, M2, M7) · “or run” (M5) · “p presets”, “run on a file” (M6) · “↵ select” · “Keep IMG_2041.jpg”, “1 step”, “2 steps”, “back to edit” (J1) · “trying quality 41 · 3 of 8”, “back to steps” (J3) · “Next step”, “smaller file”, “another format”, “Another step”, “keep IMG_2041.jpg”, “undo the step”, “back to Done” (J4) · “Resizing”, “Compressing”, “at quality 60”.</li>
</ol></div>
<style>
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr .ft{font:600 13px -apple-system,sans-serif;color:#a9aebb}
.pair{display:flex;gap:18px;align-items:flex-start;margin-bottom:18px}
.pair .t{zoom:.82}
.flow{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:12px;max-width:1500px}
.flow .t{zoom:.62}
.flow .arrow{font-size:24px;color:#4a4f5a;align-self:center}
.concept{flex-direction:column-reverse;gap:14px}
.figure{flex-direction:column;max-width:100%}
.side{max-width:1100px}
.verdicts{flex-direction:row !important;flex-wrap:wrap}
.verdicts button{padding:7px 12px}
.why{max-width:700px}
</style>`

writeFileSync(
  'mockups/presets-ux-2026-10-round3.html',
  feedbackPage({
    page: 'presets-ux-r3',
    title: 'Forge · presets and continue editing, round three',
    heading: 'Presets and Continue editing, round three',
    lede: 'Tabs drawn several ways, broad places for presets on home, and Continue editing as whole journeys — choosing, working and leaving together. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/presets-ux-2026-10-round3.html')
