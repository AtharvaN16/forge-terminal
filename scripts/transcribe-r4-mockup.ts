/**
 * Transcribe, round four (2026-10-22). Decided from round three: Working
 * keeps the Transcribing line, folds it to "✓ Transcribing 1m 08s" once it
 * is done (no bar), then "Writing notes" with the spinner and a two-cell
 * square per part (W3); the clock is T1 ("1m 08s"); no "nothing is saved
 * until it is done" footnote. Open: the output format as a split of the
 * Transcribe to screen — both on one screen, ↑↓ only (no tab), one format
 * can be made the default — and how each split behaves in a short window.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/transcribe-r3-capture.tsx
 *   npx tsx scripts/transcribe-r4-mockup.ts → mockups/transcribe-2026-10-round4.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { blank, mix, type Row, type Run } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { pagesRow } from '../src/shell/working-art.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, cellsOf, type Grid, gridHtml, run, termHtml, toGrid } from './term-cells.js'

const W = 80
const p = modePalette(DARK, 'transcribe')
const RED = '#e63946'
const CANVAS = '#1e1e1e'
const NOW = mix(RED, CANVAS, 0.55)
const SELECT = '#323232'
const PILL = '#414141'
const FIELD = '#2c2c2c'
const FIELD_TINT = '#3a1a1d'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const RAW = JSON.parse(readFileSync('/tmp/forge-transcribe-r3/frames.json', 'utf8')) as Record<
  string,
  Raw[][]
>
const frame = (name: string): Grid =>
  (RAW[name] ?? []).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

/* ------------------------------------------------------------ patching */

const text = (cells: Cell[]) => cells.map((c) => c.ch).join('')
/** `from` swapped for `to` (the same width) in row `r`, each cell keeping its style. */
function swap(g: Grid, r: number, from: string, to: string, fg?: string) {
  const row = g[r] as Cell[]
  const at = text(row).indexOf(from)
  if (at < 0) throw new Error(`not found on row ${r}: ${from}`)
  if ([...to].length !== [...from].length) throw new Error(`widths differ: ${from} / ${to}`)
  const style = row[at] as Cell
  ;[...to].forEach((ch, i) => {
    const c = row[at + i] as Cell
    row[at + i] = { ...c, ch, fg: fg ?? c.fg ?? style.fg }
  })
}
const setRow = (g: Grid, r: number, row: Row) => {
  g[r] = toGrid([row], W)[0] as Cell[]
}
const clearRows = (g: Grid, from: number, to: number) => {
  for (let r = from; r <= to; r++) setRow(g, r, [])
}

/** The header bar's hatching colour at each column, gathered from every captured bar. */
const HATCH: (string | undefined)[] = (() => {
  const out: (string | undefined)[] = Array(W).fill(undefined)
  for (const g of Object.values(RAW))
    (g[1] ?? []).forEach((c, i) => {
      if (c.ch === '╱' && c.fg && !out[i]) out[i] = c.fg
    })
  let last = -1
  for (let i = 0; i < W; i++) {
    if (!out[i]) continue
    if (last >= 0)
      for (let j = last + 1; j < i; j++)
        out[j] = mix(out[last] as string, out[i] as string, (j - last) / (i - last))
    last = i
  }
  return out
})()

/** The header bar's trail: the answers, then the current step in bold, right-aligned. */
function trail(g: Grid, answers: string[], current: string) {
  const row = g[1] as Cell[]
  const from = 16
  const end = 76
  const words: Run[] = [
    ...answers.flatMap((a) => [run(` ${a} `, p.dim), run('╱')]),
    run(` ${current} `, p.fg, undefined, true),
    run('╱╱'),
  ]
  const cells = cellsOf(words)
  const start = end - cells.length
  for (let i = from; i < end; i++) row[i] = { ch: '╱', fg: HATCH[i], bg: CANVAS }
  cells.forEach((c, i) => {
    row[start + i] = c.ch === '╱' ? { ch: '╱', fg: HATCH[start + i], bg: CANVAS } : { ...c, bg: CANVAS }
  })
}

/** A key row: caps on the left, quiet keys on the right, as the app draws it. */
function keyRow(left: [string, string][], right: [string, string][]): Row {
  const l: Run[] = left.flatMap(([k, w], i) => [
    ...(i ? [blank(2)] : []),
    run(` ${k} `, p.fg, p.keycapBg, true),
    run(` ${w}`, p.dim),
  ])
  const r: Run[] = right.flatMap(([k, w], i) => [
    ...(i ? [run(' · ', p.border)] : []),
    run(k, p.fg),
    ...(w ? [run(` ${w}`, p.border)] : []),
  ])
  const lw = cellsOf(l).length
  const rw = cellsOf(r).length
  return [blank(4), ...l, blank(Math.max(1, 72 - lw - rw)), ...r]
}
/** The key row: the last row of a screen. */
const keysOf = (g: Grid) => g.length - 1

/** The card's size: the stand-in file is 16 bytes. */
const realSize = (g: Grid) => swap(g, 5, '16 B  ', '212 MB', p.dim)

/* ------------------------------------------------------------ working */

const LEAD = 4
const END = LEAD + 64

/** A step's line: its mark (spinner, ✓, or none), its name, its own clock at the line's end. */
function stepLine(
  state: 'now' | 'done' | 'later',
  label: string,
  clock = '',
  count: Run[] = [],
): Row {
  const mark =
    state === 'now'
      ? run('⠹', RED, undefined, true)
      : state === 'done'
        ? run('✓', p.ok, undefined, true)
        : run(' ')
  const name =
    state === 'now'
      ? run(label, p.fg, undefined, true)
      : state === 'done'
        ? run(label, p.fg)
        : run(label, p.faint)
  const head: Run[] = [blank(LEAD), mark, blank(1), name, ...count]
  const used = cellsOf(head).length
  return clock ? [...head, blank(Math.max(1, END - used - clock.length)), run(clock, p.border)] : head
}

