/**
 * Several files at once (2026-10-22). The CLI has always batched; the shell
 * refused several files in convert, compress and edit. This round draws the
 * whole compress flow for twelve images, the screens edit and pdf change, and
 * five ways for Done to tell a batch.
 *
 * Every screen starts from the app's own cells at 80 × 24, dark
 * (scripts/batch-capture.tsx → scripts/batch-frames.json); Done's strip, bar
 * and now/was are the real `doneBody`. Decided pieces hold everywhere: the
 * header bar, the strip, the bar, now/was, the foot, the key row.
 *
 *   npx tsx scripts/batch-mockup.ts   → mockups/batch-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { doneBody } from '../src/shell/done-art.js'
import { mix, type Row } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./batch-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const N = 80
const grid = (k: string): Grid => {
  const raw = frames[k]
  if (!raw) throw new Error(`no frame ${k}`)
  return raw.map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )
}

const q = modePalette(DARK, 'compress')
const CANVAS = q.canvas
const MODE = modeColours(q, 'compress').fg
/** The painted app's block: columns 4 to 75. */
const L = 4
const R = N - 4
const BLOCK = R - L

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: CANVAS }))
const blanks = (n: number) => Array.from({ length: n }, blankRow)
const copy = (row: Cell[] | undefined): Cell[] => (row ?? blankRow()).map((c) => ({ ...c }))
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)

/** `segs` written on `row` from column `at`; a cell keeps its fill unless the segment has one. */
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
const line = (at: number, segs: Seg[]) => put(blankRow(), at, segs)
const ends = (left: Seg[], right: Seg[], at = L, end = R) =>
  put(line(at, left), end - len(right), right)

/** The app's `Row`s as cells, `shift` columns in (the painted margin is two). */
const rowsOf = (rows: Row[], shift = 2): Cell[][] =>
  rows.map((row) => {
    const cells = blankRow()
    let i = shift
    for (const r of row)
      for (const ch of r.text) {
        if (i < N) cells[i] = { ch, fg: r.fg, bg: r.bg ?? CANVAS, b: !!r.bold }
        i++
      }
    return cells
  })

/** A captured row with `from` swapped for `to` (padded with spaces in the old cells' fill). */
function swap(row: Cell[], from: string, to: string, style?: Partial<Cell>): Cell[] {
  const text = row.map((c) => c.ch).join('')
  const at = text.indexOf(from)
  if (at < 0) throw new Error(`no "${from}" in "${text.trim()}"`)
  const out = row.map((c) => ({ ...c }))
  const first = { ...(row[at] as Cell), ...style }
  const room = Math.max(from.length, to.length)
  for (let k = 0; k < room; k++) {
    const under = out[at + k]
    if (!under) break
    out[at + k] =
      k < to.length ? { ...first, ch: to[k] as string } : { ch: ' ', bg: under.bg ?? CANVAS }
  }
  return out
}

/** A key as the key row draws it: the cap on the key grey, the words dim. */
const cap = (k: string, words: string): Seg[] => [
  [` ${k} `, q.fg, q.keycapBg, true],
  [` ${words}`, q.dim],
]
/** The key row (KeyRow): keys from the margin, the footnote ending on it. */
function keyRow(main: Seg[][], foot: Array<[string, string]> = [['ctrl-c', 'quit']]): Cell[] {
  const left: Seg[] = main.flatMap((k, i) => (i ? [['  '] as Seg, ...k] : k))
  const right: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[' · ', q.border]] as Seg[]) : []),
    [k, q.fg] as Seg,
    ...(w ? ([[` ${w}`, q.border]] as Seg[]) : []),
  ])
  return ends(left, right, L, R)
}
const RULE = copy(grid('compress.step4')[22])

/** The header bar: the mode's chip, the answers, the current step in bold. */
const header = (
  answers: string[],
  current: string,
  mode: 'compress' | 'edit' | 'pdf' = 'compress',
) =>
  rowsOf([
    trailBarRow({
      width: N - 4,
      palette: modePalette(DARK, mode),
      mode,
      trail: { answers, current },
      slanted: false,
    }),
  ])[0] as Cell[]

