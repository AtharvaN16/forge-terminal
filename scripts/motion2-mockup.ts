/**
 * Motion, round two (2026-10-12): the animations proposed for the round-5 UI,
 * M1–M8, each drawn frame by frame from the app's own art functions at
 * 80 × 24 and played back at the rate a terminal redraws (33 ms a frame).
 *
 * Every frame is cells: a glyph, a colour, a fill. An animation here is only
 * ever a change of those — what Ink can draw. Turning motion off plays the
 * same timeline with every change cut, which is what NO_COLOR, a pipe, the
 * first-run palette and the tests see.
 *
 * Nothing in src/ knows about these. The old page, built on the old UI, is
 * mockups/motion-2026-10.html.
 *
 *   npx tsx scripts/motion2-mockup.ts   → mockups/motion-2-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { SPINNER_FRAMES } from '../src/cli/spinner.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import {
  fieldRows,
  fieldValue,
  paletteBody,
  paletteColumn,
  photoRows,
} from '../src/shell/colour/colour-art.js'
import { type DoneFacts, doneBody, doneLayout, receiptBars } from '../src/shell/done-art.js'
import {
  blank,
  brandRows,
  HOME_MARGIN as M,
  MODE_KINDS,
  mix,
  type Row,
  type Run,
  stagedCardRows,
  stagedListRows,
  surfaceRows,
  tabRows,
  width,
} from '../src/shell/home-art.js'
import { titleRow } from '../src/shell/quality-art.js'
import {
  fieldRow,
  folderRow,
  label,
  NAME_WIDTH,
  pathRow,
  ruleRow,
  underlineRow,
} from '../src/shell/save-as-art.js'
import {
  DARK,
  MODE_KEYS,
  modeColours,
  modePalette,
  type Palette,
  type ShellMode,
} from '../src/shell/theme.js'
import { workLine } from '../src/shell/working-art.js'

const N = 80
const H = 24
const FRAME = 33
const P = DARK

/* ------------------------------------------------------------- cells */

interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}
type Screen = Cell[][]

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })

function explode(row: Row): Cell[] {
  const out: Cell[] = []
  for (const r of row)
    for (const ch of r.text)
      out.push({ ch, fg: r.fg || undefined, bg: r.bg || undefined, bold: r.bold })
  while (out.length < N) out.push({ ch: ' ' })
  if (out.length > N) console.warn('row too wide:', out.map((c) => c.ch).join(''))
  return out.slice(0, N)
}
const screenOf = (rows: Row[]): Screen => {
  const s = rows.slice(0, H).map(explode)
  while (s.length < H) s.push(explode([]))
  return s
}

/** The colour a cell shows: a space shows only its fill. */
const bgOf = (c: Cell) => c.bg ?? P.canvas
const inkOf = (c: Cell) => (c.ch === ' ' ? bgOf(c) : (c.fg ?? P.fg))

/** `a` moved `k` of the way to `b`: colours blend, a glyph swaps where it has to. */
function blend(a: Cell, b: Cell, k: number): Cell {
  if (k <= 0) return a
  if (k >= 1) return b
  const ch = a.ch === ' ' ? b.ch : b.ch === ' ' ? a.ch : k < 0.5 ? a.ch : b.ch
  return {
    ch,
    fg: mix(inkOf(a), inkOf(b), k),
    bg: mix(bgOf(a), bgOf(b), k),
    bold: k < 0.5 ? a.bold : b.bold,
  }
}
const blendScreens = (a: Screen, b: Screen, k: number): Screen =>
  a.map((row, r) => row.map((c, x) => blend(c, b[r]?.[x] ?? c, k)))

/** `b` swept in over `a` from the left, its front at `front` columns with a soft edge. */
const wipeRow = (a: Cell[], b: Cell[], front: number, soft = 6): Cell[] =>
  a.map((c, x) => blend(c, b[x] ?? c, Math.max(0, Math.min(1, (front - x) / soft))))

const clamp = (k: number) => Math.max(0, Math.min(1, k))
const easeOut = (k: number) => 1 - (1 - clamp(k)) ** 3
const easeInOut = (k: number) => {
  const t = clamp(k)
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/* ---------------------------------------------------------- screens */

const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  { text: ' '.repeat(Math.max(0, n - width(row))), bg },
]
const frame = (top: Row[], bottom: Row[] = []): Row[] => {
  const out = top.slice(0, H - bottom.length)
  while (out.length < H - bottom.length) out.push([])
  return [...out, ...bottom]
}

type Keys = [string, string][]
/** The rule and the F1 key row, as `HintBar` draws them; `lit` recolours one keycap. */
function keys(
  p: Palette,
  main: Keys,
  foot: Keys,
  lit?: { key: string; fg: string; bg: string; word?: string },
): Row[] {
  const row: Row = [blank(M + 1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    const on = lit?.key === k
    row.push(
      run(` ${k} `, on ? lit.fg : p.fg, on ? lit.bg : p.keycapBg, true),
      run(` ${w}`, on && lit.word ? lit.word : p.dim),
    )
  })
  const note = foot.map(([k, w]) => (w ? `${k} ${w}` : k)).join(' · ')
  row.push(blank(Math.max(1, N - width(row) - stringWidth(note) - 1)), run(note, p.border))
  return [[run('─'.repeat(N), p.border)], row]
}

const bar = (
  p: Palette,
  mode: ShellMode,
  answers: string[],
  current: string | undefined,
  drift?: number,
) => trailBarRow({ width: N, palette: p, mode, trail: { answers, current }, slanted: true, drift })

/** Home's field on its recessed shelf (P2), the caret on the hint's first letter. */
function shelf(p: Palette, mode: ShellMode, hint: string): Row[] {
  const bg = p.shelf
  const line = (r: Row): Row => [blank(M), ...pad(r, N - 2 * M, bg)]
  return [
    line([]),
    line([
      run('  ', undefined, bg),
      run('›', modeColours(p, mode).fg, bg, true),
      run(' ', undefined, bg),
      run(hint.slice(0, 1), p.canvas, p.dim),
      run(hint.slice(1), p.border, bg),
    ]),
    line([]),
  ]
}