const HEARD = 2890
const LENGTH = 3717
const clockOf = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const heardBar = (done: number) =>
  pagesRow({ palette: p, mode: 'transcribe', done, total: LENGTH, says: `${clockOf(done)} of ${clockOf(LENGTH)}` })

const PARTS = 5
const DONE = 2 // part 3 is being written
const said = (done: number) => run(`  ${done} of ${PARTS} parts`, p.dim)
const cellAt = (i: number) => (i < DONE ? RED : i === DONE ? NOW : p.track)

/** W1, the user's idea: a small square per part. */
const smallSquares = (known: boolean): Row =>
  known
    ? [
        blank(LEAD + 2),
        ...Array.from({ length: PARTS }, (_, i) => run('■ ', i < DONE ? RED : i === DONE ? NOW : p.faint)),
        said(DONE),
      ]
    : []
/** W2: the page bar's thirty cells, cut into one segment per part. */
const segmented = (known: boolean): Row => {
  if (!known) return []
  const gaps = PARTS - 1
  const base = Math.floor((30 - gaps) / PARTS)
  const extra = 30 - gaps - base * PARTS
  const runs: Run[] = []
  for (let i = 0; i < PARTS; i++) {
    if (i) runs.push(blank(1))
    runs.push(run('█'.repeat(base + (i < extra ? 1 : 0)), cellAt(i)))
  }
  return [blank(LEAD + 2), ...runs, said(DONE)]
}
/** W3: a square of two cells per part — a terminal cell is half as wide as it is tall. */
const bigSquares = (known: boolean): Row =>
  known
    ? [
        blank(LEAD + 2),
        ...Array.from({ length: PARTS }, (_, i) => [run('██', cellAt(i)), blank(1)]).flat(),
        run(` ${DONE} of ${PARTS} parts`, p.dim),
      ]
    : []

/** The real Working screen, its rows from the working line down replaced. */
function working(name: 'heard' | 'notes', rows: Row[]): Grid {
  const g = frame(name)
  realSize(g)
  trail(g, ['Desktop', 'influence-talk.md'], name === 'heard' ? 'Transcribing' : 'Writing notes')
  clearRows(g, 8, 21)
  rows.forEach((r, i) => setRow(g, 8 + i, r))
  // Both steps can be stopped. No footnote (user, 2026-10-22).
  setRow(g, keysOf(g), keyRow([['esc', 'stop']], [['ctrl-c', 'quit']]))
  return g
}

/** █ as a terminal draws it: the whole cell, no seam between neighbours. */
const solidify = (g: Grid): Grid =>
  g.map((r) => r.map((c) => (c.ch === '█' ? { ch: ' ', bg: c.fg, fg: c.fg } : c)))

/** Rows 0–`to`, then the key row's two, with a cut between. */
function cropped(g: Grid, to: number): string {
  if (to >= keysOf(g) - 2) return termHtml(DARK, solidify(g), CANVAS)
  const top = solidify(g.slice(0, to + 1))
  const foot = g.slice(keysOf(g) - 1)
  return `<div class="t" style="background:${CANVAS}">${gridHtml(top, DARK)}<div class="cut"></div>${gridHtml(foot, DARK)}</div>`
}
const pair = (a: string, b: string, la: string, lb: string) =>
  `<div class="stack"><div class="cap">${la}</div>${a}<div class="cap">${lb}</div>${b}</div>`

/* ------------------------------------------------------------ format */

const FORMATS = [
  ['Markdown', '.md'],
  ['Word', '.docx'],
  ['PDF', '.pdf'],
  ['Text', '.txt'],
] as const
const WANTS = [
  ['All', 'summary, notes and transcript'],
  ['Notes', 'summary and notes'],
  ['Transcript', ''],
] as const

/** A picker row as the app's Select draws it: the hint and any pill only on the selected row. */
function pick(label: string, on: boolean, hint = '', pill = '', col = 18, quiet = false): Row {
  if (!on)
    return [blank(6), run(label, quiet ? p.dim : p.fg, undefined, quiet), ...(quiet ? [] : [])]
  const head: Run[] = [
    blank(4),
    run('▌', RED, SELECT),
    run(' ', undefined, SELECT),
    run(label, p.fg, SELECT, true),
    run(' '.repeat(Math.max(1, col - 6 - label.length)), undefined, SELECT),
    run(hint, p.dim, SELECT),
  ]
  const used = cellsOf(head).length
  if (!pill) return [...head, run(' '.repeat(76 - used), undefined, SELECT)]
  const pillRuns: Run[] = [
    run(' ', undefined, PILL),
    run('‹', RED, PILL, true),
    run(' ', undefined, PILL),
    run(pill, p.fg, PILL, true),
    run(' ', undefined, PILL),
    run('›', RED, PILL, true),
    run(' ', undefined, PILL),
  ]
  const pw = cellsOf(pillRuns).length
  return [...head, run(' '.repeat(74 - used - pw), undefined, SELECT), ...pillRuns, run('  ', undefined, SELECT)]
}
/** The inactive group's choice: kept, marked, not highlighted. */
const kept = (label: string): Row => [blank(4), run('▌', p.border), blank(1), run(label, p.fg, undefined, true)]
const title = (t: string): Row => [blank(4), run(t, RED, undefined, true)]

function chooseScreen(rows: Row[], keys: Row, answers: string[] = [], current = 'Transcribe to'): Grid {
  const g = frame('choose')
  realSize(g)
  trail(g, answers, current)
  clearRows(g, 8, 21)
  rows.forEach((r, i) => setRow(g, 8 + i, r))
  setRow(g, keysOf(g), keys)
  return g
}
const BACK: [string, string][] = [
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]

