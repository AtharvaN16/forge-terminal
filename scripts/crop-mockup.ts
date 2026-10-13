/**
 * Crop to shape (2026-10-13): a new Enhance row that cuts a photo to 1:1,
 * 4:5, 16:9 or 9:16, then a preview where the crop can be moved before Save as.
 * The row, and four ways to draw the preview.
 *
 * The card, the list, the key row and the slider screen are cells captured
 * from the real app at 80 × 24 (a throwaway test wrote
 * /tmp/forge-crop/frames-{dark,light}.json); the header bar is the app's own
 * art. The photo is drawn here (an SVG scene: a person to the right of
 * centre, a tree at the left), and where the crop starts is what Sharp's
 * attention strategy really picks on it.
 *
 *   npx tsx scripts/crop-mockup.ts   → mockups/crop-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import type { Row } from '../src/shell/home-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
type Grid = Cell[][]

const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-crop/frames-${name}.json`, 'utf8')) as Record<string, Grid>
const CAPTURED = { dark: frames('dark'), light: frames('light') }

const copy = (g: Grid): Grid => g.map((r) => r.map((c) => ({ ...c })))

/* ------------------------------------------------------------ colour */

const hex = (h: string): [number, number, number] => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
]
const toHex = (c: readonly number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
/** `a` moved `t` of the way to `b`. */
const mix = (a: string, b: string, t: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex(x.map((v, i) => v + ((y[i] as number) - v) * t))
}

/* -------------------------------------------------------------- look */

interface Look {
  name: 'dark' | 'light'
  p: Palette
  mode: string
  canvas: string
  fg: string
  dim: string
  quiet: string
  band: string
  chip: string
  accent: string
  f: Record<string, Grid>
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  const p = modePalette(base, 'enhance')
  return {
    name,
    p,
    mode: modeColours(p, 'enhance').fg,
    canvas: p.canvas,
    fg: p.fg,
    dim: p.dim,
    quiet: p.border,
    band: p.band,
    chip: p.folderChip,
    accent: p.accent,
    f: CAPTURED[name],
  }
}

/* ----------------------------------------------------------- drawing */

/** `text` written into row `y` from column `x`. */
function paint(
  g: Grid,
  y: number,
  x: number,
  text: string,
  fg: string | null,
  bg: string | null,
  b = false,
) {
  let k = x
  for (const ch of text) {
    const row = g[y] as Cell[]
    if (k >= N) break
    row[k] = { ch, fg, bg, b }
    k += 1
  }
  return k
}
/** Row `y` from `x` to `to` emptied onto `bg`. */
function clear(g: Grid, y: number, x = 0, to = N, bg: string | null = null) {
  for (let k = x; k < to; k++) (g[y] as Cell[])[k] = { ch: ' ', fg: null, bg, b: false }
}
const cellsOf = (row: Row, canvas: string): Cell[] => {
  const out: Cell[] = []
  for (const r of row)
    for (const ch of r.text) out.push({ ch, fg: r.fg ?? null, bg: r.bg ?? canvas, b: !!r.bold })
  while (out.length < N) out.push({ ch: ' ', fg: null, bg: canvas, b: false })
  return out.slice(0, N)
}

/** The header bar with `answers` then `current` in its trail. */
function bar(L: Look, g: Grid, answers: string[], current: string) {
  g[1] = cellsOf(
    trailBarRow({
      width: N,
      palette: L.p,
      mode: 'enhance',
      trail: { answers, current },
      slanted: false,
    }),
    L.canvas,
  )
}

/** The key row (last line): the keys, then the quiet tail at the right. */
function keys(L: Look, g: Grid, main: [string, string][], foot = '1–5 mode · esc back') {
  clear(g, 23, 0, N, L.canvas)
  let x = 4
  main.forEach(([k, w], i) => {
    if (i) x += 3
    x = paint(g, 23, x, k, L.fg, L.canvas, true)
    x = paint(g, 23, x + 2, w, L.dim, L.canvas)
  })
  paint(g, 23, N - 2 - stringWidth(foot), foot, L.quiet, L.canvas)
}

/* ------------------------------------------------------------- photo */

interface Photo {
  name: string
  w: number
  h: number
  bytes: string
  png: Buffer
}

/** A meadow with a tree at the left and a person right of centre, in a red jacket. */
async function scene(): Promise<Photo> {
  const w = 4032
  const h = 3024
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d93d6"/><stop offset="1" stop-color="#cfe3f5"/></linearGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7bb257"/><stop offset="1" stop-color="#3f7232"/></linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#sky)"/>
  <circle cx="70" cy="62" r="20" fill="#dbe9f6"/>
  <path d="M0 170 L60 120 L110 150 L170 105 L240 150 L300 118 L400 160 L400 300 L0 300Z" fill="#8aa2c4"/>
  <path d="M0 195 Q100 160 200 185 T400 178 L400 300 L0 300Z" fill="url(#grass)"/>
  <rect x="52" y="140" width="9" height="70" fill="#5a3d26"/>
  <circle cx="56" cy="128" r="34" fill="#2f5d2a"/>
  <circle cx="40" cy="146" r="22" fill="#356a2f"/>
  <circle cx="74" cy="144" r="24" fill="#2b5526"/>
  <rect x="268" y="196" width="10" height="64" rx="3" fill="#26324a"/>
  <rect x="283" y="196" width="10" height="64" rx="3" fill="#26324a"/>
  <rect x="262" y="132" width="38" height="72" rx="12" fill="#d8402c"/>
  <rect x="254" y="138" width="10" height="52" rx="5" fill="#c23a28"/>
  <rect x="298" y="138" width="10" height="52" rx="5" fill="#c23a28"/>
  <circle cx="281" cy="112" r="17" fill="#e2b48e"/>
  <path d="M264 108 Q281 86 298 108 Q290 98 281 99 Q272 98 264 108Z" fill="#3a2a20"/>
</svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  writeFileSync('/tmp/forge-crop/scene.png', png)
  return { name: 'IMG_2041.jpg', w, h, bytes: '71.7 KB', png }
}

interface Shape {
  label: string
  w: number
  h: number
}
const SHAPES: Shape[] = [
  { label: '1:1', w: 1, h: 1 },
  { label: '4:5', w: 4, h: 5 },
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 },
]

