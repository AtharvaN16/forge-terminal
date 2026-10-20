/**
 * Presets (2026-10-16), round 9. Decided: A (do it for real on Done, then
 * save). Done keeps its body, with three quiet additions in the key row's
 * greys: `p save as preset` beside the formats' chip, `→ continue editing`
 * at the bottom right above the key row, and the sizes as N6's badge on a
 * green (or orange) tint. → opens W2 — one window over Done, as colour mode's
 * Tweak: every operation a row, ● selected or ○ not, its value, what it makes
 * dim at the end; a row that needs room opens its own small window just under
 * it. Earlier rounds: mockups/presets-2026-10-round6.html (concepts),
 * presets-2026-10-round7.html (P1, pop-up experiments) and
 * presets-2026-10-round8.html (W2's first drawing).
 *
 * The header bar, Done body, quality slider and exact-size pair are the app's
 * own art; the windows copy colour mode's (W1), the key rows what the app
 * draws at 80 × 24.
 *
 *   npx tsx scripts/presets-mockup.ts   → mockups/presets-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import { type DoneFacts, doneBody } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { exactPairRows } from '../src/shell/resize-art.js'
import {
  edgeColour,
  fieldBlank,
  fieldRow,
  folderRow,
  label,
  NAME_WIDTH,
  newFolderRow,
  padTo,
  pathRow,
  ruleRow,
  underlineRow,
} from '../src/shell/save-as-art.js'
import { DARK, LIGHT, modePalette, type Palette, type ShellMode } from '../src/shell/theme.js'

const N = 80
const H = 24

interface Look {
  p: Palette
  name: 'dark' | 'light'
}
const looks: Look[] = [
  { p: DARK, name: 'dark' },
  { p: LIGHT, name: 'light' },
]

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]
const mp = (L: Look, m: ShellMode = 'convert') => modePalette(L.p, m)
const B = (n = N): Row => [blank(n)]

function header(L: Look, mode: ShellMode, answers: string[], current: string): Row {
  return trailBarRow({ width: N, palette: L.p, mode, trail: { answers, current }, slanted: false })
}

/** A key as the key row draws it: the cap on the keycap grey, the words dim. */
const keyRuns = (L: Look, k: string, w: string): Run[] => [
  run(` ${k} `, L.p.fg, L.p.keycapBg, true),
  run(` ${w}`, L.p.dim),
]

/** The key row as the app draws it: caps on the keycap grey, words dim, the footnote quiet. */
function keyRow(L: Look, main: [string, string][], foot: string, lead = 3): Row {
  const row: Row = [blank(lead)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(...keyRuns(L, k, w))
  })
  row.push(blank(Math.max(2, N - width(row) - stringWidth(foot) - 3)), run(foot, L.p.border))
  return row
}
const rule = (L: Look): Row => [blank(2), run('─'.repeat(N - 4), L.p.border)]
const keys = (L: Look, main: [string, string][], foot: string): Row[] => [
  rule(L),
  keyRow(L, main, foot),
]

/** A whole 80 × 24 screen: the bar on row 1, `body` from row 3, the keys on the last two. */
function screen(h: Row, body: Row[], k: Row[]): Row[] {
  const rows: Row[] = [B(), h, B(), ...body]
  while (rows.length < H - 2) rows.push(B())
  return [...rows.slice(0, H - 2), ...k]
}

/** /update's pill: lit, ink on white; at rest, dim words on the keycap grey. */
const pill = (L: Look, t: string, lit: boolean): Run =>
  lit ? run(` ${t} `, L.p.ink, L.p.pill, true) : run(` ${t} `, L.p.dim, L.p.keycapBg)

/* ------------------------------------------------------------ Done */

const facts = (after: number): DoneFacts => ({
  mode: 'convert',
  before: { format: 'PNG', name: 'photo.png', bytes: 14_400_000 },
  after: { format: 'WebP', name: 'photo.webp', bytes: after },
})

/** The steps so far, as Done's formats chip: `PNG → WebP 80 → 1920 wide`. */
function chainChip(L: Look, parts: string[], lead = 3): Row {
  const p = mp(L)
  const r: Row = [blank(lead), run(' ', undefined, p.band)]
  parts.forEach((t, i) => {
    if (i) r.push(run(' → ', p.accent, p.band, true))
    r.push(run(t, p.accent, p.band, true))
  })
  r.push(run(' ', undefined, p.band))
  return r
}

interface Chain {
  bytes: number
  parts: string[]
  answers: string[]
  /** Another file than photo.png → photo.webp, and the size it was. */
  facts?: DoneFacts
  was?: string
  now?: string
}
const ONE: Chain = {
  bytes: 2_000_000,
  parts: ['PNG', 'WebP'],
  answers: ['WebP', '80', 'Desktop', 'photo.webp'],
}
const THREE: Chain = {
  bytes: 910_000,
  parts: ['PNG', 'WebP 80', '1920 wide', 'Sharpen'],
  answers: ['WebP', '80', '1920 wide', 'Sharpen', 'photo.webp'],
}
const GREW: Chain = {
  bytes: 21_000_000,
  parts: ['PNG', 'WebP 80', 'Sharpen', 'Boost 4×'],
  answers: ['WebP', '80', 'Sharpen', '4×', 'photo.webp'],
}

const SAVE = 'Save as preset'
const MORE = 'Continue editing'
const M3 = 3
const BLOCK = N - 2 * M3
const sizeText = (b: number) => (b >= 1_000_000 ? `${b / 1_000_000} MB` : `${b / 1000} KB`)

/** N6 · the sizes as badges: “now” on grey, the size on a green tint — orange when the file grew. */
function sizesRow(L: Look, c: Chain): Row {
  const grew = c.bytes > (c.facts?.before.bytes ?? 14_400_000)
  const ink = grew ? L.p.larger : L.p.ok
  const tint = mix(ink, L.p.canvas, 0.8)
  const now: Run[] = [
    run(' now ', L.p.dim, L.p.keycapBg),
    run(` ${c.now ?? sizeText(c.bytes)} `, ink, tint, true),
  ]
  const was: Run[] = [
    run(' was ', L.p.border, L.p.keycapBg),
    run(` ${c.was ?? '14.4 MB'} `, L.p.dim, L.p.panelBand),
  ]
  const [left, right] = grew ? [was, now] : [now, was]
  return [blank(M3), ...left, blank(Math.max(1, BLOCK - width(left) - width(right))), ...right]
}

/** What sits beside the chip: the key to save, the confirmation, or the choice once it changed. */
type SaveLook = 'key' | 'saved' | 'update'

/**
 * Done as decided: today's body; `p save as preset` beside the chip and
 * `→ continue editing` at the bottom right, both in the key row's greys; the
 * sizes as N6's badges. The key row is today's.
 */