/* ------------------------------------------------------------ decided */

const decidedHeard: Row[] = [
  stepLine('now', 'Transcribing', '58.4s'),
  [],
  heardBar(HEARD),
  [],
  stepLine('later', 'Writing notes'),
]
const decidedNotes: Row[] = [
  stepLine('done', 'Transcribing', '1m 08s'),
  [],
  stepLine('now', 'Writing notes', '18.2s'),
  [],
  bigSquares(true),
]

/* ------------------------------------------------------------ split rows */

const TAG_FG = '#c98a4b'
const TAG_BG = '#33261a'
/** Save as's "default" tag, as it sits on the default folder's row. */
const tag = (): Run[] => [run(' ', undefined, TAG_BG), run('default', TAG_FG, TAG_BG), run(' ', undefined, TAG_BG)]
const pillOf = (v: string): Run[] => [
  run(' ', undefined, PILL),
  run('‹', RED, PILL, true),
  run(' ', undefined, PILL),
  run(v, p.fg, PILL, true),
  run(' ', undefined, PILL),
  run('›', RED, PILL, true),
  run(' ', undefined, PILL),
]

type State = 'on' | 'kept' | 'off'
/**
 * A row of a list between columns `from` and `to`: under the cursor ('on') it
 * is the selection band with its hint; a group's choice while the cursor is
 * in the other group ('kept') is marked and bold; anything else is plain. A
 * trailing run (the default tag, or a pill) sits at the row's far end.
 */
function item(
  label: string,
  state: State,
  { hint = '', end = [] as Run[], from = 4, to = 76, col = 18 } = {},
): Run[] {
  const bg = state === 'on' ? SELECT : undefined
  const mark =
    state === 'on' ? run('▌', RED, SELECT) : state === 'kept' ? run('▌', p.border) : run(' ')
  const head: Run[] = [
    mark,
    run(' ', undefined, bg),
    run(label, p.fg, bg, state !== 'off'),
    ...(state === 'on' && hint
      ? [run(' '.repeat(Math.max(1, col - from - 2 - label.length)), undefined, bg), run(hint, p.dim, bg)]
      : []),
  ]
  const used = cellsOf(head).length
  const tail = cellsOf(end).length
  const gap = to - from - used - tail - (tail ? 2 : 0)
  return [...head, run(' '.repeat(Math.max(1, gap)), undefined, bg), ...end, ...(tail ? [run('  ', undefined, bg)] : [])]
}
const row = (...runs: Run[][]): Row => [blank(4), ...runs.flat()]

/** The list's visible rows when there is room for `room`: the cursor kept in view, "↓ n more" under it. */
function windowed(rows: Row[], room: number, cursor: number): Row[] {
  if (rows.length <= room) return rows
  const show = room - 1
  const start = Math.max(0, Math.min(cursor - show + 1, rows.length - show))
  const below = rows.length - start - show
  const note = `↓ ${below} more`
  return [...rows.slice(start, start + show), [blank(76 - note.length), run(note, p.dim)]]
}

const WHAT = (want: State, detail = true): Row[] => [
  title('Transcribe to'),
  row(item('All', want, { hint: 'summary, notes and transcript', end: detail && want === 'on' ? pillOf('Standard') : [] })),
  row(item('Notes', 'off')),
  row(item('Transcript', 'off')),
]

/** The screen at 80 × `h`: header, card, the list's rows in what room is left, the key row. */
function screen(
  rows: Row[],
  keys: Row,
  h = 24,
  cursor = 0,
  answers: string[] = [],
  current = 'Transcribe to',
): Grid {
  const room = h - 10
  const g = chooseScreen([], keys, answers, current)
  clearRows(g, 8, 21)
  windowed(rows, room, cursor).forEach((r, i) => setRow(g, 8 + i, r))
  return h === 24 ? g : [...g.slice(0, 8 + room), ...g.slice(g.length - 2)]
}

const ON_ALL = keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['↵', 'confirm']], BACK)
const ON_FORMAT = keyRow([['↑↓', 'choose'], ['tab', 'make default'], ['↵', 'confirm']], BACK)
const ON_FORMAT_ROW = keyRow([['↑↓', 'choose'], ['←→', 'format'], ['tab', 'make default'], ['↵', 'confirm']], [['esc', 'back']])

const formatRows1 = (on: number): Row[] => [
  title('Format'),
  ...FORMATS.map(([l, e], i) => row(item(l, i === on ? 'on' : 'off', { hint: e }))),
]

/* S1 — two lists, one under the other; ↑↓ runs through both. */
const s1 = (focus: 'what' | 'format'): Row[] => [
  ...WHAT(focus === 'what' ? 'on' : 'kept'),
  [],
  title('Format'),
  ...FORMATS.map(([l, e], i) =>
    row(
      item(l, focus === 'format' && i === 1 ? 'on' : focus === 'what' && i === 0 ? 'kept' : 'off', {
        hint: e,
        end: i === 0 ? tag() : [],
      }),
    ),
  ),
]

