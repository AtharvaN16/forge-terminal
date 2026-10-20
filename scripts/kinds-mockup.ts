/**
 * The drop zone's supported formats, round four (2026-10-19). Decided so
 * far: the panel's line groups by kind; a held ? shows the formats; the hint
 * is the key alone at the field's end; the title says "Supported formats".
 *
 * This round: (1) the pop-up the way the app already pops things up — the
 * / menu's box over a dimmed home, with its hatched bar; (2) what a very
 * long list does; (3) the / menu's box without its gold stroke.
 *
 * The band, tabs, dotted panel, header bar, menu hint and the menu's list
 * colours are the app's own art; the field, the key row and the box's sides
 * are drawn here the way the app draws them (transcribe-mockup's `menuPopup`).
 * Full 80 × 24.
 *
 *   npx tsx scripts/kinds-mockup.ts   → mockups/menu-field-2026-10.html
 *   (round five, the / menu's field; earlier rounds were mockups/kinds-2026-10.html)
 */
import { writeFileSync } from 'node:fs'
import { trailBarRow } from '../src/shell/bar-art.js'
import { listCommands } from '../src/shell/commands.js'
import {
  blank,
  brandRows,
  HOME_MARGIN,
  menuHintRow,
  mix,
  type Row,
  type Run,
  width as rowWidth,
  suggestionRows,
  surfaceRows,
  tabRows,
} from '../src/shell/home-art.js'
import { menuListRows } from '../src/shell/menu-art.js'
import {
  DARK,
  LIGHT,
  MODE_KEYS,
  modeColours,
  modeGradient,
  modePalette,
  type Palette,
  type ShellMode,
} from '../src/shell/theme.js'

const N = 80
const SURFACE = 8
const KEY = 'tab'
const TITLE = 'Supported formats'

interface Cell {
  ch: string
  fg?: string
  bg?: string
  b?: boolean
}
type Grid = Cell[][]
const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))
const runsOf = (cells: Cell[]): Row =>
  cells.map((c) => ({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.b }))
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  { text: ' '.repeat(Math.max(0, n - rowWidth(row))), ...(bg ? { bg } : {}) },
]

/* ------------------------------------------------------------ the strings */

type Kinds = [string, string][]
/** What the panel's line says at rest. */
const KINDS: Partial<Record<ShellMode, string>> = {
  convert: 'Images · Video · Audio · Documents',
  compress: 'Images · PDF',
  edit: 'Images',
}
/** The formats, a line a kind: convert's are the ones in src/core/formats.ts. */
const FORMATS: Record<'convert' | 'compress' | 'edit', Kinds> = {
  convert: [
    ['Images', 'JPEG · PNG · WebP · AVIF · HEIC · GIF · TIFF'],
    ['Video', 'MP4 · MOV · HEVC · WebM · MKV · AVI'],
    ['Sound', 'MP3 · M4A · Opus · FLAC · AIFF · WAV · OGG'],
    ['Documents', 'PDF · Word'],
  ],
  compress: [
    ['Images', 'JPEG · PNG · WebP · AVIF · GIF'],
    ['PDF', 'PDF'],
  ],
  edit: [['Images', 'JPEG · PNG · WebP · AVIF · HEIC · GIF · TIFF']],
}
/** `list` broken at its separators to lines of at most `max` columns. */
function wrap(list: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const part of list.split(' · ')) {
    const next = line ? `${line} · ${part}` : part
    if (next.length > max && line) {
      out.push(`${line} ·`)
      line = part
    } else line = next
  }
  if (line) out.push(line)
  return out
}
const leadOf = (kinds: Kinds) => Math.max(...kinds.map(([k]) => k.length)) + 3

/* ------------------------------------------------------------- the pieces */

/** The field: the shelf, three rows, the marker four columns in, `hint` two cells short of its end. */
function field(p: Palette, hint?: Run[], typed?: string): Row[] {
  const inner = N - 4
  const bg = p.shelf === '' ? undefined : p.shelf
  const fill = (runs: Run[]): Row => [
    blank(HOME_MARGIN),
    ...pad(
      runs.map((r) => ({ ...r, ...(r.bg || !bg ? {} : { bg }) })),
      inner,
      bg,
    ),
  ]
  const left: Run[] = [
    blank(2),
    run('›', p.accent, undefined, true),
    blank(1),
    ...(typed === undefined
      ? [run('or type a path', p.border)]
      : [run(typed, p.fg), run(' ', p.ink, p.fg)]),
  ]
  return [
    fill([]),
    fill(hint ? [...left, blank(inner - rowWidth(left) - rowWidth(hint) - 2), ...hint] : left),
    fill([]),
  ]
}

function keyRow(p: Palette): Row {
  const left: Row = [
    blank(HOME_MARGIN + 1),
    run(' ↵ ', p.fg, p.keycapBg, true),
    run(' send', p.dim),
  ]
  const note: Row = [run(`${MODE_KEYS} ←→ mode · esc clear · ctrl-n new · ctrl-c quit`, p.border)]
  return [...left, blank(N - rowWidth(left) - rowWidth(note) - 1), ...note, blank(1)]
}

/* ------------------------------------------------------------ panel takeover */

function clear(g: Grid, r: number, c: number, h: number, w: number, bg: string) {
  for (let i = r; i < r + h; i++)
    for (let j = c; j < c + w; j++) {
      const cell = g[i]?.[j]
      if (cell) Object.assign(cell, { ch: ' ', fg: undefined, bg, b: false })
    }
}
function put(g: Grid, r: number, c: number, text: string, fg: string, bold = false) {
  ;[...text].forEach((ch, i) => {
    const cell = g[r]?.[c + i]
    if (cell) Object.assign(cell, { ch, fg, b: bold })
  })
}