const SURFACE = 8
/** The brand's rows and the surface's rows in a home frame, for the sweeps. */
const BRAND_AT = [1, 2, 3]
const SURFACE_AT = Array.from({ length: SURFACE }, (_, i) => 7 + i)

function home(p: Palette, mode: ShellMode, panel?: Row[], staged = false): Row[] {
  const tabs = tabRows({ width: N, palette: p, mode, savesTo: '~/Desktop' })
  const surface =
    panel ??
    surfaceRows({
      width: N,
      rows: SURFACE,
      palette: p,
      mode,
      typing: false,
      kinds: MODE_KINDS[mode],
    })
  return frame(
    [
      [],
      ...brandRows({ width: N, palette: p, mode }),
      [],
      ...tabs,
      ...surface,
      ...shelf(p, mode, staged ? 'drop more, or type a path' : 'or type a path'),
    ],
    staged
      ? keys(
          p,
          [['↵', 'convert']],
          [
            [MODE_KEYS, 'mode'],
            ['esc', 'clear'],
            ['ctrl-n', 'new'],
            ['ctrl-c', 'quit'],
          ],
        )
      : keys(
          p,
          [['↵', 'send']],
          [
            [MODE_KEYS, 'mode'],
            ['esc', 'clear'],
            ['ctrl-n', 'new'],
            ['ctrl-c', 'quit'],
          ],
        ),
  )
}

/* ------------------------------------------------------------ timelines */

/** A state a demo holds from `at` ms, reached from the one before it by `how`. */
interface Step {
  at: number
  screen: Screen
  ms?: number
  how?: 'blend' | 'wipe' | 'cut'
  /** Rows the wipe sweeps; the rest blend. */
  sweep?: number[]
}

/** Steps played as a timeline: a change takes `ms` with motion, nothing without. */
function stepper(steps: Step[]) {
  return (t: number, motion: boolean): Screen => {
    let i = 0
    while (i + 1 < steps.length && (steps[i + 1]?.at ?? Infinity) <= t) i++
    const cur = steps[i] as Step
    const prev = steps[i - 1]
    const ms = cur.ms ?? 0
    if (!motion || !prev || ms === 0 || cur.how === 'cut' || t - cur.at >= ms) return cur.screen
    const k = easeOut((t - cur.at) / ms)
    if (cur.how === 'wipe') {
      const sweep = new Set(cur.sweep ?? [])
      return prev.screen.map((row, r) =>
        sweep.has(r)
          ? wipeRow(row, cur.screen[r] ?? row, k * (N + 6))
          : row.map((c, x) => blend(c, cur.screen[r]?.[x] ?? c, k)),
      )
    }
    return blendScreens(prev.screen, cur.screen, k)
  }
}

/* --------------------------------------------------------------- M1 */

// The loop's last step comes back to convert, so the first frame follows on.
const M1_ORDER: ShellMode[] = ['convert', 'compress', 'pdf', 'enhance', 'convert']
const m1Steps = (how: 'wipe' | 'blend', ms: number) =>
  stepper(
    M1_ORDER.map((mode, i) => ({
      at: i === 0 ? 0 : i * 1300 - 500,
      screen: screenOf(home(P, mode)),
      ms: i === 0 ? 0 : ms,
      how,
      sweep: [...BRAND_AT, ...SURFACE_AT],
    })),
  )

/* --------------------------------------------------------------- M2 */

const PHOTO = {
  name: 'Id card.png',
  tag: 'PNG',
  size: '1.9 MB',
  facts: '2480×1748 · 1.9 MB · transparent',
}
const SECOND = { name: 'Passport scan.png', tag: 'PNG', size: '2.4 MB', facts: '' }
const cardHome = () =>
  home(
    P,
    'convert',
    stagedCardRows({ width: N, rows: SURFACE, palette: P, mode: 'convert', file: PHOTO }),
    true,
  )
const listHome = (fresh: number) =>
  home(
    P,
    'convert',
    stagedListRows({
      width: N,
      rows: SURFACE,
      palette: P,
      mode: 'convert',
      view: { files: [PHOTO, SECOND], headline: '2 images', total: '4.3 MB', fresh },
    }),
    true,
  )

/** The dots of a surface lit by `k(x, r)`: 0 is as they rest, 1 the mode's colour at full. */
function lightDots(s: Screen, k: (x: number, r: number) => number): Screen {
  const accent = modeColours(P, 'convert').fg
  return s.map((row, r) =>
    SURFACE_AT.includes(r)
      ? row.map((c, x) => {
          const v = clamp(k(x, r - (SURFACE_AT[0] as number)))
          return c.ch === '·' && v > 0
            ? { ...c, fg: mix(c.fg ?? P.fg, accent, v), bold: v > 0.5 }
            : c
        })
      : row,
  )
}

function m2(kind: 'ripple' | 'flash') {
  const rest = screenOf(home(P, 'convert'))
  const card = screenOf(cardHome())
  const list = screenOf(listHome(1))
  const listCold = screenOf(listHome(0))
  const DROP = 900
  const SECOND_AT = 2900
  const cx = N / 2
  const cy = (SURFACE - 1) / 2
  return (t: number, motion: boolean): Screen => {
    if (t < DROP) return rest
    if (t < SECOND_AT) {
      if (!motion) return card
      const e = t - DROP
      if (kind === 'ripple') {
        if (e > 520) return card
        const R = (e / 520) * 46
        const fade = 1 - e / 520
        return lightDots(card, (x, r) => {
          const d = Math.hypot(x - cx, (r - cy) * 3.2)
          return Math.exp(-(((d - R) / 4) ** 2)) * fade
        })
      }
      if (e > 420) return card
      const v = e < 60 ? e / 60 : 1 - (e - 60) / 360
      return lightDots(card, () => v * 0.9)
    }
    // The second drop: the list, its new row on the band for FRESH_MS (built).
    if (!motion) return listCold
    return t - SECOND_AT < 1200 ? list : listCold
  }
}

