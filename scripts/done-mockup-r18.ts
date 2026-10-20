/**
 * The Done screen, round twenty-four (2026-10-19). Round twenty-three
 * (mockups/feedback/done-round17.json): K17 loved again; K25 (white words,
 * the key cap on the right) disliked — "show on the left again". So K26:
 * the key cap on the left, K17's white words; beside K17 and K19 (the cap on
 * the left, dim words, potential).
 *
 * Round twenty-three, kept for the record: Round twenty-two
 * (mockups/feedback/done-round16.json): K17 loved — "continue editing →" in
 * white on a small shelf-grey frame at the bottom right, p save as preset
 * quiet at the bottom left; K19 has potential with "move arrow to the right
 * of the text". So: K17 against K19 with its key cap moved right, and the
 * whole screen in light mode, never seen yet.
 *
 *   npx tsx scripts/done-mockup-r18.ts   → mockups/done-2026-10-round18.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette, type Palette, type ShellMode } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { feedbackPage } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const N = 80
const H = 24
const M = 2
const BLOCK = N - 2 * M
const KB = 1000
const MB = 1000 * KB

/* ------------------------------------------------------------- results */

interface Result {
  mode: ShellMode
  before: { format: string; name: string; bytes: number }
  after: { format: string; name: string; bytes: number }
  /** The header's trail, before "Done". */
  trail: string[]
  /** What ↵ does here (App.tsx). */
  again: string
}
const CONVERT: Result = {
  mode: 'convert',
  before: { format: 'PNG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.png', bytes: 310 * KB },
  after: { format: 'WebP', name: 'Screenshot 2026-10-19 at 9.43.23 PM.webp', bytes: 32.2 * KB },
  trail: ['WebP', 'Desktop'],
  again: 'convert another',
}
const _COMPRESS: Result = {
  mode: 'compress',
  before: { format: 'PNG', name: 'holiday-photo.png', bytes: 2.4 * MB },
  after: { format: 'PNG', name: 'holiday-photo.png', bytes: 640 * KB },
  trail: ['80', 'Desktop'],
  again: 'compress again',
}
const _EDIT: Result = {
  mode: 'edit',
  before: { format: 'JPEG', name: 'IMG_4821.jpg', bytes: 4.1 * MB },
  after: { format: 'JPEG', name: 'IMG_4821-resized.jpg', bytes: 1.2 * MB },
  trail: ['Resize', 'IMG_4821-resized.jpg'],
  again: 'edit another',
}
const _GREW: Result = {
  mode: 'convert',
  before: { format: 'JPEG', name: 'poster.jpg', bytes: 120 * KB },
  after: { format: 'PNG', name: 'poster.png', bytes: 540 * KB },
  trail: ['PNG', 'Desktop'],
  again: 'convert another',
}

/* -------------------------------------------------------------- pieces */

const modeFg = (q: Palette, r: Result) => modeColours(q, r.mode).fg
const grew = (r: Result) => r.after.bytes > r.before.bytes
const outcome = (q: Palette, r: Result) => (grew(r) ? q.larger : q.ok)
const change = (r: Result) => {
  const diff = formatBytes(Math.abs(r.after.bytes - r.before.bytes))
  const phrase = changePhrase(r.before.bytes, r.after.bytes)
  return grew(r) ? `+${diff} · ${phrase}` : `${diff} saved · ${phrase}`
}

/** R9 + V2: the strip in the shelf grey, half a row above and below the words. */
function strip(q: Palette, r: Result): Row[] {
  const tone = q.shelf
  const cells = Array.from({ length: BLOCK }, (): Cell => ({ ch: ' ', bg: tone }))
  const formats: Run[] =
    r.before.format === r.after.format
      ? [run(` ${r.after.format}`, q.fg, undefined, true)]
      : [
          run(` ${r.before.format}`, q.dim),
          run(' → ', q.border),
          run(r.after.format, q.fg, undefined, true),
        ]
  over(cells, 0, formats)
  const saving = [run(` ${change(r)} `, outcome(q, r), undefined, true)]
  over(cells, BLOCK - rowWidth(saving), saving)
  const half = (ch: string): Row => [blank(M), run(ch.repeat(BLOCK), tone)]
  return [half('▄'), [blank(M), ...rowOf(cells)], half('▀')]
}

type Growth = 'fill' | 'hatch' | 'over'
/**
 * The bar: the band in the mode's colour as long as the new file, the rest
 * of the old file's length hatched grey. When the file grew, the band runs
 * to the old length and the growth past it is drawn per `growth`: an
 * orange fill, orange hatching, or the band carrying on with orange
 * hatching over it.
 */