/** A screen 24 rows tall: `top` from row 0, `bottom` ending on the last row, blank between. */
function screen(top: Cell[][], bottom: Cell[][], h = 24): Grid {
  const gap = h - top.length - bottom.length
  if (gap < 0) throw new Error(`screen overflows by ${-gap}`)
  return [...top, ...blanks(gap), ...bottom]
}
const shot = (g: Grid, p = q) => termHtml(p, g)
const pair = (a: string, b: string, la: string, lb: string) =>
  `<div style="display:flex;gap:24px">${[
    [a, la],
    [b, lb],
  ]
    .map(
      ([h, l]) =>
        `<div><div style="font:12px 'SF Mono',ui-monospace,monospace;color:#8f94a1;margin:0 0 6px">${l}</div>${h}</div>`,
    )
    .join('')}</div>`
const one = (h: string, l = '') =>
  `<div>${l ? `<div style="font:12px 'SF Mono',ui-monospace,monospace;color:#8f94a1;margin:0 0 6px">${l}</div>` : ''}${h}</div>`

/* --------------------------------------------------------------- the batch */

interface File {
  name: string
  before: number
  after?: number
  /** Not saved: why, in a few words. */
  failed?: string
  /** Not saved: the target can't be reached; the smallest it gets. */
  floor?: number
}
const MB = 1_000_000
const KB = 1000
const NAMES = Array.from({ length: 12 }, (_, i) => `IMG_${2041 + i}.png`)
const BEFORE = [1.31, 1.42, 1.55, 1.38, 1.72, 1.26, 1.94, 1.49, 1.61, 1.33, 1.58, 2.08].map((m) =>
  Math.round(m * MB),
)
const AFTER = [462, 471, 488, 455, 493, 439, 497, 476, 0, 451, 484, 0].map((k) => k * KB)
const allOk: File[] = NAMES.map((name, i) => ({
  name,
  before: BEFORE[i] as number,
  after: i === 8 ? 482 * KB : i === 11 ? 499 * KB : (AFTER[i] as number),
}))
const withProblems: File[] = NAMES.map((name, i) =>
  i === 8
    ? { name, before: BEFORE[i] as number, failed: 'can’t be read, it’s damaged' }
    : i === 11
      ? { name, before: BEFORE[i] as number, floor: 612 * KB }
      : { name, before: BEFORE[i] as number, after: AFTER[i] as number },
)
const saved = (fs: File[]) => fs.filter((f) => f.after !== undefined)
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const totals = (fs: File[]) => {
  const ok = saved(fs)
  return {
    n: ok.length,
    before: sum(ok.map((f) => f.before)),
    after: sum(ok.map((f) => f.after ?? 0)),
  }
}
const STAGED = sum(BEFORE)

/** The real Done body for the files that were saved: "12 images" in the bar. */
function body(fs: File[], compact = false): Cell[][] {
  const t = totals(fs)
  const noun = `${t.n} images`
  return rowsOf(
    doneBody({
      palette: q,
      width: N - 4,
      compact,
      facts: {
        mode: 'compress',
        before: { format: 'PNG', name: noun, bytes: t.before },
        after: { format: 'PNG', name: noun, bytes: t.after },
      },
    }),
  )
}

const DONE = grid('compress.step4')
const FOOT = copy(DONE[20])
const DONE_HEADER = header(['To a target size', '500 KB', 'Desktop', '12 files'], 'Done')
const doneKeys = (extra: Seg[][] = []) =>
  keyRow([cap('↵', 'compress again'), cap('o', 'open folder'), ...extra])

/** A problem file's few words: why it wasn't saved. */
const why = (f: File) => f.failed ?? `can’t get below ${formatBytes(f.floor ?? 0)}`

/** One file's row in a list: ✓ name, was → now, the change; a problem tinted with why. */
function fileRow(f: File, i: number, end = R): Cell[] {
  const name = f.name.padEnd(22)
  if (f.failed) {
    const r = put(blankRow(), L, [[' '.repeat(end - L), undefined, q.failTint]])
    return put(r, L, [
      [' ✕ ', q.fail, q.failTint, true],
      [name, q.fail, q.failTint, true],
      [why(f), q.fg, q.failTint],
    ])
  }
  if (f.floor) {
    return put(blankRow(), L, [
      [' – ', q.border],
      [name, q.dim],
      [why(f), q.border],
    ])
  }
  const was = formatBytes(f.before)
  const now = formatBytes(f.after ?? 0)
  const pct = `−${Math.round((1 - (f.after ?? 0) / f.before) * 100)}%`
  return put(blankRow(), L, [
    [' ✓ ', q.ok, undefined, true],
    [name, q.fg],
    [was.padStart(8), q.border],
    ['  →  ', q.border],
    [now.padStart(8), q.fg],
    [pct.padStart(i >= 0 ? 10 : 10), q.ok, undefined, true],
  ])
}
/** Problems first, then the rest in the order they were dropped. */
const ordered = (fs: File[]) => [...fs.filter((f) => !f.after), ...fs.filter((f) => f.after)]