function doneNew(L: Look, c: Chain, o: { save?: SaveLook } = {}): Row[] {
  const rows = doneBody({ palette: mp(L), facts: c.facts ?? facts(c.bytes), width: N })
  if (c.parts.length > 2) rows[0] = chainChip(L, c.parts)
  const save: Run[] =
    o.save === 'saved'
      ? [run('✓ saved as ', L.p.ok), run('blog', L.p.ok, undefined, true)]
      : o.save === 'update'
        ? keyRuns(L, 'p', 'update blog')
        : keyRuns(L, 'p', 'save as preset')
  rows[0] = [...(rows[0] ?? []), blank(2), ...save]
  rows[5] = sizesRow(L, c)
  const top = Math.max(0, Math.floor((H - 6 - rows.length) / 2) - 1)
  const out = screen(
    header(L, 'convert', c.answers, 'Done'),
    [...Array.from({ length: top }, () => B()), ...rows],
    keys(
      L,
      [
        ['↵', 'convert another'],
        ['o', 'open'],
        ['s', 'show in Finder'],
      ],
      'ctrl-c quit',
    ),
  )
  const hint = keyRuns(L, '→', 'continue editing')
  out[H - 3] = [...pad([], N - 3 - width(hint)), ...hint]
  return out
}

/* ------------------------------------------------------------ windows, as colour mode's */

/*
 * Colour mode's windows (W1, Mode and Tweak): a rounded frame on the field's
 * grey, the title in the top edge, the screen faded behind so the window is
 * plainly on top. A second, smaller window opens just under the row it
 * belongs to, over the first without fading it.
 */

interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}
const cellsOfRow = (r: Row, n = N): Cell[] => {
  const out: Cell[] = []
  for (const x of r)
    for (const ch of Array.from(x.text)) out.push({ ch, fg: x.fg, bg: x.bg, bold: x.bold })
  while (out.length < n) out.push({ ch: ' ' })
  return out.slice(0, n)
}
const rowOfCells = (cs: Cell[]): Row => {
  const out: Row = []
  for (const c of cs) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch
    else out.push({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.bold })
  }
  return out
}

