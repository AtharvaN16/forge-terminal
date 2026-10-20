/**
 * The Done screen, round twenty (2026-10-19). Decided so far: the chip row
 * is one strip in the shelf grey (R9, loved) with half a row of padding
 * above and below (V2), " PNG → " quiet and "WebP" white at its left, the
 * saving at its right; the bar's band in the mode's colour (B13), its
 * hatching grey, the name in it; the sizes stacked (T5); → at the bottom
 * right. p has no place yet.
 *
 * Asked for: the screen in the other modes' colours; a file that grew; and
 * concepts for → continue editing and p save as preset (K1–K11 all passed
 * over, so none of them come back).
 *
 * DoneScreen draws Convert, Compress, and Edit when it offers to compress
 * next (App.tsx), so those three are the modes here.
 *
 *   npx tsx scripts/done-mockup-r14.ts   → mockups/done-2026-10-round14.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette, type Palette, type ShellMode } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
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
const COMPRESS: Result = {
  mode: 'compress',
  before: { format: 'PNG', name: 'holiday-photo.png', bytes: 2.4 * MB },
  after: { format: 'PNG', name: 'holiday-photo.png', bytes: 640 * KB },
  trail: ['80', 'Desktop'],
  again: 'compress again',
}
const EDIT: Result = {
  mode: 'edit',
  before: { format: 'JPEG', name: 'IMG_4821.jpg', bytes: 4.1 * MB },
  after: { format: 'JPEG', name: 'IMG_4821-resized.jpg', bytes: 1.2 * MB },
  trail: ['Resize', 'IMG_4821-resized.jpg'],
  again: 'edit another',
}
const GREW: Result = {
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
const standing = (q: Palette): Frame => ({
  top: [blank(M), ...cap(q, 'p', 'save as preset')],
  foot: [atRight(cap(q, '→', 'continue editing'))],
})

/* ------------------------------------------------------------ concepts */

const q = modePalette(DARK, 'convert')
const shot = (r: Result, rows: Row[], frame: Frame, p = modePalette(DARK, r.mode)) =>
  termHtml(p, toGrid(screen(p, r, rows, frame), N))

const MODES: PageConcept[] = (
  [
    ['M1', 'Convert', CONVERT],
    ['M2', 'Compress', COMPRESS],
    ['M3', 'Edit, offering to compress', EDIT],
  ] as const
).map(([id, label, r], i) => {
  const p = modePalette(DARK, r.mode)
  return {
    id,
    name: label,
    idea:
      r.mode === 'convert'
        ? 'The screen as it stands, in convert’s blue: the header, the band.'
        : r.mode === 'compress'
          ? 'Compress keeps the format, so the strip says it once: PNG. The band and the header take compress’s colour.'
          : 'Edit (a resize here) keeps the format too; the band and header take edit’s colour. Edit shows this screen when it offers to compress next.',
    html: shot(r, body(p, r), standing(p), p),
    ...(i === 0 ? { section: 'In each mode’s colours' } : {}),
  }
})

const GROWTHS: PageConcept[] = (
  [
    [
      'G1',
      'Growth as an orange fill',
      'The band runs to the old file’s length; what the new file grew by is a soft orange fill past it, as the app draws growth today. The saving’s place says “+420 KB · 350% larger” in orange.',
      'fill',
    ],
    [
      'G2',
      'Growth as orange hatching',
      'The band to the old length, the growth past it hatched in orange: the mirror of the grey hatching a smaller file sheds — what was decided for growth back in round six.',
      'hatch',
    ],
    [
      'G3',
      'The band carries on, hatched orange',
      'The band runs the whole new length, since it is all the new file; past the old length it is crossed with orange hatching, marking the part that is extra.',
      'over',
    ],
  ] as const
).map(([id, label, idea, growth], i) => ({
  id,
  name: label,
  idea,
  html: shot(GREW, body(q, GREW, growth), standing(q)),
  ...(i === 0 ? { section: 'A file that grew: 120 KB → 540 KB' } : {}),
}))

/* The two keys. → stays at the bottom right; p is placed by each concept. */
const blueOf = (p: Palette) => modeColours(p, 'convert').fg
/** One row: `left` from column `from`, `right` ending a cell short of the edge. */
const both = (left: Run[], right: Run[], from = M): Row => {
  const lw = from + rowWidth(left)
  return [blank(from), ...left, blank(Math.max(1, N - 1 - lw - rowWidth(right))), ...right]
}
/** `runs` on the shelf grey with a cell either side: a small strip's middle row. */
const onShelf = (p: Palette, runs: Run[]): Run[] => [
  run(' ', undefined, p.shelf),
  ...runs.map((x) => ({ ...x, bg: x.bg ?? p.shelf })),
  run(' ', undefined, p.shelf),
]
/** The half rows above and below a small strip `w` wide. */
const halves = (p: Palette, w: number): [Run, Run] => [
  run('▄'.repeat(w), p.shelf),
  run('▀'.repeat(w), p.shelf),
]