/* --------------------------------------------------------------- M3 */

const FOLDERS = [
  { label: 'Same folder', path: '~/Desktop' },
  { label: 'Downloads', path: '~/Downloads' },
  { label: 'New subfolder', path: '~/Desktop/Id card' },
]
const FW = 76

/** Save as (V10c) as SaveAs.tsx lays it out, from save-as-art's rows. */
function saveAs(sel: number, def: number, dropped: boolean, flash = 0): Row[] {
  const p = modePalette(P, 'convert')
  const at = (r: Row): Row => [blank(M), ...r]
  const tint = modeColours(p, 'convert').bg
  const onPath = dropped
  const nameRow = fieldRow({
    palette: p,
    width: FW,
    runs: [
      label(p, 'name'),
      run(' Id card', p.fg, tint, true),
      ...(onPath ? [run(' ', undefined, tint)] : [run(' ', undefined, p.fg)]),
      run(' '.repeat(NAME_WIDTH - 9), undefined, tint),
      run(' .webp', p.border),
    ],
  })
  const folders = FOLDERS.map((f, i) =>
    folderRow({
      palette: p,
      width: FW,
      first: i === 0,
      label: f.label,
      path: f.path,
      selected: !onPath && i === sel,
      isDefault: i === def,
    }),
  )
  let path = pathRow({
    palette: p,
    width: FW,
    line: dropped
      ? { kind: 'place', label: 'Scans', path: '~/Documents/Scans', highlighted: true }
      : { kind: 'rest' },
  })
  if (flash > 0) {
    const lit = mix(p.fieldBand, p.accent, 0.55 * flash)
    path = path.map((x, i) => (i > 0 && x.bg === p.fieldBand ? { ...x, bg: lit } : x))
  }
  const blankRow = fieldRow({ palette: p, width: FW })
  const main: Keys = [
    ['↵', 'save'],
    ['↑↓', 'folder'],
    ['tab', 'make default'],
  ]
  return frame(
    [
      bar(P, 'convert', ['WebP', '80'], 'Save as'),
      [],
      titleRow({ palette: P, mode: 'convert', title: 'Save as', width: N }),
      [],
      ...[
        blankRow,
        nameRow,
        underlineRow({ palette: p, width: FW }),
        ruleRow({ palette: p, width: FW }),
        blankRow,
        ...folders,
        path,
        blankRow,
      ].map(at),
    ],
    keys(P, main, [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ]),
  )
}

function m3() {
  const DROP = 3000
  const glide = stepper([
    { at: 0, screen: screenOf(saveAs(0, 0, false)) },
    { at: 800, screen: screenOf(saveAs(1, 0, false)), ms: 140 },
    { at: 1500, screen: screenOf(saveAs(2, 0, false)), ms: 140 },
    { at: 2200, screen: screenOf(saveAs(2, 2, false)), ms: 150 },
    { at: DROP, screen: screenOf(saveAs(2, 2, true)), ms: 140 },
  ])
  return (t: number, motion: boolean): Screen => {
    if (!motion || t < DROP) return glide(t, motion)
    const e = t - DROP
    if (e > 450) return glide(t, motion)
    // The row lights as the drop lands and fades back to the band over 450 ms.
    return screenOf(saveAs(2, 2, true, 1 - easeOut(e / 450)))
  }
}

/* --------------------------------------------------------------- M4 */

const TRAIL: Array<[string[], string | undefined]> = [
  [[], undefined],
  [[], 'Convert to'],
  [['WebP'], 'Quality'],
  [['WebP', '80'], 'Save as'],
  [['WebP', '80', 'Desktop', 'Id card.webp'], 'Done'],
]

/** How long each M4 version takes, in ms. */
const M4_MS = { fade: 250, slide: 220, tint: 650, none: 0 }

/** The bar alone, as the steps answer it: the newest word arriving by `how`. */
function m4(how: keyof typeof M4_MS) {
  const STEP = 1300
  // A bar of nothing but hatching: the cells the trail slides over.
  const bare = explode(bar(P, 'convert', [], undefined))
  const tint = mix(P.canvas, modeColours(P, 'convert').fg, 0.4)
  return (t: number, motion: boolean): Screen => {
    const i = Math.min(TRAIL.length - 1, Math.floor(t / STEP))
    const [answers, current] = TRAIL[i] as [string[], string | undefined]
    const s = screenOf([[], bar(P, 'convert', answers, current)])
    const e = t - i * STEP
    const ms = M4_MS[how]
    if (!motion || i === 0 || ms === 0 || e >= ms) return s
    const k = easeOut(e / ms)
    // The question on screen is the bold run, a knocked-out cell either side: what arrived.
    const row = s[1] as Cell[]
    const xs = row.flatMap((c, x) => (c.bold && c.ch !== ' ' && x > 14 ? [x] : []))
    const first = Math.min(...xs) - 1
    const last = Math.max(...xs) + 1
    if (how === 'fade') {
      s[1] = row.map((c, x) =>
        x < first || x > last ? c : { ...c, fg: mix(P.canvas, c.fg ?? P.fg, k) },
      )
      return s
    }
    if (how === 'tint') {
      // The word lands on the mode's tint, which drains back into the bar.
      s[1] = row.map((c, x) => (x < first || x > last ? c : { ...c, bg: mix(tint, P.canvas, k) }))
      return s
    }
    // Slide: the new word pushes in from the right end, and the answers before
    // it step left from where they stood to make room; hatching fills in
    // behind them. The two cells of tail stay.
    const start = row.findIndex((c, x) => x > 14 && c.ch !== '╱')
    const end = N - M - 2
    const shift = Math.round((1 - k) * (last - first + 2))
    s[1] = row.map((c, x) => {
      if (x < start || x >= end) return c
      const from = x - shift
      return from >= start ? (row[from] as Cell) : (bare[x] as Cell)
    })
    return s
  }
}

