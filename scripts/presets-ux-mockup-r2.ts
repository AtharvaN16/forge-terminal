/**
 * Presets UX, round two (2026-10-22). Round one: mockups/presets-ux-2026-10.html.
 *
 * Decided in round one (in chat): presets live everywhere offered — the /
 * menu, the mode's own picker when a preset applies (convert, compress,
 * pdf…), home's field once a file or folder is staged (not a home tab), and
 * Finder's Quick Actions. Space as "select" goes: rows are chosen with ↵ and
 * an inline button. D3 (asked once on leaving) is liked, with its choices
 * inside the window rather than on the key row. The Compress / Quality tab
 * was unclear and is parked.
 *
 * Open, and drawn here: the picker's layout with presets (the user asked to
 * try a split, mindful of short windows and of video's boxes), home's field
 * with presets (a file, and a folder), Continue editing as genuinely
 * different shapes, what the window says while a step works (bolder than
 * round one), and the choice on leaving inside the window.
 *
 * Captures: scripts/presets-ux-capture.tsx (Done, the edit window) and
 * scripts/presets-ux-capture-r2.tsx (staged, pickers, working, edit).
 *
 *   npx tsx scripts/presets-ux-mockup-r2.ts   → mockups/presets-ux-2026-10-round2.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { trailBarRow } from '../src/shell/bar-art.js'
import { windowOver } from '../src/shell/colour/system-art.js'
import type { Row, Run } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
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

const P = modePalette(DARK, 'convert')
const N = 80
const L = 4
const R = N - 4
const CANVAS = P.canvas
const ACCENT = P.accent
const COMPRESS = modePalette(DARK, 'compress').accent
const INK = '#0c1d22'
const SEL = '#323232'
const SHELF = '#242424'
const ZONE = '#2c2c2c'

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
  [' ', undefined, P.keycapBg],
  [k, P.fg, P.keycapBg, true],
  [' ', undefined, P.keycapBg],
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
  return put(put(blankRow(), L, left), R - len(right), right)
}
/** The in-field key chip (field-key-hint-chip, decided): ink on the mode colour, at the far end. */
const chip = (k: string, words: string, bg = ACCENT): Seg[] => [[` ${k} ${words} `, INK, bg, true]]
const chipRuns = (k: string, words: string, bg = ACCENT): Run[] => [
  run(` ${k} ${words} `, INK, bg, true),
]

const shot = (g: Grid) => termHtml(P, g)
const RULE = copy((F1.done as Grid)[22])

/** The steps, as Done's strip says them: dim source, faint arrows, the rest white bold. */
const chainSegs = (parts: string[], bg?: string): Seg[] =>
  parts.flatMap((t, i) =>
    i === 0 ? [[t, P.dim, bg] as Seg] : [[' → ', P.faint, bg] as Seg, [t, P.fg, bg, true] as Seg],
  )
const chainRuns = (parts: string[]): Run[] =>
  chainSegs(parts).map(([t, fg, bg, b]) => run(t, fg, bg, b))

/** Fits a screen to `H` rows: the body cut with "↓ N more" when it does not fit, the rule and keys last. */
function fit(H: number, rows: Cell[][], keys: Cell[], from = 10): Grid {
  const room = H - 2
  const out = rows.map(copy)
  if (out.length > room) {
    const hidden = out.length - room + 1
    const kept = out.slice(0, room - 1)
    const more = line(0, [])
    put(more, R - 10, [[`↓ ${hidden} more`.padStart(10), P.dim]])
    void from
    return [...kept, more, copy(RULE), keys]
  }
  while (out.length < room) out.push(blankRow())
  return [...out, copy(RULE), keys]
}

/* ======================================================= 1 · the picker */

interface Preset {
  name: string
  steps: string[]
  size?: string
  /** What it applies to, for a folder: how many of its files. */
  of?: string
}
const PHOTO_PRESETS: Preset[] = [
  { name: 'webblog', steps: ['JPEG 80', 'under 300 KB'], size: '297 KB' },
  { name: 'social', steps: ['1080 wide', '1:1'], size: '214 KB' },
  { name: 'thumbs', steps: ['WebP', '400 wide'], size: '18 KB' },
]
const VIDEO_PRESETS: Preset[] = [
  { name: 'clips', steps: ['MP4', '720p'] },
  { name: 'voice', steps: ['M4A'] },
]
const FORMATS = ['JPEG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PDF']
type Kind = 'photo' | 'video' | 'compress'

/** The picker's first ten rows, captured: header, the file's card, the title. */
const topOf = (k: Kind): Cell[][] =>
  ((k === 'video' ? F2.videoPicker : k === 'compress' ? F2.compressMethod : F2.picker) as Grid)
    .slice(0, 10)
    .map(copy)
const pickKeys = (k: Kind, extra: Array<[string, string]> = []) =>
  keyRow(
    [[k === 'video' ? '↑↓←→' : '↑↓', 'choose'], ...extra, ['↵', 'confirm']],
    [
      ['esc', 'remove file'],
      ['ctrl-c', 'quit'],
    ],
  )