/** A window over a whole screen: the body fades (unless `keep`); the header stays; the keys become the window's. */
function pop(
  L: Look,
  under: Row[],
  win: {
    title: string
    lines: Row[]
    width: number
    top: number
    left?: number
    keys: Row[]
    keep?: boolean
  },
): Row[] {
  const canvas = L.p.canvas
  const fade = (h?: string) => (h && /^#[0-9a-f]{6}$/i.test(h) ? mix(h, canvas, 0.7) : h)
  const rows = under.map((r, i) =>
    !win.keep && i >= 2 && i < H - 2
      ? cellsOfRow(r).map((c) => ({ ...c, fg: fade(c.fg ?? L.p.fg), bg: fade(c.bg), bold: false }))
      : cellsOfRow(r),
  )
  const W = win.width
  const left = win.left ?? Math.floor((N - W) / 2)
  const fill = L.p.selectionBg || undefined
  const edge = L.p.border
  const inner = W - 2
  const title = ` ${win.title} `
  const top: Cell[] = [
    { ch: '╭', fg: edge, bg: fill },
    { ch: '─', fg: edge, bg: fill },
    ...Array.from(title).map((ch) => ({ ch, fg: L.p.fg, bg: fill, bold: true })),
    ...Array.from({ length: Math.max(0, inner - 1 - title.length) }, () => ({
      ch: '─',
      fg: edge,
      bg: fill,
    })),
    { ch: '╮', fg: edge, bg: fill },
  ]
  const bottom: Cell[] = [
    { ch: '╰', fg: edge, bg: fill },
    ...Array.from({ length: inner }, () => ({ ch: '─', fg: edge, bg: fill })),
    { ch: '╯', fg: edge, bg: fill },
  ]
  const body = win.lines.map((line): Cell[] => [
    { ch: '│', fg: edge, bg: fill },
    ...cellsOfRow(line, inner).map((c) => ({ ...c, bg: c.bg ?? fill })),
    { ch: '│', fg: edge, bg: fill },
  ])
  ;[top, ...body, bottom].forEach((cells, k) => {
    const row = rows[win.top + k]
    if (!row) return
    cells.forEach((c, j) => {
      row[left + j] = c
    })
  })
  return [...rows.map(rowOfCells).slice(0, H - 2), ...win.keys]
}

/** A list row in a window, as colour's: › in the mode colour and the band on the one in hand. */
function popRow(
  L: Look,
  name: string,
  on: boolean,
  inner: number,
  nameW: number,
  after: Run[] = [],
): Row {
  const band = on ? L.p.panelBand : undefined
  const row: Row = [
    run(on ? ' › ' : '   ', mp(L).accent, band, true),
    run(name, on ? L.p.fg : L.p.dim, band, on),
  ]
  row.push(run(' '.repeat(Math.max(1, nameW + 3 - width(row))), undefined, band))
  row.push(...after.map((r) => ({ ...r, bg: band, fg: on ? r.fg : L.p.border })))
  row.push(run(' '.repeat(Math.max(0, inner - width(row))), undefined, band))
  return row
}

const slider = (L: Look, value: number, w: number): Run[] =>
  sliderRow({ palette: L.p, value, min: 0, max: 100, width: w }).slice(1)

/** Resize's pair without "keeps its shape", from its first box. */
const pairRows = (L: Look): Row[] =>
  exactPairRows({
    palette: mp(L, 'edit'),
    mode: 'edit',
    width: '1920',
    height: '1280',
    focus: 'width',
    follows: true,
  }).map((r) => {
    const keep = r.findIndex((x) => x.text === 'keeps its shape')
    return [blank(1), ...(keep > 0 ? r.slice(1, keep - 1) : r.slice(1))]
  })

/* ------------------------------------------------------------ W2: one window, every operation a row */

/** One row of the window: selected or not, the operation, its value, what it makes. */
interface TR {
  n: string
  on: boolean
  /** Its value as shown; '' for a row with nothing to ask. */
  v?: string
  /** Not for this file: dim, with why where the value would be. */
  why?: string
  fail?: boolean
  spin?: boolean
  /** A slider instead of the value, lit (Quality). */
  slide?: number
  /** Has a window of its own: lit, → opens it. */
  more?: boolean
}

const TW = 68
const TIN = TW - 2
const TLEFT = Math.floor((N - TW) / 2)
/** Where a row's value starts, on the screen: the window's edge, the marker, the dot, the name. */
const VALUE_AT = TLEFT + 1 + 3 + 2 + 19

function twRow(L: Look, r: TR, lit: boolean, inner = TIN): Row {
  const p = mp(L)
  const band = lit ? L.p.panelBand : undefined
  const dot = run(r.on ? '● ' : '○ ', r.why ? L.p.faint : r.on ? p.accent : L.p.border, band)
  const nameFg = r.why ? L.p.faint : r.on || lit ? L.p.fg : L.p.dim
  const head: Row = [
    run(lit ? ' › ' : '   ', p.accent, band, true),
    dot,
    run(r.n.padEnd(19), nameFg, band, lit),
  ]
  let value: Run[]
  if (r.why) value = [run(r.why, L.p.faint)]
  else if (r.fail) value = [run(`✕ ${r.v ?? ''}`.trimEnd(), L.p.fail, undefined, true)]
  else if (r.spin)
    value = [run('⠹ ', p.accent, undefined, true), run(r.v ?? '', L.p.fg, undefined, true)]
  else if (lit && r.slide !== undefined) value = slider(L, r.slide, 30)
  else if (r.v) value = [run(r.v, r.on ? L.p.fg : L.p.faint, undefined, lit)]
  else value = r.on || r.v === '' ? [] : [run('—', L.p.faint)]
  if (lit && r.more && !r.why && !r.fail && !r.spin) value.push(run('  ›', L.p.border))
  return pad([...head, ...value.map((x) => ({ ...x, bg: x.bg ?? band }))], inner, band)
}

/** The window's foot: what the file is now, live. */
const twResult = (
  L: Look,
  o: { name?: string; now: string; change?: string; grew?: boolean },
): Row => [
  blank(3),
  run('✓ ', L.p.ok, undefined, true),
  run(o.name ?? 'photo.webp', L.p.fg, undefined, true),
  run('   now ', L.p.border),
  run(o.now, L.p.fg, undefined, true),
  ...(o.change ? [run(`   ${o.change}`, o.grew ? L.p.larger : L.p.ok, undefined, true)] : []),
]

/** The window's keys for the lit row: → only where it has a window of its own; ←→ on a slider. */
function twKeys(L: Look, r: TR | undefined): Row[] {
  if (r?.slide !== undefined)
    return keys(
      L,
      [
        ['↑↓', 'choose'],
        ['←→', '1'],
        ['⇧←→', '10'],
        ['↵', 'done'],
      ],
      'esc cancel',
    )
  return keys(
    L,
    [
      ['↑↓', 'choose'],
      ['space', 'select'],
      ...(r?.more ? ([['→', 'more']] as [string, string][]) : []),
      ['↵', 'done'],
    ],
    'esc cancel',
  )
}

/** A tinted row inside the window: the problem, then what to do. */
const twTint = (L: Look, left: Run[], right: string): Row => {
  const bg = L.p.failTint
  const body: Run[] = [run('   ', undefined, bg), ...left.map((r) => ({ ...r, bg }))]
  const end = run(`${right}  `, L.p.failTintDim, bg)
  return [...pad(body, TIN - width([end]), bg), end]
}

interface Sub {
  title: string
  lines: Row[]
  width?: number
  keys: Row[]
}

/** The window over Done (or `under`), its rows, the result at its foot — and the lit row's own window under it. */
function tw(
  L: Look,
  o: {
    rows: TR[]
    lit: string
    result: Row
    keys?: Row[]
    under?: Row[]
    tint?: Row
    sub?: Sub
  },
): Row[] {
  const lines: Row[] = [
    [],
    ...o.rows.map((r) => twRow(L, r, r.n === o.lit)),
    [],
    ...(o.tint ? [o.tint] : []),
    o.result,
    [],
  ]
  const top = Math.max(3, Math.floor((H - lines.length - 2) / 2) - 1)
  const litRow = o.rows.find((r) => r.n === o.lit)
  // Done under the window, without its → continue editing: the window is what it opened.
  const under = (o.under ?? doneNew(L, ONE)).map((r, i) => (i === H - 3 ? B() : r))
  const main = pop(L, under, {
    title: MORE,
    lines,
    width: TW,
    top,
    keys: o.keys ?? twKeys(L, litRow),
  })
  if (!o.sub) return main
  // The row's own window opens under the row, from where its value starts —
  // above it when there is no room below — and the first window dims behind it.
  const at = top + 2 + o.rows.findIndex((r) => r.n === o.lit)
  const h = o.sub.lines.length + 2
  const w = o.sub.width ?? 42
  const below = at + 1 + h <= H - 3
  return pop(L, main, {
    title: o.sub.title,
    lines: o.sub.lines,
    width: w,
    top: below ? at + 1 : at - h,
    left: Math.min(N - w - 1, VALUE_AT - 2),
    keys: o.sub.keys,
  })
}

const SUB_KEYS = (L: Look, change: [string, string] = ['↑↓', 'choose']) =>
  keys(L, [change, ['↵', 'confirm']], '← back')

/* the image rows, in the order the app lists them */

const IMG_BASE: TR[] = [
  { n: 'Convert to', on: true, v: 'WebP', more: true },
  { n: 'Quality', on: true, v: '80', slide: 80 },
  { n: 'Compress', on: false, more: true },
  { n: 'Resize', on: false, more: true },
  { n: 'Trim edges', on: false },
  { n: 'Crop to shape', on: false, more: true },
  { n: 'Sharpen', on: false },
  { n: 'Boost resolution', on: false, more: true },
  { n: 'Remove background', on: false },
]
type Over = Record<string, Partial<TR>>
/** The rows with some changed: name → what is different. */
const img = (over: Over = {}): TR[] => IMG_BASE.map((r) => ({ ...r, ...(over[r.n] ?? {}) }))

/** Each row selected, with its value, for photo.png (3024×2016). */
const SET = {
  resize: (): Partial<TR> => ({ on: true, v: '1920 wide' }),
  trim: (): Partial<TR> => ({ on: true, v: '' }),
  crop: (): Partial<TR> => ({ on: true, v: '16:9' }),
  sharpen: (): Partial<TR> => ({ on: true, v: '' }),
  boost: (k = '2×'): Partial<TR> => ({ on: true, v: k }),
  cutout: (): Partial<TR> => ({ on: true, v: '' }),
}
/** WebP 80, 1920 wide, Sharpen: the example. */
const SHARP = (over: Over = {}): Over => ({
  Resize: SET.resize(),
  Sharpen: SET.sharpen(),
  ...over,
})
const R = {
  two: (L: Look) => twResult(L, { now: '2 MB', change: '86% smaller' }),
  wide: (L: Look) => twResult(L, { now: '840 KB', change: '94% smaller' }),
  sharp: (L: Look) => twResult(L, { now: '910 KB', change: '94% smaller' }),
  noResize: (L: Look) => twResult(L, { now: '2.1 MB', change: '85% smaller' }),
}

/* each row's own window */

const SUBS = {
  convert: (L: Look, sel = 'WebP'): Sub => ({
    title: 'Convert to',
    lines: [
      [],
      ...['JPEG', 'WebP', 'AVIF', 'PNG', 'GIF', 'TIFF'].map((f) => popRow(L, f, f === sel, 40, 8)),
      [],
    ],
    keys: SUB_KEYS(L, ['↑↓', 'format']),
  }),
  compress: (L: Look): Sub => ({
    title: 'Compress',
    lines: [
      [],
      popRow(L, 'By quality', false, 40, 18, [run('70', L.p.dim)]),
      popRow(L, 'To a target size', true, 40, 18, [
        run(' 500', L.p.fg, mp(L).band, true),
        run(' ', undefined, L.p.fg),
        run(' ', undefined, mp(L).band),
        run(' KB', L.p.dim),
      ]),
      [],
    ],
    keys: keys(
      L,
      [
        ['↑↓', 'choose'],
        ['0–9', 'size'],
        ['←→', 'KB · MB'],
        ['↵', 'confirm'],
      ],
      '← back',
    ),
  }),
  resize: (L: Look): Sub => ({
    title: 'Resize',
    lines: [[], ...pairRows(L), []],
    keys: keys(
      L,
      [
        ['0–9', 'width'],
        ['tab', 'height'],
        ['↵', 'confirm'],
      ],
      '← back',
    ),
  }),
  crop: (L: Look): Sub => ({
    title: 'Crop to shape',
    lines: [
      [],
      ...(
        [
          ['1:1', '2016×2016'],
          ['4:5', '1613×2016'],
          ['16:9', '3024×1701'],
          ['9:16', '1134×2016'],
        ] as const
      ).map(([s, d]) => popRow(L, s, s === '16:9', 40, 6, [run(d, L.p.dim)])),
      [],
    ],
    keys: SUB_KEYS(L, ['↑↓', 'shape']),
  }),
  boost: (L: Look): Sub => ({
    title: 'Boost resolution',
    lines: [
      [],
      ...(
        [
          ['2×', '6048×4032'],
          ['3×', '9072×6048'],
          ['4×', '12096×8064'],
        ] as const
      ).map(([s, d]) => popRow(L, s, s === '2×', 40, 4, [run(d, L.p.dim)])),
      [],
    ],
    keys: SUB_KEYS(L, ['↑↓', 'scale']),
  }),
  background: (L: Look): Sub => ({
    title: 'Remove background',
    lines: [
      [],
      [blank(3), run('JPEG has no transparency', L.p.dim)],
      [],
      ...['On white', 'On black', 'As PNG instead'].map((t) =>
        popRow(L, t, t === 'On white', 40, 16),
      ),
      [],
    ],
    keys: SUB_KEYS(L),
  }),
  extension: (L: Look): Sub => ({
    title: 'Sharpen',
    lines: [[], [blank(3), pill(L, 'add · 41 MB', true)], []],
    width: 24,
    keys: keys(L, [['↵', 'add']], '← back'),
  }),
  pdfConvert: (L: Look): Sub => ({
    title: 'Convert to',
    lines: [
      [],
      ...['PNG', 'JPEG', 'WebP', 'TIFF'].map((f) =>
        popRow(L, f, f === 'PNG', 40, 8, f === 'PNG' ? [run('12 files', L.p.dim)] : []),
      ),
      [],
      [
        blank(3),
        run('Pages       ', L.p.border),
        run('‹ ', L.p.border),
        run('All pages', L.p.fg),
        run(' ›', L.p.border),
      ],
      [
        blank(3),
        run('Resolution  ', L.p.border),
        run('‹ ', L.p.border),
        run('150 dpi', L.p.fg),
        run(' ›', L.p.border),
      ],
      [],
    ],
    keys: keys(
      L,
      [
        ['↑↓', 'format'],
        ['tab', 'pages'],
        ['↵', 'confirm'],
      ],
      '← back',
    ),
  }),
  rotate: (L: Look): Sub => ({
    title: 'Rotate',
    lines: [
      [],
      ...['90° right', '180°', '90° left'].map((t) => popRow(L, t, t === '90° right', 40, 10)),
      [],
    ],
    keys: SUB_KEYS(L, ['↑↓', 'turn']),
  }),
  split: (L: Look): Sub => ({
    title: 'Split',
    lines: [
      [],
      popRow(L, 'Every page', true, 40, 16, [run('12 files', L.p.dim)]),
      popRow(L, 'Every N pages', false, 40, 16, [run('‹ 2 ›', L.p.dim)]),
      [],
    ],
    keys: SUB_KEYS(L),
  }),
}

/* the flow */

const FL = {
  open: (L: Look) => tw(L, { rows: img(), lit: 'Compress', result: R.two(L) }),
  resizeLit: (L: Look) => tw(L, { rows: img(), lit: 'Resize', result: R.two(L) }),
  resizeSub: (L: Look) =>
    tw(L, {
      rows: img({ Resize: { on: true, v: '1920 wide' } }),
      lit: 'Resize',
      result: R.wide(L),
      sub: SUBS.resize(L),
    }),
  resized: (L: Look) =>
    tw(L, { rows: img({ Resize: SET.resize() }), lit: 'Resize', result: R.wide(L) }),
  sharpen: (L: Look) => tw(L, { rows: img(SHARP()), lit: 'Sharpen', result: R.sharp(L) }),
  off: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ Resize: { ...SET.resize(), on: false } })),
      lit: 'Resize',
      result: R.noResize(L),
    }),
  quality: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ Quality: { v: '72', slide: 72 } })),
      lit: 'Quality',
      result: twResult(L, { now: '760 KB', change: '95% smaller' }),
    }),
  done: (L: Look) => doneNew(L, THREE),
  save: (L: Look, taken = false) => saveWin(L, THREE, { taken }),
  saveWhere: (L: Look) => saveWin(L, THREE, { at: 1 }),
  saveFolder: (L: Look) => saveWin(L, THREE, { making: 'blog-images' }),
  saved: (L: Look) => doneNew(L, THREE, { save: 'saved' }),
}