/* --------------------------------------------------------------- M5 */

const CASES: Array<DoneFacts & { answers: string[] }> = [
  {
    mode: 'convert',
    before: { format: 'PNG', name: 'poster.png', bytes: 2_400_000 },
    after: { format: 'JPEG', name: 'poster.jpg', bytes: 1_600_000 },
    answers: ['JPEG', '80', 'Desktop', 'poster.jpg'],
  },
  {
    mode: 'convert',
    before: { format: 'GIF', name: 'logo.gif', bytes: 120_000 },
    after: { format: 'PNG', name: 'logo.png', bytes: 210_000 },
    answers: ['PNG', 'Desktop', 'logo.png'],
  },
  {
    mode: 'convert',
    before: { format: 'PNG', name: 'Id card.png', bytes: 1_900_000 },
    after: { format: 'WebP', name: 'Id card.webp', bytes: 165_000 },
    answers: ['WebP', '80', 'Desktop', 'Id card.webp'],
  },
]

const DONE_KEYS: Keys = [
  ['↵', 'convert another'],
  ['o', 'open'],
  ['s', 'show in Finder'],
]

/** Done as built (B6a), and where its bar's three rows are. */
function done(f: DoneFacts & { answers: string[] }, lit?: Parameters<typeof keys>[3]) {
  const p = modePalette(P, f.mode)
  const body = doneBody({ palette: p, facts: f, width: N })
  const { top } = doneLayout({ height: H, body: body.length, notes: 0 })
  const rows = frame(
    [bar(P, f.mode, f.answers, 'Done'), [], ...Array.from({ length: top }, (): Row => []), ...body],
    keys(P, DONE_KEYS, [['ctrl-c', 'quit']], lit),
  )
  return { rows, barAt: 2 + top + 1, p }
}

/**
 * The bar part way drawn. The band covers `shared` cells; past it the change
 * shows (`change` cells of growth, or for a smaller file all of the rest when
 * `change` > 0) at `alpha` of its strength; the change's words have faded in
 * by `labelK`.
 */
function barAt(
  f: DoneFacts & { answers: string[] },
  shared: number,
  change: number,
  alpha: number,
  labelK: number,
): Screen {
  const { rows, barAt: at, p } = done(f)
  const s = screenOf(rows)
  const block = N - 2 * M
  const bars = receiptBars(f.before.bytes, f.after.bytes, block)
  const fin = Math.min(bars.before, bars.after)
  const band = p.panelBand
  const isStructure = (c: Cell) =>
    (c.ch === ' ' && (c.bg === band || c.bg === p.grownFill)) || c.ch === '╱'
  const changeBg = bars.grew ? mix(P.canvas, p.grownFill, alpha) : undefined
  const changeCell = (): Cell =>
    bars.grew ? { ch: ' ', bg: changeBg } : { ch: '╱', fg: mix(P.canvas, p.shedHatch, alpha) }
  for (let r = at; r < at + 3; r++) {
    const row = s[r] as Cell[]
    // The change's words are in the outcome's colour, flush right, a knocked-out cell before them.
    const labelAt = row.findIndex(
      (c, x) => x > M + 2 && c.ch !== ' ' && (c.fg === p.ok || c.fg === p.larger),
    )
    s[r] = row.map((c, x) => {
      const i = x - M
      if (i < 0 || i >= block) return c
      const region =
        i < shared ? 'band' : (bars.grew ? i < fin + change : change > 0) ? 'change' : 'empty'
      const under = region === 'band' ? band : region === 'change' ? changeBg : undefined
      if (!isStructure(c)) {
        const isLabel = labelAt >= 0 && x >= labelAt - 1
        if (!isLabel) return { ...c, bg: under }
        if (labelK <= 0)
          return region === 'band'
            ? { ch: ' ', bg: band }
            : region === 'change'
              ? changeCell()
              : { ch: ' ' }
        return { ...c, bg: under, fg: mix(under ?? P.canvas, c.fg ?? P.fg, labelK) }
      }
      if (region === 'band') return { ch: ' ', bg: band }
      if (region === 'change') return changeCell()
      return { ch: ' ' }
    })
  }
  return s
}

function m5(kind: 'shrink' | 'fill') {
  const SPAN = 2600
  const ENTER = 400
  return (t: number, motion: boolean): Screen => {
    const n = Math.floor(t / SPAN) % CASES.length
    const f = CASES[n] as (typeof CASES)[number]
    const e = (t % SPAN) - ENTER
    if (e < 0) {
      // Working, a moment before: the bar drifting, the one spinner line.
      const spin = SPINNER_FRAMES[Math.floor((t % SPAN) / 80) % SPINNER_FRAMES.length]
      return screenOf(
        frame(
          [
            bar(
              P,
              f.mode,
              f.answers.slice(0, -1),
              'Converting',
              motion ? (t % SPAN) / 1000 : undefined,
            ),
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            workLine({
              palette: P,
              mode: f.mode,
              spinner: motion ? spin : undefined,
              label: `Encoding ${f.after.format}`,
              width: N,
            }),
          ],
          keys(P, [['esc', 'stop']], [['ctrl-c', 'quit']]),
        ),
      )
    }
    const block = N - 2 * M
    const bars = receiptBars(f.before.bytes, f.after.bytes, block)
    const fin = Math.min(bars.before, bars.after)
    const grow = block - fin
    const all = bars.grew ? grow : block
    if (!motion) return barAt(f, fin, all, 1, 1)
    if (kind === 'shrink') {
      const k = easeOut(e / 520)
      const labelK = clamp((e - 480) / 140)
      if (bars.grew) return barAt(f, fin, Math.round(k * grow), 1, labelK)
      // The band starts as long as the old file and pulls back to the new one.
      return barAt(f, Math.round(block - (block - fin) * k), block, 1, labelK)
    }
    const k1 = easeOut(e / 360)
    const k2 = clamp((e - 340) / 200)
    const labelK = clamp((e - 520) / 140)
    return barAt(f, Math.round(fin * k1), k2 > 0 ? all : 0, k2, labelK)
  }
}