/** A list row as the pickers draw it: the lit one on the band with ▌, words after at `after`. */
function listRow(
  name: string,
  lit: boolean,
  rest: Seg[] = [],
  o: { accent?: string; at?: number; to?: number; from?: number } = {},
): Cell[] {
  const a = o.accent ?? ACCENT
  const from = o.from ?? 4
  const r = blankRow()
  if (lit) {
    clear(r, from, o.to ?? 56, SEL)
    put(r, from, [
      ['▌', a, SEL],
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
const photoFormats = (lit: number | null) =>
  FORMATS.map((f, i) =>
    listRow(
      f,
      i === lit,
      i === 0 && lit === 0
        ? [
            ['708 KB', P.fg, undefined, true],
            ['  96% smaller', P.ok],
          ]
        : [],
      { at: 35 },
    ),
  )

/** P1: presets as a section above the list (round one's A2). */
function p1(H: number, k: Kind): Grid {
  const rows = topOf(k)
  if (k === 'video') {
    const vp = F2.videoPicker as Grid
    const presets = VIDEO_PRESETS.map((p, i) =>
      listRow(
        p.name,
        i === 0,
        chainSegs(p.steps).map(
          ([t, fg, bg, b]) => [t, i === 0 ? fg : P.border, bg, i === 0 && b] as Seg,
        ),
      ),
    )
    return fit(
      H,
      [
        ...rows,
        ...presets,
        line(6, [['─'.repeat(48), P.faint]]),
        ...vp.slice(10, 18).map((r) => {
          const c = copy(r)
          // Nothing lit in the boxes while a preset is.
          for (const cell of c) if (cell.bg === SEL) cell.bg = CANVAS
          for (const cell of c) if (cell.ch === '▌') cell.ch = ' '
          for (const cell of c) if (cell.fg === ACCENT) cell.fg = P.border
          // The detail line names the lit preset's steps, as it names a codec.
          if (c.some((cell) => cell.ch === 'H')) {
            clear(c, 0, N, CANVAS)
            put(c, 3, [
              ['clips', P.fg, undefined, true],
              ['   '],
              ...chainSegs(['MOV', 'MP4', '720p']),
            ])
          }
          return c
        }),
      ],
      pickKeys(k),
    )
  }
  const presets = PHOTO_PRESETS.map((p, i) =>
    listRow(p.name, i === 0, [
      ...chainSegs(p.steps).map(
        ([t, fg, bg, b]) => [t, i === 0 ? fg : P.border, bg, i === 0 && b] as Seg,
      ),
      ...(i === 0 ? ([['   ' + (p.size ?? ''), P.fg, undefined, true]] as Seg[]) : []),
    ]),
  )
  return fit(
    H,
    [...rows, ...presets, line(6, [['─'.repeat(48), P.faint]]), ...photoFormats(null)],
    pickKeys(k),
  )
}

/** A box as the video picker draws one: the focused box's edge and name in the mode colour. */
function boxes(
  spec: Array<{ name: string; items: string[]; lit?: number }>,
  focus: number,
  rowsTall: number,
): Cell[][] {
  const gap = 2
  const left0 = 3
  const total = R + 1 - left0
  const w = Math.floor((total - gap * (spec.length - 1)) / spec.length)
  const out: Cell[][] = Array.from({ length: rowsTall + 2 }, blankRow)
  spec.forEach((b, i) => {
    const x = left0 + i * (w + gap)
    const on = i === focus
    const edge = on ? ACCENT : P.border
    put(out[0] as Cell[], x, [
      ['╭─ ', edge],
      [b.name, on ? ACCENT : P.dim, undefined, on],
      [` ${'─'.repeat(Math.max(0, w - 5 - b.name.length))}╮`, edge],
    ])
    for (let r = 0; r < rowsTall; r++) {
      const row = out[r + 1] as Cell[]
      put(row, x, [['│', edge]])
      put(row, x + w - 1, [['│', edge]])
      const item = b.items[r]
      if (item !== undefined) {
        const lit = on && b.lit === r
        if (lit) {
          clear(row, x + 1, x + w - 1, SEL)
          put(row, x + 1, [
            ['▌', ACCENT, SEL],
            [' ', undefined, SEL],
            [item, P.fg, SEL, true],
          ])
        } else put(row, x + 3, [[item, P.fg]])
      }
    }
    put(out[rowsTall + 1] as Cell[], x, [
      ['╰', edge],
      ['─'.repeat(w - 2), edge],
      ['╯', edge],
    ])
  })
  return out
}

/** P2: a split — presets in a box of their own beside the formats, as video's boxes are. */
function p2(H: number, k: Kind): Grid {
  const rows = topOf(k)
  if (k === 'video') {
    const b = boxes(
      [
        { name: 'presets', items: VIDEO_PRESETS.map((p) => p.name), lit: 0 },
        { name: 'video', items: ['MP4', 'HEVC', 'WebM', 'GIF'] },
        { name: 'audio only', items: ['MP3', 'M4A', 'WAV'] },
      ],
      0,
      4,
    )
    return fit(
      H,
      [
        ...rows,
        ...b,
        blankRow(),
        line(3, [['clips', P.fg, undefined, true], ['   '], ...chainSegs(['MOV', 'MP4', '720p'])]),
      ],
      pickKeys(k),
    )
  }
  const b = boxes(
    [
      { name: 'presets', items: PHOTO_PRESETS.map((p) => p.name), lit: 0 },
      { name: 'formats', items: FORMATS },
    ],
    0,
    6,
  )
  return fit(
    H,
    [
      ...rows,
      ...b,
      blankRow(),
      line(3, [
        ['webblog', P.fg, undefined, true],
        ['   '],
        ...chainSegs(['PNG', 'JPEG 80', 'under 300 KB']),
        ['   297 KB', P.fg, undefined, true],
      ]),
    ],
    pickKeys(k, [['←→', 'presets']]),
  )
}

/** P3: the title becomes two tabs, formats and presets; one list shows at a time. */
function p3(H: number, k: Kind, on: 'formats' | 'presets'): Grid {
  const rows = topOf(k)
  const title = rows[8] as Cell[]
  clear(title, 0, N, CANVAS)
  const tab = (t: string, lit: boolean): Seg[] =>
    lit ? [[` ${t} `, P.fg, SEL, true]] : [[` ${t} `, P.dim]]
  put(title, 4, [
    ['Convert to', ACCENT, undefined, true],
    ['   '],
    ...tab('formats', on === 'formats'),
    [' '],
    ...tab('presets 3', on === 'presets'),
  ])
  const body =
    on === 'formats'
      ? photoFormats(0)
      : PHOTO_PRESETS.map((p, i) =>
          listRow(p.name, i === 0, [
            ...chainSegs(p.steps).map(
              ([t, fg, bg, b]) => [t, i === 0 ? fg : P.border, bg, i === 0 && b] as Seg,
            ),
            ...(i === 0 ? ([['   297 KB', P.fg, undefined, true]] as Seg[]) : []),
          ]),
        )
  return fit(
    H,
    [...rows, ...body],
    pickKeys(k, [['tab', on === 'formats' ? 'presets' : 'formats']]),
  )
}

/** P4: presets on the title's own row, as pills — no row added; their steps on the row under it. */
function p4(H: number, k: Kind, lit: boolean): Grid {
  const rows = topOf(k)
  const presets = k === 'video' ? VIDEO_PRESETS : PHOTO_PRESETS
  const title = rows[8] as Cell[]
  const word = k === 'compress' ? 'Method' : 'Convert to'
  const accent = k === 'compress' ? COMPRESS : ACCENT
  clear(title, 16, N, CANVAS)
  let x = R
  const pills = presets.map((p, i) => {
    const on = lit && i === 0
    return [[` ${p.name} `, on ? INK : P.dim, on ? accent : P.keycapBg, on] as Seg]
  })
  const width = pills.reduce((n, s) => n + len(s), 0) + (pills.length - 1)
  x = R - width
  pills.forEach((s, i) => {
    put(title, x, s)
    x += len(s) + (i < pills.length - 1 ? 1 : 0)
  })
  void word
  const under = rows[9] as Cell[]
  clear(under, 0, N, CANVAS)
  const first = presets[0] as Preset
  if (lit) {
    const steps = chainSegs([k === 'video' ? 'MOV' : 'PNG', ...first.steps])
    const tail: Seg[] = first.size
      ? [
          ['   ', undefined],
          [first.size, P.fg, undefined, true],
        ]
      : []
    put(under, R - len(steps) - len(tail), [...steps, ...tail])
  }
  let body: Cell[][]
  if (k === 'video') {
    body = (F2.videoPicker as Grid).slice(10, 18).map((r) => {
      const c = copy(r)
      if (lit)
        for (const cell of c) {
          if (cell.bg === SEL) cell.bg = CANVAS
          if (cell.ch === '▌') cell.ch = ' '
          if (cell.fg === ACCENT) cell.fg = P.border
        }
      // The codec line belongs to a lit format; with a preset lit it goes.
      if (lit && c.some((cell) => cell.ch === 'H') && c.some((cell) => cell.ch === '.'))
        clear(c, 0, N, CANVAS)
      return c
    })
  } else if (k === 'compress') {
    body = [
      listRow('By quality', !lit, !lit ? [['pick a level, see the result', P.dim]] : [], {
        accent,
        at: 24,
      }),
      listRow('To a target size', false),
    ]
  } else body = photoFormats(lit ? null : 0)
  return fit(H, [...rows, ...body], pickKeys(k))
}

/** P5: a side column, as edit's picker splits: formats left as today, presets right of a │. */
function p5(H: number, litPreset: boolean): Grid {
  const rows = topOf('photo')
  const body = FORMATS.map((f, i) => listRow(f, !litPreset && i === 0, [], { to: 38 }))
  const right: Seg[][] = []
  PHOTO_PRESETS.forEach((p, i) => {
    const on = litPreset && i === 0
    right.push([
      [on ? '▌ ' : '  ', ACCENT, on ? SEL : undefined],
      [p.name, P.fg, on ? SEL : undefined, on],
    ])
    right.push([
      ['  ', undefined],
      ...chainSegs(p.steps).map(([t, fg, bg, b]) => [t, on ? fg : P.border, bg, on && b] as Seg),
    ])
  })
  body.forEach((r, i) => {
    put(r, 40, [['│', P.border]])
    const seg = right[i]
    if (seg) {
      if (litPreset && i === 0) clear(r, 42, 76, SEL)
      put(r, 42, seg)
    }
  })
  return fit(H, [...rows, ...body], pickKeys('photo', [['←→', litPreset ? 'formats' : 'presets']]))
}

/* ======================================================= 2 · home's field */

const STAGED = F2.staged as Grid
const FOLDER = F2.folder as Grid
const homeKeys = keyRow(
  [
    ['↵', 'convert'],
    ['esc', 'clear'],
  ],
  [
    ['1–6 ←→', 'mode'],
    ['ctrl-c', 'quit'],
  ],
)

/** The field's row as home draws it, its chip at the far end; `lit` false when a preset row is. */
function fieldRow(r: Cell[], text: Seg[], chipWords: Seg[]): void {
  clear(r, 4, 76, SHELF)
  put(r, 6, [['›', ACCENT, SHELF, true], [' ', undefined, SHELF], ...text])
  put(r, 74 - len(chipWords), chipWords)
}
const presetLine = (p: Preset, lit: boolean, x = 8): Seg[] => [
  [lit ? '▌ ' : '  ', ACCENT, lit ? SEL : SHELF],
  [p.name.padEnd(10), P.fg, lit ? SEL : SHELF, lit],
  ...chainSegs(p.steps, lit ? SEL : SHELF).map(
    ([t, fg, bg, b]) => [t, lit ? fg : P.border, bg, lit && b] as Seg,
  ),
  ...(p.of ? ([[`   ${p.of}`, lit ? P.dim : P.faint, lit ? SEL : SHELF]] as Seg[]) : []),
]

/** H1: the field grows down — the presets under it on its shelf; ↵ stays where it is. */
function h1(folder: boolean, litPreset: boolean): Grid {
  const g = (folder ? FOLDER : STAGED).map(copy)
  const presets: Preset[] = folder
    ? [
        { name: 'webblog', steps: ['JPEG 80', 'under 300 KB'], of: '13 of 15' },
        { name: 'social', steps: ['1080 wide', '1:1'], of: '13 of 15' },
        { name: 'clips', steps: ['MP4', '720p'], of: '2 of 15' },
      ]
    : PHOTO_PRESETS
  if (folder) {
    const card = g[11] as Cell[]
    clear(card, 15, 63, ZONE)
    put(card, 15, [['13 images · 2 videos · 9.8 MB', P.dim, ZONE]])
  }
  for (let r = 15; r <= 21; r++) clear(g[r] as Cell[], 0, N, CANVAS)
  for (let r = 15; r <= 20; r++) clear(g[r] as Cell[], 4, 76, SHELF)
  fieldRow(g[16] as Cell[], [['drop more, or type a path', P.border, SHELF]], chip('↵', 'enter'))
  presets.forEach((p, i) => {
    const r = g[17 + i] as Cell[]
    const lit = litPreset && i === 0
    if (lit) clear(r, 6, 74, SEL)
    put(r, 6, presetLine(p, lit))
  })
  put(g[21] as Cell[], 69, [
    [' / ', P.fg, P.keycapBg, true],
    [' menu', P.dim],
  ])
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', litPreset ? 'run preset' : 'convert'],
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

/** H2: the presets in the field's own row, as pills before the chip; tab moves along them. */
function h2(litPreset: boolean): Grid {
  const g = STAGED.map(copy)
  const r = g[16] as Cell[]
  const pills: Seg[] = PHOTO_PRESETS.flatMap((p, i) => {
    const on = litPreset && i === 0
    return [
      [` ${p.name} `, on ? INK : P.dim, on ? ACCENT : P.keycapBg, on] as Seg,
      [' ', undefined, SHELF] as Seg,
    ]
  })
  fieldRow(r, [['type a path', P.border, SHELF]], chip('↵', 'enter'))
  put(r, 74 - len(chip('↵', 'enter')) - 2 - len(pills), pills)
  if (litPreset) {
    const under = g[17] as Cell[]
    clear(under, 4, 76, SHELF)
    const steps = chainSegs(['PNG', 'JPEG 80', 'under 300 KB'], SHELF)
    put(under, 74 - len(chip('↵', 'enter')) - 2 - len(steps) - 1, steps)
  }
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['tab', 'preset'],
        ['↵', litPreset ? 'run preset' : 'convert'],
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

/** H3: the presets on the file's card, in the drop zone, not the field. */
function h3(): Grid {
  const g = STAGED.map(copy)
  // The card grows a row: its steps line, then the presets.
  const card = g.slice(9, 13).map(copy)
  const bottom = copy(card[3])
  const mid = copy(card[2])
  clear(mid, 14, 64, ZONE)
  const pills: Seg[] = PHOTO_PRESETS.flatMap((p, i) => [
    [` ${p.name} `, i === 0 ? INK : P.dim, i === 0 ? ACCENT : P.keycapBg, i === 0] as Seg,
    [' ', undefined, ZONE] as Seg,
  ])
  put(mid, 15, pills)
  g[12] = mid
  g[13] = bottom
  ;(g[14] as Cell[]).splice(0, N, ...copy(STAGED[13]))
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['tab', 'preset'],
        ['↵', 'run preset'],
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

/* ======================================================= 3 · continue editing */

const DONE = F1.done as Grid
const TOP = [copy(DONE[0]), copy(DONE[1])]
const UNDER: Row[] = DONE.slice(2, 22).map((r, i) => (i === 18 ? [] : rowOf(r)))
function overDone(
  title: string,
  lines: Row[],
  under: Row[] = UNDER,
  o: { width?: number; top?: number; left?: number } = {},
): Row[] {
  const width = o.width ?? 68
  const top = o.top ?? Math.max(0, Math.floor((21 - (lines.length + 2)) / 2) - 1)
  return windowOver(P, under, {
    title,
    lines,
    width,
    columns: N,
    top,
    ...(o.left === undefined ? {} : { left: o.left }),
  }).slice(0, 20)
}
const screen = (middle: Row[], keys: Cell[]): Grid => [
  ...TOP.map(copy),
  ...toGrid(middle, N).map((r) => r.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
  copy(RULE),
  keys,
]
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  run(' '.repeat(Math.max(0, n - rlen(row))), undefined, bg),
]
const INNER = 66

/** A row with its button: › and the band when lit, ✓ when it is one of your steps, the chip at the far end. */
function opRow(
  name: string,
  value: string,
  o: { on?: boolean; lit?: boolean; dead?: boolean; chip?: string; nameW?: number } = {},
): Row {
  const bg = o.lit ? P.panelBand : undefined
  const head: Row = [
    run(o.lit ? ' › ' : '   ', ACCENT, bg, true),
    run(o.on ? '✓ ' : '  ', ACCENT, bg, true),
    run(name.padEnd(o.nameW ?? 19), o.dead ? P.faint : o.on || o.lit ? P.fg : P.dim, bg, !!o.lit),
    run(value, o.dead ? P.faint : o.on ? P.fg : P.faint, bg, !!o.lit && !!o.on),
  ]
  if (!o.chip) return pad(head, INNER, bg)
  const c = chipRuns('↵', o.chip)
  return [...pad(head, INNER - rlen(c) - 2, bg), ...c, run('  ', undefined, bg)]
}
const footOk = (bytes: string, change: string): Row => [
  run('   '),
  run('✓ ', P.ok, undefined, true),
  run('IMG_2041.jpg', P.fg, undefined, true),
  run('   now ', P.border),
  run(bytes, P.fg, undefined, true),
  run(`   ${change}`, P.ok, undefined, true),
]

/** The W2 rows with buttons instead of space: today's window, ✓ for your steps, ↵ on the lit row. */
function w2Lines(o: { compress?: boolean; lit?: number; chip?: string; foot?: Row[] } = {}): Row[] {
  const rows: Array<[string, string, { on?: boolean; dead?: boolean }]> = [
    ['Convert to', 'JPEG', { on: true }],
    ['Quality', '80', { on: true }],
    ['Compress', o.compress ? 'under 300 KB' : '—', { on: !!o.compress }],
    ['Resize', '—', {}],
    ['Crop to shape', '—', {}],
    ['Sharpen', 'not added', { dead: true }],
    ['Boost resolution', 'not added', { dead: true }],
    ['Remove background', 'not added', { dead: true }],
  ]
  const lit = o.lit ?? 3
  return [
    [],
    ...rows.map(([n, v, s], i) =>
      opRow(n, v, {
        ...s,
        lit: i === lit,
        ...(i === lit ? { chip: o.chip ?? (s.on ? 'remove' : 'add') } : {}),
      }),
    ),
    [],
    ...(o.foot ?? [
      footOk(o.compress ? '297 KB' : '708 KB', o.compress ? '98.1% smaller' : '95.6% smaller'),
    ]),
    [],
  ]
}
const W2_KEYS = keyRow(
  [
    ['↑↓', 'choose'],
    ['↵', 'add'],
    ['→', 'more'],
  ],
  [['esc', 'done']],
)

/** K1: Continue editing is edit mode, carried on: its own picker on the new file, the steps so far on top. */
function k1(after: boolean): Grid {
  const g = (F2.editPicker as Grid).map(copy)
  const EDIT = '#b39ae8'
  // Header: the convert's trail, then Edit.
  g[1] = copy(DONE[1])
  // The card is the file just made.
  const c1 = g[4] as Cell[]
  clear(c1, 6, 54, CANVAS)
  put(c1, 6, [['IMG_2041.jpg', P.fg]])
  const c2 = g[5] as Cell[]
  clear(c2, 6, 54, CANVAS)
  put(c2, 6, [[after ? '1920×1280 · 297 KB' : '3000×2000 · 708 KB', P.fg]])
  const head = g[3] as Cell[]
  put(head, 7, [['JPEG', ACCENT], [' ']])
  // The title and the steps.
  const t = g[8] as Cell[]
  clear(t, 0, N, CANVAS)
  put(t, 4, [['Edit JPEG', EDIT, undefined, true]])
  const steps = chainSegs(after ? ['PNG', 'JPEG 80', '1920 wide'] : ['PNG', 'JPEG 80'])
  put(t, R - len(steps), steps)
  // The list: Done first, then the operations; the explainer column says what Done keeps.
  const items = [
    'Done',
    'Sharpen',
    'Boost resolution',
    'Remove background',
    '',
    'Trim edges',
    'Resize',
    'Crop to shape',
  ]
  for (let i = 0; i < 9; i++) clear(g[10 + i] as Cell[], 0, 40, CANVAS)
  items.forEach((name, i) => {
    if (!name) return
    const r = g[10 + i] as Cell[]
    const lit = i === 0
    if (lit) {
      clear(r, 4, 40, SEL)
      put(r, 4, [
        ['▌', EDIT, SEL],
        [' ', undefined, SEL],
        [name, P.fg, SEL, true],
      ])
      put(r, 22, [[after ? '2 steps' : '1 step', P.dim, SEL]])
    } else put(r, 6, [[name, P.fg]])
    if (name === 'Resize' && after) put(r, 22, [['✓ 1920 wide', P.ok]])
  })
  for (let i = 0; i < 8; i++) {
    const r = g[10 + i] as Cell[]
    clear(r, 41, 76, CANVAS)
  }
  put(g[10] as Cell[], 43, [['Keep IMG_2041.jpg', P.fg, undefined, true]])
  put(g[11] as Cell[], 43, chainSegs(after ? ['PNG', 'JPEG 80', '1920 wide'] : ['PNG', 'JPEG 80']))
  put(g[13] as Cell[], 43, [
    ['p', P.fg, undefined, true],
    [' save as preset', P.dim],
  ])
  for (let i = 0; i < 8; i++) put(g[10 + i] as Cell[], 40, [['│', P.border]])
  ;(g[23] as Cell[]).splice(
    0,
    N,
    ...keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
        ['p', 'save as preset'],
      ],
      [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
  return g
}

/** K2: a steps screen of its own — each step a row with the size it leaves, a bar for that size. */
function k2(): Grid {
  const g: Cell[][] = [copy(DONE[0]), copy(DONE[1]), blankRow(), blankRow()]
  put(g[3] as Cell[], 4, [
    ['Steps', ACCENT, undefined, true],
    ['   '],
    ...chainSegs(['PNG', 'JPEG 80', 'under 300 KB']),
  ])
  g.push(blankRow())
  const steps: Array<[string, string, string, number, boolean]> = [
    ['IMG_2041.png', '', '16 MB', 1, false],
    ['Convert to', 'JPEG 80', '708 KB', 708 / 16000, false],
    ['Compress', 'under 300 KB', '297 KB', 297 / 16000, true],
  ]
  const BAR = 20
  steps.forEach(([name, value, size, frac, lit], i) => {
    const r = blankRow()
    const bg = lit ? SEL : undefined
    if (lit) clear(r, 4, 76, SEL)
    put(r, 4, [
      [lit ? '▌' : ' ', ACCENT, bg],
      [' ', undefined, bg],
      [i === 0 ? '  ' : `${i} `, P.border, bg],
      [name.padEnd(14), i === 0 ? P.dim : P.fg, bg, lit],
      [value.padEnd(14), P.fg, bg, lit],
    ])
    const w = Math.max(1, Math.round(BAR * Math.max(frac, 0.02)))
    put(r, 36, [
      [' '.repeat(w), undefined, i === 0 ? P.faint : ACCENT],
      [' '.repeat(BAR - w), undefined, bg ?? CANVAS],
    ])
    put(r, 36 + BAR + 1, [[size.padStart(7), P.fg, bg, true]])
    if (lit) put(r, 76 - len(chip('↵', 'change')), chip('↵', 'change'))
    g.push(r)
    g.push(blankRow())
  })
  g.push(
    put(blankRow(), 6, [
      ['+ ', ACCENT, undefined, true],
      ['Add a step', P.dim],
    ]),
  )
  g.push(blankRow())
  return fit(
    24,
    g,
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'change'],
        ['⌫', 'remove'],
      ],
      [['esc', 'done']],
    ),
  )
}

/** K3: the / menu's popup, over Done from its bottom right: your steps, then what can be added. */
function k3(): Grid {
  const lines: Row[] = [
    [],
    pad([run('   Your steps', '#e5a23c', undefined, true)], 40),
    pad(
      [run('   ✓ ', ACCENT, undefined, true), run('Convert to   ', P.fg), run('JPEG 80', P.fg)],
      40,
    ),
    [],
    pad([run('   Add', '#e5a23c', undefined, true)], 40),
    (() => {
      const bg = P.panelBand
      const head: Row = [run(' › ', ACCENT, bg, true), run('  Compress', P.fg, bg, true)]
      const c = chipRuns('↵', 'add')
      return [...pad(head, 40 - rlen(c) - 2, bg), ...c, run('  ', undefined, bg)]
    })(),
    pad([run('     Resize', P.dim)], 40),
    pad([run('     Crop to shape', P.dim)], 40),
    pad([run('     Sharpen', P.faint), run('        not added', P.faint)], 40),
    [],
  ]
  const under = DONE.slice(2, 22).map(rowOf)
  return screen(
    overDone('Continue editing', lines, under, { width: 42, top: 4, left: 34 }),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'add'],
      ],
      [['esc', 'close']],
    ),
  )
}

/** K4: what you want, not what it is called — a few goals, each a ready answer. */
function k4(): Grid {
  const goals: Array<[string, string, boolean]> = [
    ['Smaller file', 'under 300 KB', true],
    ['Web size', '1920 wide', false],
    ['Square', '1:1', false],
    ['Sharper', 'not added', false],
    ['No background', 'not added', false],
    ['Something else', '', false],
  ]
  const lines: Row[] = [
    [],
    ...goals.map(([g, v, on], i) =>
      opRow(g, v, {
        on,
        lit: i === 1,
        dead: v === 'not added',
        nameW: 18,
        ...(i === 1 ? { chip: 'add' } : {}),
      }),
    ),
    [],
    footOk('297 KB', '98.1% smaller'),
    [],
  ]
  return screen(
    overDone('Continue editing', lines),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'add'],
        ['→', 'change'],
      ],
      [['esc', 'done']],
    ),
  )
}