/**
 * Save as preset, opened by p: the centred window holding Save as's own block
 * — the name on the mode's tint, underlined, a rule, then the folders (the
 * highlighted one on the band with its path, the default's tag at the far
 * end) and the path row. ↑↓ move the folders while the name keeps the caret,
 * as in Save as.
 */
function saveWin(
  L: Look,
  c: Chain,
  o: { taken?: boolean; at?: number; making?: string } = {},
): Row[] {
  const p = mp(L)
  const name = 'blog'
  const done = doneNew(L, c).map((r, i) => (i === H - 3 ? B() : r))
  const W = TW
  const fw = W - 2
  const at = o.at ?? 0
  const nameRow = fieldRow({
    palette: p,
    width: fw,
    runs: [
      label(p, 'name'),
      ...padTo(
        [run(` ${name}`, p.fg, p.band), ...(o.making ? [] : [run(' ', undefined, p.fg)])],
        NAME_WIDTH,
        p.band,
      ),
    ],
  })
  const folders: [string, string, boolean][] = [
    ['Desktop', '~/Desktop', true],
    ['Same location', '', false],
    ['Downloads', '~/Downloads', false],
    ['Ask each time', '', false],
  ]
  const lines: Row[] = [
    fieldBlank({ palette: p, width: fw }),
    nameRow,
    o.taken
      ? fieldRow({
          palette: p,
          width: fw,
          runs: [label(p), run('▔'.repeat(NAME_WIDTH), L.p.fail)],
        })
      : underlineRow({ palette: p, width: fw }),
    ...(o.taken
      ? [
          fieldRow({
            palette: p,
            width: fw,
            runs: [label(p), run(name, L.p.fail, undefined, true), run(' is taken', L.p.fail)],
          }),
        ]
      : []),
    ruleRow({ palette: p, width: fw }),
    fieldBlank({ palette: p, width: fw }),
    ...folders.flatMap(([n, path, isDefault], k) => [
      folderRow({
        palette: p,
        width: fw,
        first: k === 0,
        label: n,
        path,
        selected: k === at && o.making === undefined,
        isDefault,
      }),
      // `/` names a new folder inside the highlighted one, as in Save as.
      ...(o.making !== undefined && k === at
        ? [newFolderRow({ palette: p, width: fw, name: o.making, isNew: true })]
        : []),
    ]),
    pathRow({ palette: p, width: fw, line: { kind: 'rest' } }),
    fieldBlank({ palette: p, width: fw }),
  ]
  // Save as's block without its coloured edge: the window's frame is the edge here.
  const edge = edgeColour(p)
  const plainEdge = lines.map((r) =>
    r[0] && r[0].bg === edge ? [{ ...r[0], bg: undefined }, ...r.slice(1)] : r,
  )
  return pop(L, done, {
    title: SAVE,
    lines: plainEdge,
    width: W,
    top: Math.max(3, Math.floor((H - lines.length - 2) / 2) - 1),
    keys:
      o.making !== undefined
        ? keys(L, [['↵', 'create and save']], 'esc cancel')
        : keys(
            L,
            [
              ['↵', 'save'],
              ['↑↓', 'folder'],
              ['/', 'new folder'],
            ],
            'esc cancel',
          ),
  })
}