/* --------------------------------------------------------------- M6 */

function m6(kind: 'tint' | 'invert') {
  const f = CASES[0] as (typeof CASES)[number]
  const accent = modeColours(P, f.mode).fg
  const at = (lit?: Parameters<typeof keys>[3]) => screenOf(done(f, lit).rows)
  const rest = at()
  const press = (key: string, e: number): Screen => {
    if (kind === 'tint') {
      const k = e < 33 ? 1 : 1 - easeOut((e - 33) / 260)
      return at({
        key,
        fg: mix(P.fg, P.ink, k),
        bg: mix(P.keycapBg, accent, k * 0.85),
        word: mix(P.dim, P.fg, k),
      })
    }
    return e < 130 ? at({ key, fg: P.ink, bg: P.fg, word: P.fg }) : rest
  }
  return (t: number, motion: boolean): Screen => {
    if (!motion) return rest
    if (t >= 900 && t < 1300) return press('o', t - 900)
    if (t >= 2300 && t < 2700) return press('s', t - 2300)
    return rest
  }
}

/* --------------------------------------------------------------- M7 */

const SWATCHES = ['#6579fd', '#ad95e9', '#f26e69', '#356723', '#77a726', '#ace02c']

/** A small landscape in the six colours: sky, haze, sun, two hills, a field. */
function landscape(): number[][] {
  const w = 26
  const h = 22
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const far = 11 + Math.round(2.2 * Math.sin(x / 3.1) + 1.2 * Math.sin(x / 1.7))
      const near = 15 + Math.round(1.8 * Math.sin((x + 5) / 4) + Math.cos(x / 2.3))
      if (y >= 18) return 5
      if (y >= near) return 4
      if (y >= far) return 3
      if (Math.hypot(x - 17, (y - 7) * 1.1) < 3.4) return 2
      if (y >= 7) return 1
      return 0
    }),
  )
}
const MAP = landscape()
const ITEMS = (() => {
  const counts = SWATCHES.map((_, i) => MAP.flat().filter((v) => v === i).length)
  const total = counts.reduce((a, b) => a + b, 0)
  return SWATCHES.map((hex, i) => ({ hex, pct: Math.round((100 * (counts[i] ?? 0)) / total) }))
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => b.pct - a.pct)
})()

function colourScreen(status: Row, shown: number, k: (i: number) => number): Screen {
  const p = modePalette(P, 'colour')
  const field = fieldRows({
    width: N,
    palette: p,
    content: fieldValue({ palette: p, value: 'sonoma.jpg', detail: '3024×1964 · 2.1 MB' }),
    focus: false,
  })
  const list = shown > 0 ? paletteColumn({ palette: p, items: ITEMS, selected: 0 }) : []
  const photo =
    shown > 0 ? photoRows({ palette: p, map: MAP, colours: SWATCHES, lit: ITEMS[0]?.i ?? 0 }) : []
  const body = shown > 0 ? paletteBody(photo, list) : []
  const detail: Row =
    shown > 0
      ? [
          blank(4),
          run(ITEMS[0]?.hex ?? '', p.fg, undefined, true),
          blank(2),
          run(`${ITEMS[0]?.pct}% of the image`, p.dim),
        ]
      : []
  const s = screenOf(
    frame(
      [bar(P, 'colour', ['sonoma.jpg'], 'Palette'), [], ...field, status, ...body, [], detail],
      keys(
        P,
        shown > 0
          ? [
              ['↑↓', 'colour'],
              ['↵', 'copy'],
              ['→', 'inside'],
            ]
          : [['esc', 'stop']],
        [
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ],
      ),
    ),
  )
  if (shown === 0) return s
  // The body starts under the bar, a blank, the field's three rows and the
  // status line; list row r holds item r / 2 (spaced every other row), from
  // column 34 (photo at 4, 26 wide, four cells after it).
  const top = 6
  for (let r = 0; r < 12; r += 2) {
    const v = k(r / 2)
    if (v >= 1) continue
    const row = s[top + r] as Cell[]
    s[top + r] = row.map((c, x) => (x < 34 ? c : blend({ ch: ' ' }, c, v)))
  }
  return s
}

function m7() {
  const FIND = 300
  const FOUND = 1300
  return (t: number, motion: boolean): Screen => {
    if (t < FIND) return colourScreen([], 0, () => 1)
    if (t < FOUND) {
      const spin = SPINNER_FRAMES[Math.floor(t / 80) % SPINNER_FRAMES.length]
      return colourScreen(
        workLine({
          palette: modePalette(P, 'colour'),
          mode: 'colour',
          spinner: motion ? spin : undefined,
          label: 'Finding colours',
          width: N,
        }),
        0,
        () => 1,
      )
    }
    const e = t - FOUND
    return colourScreen([], ITEMS.length, (i) => (motion ? easeOut((e - i * 45) / 140) : 1))
  }
}

/* --------------------------------------------------------------- M8 */