/* ======================================================= 4 · while it works */

const SPIN = '⠹'
const busyRow = (row: Row): Row =>
  row.map((r) => (r.fg && r.fg !== ACCENT ? { ...r, fg: P.faint, bold: false } : r))

/** R1: the size search, drawn — each try a mark on a ruler of sizes, the target a line. */
function r1(): Grid {
  const W = 56
  const max = 708
  const at = (kb: number) => Math.round((kb / max) * (W - 1))
  const tries: Array<[number, string]> = [
    [708, '80'],
    [412, '52'],
    [318, '41'],
    [290, '38'],
  ]
  const ruler: Run[] = []
  const cells: Array<{ ch: string; fg: string }> = Array.from({ length: W }, () => ({
    ch: '─',
    fg: P.faint,
  }))
  cells[at(300)] = { ch: '│', fg: P.ok }
  tries.forEach(([kb], i) => {
    cells[at(kb)] = i === tries.length - 1 ? { ch: SPIN, fg: ACCENT } : { ch: '●', fg: P.border }
  })
  for (const c of cells) ruler.push(run(c.ch, c.fg, undefined, c.fg === ACCENT))
  const labels: Run[] = [
    run(' '.repeat(at(300) - 3)),
    run('300 KB', P.ok),
    run(' '.repeat(W - at(300) - 3 - 6)),
    run('708 KB', P.dim),
  ]
  const lines = w2Lines({
    compress: true,
    lit: 99,
    foot: [
      [
        run('   '),
        run(`${SPIN} `, ACCENT, undefined, true),
        run('Compressing', P.fg, undefined, true),
        run('   try 4 of 8 · quality 38 · 290 KB', P.dim),
      ],
      [],
      [run('   '), run('0 ', P.faint), ...ruler],
      [run('     '), ...labels],
    ],
  }).map((r, i) => (i >= 1 && i <= 8 && i !== 3 ? busyRow(r) : r))
  return screen(overDone('Continue editing', lines), keyRow([], [['esc', 'stop']]))
}