/* S2 — the formats on one row under the list, side by side; ←→ picks one. */
function formatsInline(state: State, chosen: number): Row {
  const bg = state === 'on' ? SELECT : undefined
  const opts: Run[] = FORMATS.flatMap(([l], i) => {
    const r =
      i === chosen
        ? [run(' ', undefined, PILL), run(l, p.fg, PILL, true), run(' ', undefined, PILL)]
        : [run(` ${l} `, i === 0 ? TAG_FG : p.dim, bg)]
    return [...r, run(' ', undefined, bg)]
  })
  const head: Run[] = [
    state === 'on' ? run('▌', RED, SELECT) : run(' '),
    run(' ', undefined, bg),
    run('Format', state === 'on' ? p.fg : p.dim, bg, state === 'on'),
    run(' '.repeat(12 - 6), undefined, bg),
  ]
  const used = cellsOf([...head, ...opts]).length
  return row(head, opts, [run(' '.repeat(Math.max(0, 72 - used)), undefined, bg)])
}
const s2 = (focus: 'what' | 'format', chosen: number): Row[] => [
  ...WHAT(focus === 'what' ? 'on' : 'kept'),
  [],
  formatsInline(focus === 'format' ? 'on' : 'off', chosen),
]

/* S3 — side by side: Transcribe to on the left, Format on the right, ↑↓ reading down one then the other. */
const SPLIT = 44
function s3(focus: 'what' | 'format'): Row[] {
  const left: Run[][] = [
    [run('Transcribe to', RED, undefined, true)],
    item('All', focus === 'what' ? 'on' : 'kept', { to: SPLIT - 2, end: focus === 'what' ? pillOf('Standard') : [] }),
    item('Notes', 'off', { to: SPLIT - 2 }),
    item('Transcript', 'off', { to: SPLIT - 2 }),
    [],
  ]
  const right: Run[][] = [
    [run('Format', RED, undefined, true)],
    ...FORMATS.map(([l, e], i) =>
      item(l, focus === 'format' && i === 1 ? 'on' : focus === 'what' && i === 0 ? 'kept' : 'off', {
        from: SPLIT,
        hint: e,
        col: SPLIT + 12,
        end: i === 0 ? tag() : [],
      }),
    ),
  ]
  return left.map((l, i) => {
    const lw = cellsOf(l).length
    return [blank(4), ...l, blank(Math.max(0, SPLIT - 4 - lw)), ...(right[i] ?? [])]
  })
}

/* S4 — the format is one more row of the list, a pill stepped with ←→, as Detail is. */
const s4 = (focus: 'what' | 'format', value: number): Row[] => [
  ...WHAT(focus === 'what' ? 'on' : 'off'),
  [],
  row(
    item('Format', focus === 'format' ? 'on' : 'off', {
      end:
        focus === 'format'
          ? [...(value === 0 ? [...tag(), run(' ', undefined, SELECT)] : []), ...pillOf((FORMATS[value] ?? FORMATS[0])[0])]
          : [run((FORMATS[value] ?? FORMATS[0])[0], p.dim)],
    }),
  ),
]

/* ------------------------------------------------------------ broader (tab 2) */

const INK = '#1e1e1e'
const pad = (n: number, bg?: string): Run => run(' '.repeat(Math.max(0, n)), undefined, bg)
const used = (runs: Run[]) => cellsOf(runs).length

/* B1 — a strip of formats above the question, picked by number, as home's tabs are. */
function strip(chosen: number): Row {
  const runs: Run[] = FORMATS.flatMap(([l], i) => {
    const on = i === chosen
    return [
      ...(i ? [pad(2)] : []),
      on ? run(` ${i + 1} ${l} `, INK, RED, true) : run(`${i + 1} `, p.fg, undefined, true),
      ...(on ? [] : [run(l, p.dim)]),
    ]
  })
  return [blank(4), ...runs]
}
const b1 = (chosen: number): Row[] => [strip(chosen), [], ...WHAT('on')]

/* B2 — letters: the extension rides on the highlighted row's hint, a letter changes it. */
/** B2's first row: the hint, then the format in the mode's colour. */
function b2Row(ext: string): Row {
  const base = item('All', 'on', { end: pillOf('Standard') })
  const head = base.slice(0, 3)
  const hint: Run[] = [pad(18 - 6 - 3, SELECT), run('summary, notes and transcript · ', p.dim, SELECT), run(ext, RED, SELECT, true)]
  const tail = pillOf('Standard')
  const gap = 72 - used([...head, ...hint]) - used(tail) - 2
  return [blank(4), ...head, ...hint, pad(gap, SELECT), ...tail, pad(2, SELECT)]
}

/* B3 — four small cards, the extension in each top edge as the file card's kind is. */
function cards(sel: number, focus: boolean, def = 0): Row[] {
  const w = 15
  const tops: Run[] = []
  const mids: Run[] = []
  const bots: Run[] = []
  FORMATS.forEach(([l, e], i) => {
    const on = i === sel
    const edge = on && focus ? RED : on ? p.fg : p.border
    const gap = i ? [pad(2)] : []
    tops.push(...gap, run('╭─ ', edge), run(e, on ? (focus ? RED : p.fg) : p.dim, undefined, on), run(` ${'─'.repeat(w - 5 - e.length)}╮`, edge))
    mids.push(...gap, run('│ ', edge), run(l.padEnd(w - 3), on ? p.fg : p.dim, undefined, on), run('│', edge))
    bots.push(
      ...gap,
      ...(i === def
        ? [run('╰─ ', edge), run('default', TAG_FG), run(` ${'─'.repeat(w - 12)}╯`, edge)]
        : [run(`╰${'─'.repeat(w - 2)}╯`, edge)]),
    )
  })
  return [
    [blank(4), ...tops],
    [blank(4), ...mids],
    [blank(4), ...bots],
  ]
}
const b3 = (focus: 'what' | 'format', sel: number): Row[] => [
  ...WHAT(focus === 'what' ? 'on' : 'kept'),
  [],
  ...cards(sel, focus === 'format'),
]