/** The launch: light crosses FORGE once, or the band draws itself in. */
function m8(kind: 'sweep' | 'draw') {
  const rest = screenOf(home(P, 'convert'))
  const START = 400
  const MS = 950
  return (t: number, motion: boolean): Screen => {
    if (!motion) return rest
    const e = t - START
    if (e < 0) return kind === 'draw' ? fadeHome(rest, 0, -1) : dimLetters(rest, 0)
    if (e > MS + 400) return rest
    if (kind === 'sweep') {
      const front = -12 + (e / MS) * (N + 24)
      const s = dimLetters(rest, clamp(e / MS))
      for (const r of BRAND_AT) {
        const row = s[r] as Cell[]
        s[r] = row.map((c, x) => {
          const glow = Math.exp(-(((x + (r - 1) * 2 - front) / 5) ** 2))
          if (c.ch === '╱') return { ...c, fg: mix(c.fg ?? P.fg, '#ffffff', 0.9 * glow) }
          if (c.ch !== ' ' && c.bold) {
            const lit = x + (r - 1) * 2 < front ? 1 : 0
            return { ...c, fg: mix(mix(P.border, P.fg, lit), '#ffffff', 0.6 * glow) }
          }
          return c
        })
      }
      return s
    }
    return fadeHome(rest, easeInOut(e / MS) * (N + 8), clamp((e - MS * 0.6) / 400))
  }
}

/** FORGE's letters dimmed back towards the border grey: `k` 0 dim, 1 as they rest. */
function dimLetters(s: Screen, k: number): Screen {
  return s.map((row, r) =>
    BRAND_AT.includes(r)
      ? row.map((c) =>
          c.bold && c.ch !== ' ' && c.ch !== '╱' ? { ...c, fg: mix(P.border, c.fg ?? P.fg, k) } : c,
        )
      : row,
  )
}

/** The band drawn in up to `front` (its leading edge bright), the rest of home fading in by `rest`. */
function fadeHome(s: Screen, front: number, rest: number): Screen {
  return s.map((row, r) => {
    if (BRAND_AT.includes(r))
      return row.map((c, x) => {
        const at = x + (r - 1) * 2
        if (c.ch === '╱') {
          if (at > front) return { ch: ' ' }
          const edge = Math.exp(-(((front - at) / 3) ** 2))
          return { ...c, fg: mix(c.fg ?? P.fg, '#ffffff', 0.7 * edge) }
        }
        if (c.bold || c.fg === P.dim) return at > front ? { ch: ' ' } : c
        return c
      })
    if (r === 0 || rest >= 1) return row
    // Everything under the band arrives as one, from the background.
    return row.map((c) => blend({ ch: ' ', bg: P.canvas }, c, rest < 0 ? 0 : rest))
  })
}

/* --------------------------------------------------------------- demos */

interface Demo {
  id: string
  name: string
  note: string
  dur: number
  draw: (t: number, motion: boolean) => Screen
  crop?: number
  pick?: boolean
}
interface Group {
  id: string
  title: string
  intro: string
  demos: Demo[]
}

const GROUPS: Group[] = [
  {
    id: 'M1',
    title: 'M1 · Mode change on home',
    intro:
      'Pressing 1–5 on home. The mode now lives in the tabs and the FORGE band, not in a header bar, so the wipe moves here. The loop goes convert → compress → pdf → enhance → convert.',
    demos: [
      {
        id: 'M1a',
        name: 'Sweep',
        note: 'The new mode’s gradient sweeps left to right across the hatching and the dots in 260 ms, with a soft six-cell edge. The tab chip, the field’s › and everything else cross-fade in the same 260 ms. This is the header bar’s wipe as built, moved to home.',
        dur: 6500,
        draw: m1Steps('wipe', 260),
        crop: 18,
      },
      {
        id: 'M1b',
        name: 'Cross-fade',
        note: 'The whole screen fades from one mode to the next in 200 ms. Calmer, but nothing reads as a direction.',
        dur: 6500,
        draw: m1Steps('blend', 200),
        crop: 18,
      },
    ],
  },
  {
    id: 'M2',
    title: 'M2 · Drop received',
    intro:
      'A file dropped on home. A drop arrives as a paste, and there is no hover, so nothing tells you it landed until the card is there. Then a second file: the list, its new row on the band for 1.2 s (built today, unchanged).',
    demos: [
      {
        id: 'M2a',
        name: 'Ripple',
        note: 'The card lands and one ring of the mode’s colour runs out through the stepped-back dots from the centre, about 520 ms, once.',
        dur: 5200,
        draw: m2('ripple'),
        crop: 18,
      },
      {
        id: 'M2b',
        name: 'Flash',
        note: 'Every dot lights at once and steps back to rest over 420 ms. Simpler, less direction.',
        dur: 5200,
        draw: m2('flash'),
        crop: 18,
      },
    ],
  },
  {
    id: 'M3',
    title: 'M3 · Save as',
    intro: 'V10c as built. ↓, ↓, tab, then a folder dropped on the screen.',
    demos: [
      {
        id: 'M3',
        name: 'Glide · tag · drop',
        note: 'The highlight glides from row to row in 140 ms, the band fading out of one and into the next — the picker’s glide, reused. Tab fades the default tag out of its old row and into the new one in 150 ms. A dropped folder lights the path row in the mode’s colour, then fades back to the band over 450 ms.',
        dur: 4600,
        draw: m3(),
      },
    ],
  },
  {
    id: 'M4',
    title: 'M4 · Trail chips arrive',
    intro:
      'Redrawn: round one’s fade and type were too quick to tell apart. The header bar alone, through a whole convert: Convert to → Quality → Save as → Done. None of these hold up a key — the next screen is already there; only the bar’s words move.',
    demos: [
      {
        id: 'M4a',
        name: 'Fade',
        note: 'The new question fades up out of the hatching in 250 ms. Earlier answers jump left at once.',
        dur: 6500,
        draw: m4('fade'),
        crop: 3,
      },
      {
        id: 'M4b',
        name: 'Push',
        note: 'The new question pushes in from the right end in 220 ms, and the answers before it slide left to make room. The only version where things travel.',
        dur: 6500,
        draw: m4('slide'),
        crop: 3,
      },
      {
        id: 'M4c',
        name: 'Tinted landing',
        note: 'The new question lands on a chip of the mode’s tint, which drains back into the bar over 650 ms. Says “this is new” for longer without moving anything.',
        dur: 6500,
        draw: m4('tint'),
        crop: 3,
      },
      {
        id: 'M4d',
        name: 'None',
        note: 'No motion: the bar is redrawn with the new word, as it is today. The screen under it has changed anyway, which may be enough.',
        dur: 6500,
        draw: m4('none'),
        crop: 3,
      },
    ],
  },
  {
    id: 'M5',
    title: 'M5 · The Done bar draws once',
    intro:
      'Working, then Done (B6a). Three files in turn: 33% smaller, 75% larger, 91% smaller. Both sizes are already measured when Done appears, so the bar only ever moves towards a true picture (invariant 7). It never repeats.',
    demos: [
      {
        id: 'M5a',
        name: 'Shrink',
        note: 'The band starts as long as the old file and pulls back to the new one in 520 ms, leaving the shed part as hatching. A file that grew pushes out into the orange fill instead. The change’s words fade in as it settles.',
        dur: 7800,
        draw: m5('shrink'),
      },
      {
        id: 'M5b',
        name: 'Fill',
        note: 'The band grows from nothing to the new file’s length in 360 ms, then the shed hatching (or the growth) appears, then the words.',
        dur: 7800,
        draw: m5('fill'),
      },
    ],
  },
  {
    id: 'M6',
    title: 'M6 · Key acknowledged',
    intro:
      'Done, pressing o (open), then s (show in Finder). Finder takes a moment to come forward; this says the key was taken.',
    demos: [
      {
        id: 'M6a',
        name: 'Tint',
        note: 'The keycap lights in the mode’s colour and fades back over about 300 ms.',
        dur: 3400,
        draw: m6('tint'),
      },
      {
        id: 'M6b',
        name: 'Invert',
        note: 'The keycap turns white for 130 ms, then is as it was. The terminal’s own idea of a pressed key.',
        dur: 3400,
        draw: m6('invert'),
      },
    ],
  },
  {
    id: 'M7',
    title: 'M7 · Colour results arrive',
    intro:
      'Colour → Palette, an image opened. “Finding colours” as built (after 0.3 s, spinner), then the result. The photo comes at once; it is what you gave it.',
    demos: [
      {
        id: 'M7',
        name: 'Swatches in turn',
        note: 'The colours arrive top to bottom, 45 ms apart, each fading in over 140 ms: about 0.4 s for six. The screen here is pieced together from colour-art’s parts, so its spacing may sit a row off the app’s.',
        dur: 3400,
        draw: m7(),
      },
    ],
  },
  {
    id: 'M8',
    title: 'M8 · Launch',
    intro:
      'Opening forge. Once, under a second, then nothing on home moves. From the old page, never built. Keep it or drop it.',
    demos: [
      {
        id: 'M8a',
        name: 'Light sweep',
        note: 'A glint crosses the hatching left to right in 950 ms; FORGE’s letters brighten as it passes them.',
        dur: 3200,
        draw: m8('sweep'),
        crop: 18,
      },
      {
        id: 'M8b',
        name: 'Band draws in',
        note: 'The hatching draws itself in left to right behind a bright edge, the letters appear as it reaches them, and the rest of home fades up under it.',
        dur: 3200,
        draw: m8('draw'),
        crop: 18,
      },
    ],
  },
]