/**
 * Q2: the panel's dots give way to the list, as they do for the / menu. Past
 * the panel's rows the list scrolls: a thin bar on the last column and a
 * "↓ n more" on the bottom edge, as the commands list does (S2).
 */
function takeover(g: Grid, p: Palette, mode: ShellMode, kinds: Kinds, up = false) {
  const W = N - HOME_MARGIN * 2
  const x = HOME_MARGIN + 3
  const lead = leadOf(kinds)
  clear(g, 0, HOME_MARGIN, SURFACE, W, p.selectionBg)
  put(g, 1, x, TITLE, modeColours(p, mode).fg, true)
  if (up) put(g, 1, N - HOME_MARGIN - 4, '▴', modeColours(p, mode).fg, true)
  put(g, 2, x, '─'.repeat(W - 6), p.border)
  const lines: [string, string][] = kinds.flatMap(([k, list]) =>
    wrap(list, W - 6 - lead - 2).map((l, i): [string, string] => [i === 0 ? k : '', l]),
  )
  const room = SURFACE - 3
  const over = lines.length > room
  const shown = over ? lines.slice(0, room - 1) : lines
  shown.forEach(([k, l], i) => {
    put(g, 3 + i, x, k, p.fg, true)
    put(g, 3 + i, x + lead, l, p.dim)
  })
  if (over) {
    const rows = room - 1
    const thumb = Math.max(1, Math.round((rows * rows) / lines.length))
    for (let i = 0; i < rows; i++)
      put(g, 3 + i, N - HOME_MARGIN - 1, i < thumb ? '┃' : '│', i < thumb ? p.dim : p.faint)
    const note = `↓ ${lines.length - shown.length} more`
    put(g, SURFACE - 1, N - HOME_MARGIN - 1 - note.length, note, p.dim)
  }
}

/* ----------------------------------------------------------------- home */

function home(
  p: Palette,
  mode: ShellMode,
  hint: Run[],
  o: { kinds?: Kinds; chevron?: boolean; typed?: string } = {},
): Grid {
  const [tabs0, tabs1] = tabRows({ palette: p, mode })
  const line = `${KINDS[mode] ?? ''}${o.chevron && !o.kinds ? '  ▾' : ''}`
  const surface = surfaceRows({
    width: N,
    rows: SURFACE,
    palette: p,
    mode,
    typing: o.typed !== undefined,
    kinds: line,
  }).map(cellsOf)
  if (o.chevron && !o.kinds)
    for (const row of surface)
      for (const c of row)
        if (c.ch === '▾') Object.assign(c, { fg: modeColours(p, mode).fg, b: true })
  if (o.kinds) takeover(surface, p, mode, o.kinds, o.chevron)
  return [
    [],
    ...brandRows({ width: N, palette: p, mode }),
    [],
    tabs0 ?? [],
    tabs1 ?? [],
    ...surface.map(runsOf),
    ...field(p, hint, o.typed),
    [],
    [],
    [],
    menuHintRow({ palette: p, width: N, open: false }),
    [run('─'.repeat(N), p.border)],
    keyRow(p),
  ].map((row) => {
    // Every row N cells wide, so a box can be drawn over any of them.
    const cells = cellsOf(row)
    while (cells.length < N) cells.push({ ch: ' ' })
    return cells
  })
}

/* ------------------------------------------------------------ the pop-up box */

/** Its right edge lines up with the "/ menu" hint's (column 78), the same margin on the left. */
const POP_X = 1
const POP_W = 78
const IN = POP_W - 4

type Stroke = string | null

/**
 * The app's popup box (MenuPopup): one column in from each side, the hatched
 * bar, a blank row, `body`, a blank row, and `foot` if it has a field. With no
 * `stroke` the edge is the fill alone, the same footprint.
 */
function box(
  p: Palette,
  o: { stroke: Stroke; bar: Row; body: Row[]; rows: number; foot?: Row },
): Row[] {
  const fill = p.selectionBg
  const side = (r: Row, bg = fill): Row =>
    [
      o.stroke ? run('│', o.stroke, fill) : run(' ', undefined, fill),
      blank(1),
      ...pad(r, IN, bg).map((x) => ({ ...x, bg: x.bg ?? bg })),
      run(' ', undefined, fill),
      o.stroke ? run('│', o.stroke, fill) : run(' ', undefined, fill),
    ].map((x) => ({ ...x, bg: x.bg ?? fill }))
  const edge = (l: string, r: string): Row =>
    o.stroke
      ? [run(`${l}${'─'.repeat(POP_W - 2)}${r}`, o.stroke, fill)]
      : [run(' '.repeat(POP_W), undefined, fill)]
  return [
    edge('╭', '╮'),
    side(o.bar),
    side([]),
    ...Array.from({ length: o.rows }, (_, i) => side(o.body[i] ?? [])),
    side([]),
    ...(o.foot ? [side(o.foot, p.shelf)] : []),
    edge('╰', '╯'),
  ]
}

/** `rows` drawn over the grid from (top, POP_X). */
function overlay(g: Grid, top: number, rows: Row[]) {
  rows.forEach((row, i) => {
    const line = g[top + i]
    if (!line) return
    cellsOf(row).forEach((c, j) => {
      line[POP_X + j] = c
    })
  })
}