/* B4 — more than one: tick the formats wanted, each is saved; the ticks are remembered. */
const b4 = (ticked: number[], cursor: number): Row[] => [
  ...WHAT('kept'),
  [],
  title('Save as'),
  ...FORMATS.map(([l, e], i) => {
    const on = i === cursor
    const bg = on ? SELECT : undefined
    const box = ticked.includes(i) ? run('■', RED, bg) : run('□', p.faint, bg)
    const head: Run[] = [
      on ? run('▌', RED, SELECT) : run(' '),
      pad(1, bg),
      box,
      pad(1, bg),
      run(l, p.fg, bg, on || ticked.includes(i)),
      ...(on ? [pad(14 - l.length, bg), run(e, p.dim, bg)] : []),
    ]
    return [blank(4), ...head, pad(72 - used(head), bg)]
  }),
]

/* B6 — the extension is typed on Save as; it completes like a path does. */
function typedName(): Grid {
  const g = frame('saveAs')
  realSize(g)
  trail(g, ['All'], 'Save as')
  const r = g[12] as Cell[]
  const runs: Run[] = [
    run(' ', undefined, FIELD_TINT),
    run('influence-talk.do', p.fg, FIELD_TINT),
    run('cx', p.faint, FIELD_TINT),
  ]
  const cells = cellsOf(runs)
  for (let i = 15; i < 46; i++) r[i] = { ch: ' ', bg: i < 41 ? FIELD_TINT : FIELD }
  cells.forEach((c, i) => {
    r[15 + i] = { ...c, bg: FIELD_TINT }
  })
  const to = g[16] as Cell[]
  const at = text(to).indexOf('forge-test')
  const end = text(to).indexOf('default') - 2
  for (let i = at; i < end; i++) to[i] = { ...(to[i] as Cell), ch: ' ' }
  'Desktop'.split('').forEach((ch, i) => {
    to[at + i] = { ...(to[at] as Cell), ch, fg: p.fg, b: true }
  })
  swap(g, 17, 'Desktop  ', 'Documents', p.fg)
  setRow(g, keysOf(g), keyRow([['↵', 'save'], ['→', 'complete'], ['↑↓', 'folder'], ['tab', 'default']], [['esc', 'back']]))
  return g
}

/* B7 — a preview: the format list on the left, what the file will look like on the right. */
/** The page, one step up from the canvas, as the Save as panel is. */
const PAGE = FIELD
const DARKTXT = p.fg
const MUTED = p.dim
function b7(cursor: number): Row[] {
  const left = FORMATS.map(([l, e], i) =>
    item(l, i === cursor ? 'on' : 'off', { to: 30, hint: e, col: 17, end: i === 0 ? tag() : [] }),
  )
  const page = (t: Run[]): Run[] => {
    const n = 40
    return [pad(1, PAGE), ...t.map((r) => ({ ...r, bg: PAGE })), pad(n - 1 - used(t), PAGE)]
  }
  const word: Run[][] = [
    page([]),
    page([run('Influence talk', DARKTXT, PAGE, true)]),
    page([run('How people decide to say yes, and why.', MUTED)]),
    page([run('0:00  Why we say yes', DARKTXT, PAGE, true)]),
    page([run('• We return favours we never asked for.', DARKTXT)]),
    page([run('• A small yes makes a large one easier.', DARKTXT)]),
  ]
  const rows: Row[] = [title('Transcribe to')]
  rows.push(...WHAT('kept').slice(1))
  rows.push([])
  rows.push([blank(4), run('Format', RED, undefined, true)])
  for (let i = 0; i < 6; i++) {
    const l = left[i] ?? []
    rows.push([blank(4), ...l, pad(32 - used(l)), ...(word[i] ?? [])])
  }
  return rows
}

const BROAD: { id: string; name: string; idea: string; frames: [string, Grid][] }[] = [
  {
    id: 'B1',
    name: 'A strip of formats, picked by number',
    idea: 'The formats sit on one strip above the question, like home’s tabs; 1–4 picks one from anywhere, so ↑↓ and ←→ keep their jobs. No default to set: the last one used is the one next time. One row, so it never hides.',
    frames: [
      ['80 × 24 · Word picked', screen(b1(1), keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['1–4', 'format'], ['↵', 'confirm']], [['esc', 'back']]), 24, 3)],
      ['80 × 16', screen(b1(1), keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['1–4', 'format'], ['↵', 'confirm']], [['esc', 'back']]), 16, 3)],
    ],
  },
  {
    id: 'B2',
    name: 'The extension on the row, changed by a letter',
    idea: 'No new rows at all: the highlighted row’s hint ends with the format, and m · w · p · t switch it (this screen has no text field, so letters are free). The last one used is kept. The quietest place it can live.',
    frames: [
      [
        '80 × 24 · after w',
        screen(
          [title('Transcribe to'), b2Row('.docx'), row(item('Notes', 'off')), row(item('Transcript', 'off'))],
          keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['m w p t', 'format'], ['↵', 'confirm']], [['esc', 'back']]),
          24,
          1,
        ),
      ],
    ],
  },
  {
    id: 'B3',
    name: 'Four cards',
    idea: 'Each format is a small card with its extension in the top edge, as the file card shows its kind. ↓ from the list lands on the cards, ←→ walks them; the default card says so in its bottom edge. Short window: the cards shrink to S2’s one row.',
    frames: [
      ['80 × 24 · on the cards, Word', screen(b3('format', 1), ON_FORMAT_ROW, 24, 5)],
      ['80 × 16 · cards become one row', screen(s2('what', 0), ON_ALL, 16, 1)],
    ],
  },
  {
    id: 'B4',
    name: 'More than one at once',
    idea: 'Tick as many as you want and get one file each — say Markdown for your notes app and PDF to send. space ticks; the ticked set is remembered, which is the default. Save as then names them together.',
    frames: [
      ['80 × 24 · Markdown and PDF ticked, cursor on PDF', screen(b4([0, 2], 2), keyRow([['↑↓', 'choose'], ['space', 'tick'], ['↵', 'confirm']], BACK), 24, 7)],
      ['80 × 16', screen(b4([0, 2], 2), keyRow([['↑↓', 'choose'], ['space', 'tick'], ['↵', 'confirm']], BACK), 16, 7)],
    ],
  },
  {
    id: 'B5',
    name: 'Asked once, then out of the way',
    idea: 'The first transcription asks for a format on its own step; that answer becomes the default and the step is skipped from then on. The format rides in the row’s hint, and f opens the step again for one run.',
    frames: [
      ['First run only · Format', screen(formatRows1(1), keyRow([['↑↓', 'choose'], ['↵', 'confirm']], BACK), 24, 2)],
      [
        'Every run after',
        screen(
          [title('Transcribe to'), b2Row('.docx'), row(item('Notes', 'off')), row(item('Transcript', 'off'))],
          keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['f', 'format'], ['↵', 'confirm']], [['esc', 'back']]),
          24,
          1,
        ),
      ],
    ],
  },
  {
    id: 'B6',
    name: 'Type the extension',
    idea: 'No chooser: the name on Save as takes an extension, and it completes the way a typed path does (→). Nothing to scroll, nothing to hide. tab would make the folder and the format the default together.',
    frames: [['Save as · typing “.do”', typedName()]],
  },
  {
    id: 'B7',
    name: 'With a preview',
    idea: 'The format list sits beside a picture of the file it makes — a page for Word and PDF, raw marks for Markdown, plain lines for text — so the choice is about what you get, not an extension. Short window: the preview goes first.',
    frames: [
      ['80 × 24 · cursor on Word', screen(b7(1), ON_FORMAT, 24, 6)],
      ['80 × 16 · no preview', screen(s1('format'), ON_FORMAT, 16, 7)],
    ],
  },
]