/* every operation */

const PDF: Chain = {
  bytes: 1_900_000,
  parts: ['PDF'],
  answers: ['under 2 MB', 'Desktop', 'report.pdf'],
  facts: {
    mode: 'compress',
    before: { format: 'PDF', name: 'report.pdf', bytes: 8_200_000 },
    after: { format: 'PDF', name: 'report.pdf', bytes: 1_900_000 },
  },
  was: '8.2 MB',
}
const PDF_ROWS: TR[] = [
  { n: 'Convert to', on: false, more: true },
  { n: 'Compress', on: true, v: 'under 2 MB', more: true },
  { n: 'Rotate', on: false, more: true },
  { n: 'Split', on: false, more: true },
]
const pdfRows = (over: Over = {}) => PDF_ROWS.map((r) => ({ ...r, ...(over[r.n] ?? {}) }))
const pdfResult = (L: Look) =>
  twResult(L, { name: 'report.pdf', now: '1.9 MB', change: '77% smaller' })

const OPS = {
  convert: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Convert to': { v: 'AVIF' } })),
      lit: 'Convert to',
      result: twResult(L, { name: 'photo.avif', now: '620 KB', change: '96% smaller' }),
      sub: SUBS.convert(L, 'AVIF'),
    }),
  compress: (L: Look) =>
    tw(L, {
      rows: img(
        SHARP({
          Compress: { on: true, v: 'under 500 KB' },
          Quality: { v: 'by size', slide: undefined },
        }),
      ),
      lit: 'Compress',
      result: twResult(L, { now: '480 KB', change: '97% smaller' }),
      sub: SUBS.compress(L),
    }),
  trim: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Trim edges': SET.trim() })),
      lit: 'Trim edges',
      result: twResult(L, { now: '880 KB', change: '94% smaller' }),
    }),
  crop: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Crop to shape': SET.crop() })),
      lit: 'Crop to shape',
      result: twResult(L, { now: '780 KB', change: '95% smaller' }),
      sub: SUBS.crop(L),
    }),
  boost: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Boost resolution': SET.boost() })),
      lit: 'Boost resolution',
      result: R.sharp(L),
      sub: SUBS.boost(L),
    }),
  cutout: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Remove background': SET.cutout() })),
      lit: 'Remove background',
      result: twResult(L, { now: '640 KB', change: '96% smaller' }),
    }),
  pdfRotate: (L: Look) =>
    tw(L, {
      under: doneNew(L, PDF),
      rows: pdfRows({ Rotate: { on: true, v: '90° right' } }),
      lit: 'Rotate',
      result: pdfResult(L),
      sub: SUBS.rotate(L),
    }),
  pdfConvert: (L: Look) =>
    tw(L, {
      under: doneNew(L, PDF),
      rows: pdfRows({
        'Convert to': { on: true, v: 'PNG' },
        Compress: { on: false },
        Split: { why: 'not with Convert to' },
      }),
      lit: 'Convert to',
      result: [
        blank(3),
        run('✓ ', L.p.ok, undefined, true),
        run('12 PNGs', L.p.fg, undefined, true),
        run('   now ', L.p.border),
        run('14.6 MB', L.p.fg, undefined, true),
      ],
      sub: SUBS.pdfConvert(L),
    }),
  pdfSplit: (L: Look) =>
    tw(L, {
      under: doneNew(L, PDF),
      rows: pdfRows({ Split: { on: true, v: 'every page' } }),
      lit: 'Split',
      result: [
        blank(3),
        run('✓ ', L.p.ok, undefined, true),
        run('12 files', L.p.fg, undefined, true),
        run('   now ', L.p.border),
        run('1.9 MB', L.p.fg, undefined, true),
      ],
      sub: SUBS.split(L),
    }),
}

/* edge cases */