/** `rows` in `room` rows, with the commands list's thin bar at the end when they don't fit. */
function scrolled(rows: Cell[][], room: number): Cell[][] {
  if (rows.length <= room) return rows
  const shown = rows.slice(0, room)
  const thumb = Math.max(1, Math.round((room * room) / rows.length))
  return shown.map((r, k) => put(r, R - 1, [[k < thumb ? '┃' : '│', k < thumb ? q.dim : q.faint]]))
}

/* -------------------------------------------------- A · totals, a panel */

/** Two files not saved, on the E5 tint: a tab, then a row each. */
function notSavedPanel(fs: File[]): Cell[][] {
  const bad = fs.filter((f) => !f.after)
  const tab = put(blankRow(), L, [
    [' ', undefined, q.failTint],
    [`${bad.length} not saved`, q.fail, q.failTint, true],
    [' ', undefined, q.failTint],
  ])
  const fill = () => put(blankRow(), L, [[' '.repeat(BLOCK), undefined, q.failTint]])
  return [
    tab,
    fill(),
    ...bad.map((f) =>
      put(fill(), L, [
        [' '],
        [f.name.padEnd(16), q.fg, q.failTint, true],
        [why(f), q.fg, q.failTint],
      ]),
    ),
    fill(),
  ]
}

function conceptA(fs: File[]): Grid {
  const problems = fs.some((f) => !f.after)
  if (!problems)
    return screen(
      [blankRow(), DONE_HEADER, ...blanks(2), ...body(fs)],
      [FOOT, blankRow(), RULE, doneKeys()],
    )
  return screen(
    [blankRow(), DONE_HEADER, blankRow(), ...body(fs, true)],
    [...notSavedPanel(fs), blankRow(), FOOT, blankRow(), RULE, doneKeys()],
  )
}

/* ------------------------------------------- B · totals and every file */

function conceptB(fs: File[]): Grid {
  const top = [blankRow(), DONE_HEADER, blankRow(), ...body(fs, true), blankRow()]
  const bottom = [blankRow(), FOOT, blankRow(), RULE, doneKeys([cap('↑↓', 'scroll')])]
  const room = 24 - top.length - bottom.length
  const rows = ordered(fs).map((f, i) => fileRow(f, i, R - 2))
  return screen([...top, ...scrolled(rows, room)], bottom)
}

/* ---------------------------------------------- C · a bar for each file */

function conceptC(fs: File[]): Grid {
  const t = totals(fs)
  // The strip as Done draws it, its words for the batch.
  const strip = body(fs).slice(0, 3)
  const biggest = Math.max(...fs.map((f) => f.before))
  const band = mix(MODE, CANVAS, 0.5)
  const hatchFg = q.selectionBg
  const cells = (n: number) => Math.max(1, Math.round((BLOCK * n) / biggest))
  const bar = (f: File): Cell[] => {
    const r = blankRow()
    const was = cells(f.before)
    if (f.failed) {
      put(r, L, [[' '.repeat(BLOCK), undefined, q.failTint]])
      return put(r, L, [
        [' ✕ ', q.fail, q.failTint, true],
        [`${f.name}  `, q.fail, q.failTint, true],
        [why(f), q.fg, q.failTint],
      ])
    }
    if (f.floor) {
      put(r, L, [['╱'.repeat(was), q.faint]])
      return put(r, L, [
        [' – ', q.border, CANVAS],
        [`${f.name}  `, q.dim, CANVAS],
        [`${why(f)} `, q.border, CANVAS],
      ])
    }
    const now = cells(f.after ?? 0)
    put(r, L, [[' '.repeat(now), undefined, band]])
    put(r, L + now, [['╱'.repeat(was - now), hatchFg]])
    return put(r, L, [
      [' ✓ ', q.ok, undefined, true],
      // Knocked out of the hatching past the band, as Done's name is.
      [f.name, q.fg, undefined, true],
    ])
  }
  const rows = ordered(fs).map(bar)
  const words = ends([['now', q.dim]], [['was', q.border]])
  const sizes = ends(
    [[formatBytes(t.after), q.ok, undefined, true]],
    [[formatBytes(t.before), q.fg, undefined, true]],
  )
  const top = [blankRow(), DONE_HEADER, blankRow(), ...strip]
  const bottom = [
    blankRow(),
    words,
    sizes,
    blankRow(),
    FOOT,
    blankRow(),
    RULE,
    doneKeys([cap('↑↓', 'scroll')]),
  ]
  const room = 24 - top.length - bottom.length
  return screen([...top, ...scrolled(rows, room)], bottom)
}