/* ------------------------------------------------------------ two steps (tab 3) */

/** Step 1: today's Transcribe to, its All row no longer saying "· .md". */
const step1 = (h = 24) => screen(WHAT('on'), ON_ALL, h, 1)
/** Step 2 on its own page: the header bar carries step 1's answer. */
const step2 = (rows: Row[], keys: Row, h = 24, cursor = 0) => screen(rows, keys, h, cursor, ['All'], 'Format')
const STEP2_KEYS = keyRow([['↑↓', 'choose'], ['tab', 'make default'], ['↵', 'confirm']], BACK)
const CARD_KEYS = keyRow([['←→', 'choose'], ['tab', 'make default'], ['↵', 'confirm']], BACK)
const GRID_KEYS = keyRow([['↑↓←→', 'choose'], ['tab', 'make default'], ['↵', 'confirm']], BACK)

/* T1 — a plain list. */
const t1 = (cursor: number): Row[] => [
  title('Format'),
  ...FORMATS.map(([l, e], i) => row(item(l, i === cursor ? 'on' : 'off', { hint: e, end: i === 0 ? tag() : [] }))),
]

/* T2 — a list and a large preview: the page has the room a split screen lacked. */
function t2(cursor: number): Row[] {
  const left = FORMATS.map(([l, e], i) =>
    item(l, i === cursor ? 'on' : 'off', { to: 30, hint: e, col: 17, end: i === 0 ? tag() : [] }),
  )
  const W2 = 40
  const page = (t: Run[]): Run[] => [pad(2, PAGE), ...t.map((r) => ({ ...r, bg: PAGE })), pad(W2 - 2 - used(t), PAGE)]
  const word: Run[][] = [
    page([]),
    page([run('Influence talk', p.fg, PAGE, true)]),
    page([run('youtube.com/watch?v=…', p.border)]),
    page([]),
    page([run('How people decide to say yes,', p.dim)]),
    page([run('and how that is used on them.', p.dim)]),
    page([]),
    page([run('0:00  Why we say yes', p.fg, PAGE, true)]),
    page([run('• We return favours never asked for.', p.fg)]),
    page([run('• A small yes makes a large one easier.', p.fg)]),
    page([]),
  ]
  const rows: Row[] = [[blank(4), run('Format', RED, undefined, true)]]
  for (let i = 0; i < word.length; i++) {
    const l = left[i] ?? []
    rows.push([blank(4), ...l, pad(32 - used(l)), ...(word[i] ?? [])])
  }
  return rows
}

/* T3 — four cards in a row (B3's cards, on a page of their own). */
const t3 = (sel: number): Row[] => [title('Format'), [], ...cards(sel, true)]

/* T4 — four tiles, two by two, each showing a few lines as that file would show them. */
function t4(sel: number): Row[] {
  const w = 35
  const samples: Run[][][] = [
    [[run('## Notes', p.dim)], [run('- We return favours…', p.dim)]],
    [[run('Notes', p.fg, undefined, true)], [run('• We return favours…', p.fg)]],
    [[run('Notes', p.fg, PAGE, true)], [run('• We return favours…', p.fg, PAGE)]],
    [[run('Notes', p.dim)], [run('We return favours…', p.dim)]],
  ]
  const tile = (i: number): Run[][] => {
    const [l, e] = FORMATS[i] ?? FORMATS[0]
    const on = i === sel
    const edge = on ? RED : p.border
    const bg = i === 2 ? PAGE : undefined
    const body = (t: Run[]): Run[] => [run('│ ', edge), pad(1, bg), ...t, pad(w - 5 - used(t), bg), pad(1, bg), run('│', edge)]
    return [
      [run('╭─ ', edge), run(l, on ? RED : p.fg, undefined, true), run(` ${'─'.repeat(w - 6 - l.length - e.length - 2)} `, edge), run(e, p.dim), run(' ─╮', edge)],
      body([]),
      ...(samples[i] ?? []).map(body),
      i === 0
        ? [run('╰─ ', edge), run('default', TAG_FG), run(` ${'─'.repeat(w - 12)}╯`, edge)]
        : [run(`╰${'─'.repeat(w - 2)}╯`, edge)],
    ]
  }
  const rows: Row[] = [title('Format')]
  for (const pairIx of [0, 2]) {
    if (pairIx) rows.push([])
    const a = tile(pairIx)
    const b = tile(pairIx + 1)
    a.forEach((ra, r) => rows.push([blank(4), ...ra, pad(2), ...(b[r] ?? [])]))
  }
  return rows
}