/* --------------------------------------------------------------- encode */

const colours: string[] = []
const colourIndex = new Map<string, number>()
const ci = (c: string | undefined) => {
  if (!c) return -1
  let i = colourIndex.get(c)
  if (i === undefined) {
    i = colours.length
    colours.push(c)
    colourIndex.set(c, i)
  }
  return i
}
type EncRun = [string, number, number, number]
const rows: EncRun[][] = []
const rowIndex = new Map<string, number>()
const frames: number[][] = []
const frameIndex = new Map<string, number>()

function encodeRow(cells: Cell[]): number {
  const out: EncRun[] = []
  for (const c of cells) {
    const fg = c.ch === ' ' ? -1 : ci(c.fg)
    const bg = ci(c.bg)
    const b = c.bold && c.ch !== ' ' ? 1 : 0
    const last = out[out.length - 1]
    if (last && last[1] === fg && last[2] === bg && last[3] === b) last[0] += c.ch
    else out.push([c.ch, fg, bg, b])
  }
  const key = JSON.stringify(out)
  let i = rowIndex.get(key)
  if (i === undefined) {
    i = rows.length
    rows.push(out)
    rowIndex.set(key, i)
  }
  return i
}
function encodeFrame(s: Screen, crop?: number): number {
  const ids = (crop ? s.slice(0, crop) : s).map(encodeRow)
  const key = ids.join(',')
  let i = frameIndex.get(key)
  if (i === undefined) {
    i = frames.length
    frames.push(ids)
    frameIndex.set(key, i)
  }
  return i
}
/** A demo's timeline, one frame per 33 ms, run-length encoded as [frame, count] pairs. */
function timeline(d: Demo, motion: boolean): number[] {
  const out: number[] = []
  for (let t = 0; t < d.dur; t += FRAME) {
    const f = encodeFrame(d.draw(t, motion), d.crop)
    if (out.length && out[out.length - 2] === f)
      out[out.length - 1] = (out[out.length - 1] as number) + 1
    else out.push(f, 1)
  }
  return out
}