const EDGE = {
  jpeg: (L: Look) =>
    tw(L, {
      rows: img({
        'Convert to': { v: 'JPEG' },
        'Remove background': { on: true, v: 'on white', more: true },
      }),
      lit: 'Remove background',
      result: twResult(L, { name: 'photo.jpg', now: '1.1 MB', change: '92% smaller' }),
      sub: SUBS.background(L),
    }),
  notHere: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Trim edges': { why: 'no empty edges' } })),
      lit: 'Trim edges',
      result: R.sharp(L),
      keys: keys(L, [['↑↓', 'choose']], 'esc cancel'),
    }),
  extension: (L: Look) =>
    tw(L, {
      rows: img({
        Resize: SET.resize(),
        Sharpen: { on: false, v: 'not added', more: true },
        'Boost resolution': { on: false, v: 'not added' },
      }),
      lit: 'Sharpen',
      result: R.wide(L),
      sub: SUBS.extension(L),
    }),
  fails: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Remove background': { on: true, v: '', fail: true } })),
      lit: 'Remove background',
      tint: twTint(
        L,
        [run('✕ ', L.p.fail, undefined, true), run('found no subject', L.p.fail)],
        'space unselect · ↵ try again',
      ),
      result: R.sharp(L),
      keys: keys(
        L,
        [
          ['↵', 'try again'],
          ['space', 'unselect'],
        ],
        'esc cancel',
      ),
    }),
  slow: (L: Look) =>
    tw(L, {
      rows: img(SHARP({ 'Boost resolution': { ...SET.boost('4×'), spin: true } })),
      lit: 'Boost resolution',
      result: [
        blank(3),
        run('⠹ ', mp(L).accent, undefined, true),
        run('Boosting resolution', L.p.fg, undefined, true),
        run('   0:14', L.p.dim),
      ],
      keys: keys(L, [], 'esc stop'),
    }),
  grows: (L: Look) =>
    tw(L, {
      rows: img(
        SHARP({
          Resize: { ...SET.resize(), on: false },
          'Boost resolution': SET.boost('4×'),
        }),
      ),
      lit: 'Boost resolution',
      result: twResult(L, { now: '21 MB', change: '46% larger', grew: true }),
    }),
  grewDone: (L: Look) => doneNew(L, GREW),
  nothing: (L: Look) =>
    tw(L, {
      rows: img({ 'Convert to': { on: false }, Quality: { on: false } }),
      lit: 'Convert to',
      result: [blank(3), run('photo.png', L.p.dim), run('   14.4 MB', L.p.dim)],
    }),
  overwrite: (L: Look) =>
    tw(L, {
      rows: img({ 'Convert to': { on: false }, Quality: { on: false }, Resize: SET.resize() }),
      lit: 'Resize',
      result: twResult(L, { name: 'photo (1).png', now: '4.2 MB', change: '71% smaller' }),
    }),
  batch: (L: Look) => {
    const c: Chain = {
      bytes: 6_300_000,
      parts: ['PNG, JPEG', 'WebP'],
      answers: ['WebP', '80', 'Desktop', '8 files'],
      facts: {
        mode: 'convert',
        before: { format: 'PNG, JPEG', name: '8 photos', bytes: 96_000_000 },
        after: { format: 'WebP', name: '8 files', bytes: 6_300_000 },
      },
      was: '96 MB',
    }
    return tw(L, {
      under: doneNew(L, c),
      rows: img(SHARP()),
      lit: 'Sharpen',
      tint: twTint(
        L,
        [
          run('✕ ', L.p.fail, undefined, true),
          run('IMG_0412.heic', L.p.fail, undefined, true),
          run(' can’t be read', L.p.fail),
        ],
        '7 of 8 done',
      ),
      result: twResult(L, { name: '7 files', now: '6.3 MB', change: '93% smaller' }),
    })
  },
  changed: (L: Look) =>
    doneNew(L, { ...THREE, parts: [...THREE.parts, 'Trim'] }, { save: 'update' }),
  narrow: (L: Look) => {
    const lines: Row[] = [
      [],
      ...img(SHARP()).map((r) => twRow(L, r, r.n === 'Resize', 46)),
      [],
      R.sharp(L),
      [],
    ]
    return pop(
      L,
      doneNew(L, ONE).map((r, i) => (i === H - 3 ? B() : r)),
      {
        title: MORE,
        lines,
        width: 48,
        top: 4,
        keys: twKeys(L, IMG_BASE[3]),
      },
    )
  },
}

/* ------------------------------------------------------------ the cards */

interface Card {
  id: string
  caption: string
  pick?: boolean
  draw: (L: Look) => Row[][]
}

const FLOW_A: Card[] = [
  {
    id: '1',
    caption:
      'A normal convert. Done as today, three quiet additions in the key row’s greys: <b>p save as preset</b> beside the chip, <b>→ continue editing</b> at the bottom right, the sizes as N6’s badges (tinted green).',
    draw: (L) => [doneNew(L, ONE)],
  },
  {
    id: '2',
    caption:
      '→ opens one window over Done, as colour’s Tweak. Every operation a row: ● selected or ○ not, and its value; the file as it is now at the foot. It opens on the first row not selected.',
    draw: (L) => [FL.open(L)],
  },
  {
    id: '3',
    caption: '↓ to Resize. A row with something to ask shows › when lit: → opens its own window.',
    draw: (L) => [FL.resizeLit(L)],
  },
  {
    id: '4',
    caption:
      '→ : Resize’s window opens <b>just under the row</b>, from where its value starts — room for the whole pair; the first window dims behind it. Typing selects the row.',
    draw: (L) => [FL.resizeSub(L)],
  },
  {
    id: '5',
    caption: '↵ confirms; the small window goes, the row says 1920 wide, the foot follows.',
    draw: (L) => [FL.resized(L)],
  },
]
const FLOW_B: Card[] = [
  {
    id: '6',
    caption:
      'Rows with nothing to ask — Sharpen, Trim edges, Remove background — need only <b>space</b> to select.',
    draw: (L) => [FL.sharpen(L)],
  },
  {
    id: '7',
    caption:
      'space on a selected row unselects it and keeps its answer, faint — 1920 wide out: 2.1 MB. space again and it is back.',
    draw: (L) => [FL.off(L)],
  },
  {
    id: '8',
    caption: 'Quality is a slider in its row, as on the quality screen: ←→ by 1, ⇧←→ by 10.',
    draw: (L) => [FL.quality(L)],
  },
  {
    id: '9',
    caption:
      '↵ done: the window goes, Done shows the new file. esc instead would have put everything back.',
    draw: (L) => [FL.done(L)],
  },
  {
    id: '10',
    caption:
      '<b>p</b>: Save as preset opens in the middle, with Save as’s own block inside — the name underlined, the folders under the rule, the default tagged. ↑↓ move the folders while the name keeps the caret, as in Save as. Same location and Ask each time are folders here. <b>/</b> names a new folder inside the highlighted one (third frame); ↵ makes it and saves there.',
    draw: (L) => [FL.save(L), FL.saveWhere(L), FL.saveFolder(L)],
  },
  {
    id: '11',
    caption: '↵ saves; where the key was, the confirmation.',
    draw: (L) => [FL.saved(L)],
  },
]