/* T5 — two steps until a default is set; after that ↵ on step 1 goes straight to Save as. */
function saveAsWith(ext: string, answers: string[], keys: Row): Grid {
  const g = frame('saveAs')
  realSize(g)
  trail(g, answers, 'Save as')
  swap(g, 12, '.md  ', ext.padEnd(5))
  const to = g[16] as Cell[]
  const at = text(to).indexOf('forge-test')
  const end = text(to).indexOf('default') - 2
  for (let i = at; i < end; i++) to[i] = { ...(to[i] as Cell), ch: ' ' }
  'Desktop'.split('').forEach((ch, i) => {
    to[at + i] = { ...(to[at] as Cell), ch, fg: p.fg, b: true }
  })
  swap(g, 17, 'Desktop  ', 'Documents', p.fg)
  setRow(g, keysOf(g), keys)
  return g
}

const TWO: { id: string; name: string; idea: string; frames: [string, Grid][] }[] = [
  {
    id: 'T1',
    name: 'A plain list',
    idea: 'Step 2 is a list like every other question in the app: the extension shows on the highlighted row, Markdown carries Save as’s “default” tag, tab moves it. Five rows, so it fits a short window.',
    frames: [
      ['Step 1 · Transcribe to (shared by every concept here)', step1()],
      ['Step 2 · Format · 80 × 24', step2(t1(1), STEP2_KEYS, 24, 2)],
      ['Step 2 · 80 × 16', step2(t1(1), STEP2_KEYS, 16, 2)],
    ],
  },
  {
    id: 'T2',
    name: 'A list and a large preview',
    idea: 'With a page of its own, the preview has room: a few lines of the file as the chosen format will show it. Short window: the preview goes and the list stays, as T1.',
    frames: [
      ['Step 2 · 80 × 24 · Word', step2(t2(1), STEP2_KEYS)],
      ['Step 2 · 80 × 16', step2(t1(1), STEP2_KEYS, 16, 2)],
    ],
  },
  {
    id: 'T3',
    name: 'Four cards in a row',
    idea: 'B3’s cards on their own page: ←→ walks them, the extension is in each top edge, the default says so in its bottom edge. Four rows, so it fits a short window as it is.',
    frames: [
      ['Step 2 · 80 × 24 · Word', step2(t3(1), CARD_KEYS)],
      ['Step 2 · 80 × 16', step2(t3(1), CARD_KEYS, 16)],
    ],
  },
  {
    id: 'T4',
    name: 'Four tiles that look like their files',
    idea: 'Two by two, each tile shows two lines the way that file would: raw marks for Markdown, bold and bullets for Word, a page for PDF, bare text for Text. Arrows move in both directions. Short window: back to T1’s list.',
    frames: [
      ['Step 2 · 80 × 24 · Word', step2(t4(1), GRID_KEYS)],
      ['Step 2 · 80 × 16', step2(t1(1), STEP2_KEYS, 16, 2)],
    ],
  },
  {
    id: 'T5',
    name: 'Two steps until there is a default',
    idea: 'Step 2 is T1’s list. Once a format is made the default with tab, ↵ on step 1 goes straight to Save as with that format — the header bar says which — and f on step 1 brings step 2 back for one run.',
    frames: [
      ['Step 2 · until a default is set', step2(t1(1), STEP2_KEYS, 24, 2)],
      [
        'Afterwards · step 1',
        screen(WHAT('on'), keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['f', 'format'], ['↵', 'confirm']], [['esc', 'back']]), 24, 1),
      ],
      [
        'Afterwards · ↵ goes straight to Save as',
        saveAsWith('.docx', ['All', 'Word'], keyRow([['↵', 'save'], ['↑↓', 'folder'], ['tab', 'make default']], BACK)),
      ],
    ],
  },
]

/* ------------------------------------------------------------------- page */

const term = (g: Grid) => termHtml(DARK, solidify(g), CANVAS)
const two = (big: Grid, small: Grid, a: string, b: string) =>
  `<div class="stack"><div class="cap">${a}</div>${term(big)}<div class="cap">${b}</div>${term(small)}</div>`