/** The largest box of `shape` inside the photo: nothing scaled, only cut. */
function boxSize(s: Photo, shape: Shape) {
  const byW = { w: s.w, h: Math.round((s.w * shape.h) / shape.w) }
  return byW.h <= s.h ? byW : { w: Math.round((s.h * shape.w) / shape.h), h: s.h }
}

/** Where Sharp's attention strategy puts that box: its left and top, in pixels. */
async function guess(s: Photo, shape: Shape) {
  const { w, h } = boxSize(s, shape)
  const { info } = await sharp(s.png)
    .resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
    .toBuffer({ resolveWithObject: true })
  return { left: -(info.cropOffsetLeft ?? 0), top: -(info.cropOffsetTop ?? 0), w, h }
}

/** The photo as `cols` × `rows` cells of half-blocks: dot colours, `rows * 2` high. */
async function dotsOf(s: Photo, cols: number, rows: number): Promise<string[][]> {
  const { data } = await sharp(s.png)
    .resize(cols, rows * 2, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const out: string[][] = []
  for (let y = 0; y < rows * 2; y++) {
    const line: string[] = []
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 3
      line.push(toHex([data[i] as number, data[i + 1] as number, data[i + 2] as number]))
    }
    out.push(line)
  }
  return out
}

/* ------------------------------------------------------- the picture */

/** The crop, in dots of the drawn picture. */
interface DotBox {
  x: number
  y: number
  w: number
  h: number
}

type Outside = 'dim' | 'lines' | 'hatch'

/**
 * The picture at (`top`, `left`), the dots outside `box` dimmed towards the
 * canvas. `lines` adds a mode-coloured edge just outside the box; `hatch`
 * draws the outside as ╱ over its dimmed colour instead of the picture.
 */