/* ---------------------------------------------- D · totals, tab for files */

function conceptD(fs: File[], listed: boolean): Grid {
  const bad = fs.filter((f) => !f.after)
  const keys = doneKeys([cap('tab', listed ? 'totals' : 'files')])
  if (!listed) {
    const note =
      bad.length > 0
        ? [
            blankRow(),
            put(put(blankRow(), L, [[' '.repeat(BLOCK), undefined, q.failTint]]), L, [
              [' '],
              [`${bad.length} not saved`, q.fail, q.failTint, true],
              ['   '],
              [bad.map((f) => f.name).join(' · '), q.fg, q.failTint],
            ]),
          ]
        : []
    return screen(
      [blankRow(), DONE_HEADER, ...blanks(bad.length ? 1 : 2), ...body(fs), ...note],
      [FOOT, blankRow(), RULE, keys],
    )
  }
  const strip = body(fs).slice(0, 3)
  const top = [blankRow(), DONE_HEADER, blankRow(), ...strip, blankRow()]
  const bottom = [blankRow(), FOOT, blankRow(), RULE, keys]
  const room = 24 - top.length - bottom.length
  return screen(
    [
      ...top,
      ...scrolled(
        ordered(fs).map((f, i) => fileRow(f, i, R - 2)),
        room,
      ),
    ],
    bottom,
  )
}

/* ------------------------------------------ E · a standing column a file */

function conceptE(fs: File[], chosen: number): Grid {
  const t = totals(fs)
  const strip = body(fs).slice(0, 3)
  const H = 8
  const W = 5
  const biggest = Math.max(...fs.map((f) => f.before))
  const band = mix(MODE, CANVAS, 0.5)
  const lit = MODE
  const rows = blanks(H)
  fs.forEach((f, i) => {
    const x = L + i * (W + 1)
    const tall = Math.max(1, Math.round((H * f.before) / biggest))
    const low = f.after ? Math.max(1, Math.round((H * f.after) / biggest)) : 0
    for (let r = 0; r < H; r++) {
      const fromBottom = H - r
      const row = rows[r] as Cell[]
      if (fromBottom > tall) continue
      if (f.failed) put(row, x, [[' '.repeat(W), undefined, q.failTint]])
      else if (f.floor || fromBottom > low)
        put(row, x, [['╱'.repeat(W), f.floor ? q.faint : q.selectionBg]])
      else put(row, x, [[' '.repeat(W), undefined, i === chosen ? lit : band]])
    }
    const mark = f.failed
      ? ['  ✕  ', q.fail, q.failTint, true]
      : f.floor
        ? ['  –  ', q.border]
        : null
    if (mark) put(rows[H - 1] as Cell[], x, [mark as Seg])
  })
  const pick = fs[chosen] as File
  const caret = put(blankRow(), L + chosen * (W + 1), [['  ▲  ', MODE, undefined, true]])
  const facts = pick.after
    ? ends(
        [
          [pick.name, q.fg, undefined, true],
          ['   '],
          [formatBytes(pick.before), q.border],
          ['  →  ', q.border],
          [formatBytes(pick.after), q.ok, undefined, true],
        ],
        [[`${t.n} images  ${formatBytes(t.after)}`, q.dim]],
      )
    : ends([[pick.name, q.fail, undefined, true], ['   '], [why(pick), q.fg]], [])
  const top = [blankRow(), DONE_HEADER, blankRow(), ...strip, blankRow(), ...rows, caret, facts]
  return screen(top, [blankRow(), FOOT, blankRow(), RULE, doneKeys([cap('←→', 'file')])])
}

/* ---------------------------------------------------------------- the flow */