const EVERY: Card[] = [
  {
    id: 'Convert to',
    caption: 'Its window lists what this file can become (invariant 2).',
    draw: (L) => [OPS.convert(L)],
  },
  {
    id: 'Compress',
    caption:
      'Compress’s two ways, as the app has them. A target size decides the quality, so the Quality row says “by size”.',
    draw: (L) => [OPS.compress(L)],
  },
  {
    id: 'Resize',
    caption: 'The exact-size pair; tab between width and height.',
    draw: (L) => [FL.resizeSub(L)],
  },
  {
    id: 'Trim edges',
    caption: 'Nothing to ask: space.',
    draw: (L) => [OPS.trim(L)],
  },
  {
    id: 'Crop to shape',
    caption:
      'The four shapes, each with the size it cuts. A preset places the crop around the subject, as Forge does unplaced.',
    draw: (L) => [OPS.crop(L)],
  },
  {
    id: 'Boost resolution',
    caption: '2× 3× 4×, each with the size it makes.',
    draw: (L) => [OPS.boost(L)],
  },
  {
    id: 'Remove background',
    caption: 'Nothing to ask: space. macOS only — the row isn’t there elsewhere.',
    draw: (L) => [OPS.cutout(L)],
  },
  {
    id: 'PDF · Rotate',
    caption: 'The rows come from the file: a PDF has Convert to, Compress, Rotate and Split.',
    draw: (L) => [OPS.pdfRotate(L)],
  },
  {
    id: 'PDF · Convert to',
    caption:
      'To images: the formats, then the pages and the resolution in the same window. Split can’t follow it.',
    draw: (L) => [OPS.pdfConvert(L)],
  },
  {
    id: 'PDF · Split',
    caption: 'Every page, or every N; “at points I choose” is per document, so not here.',
    draw: (L) => [OPS.pdfSplit(L)],
  },
]

const EDGES: Card[] = [
  {
    id: 'E1 · no transparency',
    caption:
      'Remove background with Convert to JPEG: the row gets a window of its own asking what goes behind — on white, on black, or as PNG instead.',
    draw: (L) => [EDGE.jpeg(L)],
  },
  {
    id: 'E2 · not here',
    caption:
      'A row that can’t apply to this file is dim, its reason where the value would be (no empty edges, animated); space does nothing.',
    draw: (L) => [EDGE.notHere(L)],
  },
  {
    id: 'E3 · needs an extension',
    caption:
      'Sharpen without Boost installed: → opens the offer under the row; ↵ adds it (Boost resolution comes with it).',
    draw: (L) => [EDGE.extension(L)],
  },
  {
    id: 'E4 · a row fails',
    caption: 'Its value turns red, one tinted row in the window says why; the rest still hold.',
    draw: (L) => [EDGE.fails(L)],
  },
  {
    id: 'E5 · a slow row',
    caption:
      'Its value spins, the foot is W5’s one line; esc stops it and leaves the row unselected.',
    draw: (L) => [EDGE.slow(L)],
  },
  {
    id: 'E6 · the file grows',
    caption:
      'Boost 4× without Resize: bigger than the original — the foot in orange, and on Done the badge on an orange tint, “was” first, as Done puts the smaller first.',
    draw: (L) => [EDGE.grows(L), EDGE.grewDone(L)],
  },
  {
    id: 'E7 · nothing selected',
    caption: 'The foot is the original; ↵ done changes nothing.',
    draw: (L) => [EDGE.nothing(L)],
  },
  {
    id: 'E8 · would overwrite',
    caption:
      'Convert to unselected: photo.png would land beside photo.png, so it becomes photo (1).png.',
    draw: (L) => [EDGE.overwrite(L)],
  },
  {
    id: 'E9 · many files',
    caption:
      'Eight photos: the window works on all of them; one can’t be read — one tinted row, the rest carry on.',
    draw: (L) => [EDGE.batch(L)],
  },
  {
    id: 'E10 · name taken',
    caption: 'A preset called blog exists: the line under the name turns red.',
    draw: (L) => [FL.save(L, true)],
  },
  {
    id: 'E11 · changed after saving',
    caption:
      'Trim edges selected since saving blog: the key says <b>p update blog</b>; in its window, a new name saves a new preset instead.',
    draw: (L) => [EDGE.changed(L)],
  },
  {
    id: 'E12 · narrow window',
    caption: 'A narrow terminal: the window narrows to what the rows need.',
    draw: (L) => [EDGE.narrow(L)],
  },
]

/* ------------------------------------------------------------ page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N)
      console.warn(`${CUR} row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  if (rows.length !== H) console.warn(`${rows.length} rows`)
  const out = rows
    .map((r) => {
      let s = ''
      let used = 0
      for (const x of r) {
        const style = [
          x.fg ? `color:${x.fg}` : '',
          x.bg ? `background:${x.bg}` : '',
          x.bold ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        s += style ? `<span style="${style}">${esc(x.text)}</span>` : `<span>${esc(x.text)}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) s += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${s}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${out}</div>`
}

/** The figure being drawn, so a width warning can say which one. */
let CUR = ''
function fig(L: Look, c: Card): string {
  CUR = c.id
  return figHtml(L, c)
}
const figHtml = (L: Look, c: Card) =>
  `<figure><div class="vt"><span class="id">${c.id}</span>${c.pick ? '<span class="pick">MY PICK</span>' : ''}</div><div class="frames">${c
    .draw(L)
    .map((f) => html(f, L.p))
    .join('')}</div><p class="cap">${c.caption}</p></figure>`
function group(kind: 'flow' | 'options', cards: Card[]): string {
  return looks
    .map(
      (L) =>
        `<div class="row ${kind} theme ${L.name}">${cards
          .map((c, i) => `${i && kind === 'flow' ? '<div class="arrow">→</div>' : ''}${fig(L, c)}`)
          .join('')}</div>`,
    )
    .join('')
}

const QUESTIONS = [
  '<b>space selects</b> a row (●) — the key row says “space select”, never “on · off”. Unselecting keeps its answer, faint. Is that what you meant?',
  'In the window: ↑↓ rows, space select, <b>→ more</b> opens the lit row’s own window under it (← back), ↵ done, esc cancel (puts everything back). OK?',
  'A preset keeps <b>only the selected rows</b>?',
  'The window <b>opens on the first row not selected</b> (Compress), not on Convert to. OK?',
  'The sizes badge: green tint when smaller, orange when larger, “was” first when it grew (as Done puts the smaller first). OK?',
  'Changes <b>run as you go</b> (a number once you confirm it), so the foot is always the real file. OK?',
  '<b>Edge cases</b> (tab ★ Edge cases): is each behaviour right? E1 (JPEG + Remove background → on white / on black / as PNG) is the one with a real choice in it.',
  'New words, to approve: “p save as preset”, “→ continue editing”, “Continue editing”, “space select”, “→ more”, “← back”, “unselect”, “by size”, “KB · MB”, “On white”, “On black”, “As PNG instead”, “JPEG has no transparency”, “not with Convert to”, “not added”, “add · 41 MB”, “found no subject”, “can’t be read”, “7 of 8 done”, “esc stop”, “is taken”, “Same location”, “Ask each time”, “p update blog”, “46% larger”.',
  'Earlier rounds: <code>presets-2026-10-round6.html</code> (concepts), <code>-round7.html</code> (P1, pop-up experiments), <code>-round8.html</code> (W2’s first drawing).',
]