const SPLITS: { id: string; name: string; idea: string; big: Grid; small: Grid; a: string; b: string }[] = [
  {
    id: 'S1',
    name: 'Two lists, one under the other',
    idea: 'Round three’s F2 without tab: ↑↓ runs from All down through Text. The list the cursor is not in keeps its choice marked. Markdown carries Save as’s “default” tag; tab on a format makes it the default. Short window: Format falls below the fold behind “↓ 5 more”.',
    big: screen(s1('format'), ON_FORMAT, 24, 7),
    small: screen(s1('what'), ON_ALL, 16, 1),
    a: '80 × 24 · cursor on Word',
    b: '80 × 16 · on opening',
  },
  {
    id: 'S2',
    name: 'Formats on one row',
    idea: 'One row under the list holds all four; ↓ reaches it, ←→ picks. The chosen one is a pill, the default is in the tag’s amber. Two rows for the whole question, so even a short window shows it.',
    big: screen(s2('format', 1), ON_FORMAT_ROW, 24, 5),
    small: screen(s2('what', 0), ON_ALL, 16, 1),
    a: '80 × 24 · on the Format row, Word picked',
    b: '80 × 16 · on opening',
  },
  {
    id: 'S3',
    name: 'Side by side',
    idea: 'The screen split down the middle: Transcribe to on the left, Format on the right. ↑↓ reads down the left list, then on into the right. Five rows tall, so nothing hides; All loses its hint for room.',
    big: screen(s3('format'), ON_FORMAT, 24),
    small: screen(s3('what'), ON_ALL, 16),
    a: '80 × 24 · cursor on Word',
    b: '80 × 16 · on opening',
  },
  {
    id: 'S4',
    name: 'Format as a pill row',
    idea: 'The format is one more row of the list, showing its value; on it, ←→ steps a pill as Detail does. The tag shows when the value is the default. The least height of all: one row.',
    big: screen(s4('format', 1), ON_FORMAT_ROW, 24, 5),
    small: screen(s4('format', 0), ON_FORMAT_ROW, 16, 5),
    a: '80 × 24 · on the Format row, Word',
    b: '80 × 16 · on the Format row, Markdown (the default)',
  },
]

const concepts: PageConcept[] = SPLITS.map((s, i) => ({
  id: s.id,
  name: s.name,
  idea: s.idea,
  ...(i === 0
    ? {
        tab: '1 · Splits',
        section:
          'OPTIONS — S1, S2, S3 or S4, pick one <span class="sub">Format on the Transcribe to screen, ↑↓ only. Each at 80 × 24 and in a short window (80 × 16).</span>',
      }
    : {}),
  html: two(s.big, s.small, s.a, s.b),
}))
const stackOf = (frames: [string, Grid][]) =>
  `<div class="stack">${frames.map(([c, g]) => `<div class="cap">${c}</div>${term(g)}`).join('')}</div>`
concepts.push(
  ...BROAD.map(
    (b, i): PageConcept => ({
      id: b.id,
      name: b.name,
      idea: b.idea,
      ...(i === 0
        ? {
            tab: '2 · Broader',
            section:
              'OPTIONS — B1 to B7, pick any you like <span class="sub">Wider ideas for the format selector: other keys, other shapes, more than one format, asking once, typing it, a preview. Still ↑↓ (or no cursor at all), never tab to switch.</span>',
          }
        : {}),
      html: stackOf(b.frames),
    }),
  ),
)

const decided = `<h2>SCREEN — Working, decided <span class="sub">W4’s fold with W3’s squares, T1’s clock, no footnote. Shown while transcribing, then while writing notes.</span></h2>
<div class="figure" style="margin-top:20px">${pair(cropped(working('heard', decidedHeard), 15), cropped(working('notes', decidedNotes), 15), 'While transcribing', 'While writing notes')}</div>`

concepts.push(
  ...TWO.map(
    (t, i): PageConcept => ({
      id: t.id,
      name: t.name,
      idea: t.idea,
      ...(i === 0
        ? {
            tab: '3 · Two steps',
            section:
              'FLOW — Step 1 Transcribe to → Step 2 Format, then Save as <span class="sub">Step 1 is today’s screen without “· .md” (shown once, in T1). The options are for step 2: T1, T2, T3, T4 or T5, pick one. Each at 80 × 24 and 80 × 16.</span>',
          }
        : {}),
      html: stackOf(t.frames),
    }),
  ),
)

const before = `<div class="box"><h3>Decided</h3><ul>
<li><b>Working:</b> Transcribing keeps its line; when it is done the bar goes and it reads “✓ Transcribing 1m 08s”. Writing notes has the spinner and W3’s squares.</li>
<li><b>Clock:</b> T1 — “42.3s” under a minute, then “4m 12s”, “1h 03m”. Every Working screen.</li>
<li><b>No “nothing is saved until it is done”</b> on the key row. My call: gone from every Working screen, not only transcribe’s — tell me if one should keep it.</li>
<li><b>Format:</b> on the same screen as Transcribe to, ↑↓ only, no tab. One format can be made the default.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>Making a format the default: <b>tab make default</b>, as Save as does for folders, and the same amber <b>default</b> tag. OK?</li>
<li>The list opens on the default format, so a habit costs no keys.</li>
<li>New words on screen, to approve: <b>Format</b>, <b>Markdown · Word · PDF · Text</b>, <b>.md · .docx · .pdf · .txt</b>, “<b>←→ format</b>” (S2, S4).</li>
</ol></div>
<div class="pane-decided">${decided}</div>
<style>
  .stack { display:flex; flex-direction:column; gap:6px; }
  .cap { color:#8f94a1; font:600 12px -apple-system,sans-serif; letter-spacing:.06em; text-transform:uppercase; margin-top:6px; }
  .cut { height:10px; margin:3px 0; background:repeating-linear-gradient(90deg,#3a3a3a 0 6px,transparent 6px 12px) center/100% 1px no-repeat; }
  h2 .sub { display:block; color:#8f94a1; font-size:14px; font-weight:400; margin-top:4px; }
</style>`

writeFileSync(
  'mockups/transcribe-2026-10-round4.html',
  feedbackPage({
    page: 'transcribe-round4',
    title: 'Forge · Transcribe, round four',
    heading: 'Transcribe: Working decided, format split',
    lede: 'The Working screen as decided, then one open question: how the format sits on the Transcribe to screen. Real app cells at 80 × 24, dark; the short window is the same screen at 80 × 16.',
    before,
    concepts,
    compact: true,
  }),
)
console.log('wrote mockups/transcribe-2026-10-round4.html')