const KEYS: Array<{ id: string; name: string; idea: string; frame: (p: Palette) => Frame }> = [
  {
    id: 'K12',
    name: 'An action strip at the bottom',
    idea: 'The top strip, mirrored at the bottom: one shelf-grey strip, half rows above and below, across the block just above the rule — p at its left, → at its right. The result is framed by two strips.',
    frame: (p) => {
      const tone = p.shelf
      const left: Run[] = [run(' '), ...cap(p, 'p', 'save as preset')]
      const right: Run[] = [...cap(p, '→', 'continue editing'), run(' ')]
      const cells = Array.from({ length: BLOCK }, (): Cell => ({ ch: ' ', bg: tone }))
      over(cells, 0, left)
      over(cells, BLOCK - rowWidth(right), right)
      return {
        foot: [
          [blank(M), run('▄'.repeat(BLOCK), tone)],
          [blank(M), ...rowOf(cells)],
          [blank(M), run('▀'.repeat(BLOCK), tone)],
        ],
      }
    },
  },
  {
    id: 'K13',
    name: 'Two small strips',
    idea: 'Each key gets its own small strip in the shelf grey, half rows above and below, like the top strip in miniature: p’s at the bottom left, →’s at the bottom right.',
    frame: (p) => {
      const l = onShelf(p, cap(p, 'p', 'save as preset'))
      const r = onShelf(p, cap(p, '→', 'continue editing'))
      const [lt, lb] = halves(p, rowWidth(l))
      const [rt, rb] = halves(p, rowWidth(r))
      return { foot: [both([lt], [rt]), both(l, r), both([lb], [rb])] }
    },
  },
  {
    id: 'K14',
    name: 'Words first, the key after',
    idea: 'As a menu writes its items: “save as preset” then its key, “continue editing” then its key — the words in white, the key quiet after them. p at the bottom left, → at the bottom right.',
    frame: (p) => {
      const item = (words: string, k: string): Run[] => [
        run(`${words} `, p.fg),
        run(` ${k} `, p.dim, fill(p.keycapBg), true),
      ]
      const left: Row = [blank(M), ...item('save as preset', 'p')]
      const right = item('continue editing', '→')
      return { foot: [[...left, blank(N - 1 - rowWidth(left) - rowWidth(right)), ...right]] }
    },
  },
  {
    id: 'K15',
    name: '→ in the mode’s colour on a strip',
    idea: '“continue editing →” on a small shelf strip at the bottom right, the words and arrow in convert’s blue: the way on, in the mode’s colour. p is quiet plain text at the bottom left.',
    frame: (p) => {
      const go = onShelf(p, [run('continue editing →', blueOf(p), undefined, true)])
      const [t, b] = halves(p, rowWidth(go))
      const preset: Run[] = [run('p', p.fg, undefined, true), run(' save as preset', p.border)]
      return { foot: [both([], [t]), both(preset, go), both([], [b])] }
    },
  },
  {
    id: 'K16',
    name: 'A second key row',
    idea: 'p and → as a second row of keys right above the usual one, under the rule, drawn exactly like it: everything you can press lives in one place at the bottom, the result has the screen to itself.',
    frame: (p) => {
      const row: Row = [
        blank(M + 1),
        ...cap(p, 'p', 'save as preset'),
        blank(2),
        ...cap(p, '→', 'continue editing'),
      ]
      return { keysAbove: row }
    },
  },
]

const KEY_CONCEPTS: PageConcept[] = KEYS.map((k, i) => ({
  id: k.id,
  name: k.name,
  idea: k.idea,
  html: shot(CONVERT, body(q, CONVERT), k.frame(q)),
  ...(i === 0 ? { section: '→ continue editing and p save as preset' } : {}),
}))

writeFileSync(
  'mockups/done-2026-10-round14.html',
  feedbackPage({
    page: 'done-round14',
    title: 'Forge · Done, round twenty',
    heading: 'Done: every mode, a file that grew, and the two keys',
    lede: 'The screen as decided — the strip in the shelf grey (R9) with half rows above and below, the band in the mode’s colour, the hatching grey, the sizes stacked, → at the bottom right — in Convert, Compress and Edit; then a file that came out larger; then new concepts for → continue editing and p save as preset, none of them K1–K11. Where p is not the question it sits at the top left as before. Dark, 80 × 24.',
    concepts: [...MODES, ...GROWTHS, ...KEY_CONCEPTS],
  }),
)
console.log('wrote mockups/done-2026-10-round14.html')