function picture(
  L: Look,
  g: Grid,
  dots: string[][],
  top: number,
  left: number,
  box: DotBox,
  outside: Outside,
) {
  const rows = dots.length / 2
  const cols = (dots[0] as string[]).length
  const inside = (x: number, y: number) =>
    x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
  const fade = L.name === 'dark' ? 0.72 : 0.7
  const shown = (x: number, y: number) => {
    const c = (dots[y] as string[])[x] as string
    return inside(x, y) ? c : mix(c, L.canvas, fade)
  }
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cols; x++) {
      const yt = r * 2
      const yb = yt + 1
      const out = !inside(x, yt) && !inside(x, yb)
      const line = g[top + r] as Cell[]
      if (outside === 'hatch' && out) {
        line[left + x] = {
          ch: '╱',
          fg: mix(shown(x, yt), L.quiet, 0.5),
          bg: mix(shown(x, yt), shown(x, yb), 0.5),
          b: false,
        }
        continue
      }
      line[left + x] = { ch: '▀', fg: shown(x, yt), bg: shown(x, yb), b: false }
    }
    if (outside === 'lines') {
      const onRow = box.y < r * 2 + 2 && box.y + box.h > r * 2
      if (onRow) {
        // A vertical edge on each side the box does not touch.
        if (box.x > 0) {
          const c = row(g, top + r)[left + box.x - 1] as Cell
          row(g, top + r)[left + box.x - 1] = { ch: '▕', fg: L.mode, bg: c.bg, b: false }
        }
        if (box.x + box.w < cols) {
          const c = row(g, top + r)[left + box.x + box.w] as Cell
          row(g, top + r)[left + box.x + box.w] = { ch: '▏', fg: L.mode, bg: c.bg, b: false }
        }
      }
    }
  }
  if (outside === 'lines') {
    // A horizontal edge above and below, where the box does not touch.
    const edge = (y: number, ch: string) => {
      if (y < 0 || y >= rows * 2) return
      const r = Math.floor(y / 2)
      for (let x = box.x; x < box.x + box.w; x++) {
        const c = row(g, top + r)[left + x] as Cell
        row(g, top + r)[left + x] = { ch, fg: L.mode, bg: c.bg, b: false }
      }
    }
    if (box.y > 0) edge(box.y - 1, '▁')
    if (box.y + box.h < rows * 2) edge(box.y + box.h, '▔')
  }
}
const row = (g: Grid, y: number) => g[y] as Cell[]

/* ---------------------------------------------------------- screens */

interface State {
  shape: Shape
  /** The crop in pixels. */
  px: { left: number; top: number; w: number; h: number }
  /** Still where the subject guess put it. */
  atGuess: boolean
}

const dims = (w: number, h: number) => `${w} × ${h}`
const grouped = (n: number) => n.toLocaleString('en-US')

/** What the crop keeps of the photo, as a share of its area. */
const cutLine = (s: Photo, st: State): string =>
  `keeps ${Math.round((st.px.w * st.px.h * 100) / (s.w * s.h))} % of the photo`

/** The arrows that can move it: one pair at the largest crop, all four once zoomed in. */
const moveKeys = (s: Photo, st: State): [string, string] =>
  st.px.w < s.w && st.px.h < s.h
    ? ['↑↓←→', 'move']
    : st.px.w < s.w
      ? ['←→', 'move']
      : ['↑↓', 'move']

/** The crop at `pct` % of the largest box for its shape, centred on `c`, kept inside the photo. */
function zoomed(s: Photo, shape: Shape, c: { x: number; y: number }, pct: number): State['px'] {
  const full = boxSize(s, shape)
  const w = Math.round((full.w * pct) / 100)
  const h = Math.round((full.h * pct) / 100)
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  return {
    left: clamp(Math.round(c.x - w / 2), s.w - w),
    top: clamp(Math.round(c.y - h / 2), s.h - h),
    w,
    h,
  }
}

/** The pixel box as dots of a `cols` × `rows`-cell picture. */
function dotBox(s: Photo, st: State, cols: number, rows: number): DotBox {
  const sx = cols / s.w
  const sy = (rows * 2) / s.h
  return {
    x: Math.round(st.px.left * sx),
    y: Math.round(st.px.top * sy),
    w: Math.round(st.px.w * sx),
    h: Math.round(st.px.h * sy),
  }
}

type Variant = 'P1' | 'P2' | 'P3' | 'P4'