const TABLE = `<div class="defs"><b>Steps</b><span>what you do to a file, in order: Convert to WebP 80, then Resize to 1920 wide. Two or more is what we called a pipeline — the inside word; screens only say “step”.</span><b>Preset</b><span>steps you kept, under a name, with where to save. One step is enough.</span></div>
<table>
<tr><th>Step</th><th>Works on</th><th>What the preset keeps</th><th>Notes</th></tr>
<tr><td>Convert</td><td>images, PDFs, Word</td><td>the format and its quality; for a PDF, the pages (all · first) and dpi</td><td>targets still come from each file (invariant 2)</td></tr>
<tr><td>Compress</td><td>images, PDFs</td><td>by quality, or to a target size (“under 500 KB”)</td><td>a target size suits presets best</td></tr>
<tr><td>Resize</td><td>images</td><td>a width, a height or a % — chosen when saving</td><td>“longest side” missing</td></tr>
<tr><td>Trim edges</td><td>images</td><td>on</td><td></td></tr>
<tr><td>Crop to shape</td><td>images</td><td>the shape, e.g. 16:9</td><td>a hand-placed crop is per photo; the preset places it as Forge does unplaced</td></tr>
<tr><td>Sharpen · Boost resolution</td><td>images</td><td>on · 2× 3× 4×</td><td>need Boost installed</td></tr>
<tr><td>Remove background</td><td>images</td><td>on</td><td>macOS, needs the extension</td></tr>
<tr><td>Rotate</td><td>PDFs</td><td>90° right · 180° · 90° left, all pages</td><td></td></tr>
<tr><td>Split</td><td>PDFs</td><td>every page · every N pages</td><td>“at points I choose” is per document</td></tr>
<tr><td>Extract · Delete · Merge</td><td>PDFs, several files</td><td>—</td><td>page numbers are per document; merge is many-in. Later</td></tr>
</table>
<table class="small">
<tr><th>Setting of the preset</th><th>Values</th></tr>
<tr><td>name</td><td>letters, digits, dashes — so <code>/blog</code> and <code>--preset blog</code> work</td></tr>
<tr><td>to</td><td>a folder · Ask each time · Same location</td></tr>
<tr><td>file</td><td>same name · name-preset (photo-blog.webp)</td></tr>
<tr><td>metadata</td><td>removed (default) · kept — <code>--keep-metadata</code> exists</td></tr>
</table>
<p class="note">Not steps: colour (makes a palette, not a file); a locked PDF’s password (asked each time, never stored).</p>`

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Presets · round 9</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --gold:#e5a23c; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font:700 13px var(--mono); letter-spacing:.1em; color:var(--gold); margin:40px 0 0; }
  .lede, .intro { color:#c7cbd4; max-width:1100px; margin:4px 0 0; }
  .qs { margin:22px 0 0; max-width:1100px; background:#15171c; border:1px solid var(--rule); border-radius:10px; padding:14px 18px 14px 40px; }
  .qs h3 { font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:var(--gold); margin:0 0 6px -22px; }
  .qs li { margin:4px 0; color:#c7cbd4; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#1d1406; background:var(--gold); border-color:var(--gold); font-weight:700; }
  section { display:none; } section.on { display:block; }
  .row { display:flex; flex-wrap:wrap; align-items:flex-start; gap:26px 10px; margin-top:18px; }
  .row.options { gap:34px 34px; }
  .arrow { align-self:center; font:28px var(--sans); color:var(--gold); padding:0 2px; }
  figure { margin:0; width:max-content; }
  .frames { display:flex; gap:10px; }
  .vt { display:flex; gap:8px; margin-bottom:6px; }
  .vt .id { font:700 12px var(--mono); padding:3px 8px; border-radius:6px; background:#2a2010; color:var(--gold); }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .cap { font-size:14px; color:#c7cbd4; margin:8px 0 0; max-width:640px; }
  body.only-dark .theme.light, body.only-light .theme.dark { display:none; }
  .t { font:12px/1 var(--mono); padding:10px 12px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:16px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:16px; line-height:16px; vertical-align:top; }
  table { border-collapse:collapse; margin-top:16px; max-width:1300px; font-size:14px; }
  th, td { text-align:left; padding:7px 14px 7px 0; border-bottom:1px solid var(--rule); vertical-align:top; color:#c7cbd4; }
  th { color:var(--muted); font-weight:600; } td:first-child { color:var(--ink); font-weight:600; white-space:nowrap; }
  table.small { margin-top:22px; }
  code { font:13px var(--mono); color:var(--ink); }
  .note { color:var(--muted); font-size:14px; }
  .defs { display:grid; grid-template-columns:max-content 1fr; gap:6px 18px; margin-top:18px; max-width:1100px; color:#c7cbd4; }
  .defs b { color:var(--ink); }
</style></head>
<body class="only-dark"><main>
<h1>Presets · round 9</h1>
<p class="lede">Decided: Done keeps its body, three quiet additions in the key row’s greys — <b>p save as preset</b> beside the chip, <b>→ continue editing</b> at the bottom right, the sizes as <b>N6</b>’s badges on a green (or orange) tint. → opens <b>W2</b>: one window over Done, every operation a row, <b>space</b> selects it, and a row that needs room opens its own small window just under it. Example: <b>photo.png</b> → WebP 80, 1920 wide, Sharpen, saved as <b>blog</b>.</p>
<div class="qs"><h3>Questions for you</h3><ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol></div>
<div class="tabs"><a data-t="flow" class="on">★ The flow</a><a data-t="every">★ Every operation</a><a data-t="edges">★ Edge cases</a><a data-t="hold">What a preset holds</a><span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>

<section id="s-flow" class="on">
<h2>FLOW · 1 → 5 · from Done into the window, a row’s own window</h2>
${group('flow', FLOW_A)}
<h2>FLOW · 6 → 11 · selecting, done, saving</h2>
${group('flow', FLOW_B)}
</section>

<section id="s-every">
<h2>SCREENS · every operation, its row lit (and its own window where it has one)</h2>
<p class="intro">Images first, then a PDF — the rows come from the file.</p>
${group('options', EVERY)}
</section>

<section id="s-edges">
<h2>SCREENS · E1–E12 · what happens when</h2>
<p class="intro">Each caption is the proposed behaviour.</p>
${group('options', EDGES)}
</section>

<section id="s-hold">
<h2>WHAT A PRESET CAN HOLD</h2>
<p class="intro">Every action Forge has today, from src/core/actions. A row keeps its answer as a rule that fits any file of its kind.</p>
${TABLE}
</section>
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.className = r.value })
</script></body></html>`

const out = new URL('../mockups/presets-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