/** Home stays behind the box, dimmed; rows from `keep` down are left lit. */
function dim(g: Grid, p: Palette, keep: number) {
  g.forEach((row, i) => {
    if (i >= keep) return
    for (const c of row) {
      c.fg = c.fg ? mix(c.fg, p.canvas, 0.75) : c.fg
      c.bg = c.bg ? mix(c.bg, p.canvas, 0.6) : c.bg
    }
  })
}

/** The open menu's key row: its caps, then the footnote's keys bright and their words faded. */
function menuKeys(p: Palette): Row {
  const cap = (k: string): Run => run(` ${k} `, p.fg, p.keycapBg, true)
  const left: Row = [
    blank(3),
    cap('↑↓'),
    run(' choose', p.dim),
    blank(2),
    cap('↵'),
    run(' open', p.dim),
  ]
  const note: Row = [
    run('esc', p.fg),
    run(' close', p.border),
    run(' · ', p.border),
    run('ctrl-c', p.fg),
    run(' quit', p.border),
  ]
  return [...left, blank(N - rowWidth(left) - rowWidth(note) - 1), ...note]
}

type FieldLook = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

/** The field's words: the gold marker two columns in, what is typed, the cursor. */
const words = (p: Palette, typed: string, bg?: string): Row => [
  run('  ', undefined, bg),
  run('›', p.brand, bg, true),
  run(` /${typed}`, p.fg, bg),
  run(' ', p.ink, p.fg),
]
/** One row the box's width on `bg`. */
const band = (p: Palette, typed: string, bg: string): Row => pad(words(p, typed, bg), IN, bg)

/**
 * The / menu over a dimmed home, 21 rows tall as the app draws it, its field
 * drawn the `look` way: A as built (a recessed row), B a raised row, C a
 * framed box, D a rule above a bare line, E at the top like a search box.
 */
function menuLook(p: Palette, look: FieldLook, typed = ''): Grid {
  const g = home(p, 'convert', [])
  dim(g, p, 21)
  g[21] = cellsOf(menuHintRow({ palette: p, width: N, open: true }))
  g[23] = cellsOf(menuKeys(p))
  const bar = trailBarRow({
    width: IN,
    palette: p,
    mode: 'convert',
    trail: { answers: [], current: '' },
    slanted: false,
    chip: { label: 'menu', colour: p.brand, stops: modeGradient(p, 'menu') },
  })
  const ROWS = 16
  const list = (rows: number) => {
    const { items } = listCommands(typed)
    return menuListRows({
      palette: p,
      width: IN,
      items,
      query: items.length > 0 ? typed : '',
      typed,
      selected: 0,
      rows,
    }).slice(0, rows)
  }
  const fit = (rows: Row[], n: number) => [
    ...rows,
    ...Array.from({ length: n - rows.length }, () => []),
  ]
  let body: Row[]
  if (look === 'A') body = [...fit(list(14), 14), [], band(p, typed, p.shelf)]
  else if (look === 'B') body = [...fit(list(14), 14), [], band(p, typed, p.panelBand)]
  else if (look === 'C')
    body = [
      ...fit(list(12), 12),
      [],
      [run(`╭${'─'.repeat(IN - 2)}╮`, p.border)],
      pad([run('│', p.border), ...words(p, typed).slice(1)], IN - 1).concat([run('│', p.border)]),
      [run(`╰${'─'.repeat(IN - 2)}╯`, p.border)],
    ]
  else if (look === 'D')
    body = [...fit(list(14), 14), [run('─'.repeat(IN), p.faint)], words(p, typed)]
  else if (look === 'E') body = [band(p, typed, p.panelBand), [], ...fit(list(14), 14)]
  else if (look === 'F') body = fit(list(14), 14)
  else body = [[], [], [], [], ...fit(list(12), 12)]
  overlay(g, 0, box(p, { stroke: null, bar, body, rows: ROWS }))
  // F and G: home's field, a filled block three rows tall, edge to edge of
  // the box with nothing round it — at its foot (F) or under its bar (G).
  if (look === 'F' || look === 'G') {
    const top = look === 'F' ? 18 : 2
    for (let r = top; r < top + 3; r++)
      for (let c = POP_X; c < POP_X + POP_W; c++) {
        const cell = g[r]?.[c]
        if (cell) Object.assign(cell, { ch: ' ', fg: undefined, bg: p.shelf, b: false })
      }
    const line = g[top + 1]
    if (line)
      cellsOf(words(p, typed)).forEach((c, i) => {
        line[POP_X + 2 + i] = { ...c, bg: c.bg ?? p.shelf }
      })
  }
  return g
}

/* ------------------------------------------------------------------ page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function html(rows: Grid, palette: Palette): string {
  return rows
    .map((cells) => {
      let out = ''
      for (const c of cells) {
        const st = [
          `color:${c.fg || palette.fg}`,
          c.bg ? `background:${c.bg}` : '',
          c.b ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        out += `<span style="${st}">${esc(c.ch)}</span>`
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
}
const term = (base: Palette, rows: Grid) =>
  `<div class="t" style="background:${base === LIGHT ? '#ffffff' : '#1e1e1e'}">${html(rows, base)}</div>`

/** One figure row: `draw` in dark and light side by side. */
const themes = (draw: (p: Palette) => Grid, label: string) =>
  `<div class="row">${[DARK, LIGHT]
    .map(
      (base) =>
        `<div class="col">${term(base, draw(modePalette(base, 'convert')))}<div class="cap">${label} · ${base === DARK ? 'dark' : 'light'}</div></div>`,
    )
    .join('')}</div>`