/** R2: the steps as a line of stations — done, working, waiting — with what the working one is doing. */
function r2(): Grid {
  const pipe: Run[] = [
    run('   '),
    run('PNG', P.dim),
    run(' ── ', P.faint),
    run('✓ ', P.ok, undefined, true),
    run('JPEG 80', P.fg, undefined, true),
    run(' ── ', P.faint),
    run(`${SPIN} `, ACCENT, undefined, true),
    run('under 300 KB', ACCENT, undefined, true),
    run(' ── ', P.faint),
    run('○ ', P.faint),
    run('IMG_2041.jpg', P.faint),
  ]
  const lines = w2Lines({
    compress: true,
    lit: 99,
    foot: [pipe, [run('                        '), run('trying quality 38 · 4 of 8', P.dim)]],
  }).map((r, i) => (i >= 1 && i <= 8 && i !== 3 ? busyRow(r) : r))
  return screen(overDone('Continue editing', lines), keyRow([], [['esc', 'stop']]))
}

/** R3: the window steps aside for the working screen everyone has already seen on every convert. */
function r3(): Grid {
  const g = (F2.working as Grid).map(copy)
  // The header as the app draws it mid-job: the trail, Compressing last, the hatching drifting.
  const bar = trailBarRow({
    width: N - 4,
    palette: DARK,
    mode: 'convert',
    trail: { answers: ['JPEG', '80', 'Desktop', 'IMG_2041.jpg'], current: 'Compressing' },
    slanted: false,
    drift: 1.2,
  })
  g[1] =
    toGrid([[run('  '), ...bar]], N)[0]?.map((c) => ({ ...c, bg: c.bg ?? CANVAS })) ?? blankRow()
  // The trail's last chip: Compressing.
  const c1 = g[4] as Cell[]
  clear(c1, 6, 54, CANVAS)
  put(c1, 6, [['IMG_2041.jpg', P.fg]])
  const c2 = g[5] as Cell[]
  clear(c2, 6, 54, CANVAS)
  put(c2, 6, [['3000×2000 · 708 KB', P.fg]])
  put(g[3] as Cell[], 7, [['JPEG', ACCENT], [' ']])
  const w = g[8] as Cell[]
  clear(w, 0, N, CANVAS)
  put(w, 6, [
    ['Compressing', P.fg, undefined, true],
    [' to under 300 KB', P.dim],
    ['   try 4 of 8', P.dim],
  ])
  put(w, 64, [['3.7s', P.border]])
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

/** R4: the picture itself in the window, a shimmer passing over it while the new one is made. */
function r4(): Grid {
  const PW = 22
  const PH = 8
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const colour = (x: number, y: number, shine: boolean) => {
    let r = (x / PW) * 200 + 30
    let g = (y / (PH * 2)) * 160 + 50
    let b = 180 - (x / PW) * 90
    if (shine) {
      r = r + (255 - r) * 0.35
      g = g + (255 - g) * 0.35
      b = b + (255 - b) * 0.35
    }
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const pic: Row[] = Array.from({ length: PH }, (_, y) =>
    Array.from({ length: PW }, (_, x) => {
      const d = x - y * 2
      const shine = d >= 8 && d <= 11
      return run('▀', colour(x, y * 2, shine), colour(x, y * 2 + 1, shine))
    }),
  )
  const side: Row[] = [
    [run('IMG_2041.jpg', P.fg, undefined, true)],
    [],
    [run('708 KB', P.dim), run('  →  ', P.faint), run(SPIN, ACCENT, undefined, true)],
    [],
    [run('Compressing', P.fg, undefined, true)],
    [run('to under 300 KB', P.dim)],
    [],
    [run('try 4 of 8', P.dim)],
  ]
  const lines: Row[] = [
    [],
    ...pic.map((p, i) => [run('   '), ...p, run('    '), ...(side[i] ?? [])]),
    [],
  ]
  return screen(overDone('Continue editing', lines), keyRow([], [['esc', 'stop']]))
}

/** R5: a running log — each try on its own line, as a terminal would print it. */
function r5(): Grid {
  const tryLine = (q: string, kb: string, verdict: string, ok: boolean, now = false): Row => [
    run('   '),
    run(now ? `${SPIN} ` : ok ? '✓ ' : '· ', now ? ACCENT : ok ? P.ok : P.faint, undefined, true),
    run(`quality ${q}`.padEnd(14), now ? P.fg : P.dim, undefined, now),
    run(kb.padStart(8), now ? P.fg : P.dim, undefined, now),
    run(`   ${verdict}`, ok ? P.ok : P.faint),
  ]
  const lines: Row[] = [
    [],
    [
      run('   '),
      run('Compressing', P.fg, undefined, true),
      run(' IMG_2041.jpg to under 300 KB', P.dim),
    ],
    [],
    tryLine('80', '708 KB', 'too big', false),
    tryLine('52', '412 KB', 'too big', false),
    tryLine('41', '318 KB', 'too big', false),
    tryLine('38', '290 KB', 'fits — trying higher', true),
    tryLine('40', '…', '', false, true),
    [],
  ]
  return screen(overDone('Continue editing', lines), keyRow([], [['esc', 'stop']]))
}

/* ======================================================= 5 · leaving */

/** The edit window with your steps, and the question asked inside it as two rows with buttons. */
function l1(): Grid {
  const foot: Row[] = [
    [run('   '), run('─'.repeat(60), P.faint)],
    opRow('Save as preset', '', { lit: true, chip: 'save', nameW: 20 }),
    opRow('Just this file', '', { nameW: 20 }),
  ]
  const lines = w2Lines({ compress: true, lit: 99, foot }).map((r, i) =>
    i >= 1 && i <= 8 ? busyRow(r) : r,
  )
  return screen(
    overDone('Continue editing', lines),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      [['esc', 'back']],
    ),
  )
}

/** L2: a small window over the edit window asks, as a row's own window opens. */
function l2(): Grid {
  const base = overDone('Continue editing', w2Lines({ compress: true, lit: 99 }))
  const lines: Row[] = [
    [],
    [run('   '), ...chainRuns(['PNG', 'JPEG 80', 'under 300 KB']), run('   ')],
    [],
    (() => {
      const bg = P.panelBand
      const c = chipRuns('↵', 'save')
      return [
        ...pad(
          [run(' › ', ACCENT, bg, true), run('Save as preset', P.fg, bg, true)],
          40 - rlen(c) - 2,
          bg,
        ),
        ...c,
        run('  ', undefined, bg),
      ]
    })(),
    pad([run('   '), run('Just this file', P.dim)], 40),
    [],
  ]
  return screen(
    overDone('Keep these steps?', lines, base, { width: 42, top: 6 }),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      [['esc', 'back']],
    ),
  )
}

