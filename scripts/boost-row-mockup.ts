/**
 * Boost resolution as one row (2026-10-12): the scale changes on the row with
 * ←→ instead of being two rows, 2× and 4×. Four ways to draw that row.
 *
 * The card and the picker's band are cells captured from the real app (the
 * throwaway test behind scripts/resize-mockup.ts wrote
 * /tmp/forge-resize/frames-{dark,light}.json); the bar and title come from
 * the app's own art functions. The row itself is composed here.
 *
 *   npx tsx scripts/boost-row-mockup.ts   → mockups/boost-row-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import { titleRow } from '../src/shell/quality-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80
const BAND = 52

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-resize/frames-${name}.json`, 'utf8')) as Record<
    string,
    Cell[][]
  >
const CAPTURED = { dark: frames('dark'), light: frames('light') }

const rowOf = (cells: Cell[]): Row => {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    const fg = c.fg ?? undefined
    const bg = c.bg ?? undefined
    if (last && last.fg === fg && last.bg === bg && !!last.bold === c.b) last.text += c.ch
    else out.push({ text: c.ch, fg, bg, bold: c.b })
  }
  return out
}

/** The captured card, with `from` written over as `to` (padded to the same width). */
function rewrite(cells: Cell[], from: string, to: string): Cell[] {
  const text = cells.map((c) => c.ch).join('')
  const i = text.indexOf(from)
  if (i < 0) return cells
  const out = cells.map((c) => ({ ...c }))
  const padded = to.padEnd(from.length)
  for (let k = 0; k < from.length; k++) (out[i + k] as Cell).ch = padded[k] as string
  return out
}

interface Source {
  name: string
  w: number
  h: number
  bytes: string
}
const BIG: Source = { name: 'IMG_2041.jpg', w: 4032, h: 3024, bytes: '71.7 KB' }
const SMALL: Source = { name: 'IMG_0412.jpg', w: 1200, h: 900, bytes: '210 KB' }

interface Look {
  p: Palette
  mode: string
  fg: string
  dim: string
  quiet: string
  sel: string
  pill: string
  keycap: string
  card: (s: Source) => Row[]
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  const f = CAPTURED[name]
  const p = modePalette(base, 'enhance')
  const picker = f[`${name}:enhance-picker`] as Cell[][]
  const typed = f[`${name}:size-typed`] as Cell[][]
  const unit = (typed[11] as Cell[]).find((c) => c.ch === 'K') as Cell
  const card = picker.slice(2, 6)
  return {
    p,
    mode: modeColours(p, 'enhance').fg,
    fg: p.fg,
    dim: p.dim,
    quiet: p.border,
    sel: (picker[9] as Cell[])[0]?.bg as string,
    pill: unit.bg as string,
    keycap: p.keycapBg,
    card: (s) =>
      card
        .map((r) => rewrite(r, BIG.name, s.name))
        .map((r) => rewrite(r, `${BIG.w}×${BIG.h} · ${BIG.bytes}`, `${s.w}×${s.h} · ${s.bytes}`))
        .map(rowOf),
  }
}

/* ------------------------------------------------------------ helpers */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]