function bar(q: Palette, r: Result, growth: Growth = 'hatch'): Row[] {
  const bars = receiptBars(r.before.bytes, r.after.bytes, BLOCK)
  const shared = Math.min(bars.before, bars.after)
  const band = mix(modeFg(q, r), q.canvas, 0.5)
  const label: Run[] = [
    run(' '),
    run('✓ ', q.ok, undefined, true),
    run(middleEllipsis(r.after.name, BLOCK - 6), q.fg, undefined, true),
    run(' '),
  ]
  return Array.from({ length: 5 }, (_, row) => {
    const cells: Cell[] = Array.from({ length: BLOCK }, (_, i): Cell => {
      if (i < shared) return { ch: ' ', bg: band }
      if (!bars.grew) return { ch: '╱', fg: mix(q.border, q.canvas, 0.55) }
      if (growth === 'fill') return { ch: ' ', bg: q.grownFill || undefined }
      if (growth === 'hatch') return { ch: '╱', fg: mix(q.larger, q.canvas, 0.35) }
      return { ch: '╱', fg: q.larger, bg: band }
    })
    if (row === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}

/** T5: the word quiet over the size; the smaller file on the left. */
function sizes(q: Palette, r: Result): Row[] {
  const now: [Run, Run] = [
    run('now', q.dim),
    run(formatBytes(r.after.bytes), outcome(q, r), undefined, true),
  ]
  const was: [Run, Run] = [
    run('was', q.border),
    run(formatBytes(r.before.bytes), q.fg, undefined, true),
  ]
  const [l, rt] = grew(r) ? [was, now] : [now, was]
  const line = (a: Run, b: Run): Row => [blank(M), a, blank(BLOCK - rowWidth([a, b])), b]
  return [[], line(l[0], rt[0]), line(l[1], rt[1])]
}

const body = (q: Palette, r: Result, growth?: Growth): Row[] => [
  ...strip(q, r),
  ...bar(q, r, growth),
  ...sizes(q, r),
]

/* -------------------------------------------------------------- screen */

const cap = (q: Palette, k: string, w: string): Run[] => [
  run(` ${k} `, q.fg, fill(q.keycapBg), true),
  run(` ${w}`, q.dim),
]

interface Frame {
  /** A row under the header (and a blank after it). */
  top?: Row
  /** Rows above the rule, the last at the bottom. */
  foot?: Row[]
  /** A second key row, above the usual one, under the rule. */
  keysAbove?: Row
}
function screen(q: Palette, r: Result, rows: Row[], frame: Frame): Row[] {
  const keys: Row = [blank(M + 1)]
  ;(
    [
      ['↵', r.again],
      ['o', 'open'],
      ['s', 'show in finder'],
    ] as const
  ).forEach(([k, w], i) => {
    if (i) keys.push(blank(2))
    keys.push(...cap(q, k, w))
  })
  const quit: Row = [run('ctrl-c', q.fg), run(' quit', q.border)]
  keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)

  const head: Row[] = frame.top ? [frame.top, []] : []
  const foot = frame.foot ?? []
  const below = frame.keysAbove ? [frame.keysAbove, keys] : [keys]
  const room = H - 2 - head.length
  const free = room - 1 - below.length - foot.length - rows.length
  const { top } = doneLayout({ height: room, body: rows.length, notes: 0 })
  const above = Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    trailBarRow({
      width: N,
      palette: q,
      mode: r.mode,
      trail: { answers: r.trail, current: 'Done' },
      slanted: false,
    }),
    [],
    ...head,
    ...blanks(above),
    ...rows,
    ...blanks(free - above),
    ...foot,
    [run('─'.repeat(N), q.border)],
    ...below,
  ]
}
const atRight = (runs: Run[]): Row => [blank(N - 1 - rowWidth(runs)), ...runs]
/** p held at the top left (it has no place yet), → at the bottom right. */
const _standing = (q: Palette): Frame => ({
  top: [blank(M), ...cap(q, 'p', 'save as preset')],
  foot: [atRight(cap(q, '→', 'continue editing'))],
})

/* ------------------------------------------------------------ concepts */

const q = modePalette(DARK, 'convert')
const shot = (r: Result, rows: Row[], frame: Frame, p = modePalette(DARK, r.mode)) =>
  termHtml(p, toGrid(screen(p, r, rows, frame), N))

/** One row: `left` from column `from`, `right` ending a cell short of the edge. */
const both = (left: Run[], right: Run[], from = M): Row => {
  const lw = from + rowWidth(left)
  return [blank(from), ...left, blank(Math.max(1, N - 1 - lw - rowWidth(right))), ...right]
}
/** `runs` on the shelf grey with a cell either side: a small frame's middle row. */
const onShelf = (p: Palette, runs: Run[], tone = p.shelf): Run[] => [
  run(' ', undefined, tone),
  ...runs.map((x) => ({ ...x, bg: x.bg ?? tone })),
  run(' ', undefined, tone),
]
/** The half rows above and below a frame `w` wide. */
const halves = (p: Palette, w: number, tone = p.shelf): [Run, Run] => [
  run('▄'.repeat(w), tone),
  run('▀'.repeat(w), tone),
]
/** p, de-emphasised: the key bold, the words quiet, no fill (K15). */
const quietP = (p: Palette): Run[] => [
  run('p', p.dim, undefined, true),
  run(' save as preset', p.border),
]
/** A frame with half rows: three foot rows, `left` on the middle one. */
const framed = (p: Palette, left: Run[], inside: Run[], tone = p.shelf): Row[] => {
  const go = onShelf(p, inside, tone)
  const [t, b] = halves(p, rowWidth(go), tone)
  return [both([], [t]), both(left, go), both([], [b])]
}

interface Keys {
  id: string
  name: string
  idea: string
  frame: (p: Palette) => Frame
  earlier?: PageConcept['earlier']
}
const KEYS: Keys[] = [
  {
    id: 'K17',
    name: 'White words',
    idea: 'Your pick: “continue editing →” in white on the frame.',
    frame: (p) => ({ foot: framed(p, quietP(p), [run('continue editing →', p.fg)]) }),
    earlier: 'love',
  },
  {
    id: 'K26',
    name: 'The key on the left, white words',
    idea: 'K25 with the key cap back on the left, as you asked: → in a key cap, then “continue editing” in K17’s white.',
    frame: (p) => ({
      foot: framed(p, quietP(p), [
        run(' → ', p.fg, fill(p.keycapBg), true),
        run(' continue editing', p.fg),
      ]),
    }),
  },
  {
    id: 'K19',
    name: '→ as a key cap',
    idea: 'From two rounds ago: → in a key cap on the left, the words dim.',
    frame: (p) => ({
      foot: framed(p, quietP(p), [
        run(' → ', p.fg, fill(p.keycapBg), true),
        run(' continue editing', p.dim),
      ]),
    }),
    earlier: 'potential',
  },
]

const ZOOM_ROWS = 4
const ZOOM_COLS = 34
const corner = (rows: Row[]) => {
  const g = toGrid(rows, N)
  const end = g.length - 2
  return g.slice(end - ZOOM_ROWS + 1, end + 1).map((r) => r.slice(N - ZOOM_COLS))
}
const zoomed = (k: Keys) =>
  `<div class="big">${termHtml(q, corner(screen(q, CONVERT, body(q, CONVERT), k.frame(q))))}</div>`

const before = `<h2>The three side by side, enlarged</h2>
<p class="lede">The bottom-right corner of each screen, about three times the size.</p>
<div class="zooms">${KEYS.map((k) => `<div><div class="zid"><span class="id">${k.id}</span> ${k.name}</div>${zoomed(k)}</div>`).join('')}</div>
<style>
  .zooms { display:flex; flex-wrap:wrap; gap:28px 36px; margin-top:18px; }
  .zid { font:600 15px -apple-system, sans-serif; margin-bottom:8px; }
  .zid .id { font:700 12px "SF Mono", monospace; padding:3px 8px; border-radius:6px; background:#12282e; color:#55c7d9; margin-right:6px; }
  .big .t { font-size:30px; padding:20px 24px; }
  .big .r, .big .r > span { height:39px; line-height:39px; }
</style>`

writeFileSync(
  'mockups/done-2026-10-round18.html',
  feedbackPage({
    page: 'done-round18',
    title: 'Forge · Done, round twenty-four',
    heading: 'Done: K17, or the key on the left in white',
    lede: 'K17, your pick, against K26 — the key cap on the left with K17’s white words, as you asked — and K19, the key cap on the left with dim words. Dark, 80 × 24.',
    before,
    concepts: [
      ...KEYS.map((k, i) => ({
        id: k.id,
        name: k.name,
        idea: k.idea,
        html: shot(CONVERT, body(q, CONVERT), k.frame(q)),
        earlier: k.earlier,
        ...(i === 0 ? { section: 'The whole screens' } : {}),
      })),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round18.html')