/** The preview screen for a variant. */
async function preview(L: Look, s: Photo, st: State, v: Variant): Promise<Grid> {
  const g = copy(L.f[`${L.name}:resize`] as Grid)
  bar(L, g, ['Crop to shape'], st.shape.label)
  const big = v === 'P4'
  // Everything under the bar is redrawn; P4 drops the card for a bigger picture.
  for (let y = big ? 2 : 8; y < 22; y++) clear(g, y, 0, N, L.canvas)

  const titleY = big ? 3 : 8
  const title = `Crop to ${st.shape.label}`
  paint(g, titleY, 2, title, L.fg, L.canvas, true)
  // The card says the name and size; without it (P4) the title line does.
  if (big) {
    const right = `${s.name} · ${dims(s.w, s.h)}`
    paint(g, titleY, N - 2 - stringWidth(right), right, L.dim, L.canvas)
  }

  const top = titleY + 2
  const rows = 21 - top + 1
  const cols = Math.round((rows * 2 * s.w) / s.h)
  const dots = await dotsOf(s, cols, rows)
  const box = dotBox(s, st, cols, rows)
  picture(L, g, dots, top, 4, box, v === 'P2' ? 'lines' : v === 'P3' ? 'hatch' : 'dim')

  // The facts, right of the picture.
  const x = 4 + cols + 4
  const k = paint(g, top, x, dims(st.px.w, st.px.h), L.fg, L.canvas, true)
  paint(g, top, k, ` · ${st.shape.label}`, L.dim, L.canvas)
  paint(g, top + 1, x, cutLine(s, st), L.dim, L.canvas)

  // r puts the crop back on the guess; offered only once it has moved.
  keys(L, g, [
    moveKeys(s, st),
    ['+−', 'zoom'],
    ...(st.atGuess ? [] : [['r', 'reset'] as [string, string]]),
    ['↵', 'confirm'],
  ])
  return g
}

/** The picker with Crop to shape added after Resize, highlighted at `shape`. */
function picker(L: Look, s: Photo, shape: Shape, i: number): Grid {
  const g = copy(L.f[`${L.name}:picker-4`] as Grid)
  bar(L, g, [], 'Enhance')
  // Resize loses the highlight; Crop to shape takes it on the next row.
  const resize = row(g, 15)
  for (let x = 2; x < 38; x++) {
    const c = resize[x] as Cell
    resize[x] = {
      ...c,
      ch: x === 2 ? ' ' : c.ch,
      bg: L.canvas,
      b: false,
      fg: x === 2 ? null : c.fg === null ? null : L.fg,
    }
  }
  clear(g, 16, 0, N, L.canvas)
  for (let x = 2; x < 38; x++) row(g, 16)[x] = { ch: ' ', fg: null, bg: L.band, b: false }
  paint(g, 16, 2, '▌', L.mode, L.band)
  paint(g, 16, 4, 'Crop to shape', L.fg, L.band, true)
  // The pill at the band's far end, as Boost's: grey arrow where there is no step.
  const pill = ` ‹ ${shape.label} › `
  let x = 37 - stringWidth(pill)
  x = paint(g, 16, x, ' ‹ ', i > 0 ? L.accent : L.quiet, L.chip, i > 0)
  x = paint(g, 16, x, shape.label, L.fg, L.chip, true)
  paint(g, 16, x, ' › ', i < SHAPES.length - 1 ? L.accent : L.quiet, L.chip, i < SHAPES.length - 1)
  paint(g, 16, 38, '│', L.quiet, null)

  // The pane (S1): short answer, why, what you get.
  for (let y = 10; y <= 16; y++) clear(g, y, 39, N, L.canvas)
  paint(g, 10, 41, 'Changes the shape.', L.fg, L.canvas, true)
  paint(g, 11, 41, 'Cuts it to a new shape around the', L.dim, L.canvas)
  paint(g, 12, 41, 'subject. You see the crop next and', L.dim, L.canvas)
  paint(g, 13, 41, 'can move it.', L.dim, L.canvas)
  const b = boxSize(s, shape)
  const k = paint(g, 15, 41, 'becomes ', L.dim, L.canvas)
  paint(g, 15, k, dims(b.w, b.h), L.fg, L.canvas, true)
  // The line beside the list runs down to the new row.
  for (let y = 10; y <= 16; y++) paint(g, y, 38, '│', L.quiet, null)

  keys(L, g, [
    ['↑↓', 'choose'],
    ['←→', 'shape'],
    ['↵', 'confirm'],
  ])
  return g
}

/* ------------------------------------------------------------- render */

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '█': 'f',
  '▌': 'h',
  '▕': 're',
  '▏': 'le',
  '▁': 'be',
  '▔': 'te',
  '\u{e0ba}': 'si',
  '\u{e0bc}': 'so',
}