function keys(
  L: Look,
  main: [string, string][],
  foot = '1–5 mode · esc back · ctrl-c quit',
): Row[] {
  const row: Row = [blank(1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${k} `, L.fg, L.keycap, true), run(` ${w}`, L.dim))
  })
  row.push(blank(Math.max(1, N - width(row) - stringWidth(foot) - 1)), run(foot, L.quiet))
  return [[run('─'.repeat(N), L.quiet)], row]
}

const LIMIT_SIDE = 16_384
const LIMIT_PX = 100_000_000
const fits = (s: Source, k: number) =>
  Math.max(s.w, s.h) * k <= LIMIT_SIDE && s.w * k * s.h * k <= LIMIT_PX
const SCALES = [2, 3, 4] as const
const dims = (s: Source, k: number) => `${s.w * k} × ${s.h * k}`

/* ---------------------------------------------------------- the row */

/** One way of drawing the Boost row's tail when it is highlighted. */
type BoostTail = (L: Look, s: Source, k: number, bg: string) => { tail: Run[]; right?: Run[] }

interface Item {
  label: string
  tail?: Run[]
  off?: string
}

/** The decided picker: band + ▌ on the chosen row, a row's detail only then. */
function picker(L: Look, items: Item[], chosen: number, right: Run[] = [], band = BAND): Row[] {
  const col = 2 + Math.max(...items.map((i) => stringWidth(i.label))) + 2
  return items.map((it, i) => {
    const on = i === chosen
    const bg = on ? L.sel : undefined
    const head: Row = [
      on ? run('▌', L.mode, bg) : blank(1),
      run(' ', undefined, bg),
      run(it.label, it.off ? L.dim : on ? L.fg : undefined, bg, on && !it.off),
    ]
    const tail = it.off ? [run(it.off, L.dim, bg)] : on ? (it.tail ?? []) : []
    const r = [...pad(head, col, bg), ...tail.map((x) => ({ ...x, bg: x.bg ?? bg }))]
    if (!on) return r
    if (!right.length) return pad(r, Math.max(band, width(r) + 1), bg)
    return [
      ...pad(r, band - width(right) - 1, bg),
      ...right.map((x) => ({ ...x, bg: x.bg ?? bg })),
      run(' ', undefined, bg),
    ]
  })
}

const bold = (L: Look, t: string) => run(t, L.fg, undefined, true)
const dimR = (L: Look, t: string) => run(t, L.dim)

function screen(L: Look, s: Source, body: Row[], keyRow: Row[], title = 'Enhance JPEG'): Row[] {
  return [
    trailBarRow({
      width: N,
      palette: L.p,
      mode: 'enhance',
      trail: { answers: [], current: 'Enhance' },
      slanted: false,
    }),
    [],
    ...L.card(s),
    [],
    titleRow({ palette: L.p, mode: 'enhance', title, width: N }),
    [],
    ...body,
    [],
    ...keyRow,
  ]
}

const SHARPEN = (L: Look, s: Source): Item => ({
  label: 'Sharpen',
  tail: [dimR(L, 'same size · '), bold(L, dims(s, 1))],
})
const CUTOUT = (L: Look): Item => ({
  label: 'Remove background',
  tail: [bold(L, 'transparent PNG')],
})

/** The proposed list: Sharpen · Boost resolution · Remove background, Boost highlighted at `k`. */
function boostScreen(L: Look, s: Source, k: number, draw: BoostTail): Row[] {
  const { tail, right } = draw(L, s, k, L.sel)
  const items = [SHARPEN(L, s), { label: 'Boost resolution', tail }, CUTOUT(L)]
  return screen(
    L,
    s,
    picker(L, items, 1, right),
    keys(L, [
      ['↑↓', 'choose'],
      ['←→', 'scale'],
      ['↵', 'confirm'],
    ]),
  )
}

const can = (s: Source, k: number, dir: -1 | 1) => {
  const i = SCALES.indexOf(k as 2 | 3 | 4) + dir
  const next = SCALES[i]
  return next !== undefined && fits(s, next)
}
/** A step arrow: violet and bold when ←→ can go that way, grey when not. */
const arrow = (L: Look, t: string, live: boolean, bg?: string) =>
  run(t, live ? L.mode : L.quiet, bg, live)
const atLimit = (s: Source, k: number) => SCALES.some((x) => x > k) && !can(s, k, 1)
const limitNote = (L: Look, s: Source, k: number): Run[] =>
  atLimit(s, k) ? [run(' · largest that fits', L.quiet)] : []

// B1 — ‹ 2× › right after the name, then the size.
const b1: BoostTail = (L, s, k) => ({
  tail: [
    arrow(L, '‹ ', can(s, k, -1)),
    bold(L, `${k}×`),
    arrow(L, ' ›', can(s, k, 1)),
    run('  '),
    bold(L, dims(s, k)),
    ...limitNote(L, s, k),
  ],
})

// B2 — every scale shown, the chosen one in Target size's unit pill.
const b2: BoostTail = (L, s, k) => {
  const tail: Run[] = []
  for (const x of SCALES) {
    if (x === k) tail.push(run(` ${x}× `, L.fg, L.pill, true))
    else tail.push(run(` ${x}× `, fits(s, x) ? L.dim : L.quiet))
  }
  tail.push(run('  '), bold(L, dims(s, k)))
  return { tail }
}

// B3 — the size where every row puts its detail; the scale a pill at the band's end.
const b3: BoostTail = (L, s, k) => ({
  tail: [bold(L, dims(s, k))],
  right: [
    arrow(L, ' ‹ ', can(s, k, -1), L.pill),
    run(`${k}×`, L.fg, L.pill, true),
    arrow(L, ' › ', can(s, k, 1), L.pill),
  ],
})

// B4 — the arrows around the size itself; the scale follows, dim.
const b4: BoostTail = (L, s, k) => ({
  tail: [
    arrow(L, '‹ ', can(s, k, -1)),
    bold(L, dims(s, k)),
    arrow(L, ' ›', can(s, k, 1)),
    dimR(L, `  ${k}×`),
    ...limitNote(L, s, k),
  ],
})

/** Every variant shows the same three moments. */
const moments = (draw: BoostTail) => (L: Look) => [
  boostScreen(L, SMALL, 2, draw),
  boostScreen(L, SMALL, 4, draw),
  boostScreen(L, BIG, 2, draw),
]

/** Today: four rows, Boost 2× highlighted, then the big photo. */
const today = (L: Look): Row[][] => {
  const rows = (s: Source): Item[] => [
    SHARPEN(L, s),
    { label: 'Boost resolution 2×', tail: [bold(L, dims(s, 2))] },
    fits(s, 4)
      ? { label: 'Boost resolution 4×', tail: [bold(L, dims(s, 4))] }
      : {
          label: 'Boost resolution 4×',
          off: `${Math.round((s.w * 4 * s.h * 4) / 1e6)} MP, over 100 MP`,
        },
    CUTOUT(L),
  ]
  const k = keys(L, [
    ['↑↓', 'choose'],
    ['↵', 'confirm'],
  ])
  return [
    screen(L, SMALL, picker(L, rows(SMALL), 1), k),
    screen(L, SMALL, picker(L, rows(SMALL), 2), k),
    screen(L, BIG, picker(L, rows(BIG), 1), k),
  ]
}

/* -------------------------------------- helpers: what each tool does */

type Tool = 'sharpen' | 'boost' | 'cutout' | 'trim' | 'resize'
/** E3's order: the AI tools, a gap, the plain tools (list order is still open). */
const TOOLS: Tool[] = ['sharpen', 'boost', 'cutout', 'trim', 'resize']
const GAP_AFTER = 2
const NAME: Record<Tool, string> = {
  sharpen: 'Sharpen',
  boost: 'Boost resolution',
  cutout: 'Remove background',
  trim: 'Trim edges',
  resize: 'Resize',
}
const TRIMMED = '1140 × 862'

/** A highlighted row's detail as B3 draws it; `words` adds what the tool does. */
function detail(L: Look, t: Tool, s: Source, words: boolean): { tail: Run[]; right?: Run[] } {
  const say = (plain: string, said: string) => (words ? said : plain)
  switch (t) {
    case 'sharpen':
      return { tail: [dimR(L, say('same size · ', 'crisper, same size · ')), bold(L, dims(s, 1))] }
    case 'boost': {
      const b = b3(L, s, 2, L.sel)
      return words ? { ...b, tail: [dimR(L, 'bigger, new detail · '), ...b.tail] } : b
    }
    case 'cutout':
      return { tail: [dimR(L, say('', 'subject kept · ')), bold(L, 'transparent PNG')] }
    case 'trim':
      return { tail: [dimR(L, say('empty edges off · ', 'borders off · ')), bold(L, TRIMMED)] }
    case 'resize':
      return words
        ? { tail: [dimR(L, 'no new detail · '), bold(L, 'any size')] }
        : { tail: [dimR(L, 'smaller or larger · '), bold(L, 'size next')] }
  }
}

/** H1's line: what the highlighted tool does, the short answer first. */
const LINE: Record<Tool, [string, string]> = {
  sharpen: ['Keeps the size.', ' An on-device model redraws soft or noisy detail.'],
  boost: ['Makes it bigger.', ' An on-device model draws in new detail.'],
  cutout: ['Keeps the subject.', ' Everything behind it becomes transparent.'],
  trim: ['Cuts off plain borders.', ' Nothing else changes.'],
  resize: ['Any size, no new detail.', ' Smaller stays sharp; larger looks softer.'],
}

function toolList(L: Look, s: Source, at: Tool, words = false, band = BAND): Row[] {
  const d = detail(L, at, s, words)
  const items: Item[] = TOOLS.map((t) => ({ label: NAME[t], tail: t === at ? d.tail : [] }))
  const rows = picker(L, items, TOOLS.indexOf(at), d.right, band)
  rows.splice(GAP_AFTER + 1, 0, [])
  return rows
}

const toolKeys = (L: Look, at: Tool, extra: [string, string][] = []) =>
  keys(L, [
    ['↑↓', 'choose'],
    ...(at === 'boost' ? ([['←→', 'scale']] as [string, string][]) : []),
    ['↵', 'confirm'],
    ...extra,
  ])

// H1 — one line under the list, about the highlighted row.
const h1Screen = (L: Look, at: Tool) =>
  screen(
    L,
    SMALL,
    [
      ...toolList(L, SMALL, at),
      [],
      [blank(1), run(LINE[at][0], L.fg, undefined, true), run(LINE[at][1], L.dim)],
    ],
    toolKeys(L, at),
  )

// H2 — the same words, inside the highlighted row's detail.
const h2Screen = (L: Look, at: Tool) =>
  screen(L, SMALL, toolList(L, SMALL, at, true, 64), toolKeys(L, at))

// H3 — a small before → after picture beside the list.
type Px = [number, number, number]
type Pic = Px[][]
const hex = ([r, g, b]: Px) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const FACE = (bg: string, face = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400">${
    bg === 'none' ? '' : `<rect width="100" height="100" fill="${bg}"/>`
  }${
    face
      ? '<circle cx="50" cy="50" r="40" fill="#f2c84b"/><circle cx="36" cy="40" r="7" fill="#262626"/><circle cx="64" cy="40" r="7" fill="#262626"/><path d="M30 60 Q50 80 70 60" stroke="#262626" stroke-width="8" fill="none" stroke-linecap="round"/>'
      : ''
  }</svg>`
async function raster(img: sharp.Sharp, n: number): Promise<Pic> {
  const { data, info } = await img
    .resize(n, n, { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const out: Pic = []
  for (let y = 0; y < info.height; y++) {
    const row: Px[] = []
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3
      row.push([data[i] as number, data[i + 1] as number, data[i + 2] as number])
    }
    out.push(row)
  }
  return out
}
const SKY = '#4f7cac'
const crisp = (n: number, bg = SKY) => raster(sharp(Buffer.from(FACE(bg))), n)
/** The photo as it came: small and a little soft. */
async function soft(n: number, sigma = 0.55): Promise<Pic> {
  const small = await sharp(Buffer.from(FACE(SKY)))
    .resize(n, n)
    .png()
    .toBuffer()
  return raster(sharp(small).blur(sigma), n)
}
/** The soft photo stretched to `n`, as Resize would. */
async function stretched(from: number, n: number): Promise<Pic> {
  const small = await sharp(Buffer.from(FACE(SKY)))
    .resize(from, from)
    .blur(0.55)
    .png()
    .toBuffer()
  return raster(sharp(small).resize(n, n, { kernel: 'cubic' }), n)
}
/** A picture inside a plain two-pixel border, the border Trim takes off. */
async function bordered(n: number): Promise<Pic> {
  const inner = await soft(n - 4)
  const plain: Px = [236, 236, 236]
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => inner[y - 2]?.[x - 2] ?? plain),
  )
}

/** Two pixel rows a cell: ▀ in the top's colour over the bottom's. */
const cells = (pic: Pic): Row[] => {
  const rows: Row[] = []
  for (let y = 0; y < pic.length; y += 2)
    rows.push(
      (pic[y] as Px[]).map((top, x) =>
        run('▀', hex(top), hex((pic[y + 1]?.[x] as Px | undefined) ?? top)),
      ),
    )
  return rows
}

/** Every picture is drawn 12 px square; the photo it stands for is 6 px, shown at 2×. */
const SEEN = 12
const zoom = (pic: Pic, f: number): Pic =>
  pic.flatMap((row) =>
    Array.from({ length: f }, () => row.flatMap((px) => Array.from({ length: f }, () => px))),
  )
const near = (a: Px, b: Px) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 90
const SKY_PX: Px = [0x4f, 0x7c, 0xac]
/** The sky swapped for a checkerboard, as a cutout would leave it. */
const unsky = (pic: Pic): Pic =>
  pic.map((row, y) =>
    row.map((px, x) =>
      near(px, SKY_PX)
        ? (Math.floor(x / 2) + Math.floor(y / 2)) % 2
          ? [205, 205, 205]
          : [150, 150, 150]
        : px,
    ),
  )
/** A small photo, shown blown up: its pixels as blocks. */
const BLOCKY = zoom(await soft(SEEN / 2), 2)
/** A photo the right size that is out of focus. */
const BLURRED = await soft(SEEN, 1)
const PICS: Record<Tool, [Pic, Pic]> = {
  sharpen: [BLURRED, await crisp(SEEN)],
  boost: [BLOCKY, await crisp(SEEN)],
  cutout: [BLURRED, unsky(BLURRED)],
  trim: [await bordered(SEEN), await soft(SEEN - 4)],
  resize: [BLOCKY, await stretched(SEEN / 2, SEEN)],
}

/** `row` cut to `n` columns. */
function cut(row: Row, n: number): Row {
  const out: Row = []
  let used = 0
  for (const r of row) {
    if (used >= n) break
    const chars = [...r.text]
    const take = chars.slice(0, n - used)
    out.push({ ...r, text: take.join('') })
    used += take.length
  }
  return out
}

/** Lays `pic` into `rows` with its bottom on `bottom`, from column `col`. */
function overlay(rows: Row[], pic: Row[], bottom: number, col: number): Row[] {
  const top = bottom - pic.length + 1
  return rows.map((r, i) => {
    const p = pic[i - top]
    if (!p) return r
    return [...pad(cut(r, col), col), ...p, ...tailFrom(r, col + width(p))]
  })
}

function h3Screen(L: Look, at: Tool): Row[] {
  const base = screen(L, SMALL, toolList(L, SMALL, at), toolKeys(L, at))
  const [before, after] = PICS[at].map(cells) as [Row[], Row[]]
  const listEnd = 9 + TOOLS.length // bar, card, title, list and its gap
  const afterCol = N - SEEN
  const beforeCol = afterCol - 3 - SEEN
  const arrowRow = listEnd - Math.floor((before.length - 1) / 2)
  let rows = overlay(base, after, listEnd, afterCol)
  rows = overlay(rows, before, listEnd, beforeCol)
  return rows.map((r, i) =>
    i === arrowRow
      ? [
          ...cut(r, beforeCol + SEEN),
          blank(1),
          run('→', L.quiet),
          blank(1),
          ...tailFrom(r, afterCol),
        ]
      : r,
  )
}
/** The runs of `row` from column `col` on. */
function tailFrom(row: Row, col: number): Row {
  const out: Row = []
  let used = 0
  for (const r of row) {
    const chars = [...r.text]
    const skip = Math.max(0, col - used)
    if (skip < chars.length) out.push({ ...r, text: chars.slice(skip).join('') })
    used += chars.length
  }
  return out
}

// H4 — ? swaps the list for a side-by-side of all five, any key returns.
const SHEET: Record<Tool, [string, string]> = {
  sharpen: ['same size', 'on-device model redraws detail'],
  boost: ['2× · 3× · 4×', 'on-device model draws new detail'],
  cutout: ['same size', 'only the subject is kept'],
  trim: ['smaller', 'plain borders cut off'],
  resize: ['5 – 200 %', 'no new detail'],
}
function sheet(L: Look): Row[] {
  const rows = TOOLS.map(
    (t): Row => [
      blank(2),
      ...pad([run(NAME[t], L.fg)], 19),
      ...pad([run(SHEET[t][0], L.fg, undefined, true)], 15),
      run(SHEET[t][1], L.dim),
    ],
  )
  rows.splice(GAP_AFTER + 1, 0, [])
  return rows
}
const h4 = (L: Look): Row[][] => [
  screen(
    L,
    SMALL,
    toolList(L, SMALL, 'sharpen'),
    toolKeys(L, 'sharpen', [['?', 'what each does']]),
  ),
  screen(
    L,
    SMALL,
    sheet(L),
    keys(L, [['any key', 'back to the list']], 'esc back · ctrl-c quit'),
    'What each one does',
  ),
]

const THREE: Tool[] = ['sharpen', 'boost', 'resize']
const helperFigs = (draw: (L: Look, at: Tool) => Row[]) => (L: Look) => THREE.map((t) => draw(L, t))

/* ------------------------------- round two: a split view, and H1 dressed */

/** Words wrapped to `w` columns. */
function wrap(text: string, w: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && stringWidth(`${line} ${word}`) > w) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

/** The pane's last line: what you get. */
const FACT = (L: Look, t: Tool, s: Source): Run[] => {
  switch (t) {
    case 'sharpen':
      return [dimR(L, 'same size · '), bold(L, dims(s, 1))]
    case 'boost':
      return [dimR(L, 'becomes '), bold(L, dims(s, 2))]
    case 'cutout':
      return [bold(L, 'transparent PNG')]
    case 'trim':
      return [dimR(L, 'becomes '), bold(L, TRIMMED)]
    case 'resize':
      return [dimR(L, 'you choose the size next')]
  }
}
const LONG: Record<Tool, string> = {
  sharpen: 'An on-device model redraws soft or noisy detail, so it looks crisper.',
  boost: 'An on-device model draws in new detail, so it stays sharp when you zoom in or print it.',
  cutout: 'Everything behind the subject becomes transparent.',
  trim: 'Plain borders come off. Nothing else in the picture changes.',
  resize: 'Smaller stays sharp; larger looks softer. Boost resolution adds detail.',
}

/** The right-hand pane for `t`, `h` rows tall, `w` wide. */
function pane(L: Look, t: Tool, s: Source, w: number, h: number): Row[] {
  const short = (LINE[t][0] as string).trim()
  const rows: Row[] = [
    [run(short, L.fg, undefined, true)],
    ...wrap(LONG[t], w).map((x) => [dimR(L, x)]),
  ]
  while (rows.length < h - 1) rows.push([])
  return [...rows.slice(0, h - 1), FACT(L, t, s)]
}

/** The list's side of the split: names only, Boost's scale pill at the band's end. */
const LEFT = 31
function leftList(L: Look, s: Source, at: Tool): Row[] {
  const right = at === 'boost' ? (b3(L, s, 2, L.sel).right ?? []) : []
  const items: Item[] = TOOLS.map((t) => ({ label: NAME[t] }))
  const rows = picker(L, items, TOOLS.indexOf(at), right, LEFT).map((r) => pad(r, LEFT))
  rows.splice(GAP_AFTER + 1, 0, pad([], LEFT))
  return rows
}

type Divider = 'line' | 'pointer'
function split(L: Look, at: Tool, divider: Divider, titled = false): Row[] {
  const s = SMALL
  const left = leftList(L, s, at)
  const chosen = TOOLS.indexOf(at) + (TOOLS.indexOf(at) > GAP_AFTER ? 1 : 0)
  const paneW = N - LEFT - 4
  const right = pane(L, at, s, paneW, left.length)
  const bar = (i: number): Run =>
    divider === 'pointer' && i === chosen ? run('┃', L.mode) : run('│', L.quiet)
  const body = left.map((r, i) => [...r, bar(i), blank(2), ...(right[i] ?? [])])
  if (!titled) return screen(L, s, body, toolKeys(L, at))
  // S3: the split starts at the title — the list's title left, the tool's name right.
  const base = screen(L, s, body, toolKeys(L, at))
  const title = pad(cut(base[7] as Row, LEFT), LEFT)
  base[7] = [...title, run('│', L.quiet), blank(2), run(NAME[at], L.mode, undefined, true)]
  base[8] = [blank(LEFT), run('│', L.quiet)]
  return base
}

const splitFigs =
  (d: Divider, titled = false) =>
  (L: Look) =>
    THREE.map((t) => split(L, t, d, titled))

/** H1's line, dressed five ways. */
type Dress = 'strip' | 'panel' | 'hatch' | 'rule' | 'pill'
function dressed(L: Look, at: Tool, how: Dress): Row[] {
  const [short, long] = LINE[at]
  const tint = modeColours(L.p, 'enhance').bg
  let help: Row[]
  switch (how) {
    case 'strip':
      help = [[run('▎', L.mode), blank(1), run(short, L.fg, undefined, true), run(long, L.dim)]]
      break
    case 'panel': {
      const line: Row = [blank(2), run(short, L.fg, tint, true), run(long, L.dim, tint)]
      help = [
        [run(' '.repeat(N), undefined, tint)],
        pad(
          line.map((x) => ({ ...x, bg: tint })),
          N,
          tint,
        ),
        [run(' '.repeat(N), undefined, tint)],
      ]
      break
    }
    case 'hatch':
      help = [
        [
          blank(1),
          run('╱╱', L.mode),
          blank(1),
          run(short, L.fg, undefined, true),
          run(long, L.dim),
        ],
      ]
      break
    case 'rule':
      help = [
        [
          blank(1),
          run(short, L.mode, undefined, true),
          blank(1),
          run('─'.repeat(N - 3 - stringWidth(short)), L.quiet),
        ],
        [blank(1), run(long.trim(), L.dim)],
      ]
      break
    case 'pill':
      help = [[blank(1), run(` ${short} `, L.mode, tint, true), run(long, L.dim)]]
      break
  }
  const gap: Row[] = how === 'panel' ? [] : [[]]
  return screen(L, SMALL, [...toolList(L, SMALL, at), ...gap, ...help], toolKeys(L, at))
}
const dressFigs = (how: Dress) => (L: Look) => THREE.map((t) => dressed(L, t, how))

const ROUND2_FIGS: Fig[] = [
  {
    id: 'S1',
    name: 'Split: a quiet line, the details on the right',
    picked: true,
    note: 'The list keeps only names (and Boost’s scale pill at the end of its band). A grey line splits the list from a pane that says what the highlighted tool does: the short answer in white, the why in grey, and what you get at the bottom, where the row’s size used to be.',
    draw: splitFigs('line'),
  },
  {
    id: 'S2',
    name: 'Split: the line points at the row',
    note: 'S1, with the divider drawn heavy and violet beside the highlighted row only, so the pane is visibly “about this one”. It moves with ↑↓, like the ▌ on the other side of the row.',
    draw: splitFigs('pointer'),
  },
  {
    id: 'S3',
    name: 'Split from the title down',
    note: 'The split starts at the title: “Enhance JPEG” over the list, the tool’s name in violet over the pane. Most structured; the name then appears twice (in the list and above the pane).',
    draw: splitFigs('line', true),
  },
  {
    id: 'D1',
    name: 'H1 · a violet edge',
    note: 'A thin violet edge in front of the line, the same violet as the selection’s ▌, so it reads as belonging to the highlighted row.',
    draw: dressFigs('strip'),
  },
  {
    id: 'D2',
    name: 'H1 · a tinted panel',
    note: 'The line sits in a full-width panel in Enhance’s tint, the way errors sit in their red tint (E5). Strongest; the tint is the mode’s own, not a new colour.',
    draw: dressFigs('panel'),
  },
  {
    id: 'D3',
    name: 'H1 · the hatch',
    note: 'Two violet ╱╱ in front, the hatching of the header bar and the home band. On-brand, small.',
    draw: dressFigs('hatch'),
  },
  {
    id: 'D4',
    name: 'H1 · a titled rule',
    note: 'The short answer in violet becomes a heading on a grey rule, the why underneath. Two lines; the rule separates it from the list.',
    draw: dressFigs('rule'),
  },
  {
    id: 'D5',
    name: 'H1 · the short answer in a pill',
    note: 'The short answer sits in a violet-tinted pill — the shape Save as uses for its default tag — and the why follows in grey. Stands out without a new line or a panel.',
    draw: dressFigs('pill'),
  },
]

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '█': 'f',
  '▌': 'h',
  '▎': 'q',
}

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  const body = rows
    .map((r) => {
      let out = ''
      let used = 0
      for (const x of r) {
        const style = [
          x.fg ? `color:${x.fg}` : '',
          x.bg ? `background:${x.bg}` : '',
          x.bold ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        let inner = ''
        for (const ch of x.text) inner += GLYPH[ch] ? `<i class="${GLYPH[ch]}"></i>` : esc(ch)
        out += style ? `<span style="${style}">${inner}</span>` : `<span>${inner}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  note: string
  pick?: boolean
  picked?: boolean
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = [DARK, LIGHT]
    .map((p) => {
      const L = lookOf(p)
      return `<div class="theme ${p.name}">${f
        .draw(L)
        .map((fr) => html(fr, L.p))
        .join('')}</div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.picked ? '<span class="pick">YOU PICKED</span>' : f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

const FIGS: Fig[] = [
  {
    id: 'B1',
    name: '‹ 2× › after the name',
    note: 'The scale sits where the row’s detail starts, between violet arrows, and the size follows. The arrows say “←→ works here” on the row itself, so the key row only confirms it. An arrow goes grey when there is nothing further that way; on the big photo 3× and 4× are too large, so › is grey and the row says “largest that fits”.',
    draw: moments(b1),
  },
  {
    id: 'B2',
    name: 'All scales, the chosen one in a pill',
    note: 'Target size’s unit pill: 2× 3× 4× are all on screen, ←→ moves the pill. Nothing to discover, every choice is visible. Scales that are too large are drawn grey and skipped; no words needed. The busiest of the four.',
    draw: moments(b2),
  },
  {
    id: 'B3',
    name: 'Size as the detail, scale pill at the band’s end',
    picked: true,
    note: 'The row reads like every other row (name, then what you get), and the scale is a pill at the far end of the band, like Save as’s default pill. Calmest reading; the pill is a little far from the name it belongs to, and on the big photo only its grey › says 3× and 4× are too large.',
    draw: moments(b3),
  },
  {
    id: 'B4',
    name: 'Arrows around the size',
    note: 'You are choosing how big the result is, so the arrows hold the size: ‹ 2400 × 1800 ›, with 2× after it, dim. Speaks in pixels first, which is what most people care about; the scale becomes the footnote.',
    draw: moments(b4),
  },
]

const HELP_FIGS: Fig[] = [
  {
    id: 'H1',
    name: 'One line under the list',
    pick: true,
    note: 'A single line under the list says what the highlighted tool does, the short answer first in white (“Keeps the size.” / “Makes it bigger.” / “Any size, no new detail.”), the why after it in grey. It changes as you move, so it only ever talks about the row you are on, and the rows themselves stay names. Nothing to learn, no new key.',
    draw: helperFigs(h1Screen),
  },
  {
    id: 'H2',
    name: 'The words inside the row',
    note: 'No new line: the highlighted row’s detail says it in three words before the size — “crisper, same size”, “bigger, new detail”, “no new detail”. Shortest, but the band grows to 64 columns, and three words cannot say <i>why</i> Resize looks softer.',
    draw: helperFigs(h2Screen),
  },
  {
    id: 'H3',
    name: 'A small before → after picture',
    note: 'Beside the list, a tiny picture of what the highlighted tool does in one glance: Sharpen turns <i>blur</i> into crisp at the same size; Boost turns <i>blocks</i> (a small photo blown up) into real detail; Resize turns the same blocks into blur. Boost and Resize start from the same picture, so the only thing that differs is the result. It shows the difference instead of telling it. The picture is the same drawing for every photo — a sign, not a preview — and it needs colour, so Apple Terminal with NO_COLOR would fall back to H1’s line.',
    draw: helperFigs(h3Screen),
  },
  {
    id: 'H4',
    name: '? opens a comparison',
    note: 'The list stays as it is; the key row adds <b>? what each does</b>, and ? swaps the list for all five side by side: what size you get, and what happens to the detail. Any key goes back. Complete and calm, but only for people who press ?.',
    draw: h4,
  },
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Enhance: Boost row and helpers</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:1000px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  section { display:none; margin-top:30px; } section.on { display:block; }
  .intro { color:#c7cbd4; max-width:1000px; }
  figure { margin:34px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; }
  .theme + .theme { margin-top:14px; }
  body.only-dark .theme.light, body.only-light .theme.dark { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  i.q { background:linear-gradient(to right, currentColor 25%, transparent 25%); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
</style></head>
<body class="only-dark"><main>
<h1>Enhance: Boost resolution as one row, and what each tool does</h1>
<p class="lede">The card and the band are captured from the app at 80 × 24; the rest is drawn with the app’s own colours. Switch dark and light at the right of the tab bar.</p>
<div class="tabs"><a data-t="r2" class="on">★ Split view · H1 dressed</a><a data-t="help">What each tool does · round one</a><a data-t="row">Boost row · B3 picked</a><span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
<section id="s-r2" class="on"><p class="intro">You picked <b>S1</b>, with “an on-device model” in place of “AI” (now in every variant). Two things you asked for. <b>S1–S3</b>: a vertical line to the right of the list splits the screen, and the details of the highlighted row move to the right of it. <b>D1–D5</b>: H1’s line, which you liked, with something to make it stand out. Same list as before (B3’s Boost row, then Trim and Resize after a gap), on a 1200 × 900 photo; each figure shows Sharpen, Boost resolution and Resize highlighted.</p>
${ROUND2_FIGS.map(figure).join('')}</section>
<section id="s-help"><p class="intro">Sharpen, Boost resolution and Resize all touch size and sharpness, so the list has to say how they differ. Four ways to say it. The list is the one it will be: <b>B3</b>’s Boost row (2× · 3× · 4×) and Resize and Trim added after a gap (E3 — that order is still open). Each figure shows Sharpen, Boost resolution and Resize highlighted, on a 1200 × 900 photo. Resize’s own screen already says, past 100 %, “stretched, so softer · Boost resolution adds detail”; that stays whichever of these you choose.</p>
${HELP_FIGS.map(figure).join('')}</section>
<section id="s-row"><p class="intro">You picked <b>B3</b>, with 3×. Each variant shows three moments: a 1200 × 900 photo at <b>2×</b> (where the row opens), the same photo after <b>→ →</b> at <b>4×</b>, and a 4032 × 3024 photo, where 3× and 4× are over the 100 MP limit so 2× is as far as it goes. In all four: the key row gains <b>←→ scale</b> only while Boost is highlighted; when Boost is not installed yet the row still says “15 MB download · ↵ installs” and the scale appears once it is; if even 2× is too large the whole row is dimmed with why, as today; ↵ answers the trail with “Boost resolution 2×”. <b>3×</b> is new: the runner can do it (its tiles divide evenly), it just has not been offered.</p>
${FIGS.map(figure).join('')}
<figure><div class="vt"><span class="id">Now</span><span class="name">Today, for comparison: two rows</span></div>${[
  DARK,
  LIGHT,
]
  .map((p) => {
    const L = lookOf(p)
    return `<div class="theme ${p.name}">${today(L)
      .map((fr) => html(fr, L.p))
      .join('')}</div>`
  })
  .join(
    '',
  )}<p class="idea">What the app draws now: Boost resolution 2× and 4× as rows of their own, 4× dimmed with its reason on the big photo.</p></figure></section>
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.className = r.value })
const th = new URLSearchParams(location.search).get('theme'); if (th) { const v = th === 'both' ? 'both' : 'only-' + th; document.body.className = v; const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
</script></body></html>`

const out = new URL('../mockups/boost-row-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