/** L3: the window becomes the save form in place: the steps, the name, two buttons. */
function l3(): Grid {
  const lines: Row[] = [
    [],
    [run('   '), ...chainRuns(['PNG', 'JPEG 80', 'under 300 KB'])],
    [],
    [
      run('   '),
      run('preset name', P.dim),
      run('   '),
      run(' webblog', P.fg, P.band, true),
      run(' ', undefined, P.fg),
      run(' '.repeat(18), undefined, P.band),
    ],
    [],
    [run('   '), run('─'.repeat(60), P.faint)],
    (() => {
      const bg = P.panelBand
      const c = chipRuns('↵', 'save')
      return [
        ...pad(
          [run(' › ', ACCENT, bg, true), run('Save as preset', P.fg, bg, true)],
          INNER - rlen(c) - 2,
          bg,
        ),
        ...c,
        run('  ', undefined, bg),
      ]
    })(),
    pad([run('   '), run('Just this file', P.dim)], INNER),
    [],
  ]
  return screen(
    overDone('Continue editing', lines),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      [['esc', 'back to steps']],
    ),
  )
}

/** L4: no question — the window always ends in its two ways out, the first lit when you get there. */
function l4(): Grid {
  const foot: Row[] = [
    footOk('297 KB', '98.1% smaller'),
    [],
    opRow('Keep IMG_2041.jpg', '', { nameW: 20, lit: true, chip: 'keep' }),
    opRow('Save as preset', '', { nameW: 20 }),
  ]
  return screen(
    overDone('Continue editing', w2Lines({ compress: true, lit: 99, foot })),
    keyRow(
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      [['esc', 'cancel']],
    ),
  )
}