function html(g: Grid, canvas: string): string {
  const styleOf = (c: Cell) =>
    [c.fg ? `color:${c.fg}` : '', c.bg ? `background:${c.bg}` : '', c.b ? 'font-weight:700' : '']
      .filter(Boolean)
      .join(';')
  const body = g
    .map((r) => {
      // Cells that share a style share one span.
      let out = ''
      let style: string | undefined
      let inner = ''
      const flush = () => {
        if (style !== undefined) out += `<span${style ? ` style="${style}"` : ''}>${inner}</span>`
      }
      for (const c of r) {
        const st = styleOf(c)
        if (st !== style) {
          flush()
          style = st
          inner = ''
        }
        inner += GLYPH[c.ch] ? `<i class="${GLYPH[c.ch]}"></i>` : esc(c.ch)
      }
      flush()
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${canvas}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  note: string
  pick?: boolean
  picked?: boolean
  draw: (L: Look) => Promise<Grid[]>
}
async function figure(f: Fig): Promise<string> {
  const themes: string[] = []
  for (const p of [DARK, LIGHT]) {
    const L = lookOf(p)
    const grids = await f.draw(L)
    themes.push(
      `<div class="theme ${L.name}">${grids.map((gr) => html(gr, L.canvas)).join('')}</div>`,
    )
  }
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.picked ? '<span class="pick">PICKED</span>' : f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes.join('')}<p class="idea">${f.note}</p></figure>`
}

/* -------------------------------------------------------------- page */

const PHOTO = await scene()
const GUESS = await Promise.all(SHAPES.map((sh) => guess(PHOTO, sh)))
const SQUARE = SHAPES[0] as Shape
const WIDE = SHAPES[2] as Shape
const sq = GUESS[0] as State['px']
const wide = GUESS[2] as State['px']
const STEP = PHOTO.w / 32
console.log(
  'attention picks',
  SHAPES.map((sh, i) => `${sh.label} ${JSON.stringify(GUESS[i])}`).join('\n'),
)

/** Three moments of the square crop: at the guess, moved left, at the left edge. */
const squareMoments = (): State[] => [
  { shape: SQUARE, px: sq, atGuess: true },
  {
    shape: SQUARE,
    px: { ...sq, left: Math.max(0, sq.left - Math.round(STEP * 4)) },
    atGuess: false,
  },
  { shape: SQUARE, px: { ...sq, left: 0 }, atGuess: false },
]
const variant = (v: Variant) => async (L: Look) =>
  Promise.all(squareMoments().map((st) => preview(L, PHOTO, st, v)))

interface Tab {
  id: string
  title: string
  intro: string
  figs: Fig[]
}

const TABS: Tab[] = [
  {
    id: 'preview',
    title: '★ 1 · The preview',
    intro: `After ↵ on <b>Crop to shape ‹ 1:1 ›</b>, a screen shows where the crop falls, before Save as. It opens where Sharp’s attention strategy puts it (on this photo it found the person: left ${grouped(sq.left)} px), and ←→ moves it one step — 1/32 of the width. At its largest a crop spans the whole width or the whole height, so one pair of arrows moves it; <b>+ −</b> zoom (tab 4) frees all four. The picture is half-blocks, so it works in every terminal and moves instantly. Once the crop has moved, <b>r reset</b> joins the key row and puts it back on the guess. Each figure: at the guess, moved four steps left, at the left edge.`,
    figs: [
      {
        id: 'P3',
        name: 'Outside hatched',
        picked: true,
        note: 'Picked. What is cut is drawn as ╱ over its own faded colour — the hatch Forge already uses for what goes away (Replace, a file that grows). Loudest; you no longer see the detail you lose.',
        draw: variant('P3'),
      },
      {
        id: 'P1',
        name: 'Outside dimmed',
        note: 'What is cut is the same picture, faded towards the background. Quiet, and the photo stays whole, so you can see what you lose. The size and what is cut sit to the right.',
        draw: variant('P1'),
      },
      {
        id: 'P2',
        name: 'Dimmed, with violet edges',
        note: 'P1 plus a thin line in the mode colour just outside the crop. The edge is exact even where the photo is dark, at the cost of one column of the faded part.',
        draw: variant('P2'),
      },
      {
        id: 'P4',
        name: 'Bigger picture, no card',
        note: 'P1 without the file card: the title moves up and the picture gets ~19 rows instead of 12, so the person is easier to place. The name and size move to the title line.',
        draw: variant('P4'),
      },
    ],
  },
  {
    id: 'row',
    title: '2 · The row',
    intro:
      'Crop to shape is one row after Resize, in the built-in group. Highlighted, it gets Boost’s pill at the band’s far end: ←→ steps <b>1:1 · 4:5 · 16:9 · 9:16</b>, the arrow grey where there is no step. The pane says what the shape becomes. A shape the photo already has is left out of the pill.',
    figs: [
      {
        id: 'R',
        name: 'Crop to shape, stepped through its four shapes',
        note: 'The pane’s last line is the size you get: nothing is scaled, so every kept pixel is the original one.',
        draw: async (L) => SHAPES.map((sh, i) => picker(L, PHOTO, sh, i)),
      },
    ],
  },
  {
    id: 'wide',
    title: '3 · Wider than the photo',
    intro:
      '16:9 is wider than this 4:3 photo, so the crop spans the whole width and <b>↑↓</b> moves it instead; the key row says so. Drawn in P3.',
    figs: [
      {
        id: 'W',
        name: '16:9 on a 4:3 photo',
        note: 'At the guess, moved up, at the bottom edge.',
        draw: async (L) =>
          Promise.all(
            [
              { shape: WIDE, px: wide, atGuess: true },
              {
                shape: WIDE,
                px: { ...wide, top: Math.max(0, wide.top - Math.round((PHOTO.h / 24) * 3)) },
                atGuess: false,
              },
              { shape: WIDE, px: { ...wide, top: PHOTO.h - wide.h }, atGuess: false },
            ].map((st) => preview(L, PHOTO, st, 'P3')),
          ),
      },
    ],
  },
  {
    id: 'zoom',
    title: '4 · Zoom',
    intro:
      '<b>+</b> zooms in: the crop gets smaller around its own centre, 10 % of the largest crop a step, down to 20 %. <b>−</b> zooms back out to the largest. Zoomed in, the crop no longer spans a whole side, so <b>all four arrows</b> move it. The second line says how much of the photo is kept. <b>r</b> undoes zoom and moves together, back to the guess. Drawn in P3.',
    figs: [
      {
        id: 'Z',
        name: 'Zooming in on the person',
        note: 'At the guess (the largest square) · + three times (70 %) · moved up and right onto the person · + three more (40 %), head and shoulders. Every kept pixel is still the photo’s own: a tighter crop is a smaller file, not a blurrier one.',
        draw: async (L) => {
          const c = { x: sq.left + sq.w / 2, y: sq.top + sq.h / 2 }
          const face = { x: 2833, y: 1290 }
          return Promise.all(
            [
              { shape: SQUARE, px: sq, atGuess: true },
              { shape: SQUARE, px: zoomed(PHOTO, SQUARE, c, 70), atGuess: false },
              {
                shape: SQUARE,
                px: zoomed(PHOTO, SQUARE, { x: 2772, y: 1260 }, 70),
                atGuess: false,
              },
              { shape: SQUARE, px: zoomed(PHOTO, SQUARE, face, 40), atGuess: false },
            ].map((st) => preview(L, PHOTO, st, 'P3')),
          )
        },
      },
    ],
  },
]

const sections = await Promise.all(
  TABS.map(
    async (t, i) =>
      `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}><p class="intro">${t.intro}</p>${(await Promise.all(t.figs.map(figure))).join('')}</section>`,
  ),
)

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Crop to shape</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:900px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
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
  i.re { background:linear-gradient(to right, transparent 80%, currentColor 80%); }
  i.le { background:linear-gradient(to right, currentColor 20%, transparent 20%); }
  i.be { background:linear-gradient(transparent 85%, currentColor 85%); }
  i.te { background:linear-gradient(currentColor 15%, transparent 15%); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
</style></head>
<body class="only-dark"><main>
<h1>Crop to shape</h1>
<p class="lede">A new Enhance row, and the preview it opens. Card, list and key row are captured from the app as it is today at 80 × 24; switch dark and light at the right of the tab bar. The photo is a drawn test scene.</p>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${sections.join('\n')}
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

const out = new URL('../mockups/crop-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