const DEMOS = GROUPS.flatMap((g) => g.demos).map((d) => ({
  id: d.id,
  on: timeline(d, true),
  off: timeline(d, false),
}))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const figure = (d: Demo) => `<figure>
<div class="vt"><span class="id">${d.id}</span><span class="name">${esc(d.name)}</span></div>
<div class="t" style="background:${P.canvas};color:${P.fg}" data-d="${d.id}"></div>
<p class="idea">${esc(d.note)}</p></figure>`

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Convert — motion, round two</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font-size:21px; margin:56px 0 4px; }
  .lede, .intro { color:#c7cbd4; max-width:1000px; margin:0; }
  .lede { color:var(--muted); }
  ol.rules { color:#c7cbd4; max-width:1000px; padding-left:22px; margin:18px 0 0; }
  ol.rules li { margin:4px 0; }
  .bar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:8px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .bar a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:5px 10px; border-radius:8px; }
  .bar a:hover { color:var(--ink); }
  .bar .sp { flex:1; }
  .bar button { font:13px var(--mono); color:var(--muted); background:none; border:1px solid var(--rule); padding:5px 12px; border-radius:8px; cursor:pointer; }
  .bar button.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(680px, 1fr)); gap:34px 22px; margin-top:18px; }
  figure { margin:0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:680px; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  i.o { background:linear-gradient(currentColor 2px, transparent 2px); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
</style></head>
<body><main>
<h1>Motion · round two</h1>
<p class="lede">The animations proposed for the round-5 UI, drawn frame by frame by the app’s own code at 80 × 24 and played at the rate a terminal redraws: one frame every 33 ms. Every frame is a glyph and two colours per cell, so all of it can be built in Ink. The old page, on the old UI, is <code>motion-2026-10.html</code>. Dark only for now: light mode’s gradients are still being picked.</p>
<ol class="rules">
  <li><b>Motion answers “is something happening?” or “what changed?”</b> It is never decoration. After launch, an idle screen does not move.</li>
  <li><b>Keys never wait.</b> Anything a key starts is done in 150 ms or less (M3, M4, M6), or runs alongside without blocking the next key (M1, M5).</li>
  <li><b>Loops run only while real work runs:</b> converting, measuring, finding colours.</li>
  <li><b>No progress is made up (invariant 7).</b> M5’s bar moves only towards sizes already measured.</li>
</ol>
<div class="bar">${GROUPS.map((g) => `<a href="#${g.id}">${g.id}</a>`).join('')}<span class="sp"></span>
<button id="mo" class="on">motion: on</button><button id="slow">speed: 1×</button><button id="again">replay</button></div>
${GROUPS.map((g) => `<section id="${g.id}"><h2>${esc(g.title)}</h2><p class="intro">${esc(g.intro)}</p><div class="grid">${g.demos.map(figure).join('')}</div></section>`).join('\n')}
</main>
<script>
const COLOURS = ${JSON.stringify(colours)}
const ROWS = ${JSON.stringify(rows)}
const FRAMES = ${JSON.stringify(frames)}
const DEMOS = ${JSON.stringify(DEMOS)}
const N = ${N}
const GLYPH = { '╱':'d', '▀':'u', '▄':'l', '█':'f', '▌':'h', '▔':'o', '\\u{e0ba}':'si', '\\u{e0bc}':'so' }
const escH = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const rowHtml = []
function row(i) {
  if (rowHtml[i]) return rowHtml[i]
  let out = '', used = 0
  for (const [text, fg, bg, b] of ROWS[i]) {
    const st = [fg >= 0 ? 'color:' + COLOURS[fg] : '', bg >= 0 ? 'background:' + COLOURS[bg] : '', b ? 'font-weight:700' : ''].filter(Boolean).join(';')
    let inner = ''
    for (const ch of text) { inner += GLYPH[ch] ? '<i class="' + GLYPH[ch] + '"></i>' : escH(ch); used++ }
    out += '<span' + (st ? ' style="' + st + '"' : '') + '>' + inner + '</span>'
  }
  if (used < N) out += '<span>' + ' '.repeat(N - used) + '</span>'
  return (rowHtml[i] = '<div class="r">' + out + '</div>')
}
const frameHtml = []
const html = (f) => frameHtml[f] ??= FRAMES[f].map(row).join('')
/** Each timeline unrolled: the frame shown at every 33 ms step. */
const unroll = (rle) => { const out = []; for (let i = 0; i < rle.length; i += 2) for (let n = 0; n < rle[i + 1]; n++) out.push(rle[i]); return out }
const players = DEMOS.map((d) => ({ el: document.querySelector('[data-d="' + d.id + '"]'), on: unroll(d.on), off: unroll(d.off), shown: -1 }))
let MOTION = true, SPEED = 1, clock = 0, last = performance.now()
const mo = document.getElementById('mo'), slow = document.getElementById('slow')
mo.onclick = () => { MOTION = !MOTION; mo.textContent = 'motion: ' + (MOTION ? 'on' : 'off'); mo.classList.toggle('on', MOTION); players.forEach((p) => p.shown = -1) }
slow.onclick = () => { SPEED = SPEED === 1 ? 0.25 : 1; slow.textContent = 'speed: ' + (SPEED === 1 ? '1×' : '¼×'); slow.classList.toggle('on', SPEED !== 1) }
document.getElementById('again').onclick = () => { clock = 0 }
// ?only=M5a shows one demo; ?at=1500 holds every clock at that millisecond (for screenshots).
const q = new URLSearchParams(location.search)
const only = q.get('only'), at = q.get('at')
if (only) document.querySelectorAll('figure').forEach((f) => { if (!f.querySelector('[data-d="' + only + '"]')) f.style.display = 'none' })
if (only) document.querySelectorAll('section').forEach((s) => { if (!s.querySelector('[data-d="' + only + '"]')) s.style.display = 'none' })
if (only) document.querySelectorAll('h1, h2, .lede, .rules, .intro, .bar').forEach((e) => { e.style.display = 'none' })
if (q.get('motion') === 'off') mo.click()
function tick(now) {
  // A browser's first frame can be stamped before the script ran: time never runs backwards here.
  clock = at !== null ? Number(at) : clock + Math.max(0, now - last) * SPEED; last = now
  const step = Math.max(0, Math.floor(clock / ${FRAME}))
  for (const p of players) {
    const tl = MOTION ? p.on : p.off
    const f = tl[step % tl.length]
    if (f !== p.shown) { p.shown = f; p.el.innerHTML = html(f) }
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
</script></body></html>`

const out = new URL('../mockups/motion-2-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log(
  'wrote',
  decodeURIComponent(out.pathname),
  page.length,
  `· ${rows.length} rows · ${frames.length} frames`,
)