/** D3 as round one drew it (liked): the question in the foot, the answers on the key row. */
function d3(): Grid {
  const foot: Row[] = [[run('   '), run('Keep these steps as a preset?', P.fg, undefined, true)]]
  return screen(
    overDone('Continue editing', w2Lines({ compress: true, lit: 99, foot })),
    keyRow(
      [
        ['p', 'save as preset'],
        ['↵', 'just this file'],
      ],
      [['esc', 'back']],
    ),
  )
}

/* --------------------------------------------------------------- figures */

const fr = (g: Grid, caption?: string) =>
  `<figure class="fr">${caption ? `<div class="ft">${caption}</div>` : ''}${shot(g)}</figure>`
const stack = (...parts: string[]) => `<div class="stack">${parts.join('')}</div>`
const pair = (...parts: string[]) => `<div class="pair">${parts.join('')}</div>`

/* ------------------------------------------------------------ concepts */

const concepts: PageConcept[] = [
  /* 1 · the picker */
  {
    id: 'P1',
    tab: '1 · Presets in the picker',
    section:
      'OPTIONS — Convert to (and compress’s Method, pdf’s action…) when a preset applies to the file. With none, the picker is today’s. Each drawn at 24 rows and at 20, where today’s picker only just fits.',
    earlier: 'like',
    name: 'A section above the formats (round one’s A2)',
    idea: 'As liked in round one: presets first, a rule, the formats. Three presets cost four rows, so at 20 rows the last formats scroll off (↓ 3 more). Video: the section sits above the two boxes.',
    html: stack(
      pair(fr(p1(24, 'photo'), '24 rows'), fr(p1(20, 'photo'), '20 rows')),
      fr(p1(24, 'video'), 'a video'),
    ),
  },
  {
    id: 'P2',
    name: 'Split: a presets box beside the formats',
    idea: 'Your split, in the video picker’s own boxes: ←→ between boxes, ↑↓ in one. The lit preset’s steps on the detail line under the boxes, where video names its codec. A photo’s six formats make the boxes eight rows tall, so it needs 22 rows: at 20 the boxes’ foot and the detail line scroll off. A video (four rows of formats) fits, with a third box.',
    html: stack(
      pair(fr(p2(24, 'photo'), '24 rows'), fr(p2(20, 'photo'), '20 rows')),
      fr(p2(24, 'video'), 'a video: three boxes'),
    ),
  },
  {
    id: 'P3',
    name: 'Two tabs: formats · presets',
    idea: 'The title row holds two tabs; tab switches the list. Never taller than today, whatever the count — but the presets are one key away, so they are easy to miss.',
    html: stack(
      pair(
        fr(p3(24, 'photo', 'formats'), 'formats'),
        fr(p3(24, 'photo', 'presets'), 'tab: presets'),
      ),
    ),
  },
  {
    id: 'P4',
    name: 'Pills on the title’s row',
    idea: 'MY PICK. The presets sit at the right of the title row, which is empty today, so no row is added at any height. ↑ from the first format lights them; the lit one’s steps and size show on the row under, also empty today. Same in a video’s picker and compress’s Method.',
    html: stack(
      pair(
        fr(p4(24, 'photo', false), 'on a format'),
        fr(p4(20, 'photo', true), '↑ — a preset lit, 20 rows'),
      ),
      pair(fr(p4(24, 'video', true), 'a video'), fr(p4(24, 'compress', true), 'compress')),
    ),
  },
  {
    id: 'P5',
    name: 'Split: a column, as edit’s picker is',
    idea: 'Formats on the left as today, presets in a column right of a │ — the shape edit’s picker already has. No rows added. A video’s two boxes leave no room for a column, so a video would fall back to P4.',
    html: stack(pair(fr(p5(24, false), 'on a format'), fr(p5(20, true), '→ — a preset, 20 rows'))),
  },

  /* 2 · home */
  {
    id: 'H1',
    tab: '2 · On home, once staged',
    section:
      'OPTIONS — the presets that fit the staged file, in or by home’s field; ↵ stays where it is',
    name: 'The field grows down',
    idea: 'MY PICK. The presets that apply open on the field’s shelf, under the field. ↓ moves into them; the chip keeps its place and the key row says what ↵ will do. A folder: each preset says how many of its files it applies to.',
    html: stack(
      pair(fr(h1(false, false), 'a photo staged'), fr(h1(false, true), '↓ — a preset')),
      fr(h1(true, true), 'a folder: 13 images, 2 videos'),
    ),
  },
  {
    id: 'H2',
    name: 'Pills in the field’s row',
    idea: 'No row added: the presets as pills just before ↵ enter; tab moves along them, the lit one’s steps appear under it. Tight once names are long or there are many.',
    html: pair(fr(h2(false), 'staged'), fr(h2(true), 'tab — a preset')),
  },
  {
    id: 'H3',
    name: 'On the file’s card instead',
    idea: 'Not in the field: the card in the drop zone grows a row of pills, so the presets read as being about this file. tab moves along them.',
    html: fr(h3()),
  },

  /* 3 · continue editing */
  {
    id: 'K1',
    tab: '3 · Continue editing',
    section:
      'OPTIONS — different shapes for carrying on from Done. No space to select: ↵ and a button on the lit row',
    name: 'It is edit mode, carried on',
    idea: 'MY PICK. → opens edit’s own picker on the file just made — the screen people already know — with the steps so far at the top right. Each operation runs its own screen and comes back here with a ✓. Done (first row) keeps the file; p saves the steps.',
    html: pair(fr(k1(false), '→ from Done'), fr(k1(true), 'after Resize')),
  },
  {
    id: 'K2',
    name: 'A steps screen with sizes',
    idea: 'A full screen, not a window: each step a row, with the size it leaves and a bar for that size — what each step bought you. ↵ changes the lit step, ⌫ removes it, + adds one.',
    html: fr(k2()),
  },
  {
    id: 'K3',
    name: 'A menu, like the / menu',
    idea: 'A small popup from Done’s bottom right, in the / menu’s manner: your steps, then what you can add, ↵ add on the lit row. Small and familiar, but Done stays behind it.',
    html: fr(k3()),
  },
  {
    id: 'K4',
    name: 'Goals, not operations',
    idea: 'Plain wants with ready answers — Smaller file (under 300 KB), Web size (1920 wide), Square (1:1)… ↵ adds one with its answer, → changes the answer. Something else opens the full list.',
    html: fr(k4()),
  },
  {
    id: 'K5',
    name: 'Today’s window, with buttons',
    idea: 'For comparison: W2 as built, space gone — ✓ marks your steps, the lit row carries ↵ add or ↵ remove, esc is done.',
    html: fr(screen(overDone('Continue editing', w2Lines()), W2_KEYS)),
  },

  /* 4 · while it works */
  {
    id: 'R1',
    tab: '4 · While it works',
    section:
      'OPTIONS — Compress on a 16 MB photo takes seconds: what does the window show? Every number here is one Forge really has',
    name: 'The search, drawn',
    idea: 'A ruler of sizes from 0 to the file you had: the target a green line, each try a mark where its size landed, the current one spinning. You watch it close in on the line. The rows go quiet; esc stops.',
    html: fr(r1()),
  },
  {
    id: 'R2',
    name: 'Stations',
    idea: 'MY PICK. Your steps as a line — done ✓, working ⠹, waiting ○ — ending in the file. Under the working one, what it is doing right now. Works for any step, not only a size search.',
    html: fr(r2()),
  },
  {
    id: 'R3',
    name: 'The working screen everyone knows',
    idea: 'The window steps aside for the same working screen every convert shows — the card, one line, the clock, the header’s hatching drifting — then comes back when the step lands. Nothing new to learn.',
    html: fr(r3()),
  },
  {
    id: 'R4',
    name: 'The picture, shimmering',
    idea: 'The photo itself in the window, a light passing over it while the new one is made; beside it, before → … and what is happening. Half blocks may seam in Apple Terminal.',
    html: fr(r4()),
  },
  {
    id: 'R5',
    name: 'A log',
    idea: 'Each try printed as a line, as a terminal would: quality, size, too big or fits. Honest and plain; long searches scroll.',
    html: fr(r5()),
  },

  /* 5 · leaving */
  {
    id: 'D3',
    tab: '5 · Leaving',
    section: 'Liked in round one',
    earlier: 'like',
    name: 'Asked once, on leaving (round one)',
    idea: 'As drawn in round one: the question in the window’s foot, the answers on the key row. You asked for the answers inside the window instead — below.',
    html: fr(d3()),
  },
  {
    id: 'L1',
    section: 'OPTIONS — the same question, its answers inside the window',
    name: 'Two rows in the window’s foot',
    idea: 'MY PICK. Leaving turns the foot into two rows under a rule — Save as preset (lit, ↵ save) and Just this file; the steps above go quiet. ↑↓ and ↵, like every other list.',
    html: fr(l1()),
  },
  {
    id: 'L2',
    name: 'A small window asks',
    idea: 'A small window over the edit window, as a row’s own window opens: its title is the question, the steps, then the two answers.',
    html: fr(l2()),
  },
  {
    id: 'L3',
    name: 'The window becomes the save',
    idea: 'One step fewer: the window turns into the save itself — the steps, the name field already open, Save as preset lit and Just this file under it.',
    html: fr(l3()),
  },
  {
    id: 'L4',
    name: 'Never asked: two ways out, always there',
    idea: 'No question: the window always ends in Keep IMG_2041.jpg and Save as preset; ↓ past the last step lands on them.',
    html: fr(l4()),
  },
]