/** The batch's card in the steps: the folder card's shape, for loose files. */
const card = (): Cell[][] => {
  const w = 52
  const title: Seg[] = [
    ['╭─ ', q.border],
    ['PNG ×12', MODE],
    [` ${'─'.repeat(w - 12)}╮`, q.border],
  ]
  return [
    line(L, title),
    put(line(L, [['│', q.border]]), L + 2, [
      ['12 images · ', q.fg],
      [formatBytes(STAGED), q.fg],
    ]),
    put(line(L, [[`╰${'─'.repeat(w - 2)}╯`, q.border]]), L + w - 1, [['╯', q.border]]),
  ].map((r) => put(r, L + w - 1, [[r === undefined ? '' : (r[L + w - 1]?.ch ?? '│'), q.border]]))
}
function cardRows(): Cell[][] {
  const w = 52
  const top = line(L, [
    ['╭─ ', q.border],
    ['PNG ×12', MODE],
    [` ${'─'.repeat(w - 12)}╮`, q.border],
  ])
  const mid = put(line(L, [['│', q.border]]), L + 2, [[`12 images · ${formatBytes(STAGED)}`, q.fg]])
  put(mid, L + w - 1, [['│', q.border]])
  const bot = line(L, [[`╰${'─'.repeat(w - 2)}╯`, q.border]])
  return [top, mid, bot]
}
void card

/** A captured step screen with its one-file card swapped for the batch's. */
function stepWith(
  k: string,
  cardAt: number,
  cardRowsN: number,
  patch: (g: Grid) => void = () => {},
): Grid {
  const g = grid(k)
  const out = [...g.slice(0, cardAt), ...cardRows(), ...g.slice(cardAt + cardRowsN)]
  while (out.length < 24) out.splice(out.length - 3, 0, blankRow())
  while (out.length > 24) out.splice(out.length - 3, 1)
  patch(out)
  return out
}

const HOME = (() => {
  const g = grid('several.home')
  const home = grid('compress.home')
  g[9] = swap(g[9] as Cell[], '5 images   7.3 MB', `12 images   ${formatBytes(STAGED)}`)
  g[13] = swap(g[13] as Cell[], '+2 more', '+9 more')
  g[16] = copy(home[16])
  g[19] = blankRow()
  g[23] = copy(home[23])
  return g
})()

const METHOD = stepWith('compress.step1', 3, 4, (g) => {
  g[1] = header([], 'Method')
  g[7] = swap(g[7] as Cell[], 'IMG_2041.png', '   12 images')
  g[9] = swap(g[9] as Cell[], 'pick a level, see the result', 'pick a level')
  g[23] = swap(g[23] as Cell[], 'esc remove file', '       esc back', {})
})
const SIZE = stepWith('size.size', 3, 4, (g) => {
  g[7] = swap(g[7] as Cell[], 'IMG_2041.png · 1.3 MB', `12 images · ${formatBytes(STAGED)}`)
  g[11] = swap(g[11] as Cell[], 'e.g. 500kb or 2mb', '500', { fg: q.fg, b: true })
})
const SAVE = (() => {
  const g = grid('watch.step3')
  const out = [...g.slice(0, 3), ...cardRows(), ...g.slice(6, 8), ...g.slice(10)]
  out[1] = header(['To a target size', '500 KB'], 'Save as')
  out[9] = swap(out[9] as Cell[], 'IMG_2041.webp … 5 files', 'IMG_2041-small.png … 12 files')
  return out
})()

/** A component rendered alone, put two columns in, under the header and card. */
const pieceRows = (k: string, take: number) =>
  grid(k)
    .slice(0, take)
    .map((r) =>
      [...blankRow().slice(0, 2), ...r.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))].slice(0, N),
    )

const TAKEN = screen(
  [
    blankRow(),
    header(['To a target size', '500 KB', 'Desktop'], 'Name taken'),
    blankRow(),
    ...cardRows(),
    blankRow(),
    ...pieceRows('piece.taken', 5),
  ],
  [
    RULE,
    keyRow(
      [cap('↑↓', 'choose'), cap('↵', 'confirm')],
      [
        ['esc', 'cancel'],
        ['ctrl-c', 'quit'],
      ],
    ),
  ],
)
const WORKING = screen(
  [
    blankRow(),
    header(['To a target size', '500 KB', 'Desktop', '12 files'], 'Compressing'),
    blankRow(),
    ...cardRows(),
    blankRow(),
    ...pieceRows('piece.working', 3).map((r, i) => {
      if (i === 0) return swap(r, 'IMG_2044.png', 'IMG_2047.png')
      if (i !== 2) return r
      // Half the bar for six of twelve.
      const bar = swap(r, '3 of 5 images', '6 of 12 images')
      const from = bar.findIndex((c) => c.ch === '█')
      for (let k = 0; k < 30; k++) {
        const c = bar[from + k] as Cell
        bar[from + k] = { ...c, fg: k < 15 ? MODE : '#2e2e2e' }
      }
      return bar
    }),
  ],
  [RULE, keyRow([cap('esc', 'stop')])],
)