const figure = (id: string, name: string, idea: string, body: string, pick = false) =>
  `<figure><div class="vt"><span class="id">${id}</span><span class="name">${name}</span>${pick ? '<span class="pick">RECOMMENDED</span>' : ''}</div>
<p class="idea">${esc(idea)}</p>${body}</figure>`

/* --- the menu's field */
const LOOKS: { id: FieldLook; name: string; idea: string; pick?: boolean }[] = [
  {
    id: 'A',
    name: 'A recessed row (as built)',
    idea: 'One row across the box, a step darker than the box, the › in the list’s column. Quiet; on some screens the step is hard to see.',
  },
  {
    id: 'B',
    name: 'A raised row',
    idea: 'The same row a step lighter than the box: the grey the chosen row in a list has. Reads as the place you type at a glance.',
  },
  {
    id: 'C',
    name: 'A framed box',
    idea: 'A thin grey frame round the line, like a text box in a form. The clearest “type here”, and the heaviest: it costs two rows of the list.',
  },
  {
    id: 'D',
    name: 'A rule above a bare line',
    idea: 'No fill: a faint rule across the box, then the line. The lightest; the field reads as the box’s footer.',
  },
  {
    id: 'E',
    name: 'At the top, like a search box',
    idea: 'The raised row moves up under the bar, the list below it: where a command palette or Spotlight puts its search. What you type sits right above what it narrows.',
  },
]
LOOKS.push(
  {
    id: 'F',
    name: 'Home’s field, at the foot',
    idea: 'The field the drop area has: a filled block three rows tall, edge to edge of the box, no line and no margin round it, closing the box at the bottom. The › in the list’s column.',
    pick: true,
  },
  {
    id: 'G',
    name: 'Home’s field, under the bar',
    idea: 'The same block at the top, straight under the bar, the list below it, as a search box sits.',
  },
)
const looks = LOOKS.map((l) =>
  figure(
    l.id,
    l.name,
    l.idea,
    themes((p) => menuLook(p, l.id), 'after /') +
      themes((p) => menuLook(p, l.id, 'co'), 'after /co'),
    l.pick,
  ),
).join('')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · The / menu’s field</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } h2 { font-size:21px; margin:56px 0 4px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .box { border:1px solid #2c2f37; border-radius:10px; padding:14px 18px; margin:22px 0 0; max-width:1000px; background:#14161b; }
  .box h3 { margin:0 0 6px; font-size:14px; letter-spacing:.06em; text-transform:uppercase; color:#8f94a1; }
  .box ol, .box ul { margin:6px 0 0 20px; padding:0; } .box li { margin:4px 0; }
  figure { margin:36px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .pick { font:600 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 12px; max-width:1000px; }
  .row { display:flex; flex-wrap:wrap; gap:28px; margin-top:14px; }
  .col { display:flex; flex-direction:column; gap:10px; }
  .cap { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; } .r > span { display:inline-block; height:17px; line-height:17px; }
  code { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; }
</style></head><body><main>
<h1>The / menu’s field</h1>
<p class="lede">The / menu open at a standard 80 × 24 window, dark and light, drawn from the app’s own band, bar and list. Each look after “/” and after “/co”.</p>

<div class="box"><h3>Decided</h3><ul>
<li>The menu stays open when no command matches, and says so. A second slash, or ↵ on something that is there, makes it a path.</li>
<li>The field’s › sits in the list’s column.</li></ul></div>

<div class="box"><h3>Open question</h3><ol>
<li><b>How does the field look?</b> A to G below, pick one. F and G are the drop area’s own field.</li></ol></div>

<h2>OPTIONS: the field</h2>
<p class="lede">A to G, pick one.</p>
${looks}
</main></body></html>`

writeFileSync('mockups/menu-field-2026-10.html', page)
console.log('wrote mockups/menu-field-2026-10.html')

/* ======================================================= file suggestions */

/**
 * Round six (2026-10-19): what the field suggests as you type, once it looks
 * across the Mac for a name (Spotlight, plus Desktop and Downloads read
 * directly). Today's list showed bare folder names from wherever Forge was
 * started ("scripts/", "skills/") and read as nothing in particular.
 */
interface Found {
  name: string
  where: string
  when: string
  kind: string
  folder?: boolean
}
const FOUND: Found[] = [
  { name: 'receipt-march.pdf', where: '~/Downloads', when: '2 min ago', kind: 'PDF' },
  { name: 'Receipt 2026-10-12.png', where: '~/Desktop', when: 'yesterday', kind: 'PNG' },
  { name: 'recording-standup.m4a', where: '~/Documents/Meetings', when: '3 days ago', kind: 'M4A' },
  { name: 'receipts', where: '~/Documents/Taxes', when: 'last week', kind: '', folder: true },
  { name: 'recipe-card.heic', where: '~/Pictures', when: 'Oct 2', kind: 'HEIC' },
  {
    name: 'Recap deck.pdf',
    where: '~/Library/Mobile Documents/…/Work',
    when: 'Sep 28',
    kind: 'PDF',
  },
]
const TYPED = 'rec'

type SuggestLook = 'S1' | 'S2' | 'S3'

/** The typing key row: ↵ send, esc clear and tab complete on caps; ↑↓ choose and quit after. */
function typingKeys(p: Palette): Row {
  const capOf = (k: string): Run => run(` ${k} `, p.fg, p.keycapBg, true)
  // As the app draws it since 2026-10-19: ↵ is in the field, "enter".
  const left: Row = [
    blank(HOME_MARGIN + 1),
    capOf('esc'),
    run(' clear', p.dim),
    blank(2),
    capOf('tab'),
    run(' complete', p.dim),
  ]
  const note: Row = [
    run('↑↓', p.fg),
    run(' choose', p.border),
    run(' · ', p.border),
    run('ctrl-c', p.fg),
    run(' quit', p.border),
  ]
  return [...left, blank(N - rowWidth(left) - rowWidth(note) - 1), ...note, blank(1)]
}

/** `text` cut to `n` cells with a middle ellipsis. */
const cut = (text: string, n: number) =>
  text.length <= n
    ? text
    : `${text.slice(0, Math.ceil((n - 1) / 2))}…${text.slice(text.length - Math.floor((n - 1) / 2))}`

/**
 * One found file as a row `w` wide: S1 and S2 the name, where it is and when;
 * S3 a kind tag first. The chosen row sits on the list band with the strip.
 */
function foundRow(
  p: Palette,
  f: Found,
  chosen: boolean,
  w: number,
  look: SuggestLook,
  bg?: string,
): Row {
  const band = chosen ? p.listBand : bg
  const strip = run(chosen ? '▌' : ' ', p.accent, band)
  const name = run(cut(f.folder ? `${f.name}/` : f.name, 26).padEnd(28), p.fg, band, chosen)
  const where = run(cut(f.where, 24).padEnd(26), chosen ? p.dim : p.border, band)
  const when = run(f.when, chosen ? p.dim : p.border, band)
  const tag =
    look === 'S3'
      ? [
          run(
            ` ${(f.folder ? 'folder' : f.kind).padEnd(6)}`,
            p.dim,
            chosen ? p.panelBand : p.keycapBg,
          ),
          run(' ', undefined, band),
        ]
      : []
  const left: Row = [strip, run(' ', undefined, band), ...tag, name, where]
  const room = w - rowWidth(left) - rowWidth([when]) - 1
  return [
    ...left,
    run(' '.repeat(Math.max(1, room)), undefined, band),
    when,
    run(' ', undefined, band),
  ]
}

/** Home while "rec" is typed, the suggestions drawn the `look` way. */
function suggestScreen(p: Palette, look: SuggestLook): Grid {
  const [tabs0, tabs1] = tabRows({ palette: p, mode: 'convert' })
  let surface = surfaceRows({
    width: N,
    rows: SURFACE,
    palette: p,
    mode: 'convert',
    typing: true,
    kinds: KINDS.convert ?? '',
  })
  const W = N - HOME_MARGIN * 2
  let under: Row[] = [[], [], [], []]
  if (look === 'S2') {
    // The drop area steps aside for the list: six rows, on its own fill.
    const fill = p.selectionBg
    surface = [
      [blank(HOME_MARGIN), run(' '.repeat(W), undefined, fill)],
      ...FOUND.map(
        (f, i): Row => [
          blank(HOME_MARGIN),
          run('  ', undefined, fill),
          ...foundRow(p, f, i === 0, W - 4, look, fill),
          run('  ', undefined, fill),
        ],
      ),
      [blank(HOME_MARGIN), run(' '.repeat(W), undefined, fill)],
    ]
  } else {
    under = [
      [],
      ...FOUND.slice(0, 3).map(
        (f, i): Row => [blank(HOME_MARGIN + 2), ...foundRow(p, f, i === 0, W - 4, look)],
      ),
    ]
  }
  return [
    [],
    ...brandRows({ width: N, palette: p, mode: 'convert' }),
    [],
    tabs0 ?? [],
    tabs1 ?? [],
    ...surface,
    ...field(p, undefined, TYPED),
    ...under,
    [run('─'.repeat(N), p.border)],
    typingKeys(p),
  ].map((row) => {
    const cells = cellsOf(row)
    while (cells.length < N) cells.push({ ch: ' ' })
    return cells
  })
}

/** Today's list, for comparison: bare names from the folder Forge was started in. */
function todaySuggest(p: Palette): Grid {
  const g = suggestScreen(p, 'S1')
  const names = ['scripts/', 'skills/', 'src/']
  names.forEach((n, i) => {
    const r = 19 + i
    const row: Row =
      i === 0
        ? [
            blank(HOME_MARGIN + 2),
            run('▌', p.accent, p.listBand),
            run(` ${n}`.padEnd(33), p.fg, p.listBand, true),
          ]
        : [blank(HOME_MARGIN + 4), run(n, p.dim)]
    const cells = cellsOf(row)
    while (cells.length < N) cells.push({ ch: ' ' })
    g[r] = cells
  })
  const f = g[16]
  if (f) {
    const typed = cellsOf(field(p, undefined, 's')[1] ?? [])
    while (typed.length < N) typed.push({ ch: ' ' })
    g[16] = typed
  }
  return g
}

const SUGGEST: {
  id: string
  name: string
  idea: string
  draw: (p: Palette) => Grid
  pick?: boolean
}[] = [
  {
    id: 'Today',
    name: 'Today',
    idea: 'Typing “s” in the project folder: bare folder names, from wherever Forge was started, with nothing to say what they are or where.',
    draw: todaySuggest,
  },
  {
    id: 'S1',
    name: 'Name, where, when',
    idea: 'Under the field, as now, three at a time: the name bright, the folder it is in, and how long ago it changed at the right. Newest first, so what you just saved or downloaded is on top.',
    draw: (p) => suggestScreen(p, 'S1'),
  },
  {
    id: 'S2',
    name: 'In the drop area',
    idea: 'The drop area makes way for the list while you type, as it does for the / menu and the supported formats: six at a time instead of three, the same three columns. The field stays where it is.',
    draw: (p) => suggestScreen(p, 'S2'),
    pick: true,
  },
  {
    id: 'S3',
    name: 'A kind tag first',
    idea: 'S1 with a small grey tag before each name, PDF, PNG, M4A or folder, so the kind reads before the name.',
    draw: (p) => suggestScreen(p, 'S3'),
  },
]
const suggestions = SUGGEST.map((s) =>
  figure(s.id, s.name, s.idea, themes(s.draw, `typed “${s.id === 'Today' ? 's' : TYPED}”`), s.pick),
).join('')

const suggestPage = `${page.slice(0, page.indexOf('<title>'))}<title>Forge · File suggestions</title>${page.slice(page.indexOf('</title>') + 8, page.indexOf('<h1>'))}<h1>Suggestions as you type a name</h1>
<p class="lede">Home at a standard 80 × 24 window, dark and light, with “rec” typed. The files are made up; the search behind them looks across the Mac by name (Spotlight), plus Desktop and Downloads read directly, newest first, only files Forge can open.</p>

<div class="box"><h3>Open question</h3><ol>
<li><b>How do the suggestions look?</b> S1 to S3 below, pick one. ↑↓ choose, tab puts the chosen one in the field, ↵ sends it.</li></ol></div>

<h2>OPTIONS: the suggestions</h2>
${suggestions}
</main></body></html>`
writeFileSync('mockups/file-suggestions-2026-10.html', suggestPage)
console.log('wrote mockups/file-suggestions-2026-10.html')

/* ================================================= first search, permission */

/**
 * Round seven (2026-10-19): the first time a name is searched, macOS asks —
 * once, in its own dialog, naming the terminal app — before anything may read
 * Desktop, Documents or Downloads. Do we say anything first, and what if the
 * answer is no?
 */
const FOUND_NOW = [
  { name: 'receipt-march.pdf', where: '~/Downloads' },
  { name: 'Receipt 2026-10-12.png', where: '~/Desktop' },
  { name: 'recording-standup.m4a', where: '~/Documents/Meetings' },
  { name: 'receipts/', where: '~/Documents/Taxes' },
  { name: 'recipe-card.heic', where: '~/Pictures' },
  { name: 'Recap deck.pdf', where: '~/Library/Mobile Documents/…/Work' },
]

/** Home with "rec" typed and `panel` on the drop area. */
function firstScreen(p: Palette, panel: Row[], keys?: Row): Grid {
  const [tabs0, tabs1] = tabRows({ palette: p, mode: 'convert' })
  return [
    [],
    ...brandRows({ width: N, palette: p, mode: 'convert' }),
    [],
    tabs0 ?? [],
    tabs1 ?? [],
    ...panel,
    ...field(p, [run(' enter ', p.fg, p.keycapBg, true)], TYPED),
    [],
    [],
    [],
    [],
    [run('─'.repeat(N), p.border)],
    keys ?? typingKeys(p),
  ].map((row) => {
    const cells = cellsOf(row)
    while (cells.length < N) cells.push({ ch: ' ' })
    return cells
  })
}
const listed = (p: Palette, items = FOUND_NOW) =>
  suggestionRows({ width: N, rows: SURFACE, palette: p, mode: 'convert', items, selected: 0 })

/** A row of the drop area's fill with `runs` three columns in. */
const panelLine = (p: Palette, runs: Run[]): Row => {
  const W = N - HOME_MARGIN * 2
  const row = [blank(3), ...runs].map((r) => ({ ...r, bg: r.bg ?? p.selectionBg }))
  return [
    blank(HOME_MARGIN),
    ...row,
    run(' '.repeat(Math.max(0, W - rowWidth(row))), undefined, p.selectionBg),
  ]
}

/** macOS's own dialog, drawn over the figure as the system draws it. */
const macAlert = (folder: string) => `<div class="alert"><div class="alert-icon">▣</div>
<div class="alert-title">“Terminal” would like to access files in your ${folder} folder.</div>
<div class="alert-body">Keeping app access permissions up to date helps protect your privacy.</div>
<div class="alert-buttons"><span>Don’t Allow</span><span class="primary">Allow</span></div></div>`

const PERMS: {
  id: string
  name: string
  idea: string
  draw: (p: Palette) => Grid
  alert?: boolean
  pick?: boolean
}[] = [
  {
    id: 'P0',
    name: 'Say nothing: macOS asks',
    idea: 'The first search reads Desktop, and macOS stops it with its own dialog, once for each of Desktop, Documents and Downloads. The dialog names your terminal app, not Forge, which can read as odd. Allow, and it never asks again.',
    draw: (p) => firstScreen(p, listed(p)),
    alert: true,
  },
  {
    id: 'P1',
    name: 'One line, the first time only',
    idea: 'The first time a name is searched, the top of the list says why a dialog is about to appear. Shown once, gone for good after.',
    draw: (p) =>
      firstScreen(p, [
        panelLine(p, []),
        panelLine(p, [run('macOS may ask once to let your terminal see these folders.', p.dim)]),
        ...listed(p).slice(1, -1).slice(0, 5),
        panelLine(p, []),
      ]),
    alert: true,
    pick: true,
  },
  {
    id: 'P2',
    name: 'Ask first',
    idea: 'Before the first search, the drop area asks: ↵ to search the Mac, esc to keep to the folder being typed. Only after ↵ does macOS ask. The most honest, and one more step.',
    draw: (p) =>
      firstScreen(
        p,
        [
          panelLine(p, []),
          panelLine(p, []),
          panelLine(p, [run('Search your Mac for files by name?', p.fg, undefined, true)]),
          panelLine(p, [run('Nothing leaves your Mac. macOS will ask once to let your', p.dim)]),
          panelLine(p, [run('terminal see Desktop, Documents and Downloads.', p.dim)]),
          panelLine(p, []),
          panelLine(p, []),
          panelLine(p, []),
        ],
        (() => {
          const capOf = (k: string): Run => run(` ${k} `, p.fg, p.keycapBg, true)
          const left: Row = [
            blank(HOME_MARGIN + 1),
            capOf('↵'),
            run(' search', p.dim),
            blank(2),
            capOf('esc'),
            run(' not now', p.dim),
          ]
          const note: Row = [run('ctrl-c', p.fg), run(' quit', p.border)]
          return [...left, blank(N - rowWidth(left) - rowWidth(note) - 1), ...note]
        })(),
      ),
  },
  {
    id: 'P3',
    name: 'If the answer was no',
    idea: 'With Desktop or Downloads refused, the search still finds what Spotlight knows elsewhere, and the list’s last row says what is missing and how to turn it on. With every result gone, the row is all the list says.',
    draw: (p) =>
      firstScreen(p, [
        ...suggestionRows({
          width: N,
          rows: SURFACE - 1,
          palette: p,
          mode: 'convert',
          items: FOUND_NOW.filter((f) => !/Desktop|Downloads/.test(f.where)),
          selected: 0,
        }),
        panelLine(p, [
          run('Desktop and Downloads are off', p.dim),
          run(' · ', p.border),
          run('Privacy & Security › Files and Folders', p.dim),
        ]),
      ]),
  },
]
const perms = PERMS.map((x) =>
  figure(
    x.id,
    x.name,
    x.idea,
    `<div class="row">${[DARK, LIGHT]
      .map(
        (base) =>
          `<div class="col"><div class="stack">${term(base, x.draw(modePalette(base, 'convert')))}${x.alert ? macAlert('Desktop') : ''}</div><div class="cap">${base === DARK ? 'dark' : 'light'}</div></div>`,
      )
      .join('')}</div>`,
    x.pick,
  ),
).join('')

const permStyle = `<style>
  .stack { position:relative; }
  .alert { position:absolute; left:50%; top:205px; transform:translateX(-50%); width:260px; background:rgba(236,236,236,.97); color:#1d1d1f; border-radius:14px; padding:18px 16px 14px; box-shadow:0 20px 50px rgba(0,0,0,.45); font:13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif; text-align:center; }
  .alert-icon { font-size:30px; margin-bottom:6px; color:#555; }
  .alert-title { font-weight:700; margin-bottom:6px; }
  .alert-body { font-size:11.5px; color:#444; margin-bottom:12px; }
  .alert-buttons { display:flex; gap:8px; } .alert-buttons span { flex:1; padding:5px 0; border-radius:7px; background:#fff; border:1px solid #d0d0d0; }
  .alert-buttons .primary { background:#0a7aff; color:#fff; border-color:#0a7aff; }
</style>`

const permPage = `${page.slice(0, page.indexOf('<title>'))}<title>Forge · First search</title>${page.slice(page.indexOf('</title>') + 8, page.indexOf('<h1>'))}${permStyle}<h1>The first search: macOS asks</h1>
<p class="lede">Home at 80 × 24, dark and light, “rec” typed for the first time. Forge reads Desktop and Downloads directly to catch new files; macOS guards those folders (and Documents) and asks once before any app may read them. The dialog is macOS’s own; Forge cannot change its words.</p>

<div class="box"><h3>Open questions</h3><ol>
<li><b>Do we tell people before macOS asks?</b> P0 to P2 below, pick one. P1 and P2 add words — each is quoted in its figure for your yes or no.</li>
<li><b>And when the answer is no:</b> P3, the last row of the list. Its words too need your yes.</li></ol></div>

<h2>OPTIONS: the first time</h2>
${perms}
</main></body></html>`
writeFileSync('mockups/first-search-2026-10.html', permPage)
console.log('wrote mockups/first-search-2026-10.html')

/* ======================================================= searching: loading */

/**
 * Round eight (2026-10-19): what the drop area shows while a name is being
 * looked for. A search usually answers in a tenth of a second; like Working
 * (W5), nothing shows unless it takes longer than 0.3 s, so these are the
 * slow case: a Mac with a big index, or a first search.
 */
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const BEFORE = [
  { name: 'Receipt 2026-10-12.png', where: '~/Desktop' },
  { name: 'receipts/', where: '~/Documents/Taxes' },
  { name: 'recipe-card.heic', where: '~/Pictures' },
  { name: 'Recap deck.pdf', where: '~/Library/Mobile Documents/…/Work' },
]

/** The drop area's fill with `runs` on row `at` (three columns in), blank elsewhere. */
const panelWith = (p: Palette, lines: Record<number, Run[]>): Row[] =>
  Array.from({ length: SURFACE }, (_, r) => panelLine(p, lines[r] ?? []))

/** The previous results, all faded: none is chosen while the new ones come. */
const fadedList = (p: Palette): Row[] =>
  suggestionRows({
    width: N,
    rows: SURFACE,
    palette: p,
    mode: 'convert',
    items: BEFORE,
    selected: -1,
  })

type LoadLook = 'L1' | 'L2' | 'L3' | 'L4'
const FRAMES: Record<LoadLook, number> = { L1: 10, L2: 12, L3: 10, L4: 14 }
const FRAME_MS: Record<LoadLook, number> = { L1: 80, L2: 260, L3: 80, L4: 70 }

function loadingPanel(p: Palette, look: LoadLook, f: number): Row[] {
  const accent = modeColours(p, 'convert').fg
  const spin = SPIN[f % SPIN.length] ?? '⠋'
  if (look === 'L1') {
    // One spinner line, in the middle of the drop area, as Working has.
    const words = 'Searching your Mac'
    const lead = Math.floor((N - HOME_MARGIN * 2 - 3 - words.length - 2) / 2)
    return panelWith(p, {
      3: [blank(lead), run(`${spin} `, accent, undefined, true), run(words, p.dim)],
    })
  }
  if (look === 'L2') {
    // No words: the drop area's own dots ripple outward while it looks.
    return surfaceRows({
      width: N,
      rows: SURFACE,
      palette: p,
      mode: 'convert',
      typing: false,
      kinds: '',
      title: ' ',
      ripple: 600 + (f * 2600) / FRAMES.L2,
    })
  }
  if (look === 'L3') {
    // What the last search found stays, faded; a spinner at the top right
    // says new ones are coming, and they replace the list when they do.
    const rows = fadedList(p)
    const top = rows[0]
    if (top) {
      const cells = cellsOf(top)
      const at = N - HOME_MARGIN - 3
      const cell = cells[at]
      if (cell) Object.assign(cell, { ch: spin, fg: accent, b: true })
      rows[0] = runsOf(cells)
    }
    return rows
  }
  // L4: a light drifting across the drop area's top edge, as Working's bar
  // drifts; the faded list under it.
  const rows = fadedList(p)
  const W = N - HOME_MARGIN * 2
  const span = W + 20
  const head = ((f / FRAMES.L4) * span) | 0
  const edge: Run[] = []
  for (let c = 0; c < W; c++) {
    const d = Math.abs(c - (head - 10))
    const k = Math.max(0, 1 - d / 10)
    edge.push(run('▔', mix(p.selectionBg, accent, k), p.selectionBg))
  }
  rows[0] = [blank(HOME_MARGIN), ...edge]
  return rows
}

const LOADS: { id: LoadLook; name: string; idea: string; pick?: boolean }[] = [
  {
    id: 'L1',
    name: 'One spinner line',
    idea: 'The drop area empties to one line: the spinner in the mode’s colour and “Searching your Mac”, dim. The words are new: yes or no?',
  },
  {
    id: 'L2',
    name: 'The dots ripple',
    idea: 'No words: the drop area’s own dots ripple out from the middle, the motion home already has at rest, while it looks. Reads as the drop area working, not as a message.',
  },
  {
    id: 'L3',
    name: 'The last results stay, a spinner in the corner',
    idea: 'What the last letter found stays, all faded, none chosen; a spinner at the drop area’s top right says new results are coming, and they replace the list when they do. Nothing jumps while you type.',
    pick: true,
  },
  {
    id: 'L4',
    name: 'A light along the top edge',
    idea: 'L3’s faded list, with a soft light drifting along the drop area’s top edge in place of the spinner, as Working’s bar drifts. No glyph, no words.',
  },
]

const loadFigures = LOADS.map((l) => {
  const pair = [DARK, LIGHT]
    .map((base) => {
      const p = modePalette(base, 'convert')
      const frames = Array.from({ length: FRAMES[l.id] }, (_, f) =>
        firstScreen(p, loadingPanel(p, l.id, f), typingKeys(p)),
      )
      return `<div class="col"><div class="anim" data-ms="${FRAME_MS[l.id]}">${frames
        .map((g, i) => `<div class="fr"${i ? ' hidden' : ''}>${term(base, g)}</div>`)
        .join('')}</div><div class="cap">${base === DARK ? 'dark' : 'light'}</div></div>`
    })
    .join('')
  return figure(l.id, l.name, l.idea, `<div class="row">${pair}</div>`, l.pick)
}).join('')

const loadPage = `${page.slice(0, page.indexOf('<title>'))}<title>Forge · Searching</title>${page.slice(page.indexOf('</title>') + 8, page.indexOf('<h1>'))}<h1>While a name is searched</h1>
<p class="lede">Home at 80 × 24, dark and light, “rec” typed. Animated. A search usually answers in about a tenth of a second; as on the Working screen (W5), nothing shows unless it takes longer than 0.3 s.</p>

<div class="box"><h3>Open question</h3><ol>
<li><b>What shows while it looks?</b> L1 to L4 below, pick one. Only L1 adds words (“Searching your Mac”).</li></ol></div>

<h2>OPTIONS: searching</h2>
${loadFigures}
<script>
for (const a of document.querySelectorAll('.anim')) {
  const frames = [...a.querySelectorAll('.fr')]
  let i = 0
  setInterval(() => {
    frames[i].hidden = true
    i = (i + 1) % frames.length
    frames[i].hidden = false
  }, Number(a.dataset.ms))
}
</script>
</main></body></html>`
writeFileSync('mockups/searching-2026-10.html', loadPage)
console.log('wrote mockups/searching-2026-10.html')