const before = `<div class="box"><h3>Decided in round one</h3><ul>
<li><b>Presets live everywhere offered:</b> the / menu (/webblog), the mode’s own picker when a preset applies (convert, compress, pdf…), home’s field once a file or folder is staged, and Finder’s Quick Actions.</li>
<li><b>No space to select.</b> Rows are chosen with ↵, and the lit row carries its button (the field key chip, in the mode’s colour).</li>
<li><b>Asked on leaving (D3), with the answers inside the window.</b></li>
<li><b>Gone:</b> a presets tab on home.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>The picker</b> (tab 1): which layout? Today’s Convert to needs 19 rows; at 16 it already overflows.</li>
<li><b>Home</b> (tab 2): where do the staged file’s presets go?</li>
<li><b>Continue editing</b> (tab 3): which shape?</li>
<li><b>While it works</b> (tab 4): which?</li>
<li><b>Leaving</b> (tab 5): which?</li>
<li><b>A folder — my call unless you object:</b> a preset is offered when it applies to at least one file in the folder; it runs on those and lists the rest as skipped (H1 shows “13 of 15”).</li>
<li><b>Round one’s Compress and Quality, said plainly:</b> both decide how small a JPEG gets — Quality by a number, Compress by a size. With both on, which wins? Since b91c125 Compress never goes above the Quality number. Parked unless you want it back.</li>
<li><b>New words to approve:</b> “run preset” (home’s key row) · “13 of 15” · “formats” / “presets 3” (P3) · “1 step” / “2 steps”, “Keep IMG_2041.jpg” (K1, L4) · “Steps”, “Add a step”, “change” (K2) · “Your steps”, “Add” (K3) · “Smaller file”, “Web size”, “Square”, “Sharper”, “No background”, “Something else” (K4) · “try 4 of 8 · quality 38 · 290 KB”, “trying quality 38” (R1, R2) · “too big”, “fits — trying higher” (R5) · “Keep these steps?”, “Save as preset”, “Just this file”, “save”, “keep” (L1–L4) · “esc stop”.</li>
</ol></div>
<style>
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr .ft{font:600 13px -apple-system,sans-serif;color:#a9aebb}
.stack{display:flex;flex-direction:column;gap:18px}
.pair{display:flex;gap:18px;align-items:flex-start}
.pair .t{zoom:.82}
.concept{flex-direction:column-reverse;gap:14px}
.side{max-width:1100px}
.verdicts{flex-direction:row !important;flex-wrap:wrap}
.verdicts button{padding:7px 12px}
.why{max-width:700px}
</style>`

writeFileSync(
  'mockups/presets-ux-2026-10-round2.html',
  feedbackPage({
    page: 'presets-ux-r2',
    title: 'Forge · presets and continue editing, round two',
    heading: 'Presets and Continue editing, round two',
    lede: 'Presets live everywhere you said; this round is how they look in each place, a few genuinely different shapes for Continue editing, bolder ways to show a step working, and the leaving question asked inside the window. Captured from the app, dark, 80 × 24 unless a screen says otherwise.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/presets-ux-2026-10-round2.html')