/* ---------------------------------------------------------- edit and pdf */

const qe = modePalette(DARK, 'edit')
const EDIT = (() => {
  const g = grid('edit.picker')
  const out = [
    ...g.slice(0, 3),
    ...cardRows().map((r) =>
      r.map((c) => (c.fg === MODE ? { ...c, fg: modeColours(qe, 'edit').fg } : c)),
    ),
    ...g.slice(7),
  ]
  out.splice(out.length - 3, 0, blankRow())
  out[7] = swap(out[7] as Cell[], 'Edit PNG', 'Edit 12 images')
  out[13] = swap(
    out[13] as Cell[],
    'Trim edges         no empty edges',
    'Trim edges                       ',
  )
  out[14] = swap(out[14] as Cell[], 'same size · 900 × 600', 'same size')
  out[15] = put(out[15] as Cell[], L + 2, [
    ['Crop to shape      ', q.faint],
    ['one at a time', q.faint],
  ])
  return out.slice(0, 24)
})()
const qp = modePalette(DARK, 'pdf')
const PDF = (() => {
  const g = grid('pdf.hub')
  const ink = (r: Cell[] | undefined, from: string, to: string) =>
    swap(r as Cell[], from, to, { fg: qp.fg })
  g[19] = ink(g[19], 'Compress  one file at a time', 'Compress                    ')
  g[20] = ink(g[20], 'Convert   one file at a time', 'Convert                     ')
  return g
})()

/* ---------------------------------------------------------------- the page */

const flow: PageConcept[] = [
  {
    tab: 'The flow',
    section: 'FLOW · Step 1 → Step 6, compressing 12 images (my calls)',
    id: 'F1',
    name: 'Home: ↵ compress',
    idea: 'Twelve images on home, as the list shows them today. The “converting several files at once is coming” line goes; ↵ compress starts, in every mode where the batch makes sense.',
    html: one(shot(HOME)),
  },
  {
    id: 'F2',
    name: 'Method',
    idea: 'Every step after home shows the batch as one card, the shape a folder’s card has. By quality drops “see the result”: a batch has no one result to show.',
    html: one(shot(METHOD)),
  },
  {
    id: 'F3',
    name: 'Target size',
    idea: 'The size is for each file, as Clop and Squoosh mean it. A size no file could reach is refused here; one only some can’t reach is tried, and those are told at Done.',
    html: one(shot(SIZE)),
  },
  {
    id: 'F4',
    name: 'Save as',
    idea: 'No name field: twelve names aren’t typed. Each file keeps its own name with -small, as the CLI writes them. Folder choices as today, New subfolder included.',
    html: one(shot(SAVE)),
  },
  {
    id: 'F5',
    name: 'Name taken, asked once',
    idea: 'When some of the twelve names are taken, one question for all of them, as /pdf asks today: keep both, replace, or cancel.',
    html: one(shot(TAKEN)),
  },
  {
    id: 'F6',
    name: 'Working',
    idea: 'The true count, file by file; each file is saved as it finishes. esc stops after the file being worked on — what is saved stays.',
    html: one(shot(WORKING)),
  },
]

const done: PageConcept[] = [
  {
    tab: 'Done for several files',
    section:
      'OPTIONS · Done for 12 files — pick one (A, B, C, D or E). Left: all saved. Right: one damaged, one can’t reach 500 KB.',
    id: 'A',
    name: 'Totals, problems in a panel',
    idea: 'Done as it is today, for the whole batch. Files that weren’t saved get the error’s tinted panel above the foot; the body goes compact to make room, as it does today.',
    html: pair(shot(conceptA(allOk)), shot(conceptA(withProblems)), 'all saved', 'two not saved'),
  },
  {
    id: 'B',
    name: 'Totals, then every file',
    idea: 'The compact body on top, then a row a file: was → now and the change. Problems lead the list, tinted as the watch list tints them. ↑↓ scrolls.',
    html: pair(shot(conceptB(allOk)), shot(conceptB(withProblems)), 'all saved', 'two not saved'),
  },
  {
    id: 'C',
    name: 'A bar for each file',
    idea: 'The bar splits into one bar a file, stacked: each band its new size, its hatching what it shed, all on one scale. Totals stay in the strip and under the bars.',
    html: pair(shot(conceptC(allOk)), shot(conceptC(withProblems)), 'all saved', 'two not saved'),
  },
  {
    id: 'D',
    name: 'Totals, tab for the files',
    idea: 'Done as it is today. Problems get one tinted row under the sizes. Tab swaps the bar for the list of files, and back.',
    html: pair(
      shot(conceptD(withProblems, false)),
      shot(conceptD(withProblems, true)),
      'two not saved',
      'after tab',
    ),
  },
  {
    id: 'E',
    name: 'A standing column for each file',
    idea: 'Each file is a column, as tall as it was; the lit part is what it is now. ←→ picks a file and the row under says it. A file not saved is a tinted column.',
    html: pair(
      shot(conceptE(allOk, 4)),
      shot(conceptE(withProblems, 8)),
      'all saved',
      'two not saved, the damaged one picked',
    ),
  },
]

const other: PageConcept[] = [
  {
    tab: 'Edit and pdf',
    section: 'SCREENS · what changes in edit and pdf (my calls)',
    id: 'G1',
    name: 'Edit, twelve images',
    idea: 'Every row applies to each image, except Crop to shape: where to crop is a choice per picture, so it is one image at a time. Trim doesn’t dim: an image with no empty edges is left as it is and told at Done. Boost: an image too large for the scale is left as it is.',
    html: one(shot(EDIT, qe)),
  },
  {
    id: 'G2',
    name: 'Pdf, three PDFs',
    idea: 'Compress and Convert now take all three, through their own modes. Split, Extract, Delete and Rotate stay one PDF at a time: each asks about one document’s pages.',
    html: one(shot(PDF, qp)),
  },
]

const before = `<div class="box"><h3>Questions for you</h3><ol>
<li>Pick one Done: A, B, C, D or E (the “Done for several files” tab). The buttons on the flow and edit/pdf screens are for anything you want changed; I’ve made those calls.</li>
<li>New words to approve: <code>2 not saved</code> (the panel’s tab, or the row), <code>can’t get below 612 KB</code>, <code>can’t be read, it’s damaged</code>, <code>one image at a time</code> (Crop to shape), <code>Edit 12 images</code>, <code>esc stop</code> on Working.</li>
<li>Decided without asking (say if any is wrong): a folder in convert still watches; a folder in compress or edit is a batch of its files; images and videos mixed in edit aren’t one batch; mixed kinds in convert and compress ask each kind’s setting, as a mixed folder does.</li>
</ol></div>`

const html = feedbackPage({
  page: 'batch-2026-10',
  title: 'Forge · several files at once',
  heading: 'Several files at once',
  lede: 'Compress, convert and edit take several files, or a folder, and do each one. The CLI always could. Drawn from the app’s own screens at 80 × 24.',
  before,
  concepts: [...flow, ...done, ...other],
})
writeFileSync(new URL('../mockups/batch-2026-10.html', import.meta.url), html)
console.log('mockups/batch-2026-10.html')

/** BATCH_SOLO=dir: each screen alone, for checking at 1:1. */
if (process.env.BATCH_SOLO) {
  const { TERM_CSS } = await import('./term-cells.js')
  const solo: Record<string, string> = {
    home: shot(HOME),
    method: shot(METHOD),
    size: shot(SIZE),
    save: shot(SAVE),
    taken: shot(TAKEN),
    working: shot(WORKING),
    a1: shot(conceptA(allOk)),
    a2: shot(conceptA(withProblems)),
    b1: shot(conceptB(allOk)),
    b2: shot(conceptB(withProblems)),
    c1: shot(conceptC(allOk)),
    c2: shot(conceptC(withProblems)),
    d1: shot(conceptD(withProblems, false)),
    d2: shot(conceptD(withProblems, true)),
    e1: shot(conceptE(allOk, 4)),
    e2: shot(conceptE(withProblems, 8)),
    edit: shot(EDIT, qe),
    pdf: shot(PDF, qp),
  }
  for (const [k, h] of Object.entries(solo))
    writeFileSync(
      `${process.env.BATCH_SOLO}/${k}.html`,
      `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0d0e11}${TERM_CSS}</style>${h}`,
    )
}
