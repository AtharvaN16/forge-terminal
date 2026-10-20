/**
 * The Done screen, round fourteen (2026-10-19). The layout is locked (the
 * user's decisions across rounds two to four):
 *
 *   header
 *   p save as preset                                → continue editing
 *   …
 *   PNG → WebP                         278 KB saved · 89.6% smaller
 *   ████╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱  ┐
 *   ✓ Screenshot … .webp ╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱  │ five rows,
 *   ████╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱  ┘ name in it
 *
 *   now 32.2 KB                                         was 310 KB
 *
 * The chip's row touches the bar. What varies is only how the pieces are
 * drawn.
 *
 *   npx tsx scripts/done-mockup-r8.ts   → mockups/done-2026-10-round8.html
 */
import { writeFileSync } from 'node:fs'
import { trailBarRow } from '../src/shell/bar-art.js'
import { doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modePalette, type Palette } from '../src/shell/theme.js'
import {
  BLOCK,
  CHANGE,
  chip,
  F,
  H,
  M,
  more,
  N,
  name,
  now,
  pill,
  preset,
  sizes,
  spread,
  was,
} from './done-pieces.js'
import { feedbackPage } from './feedback-page.js'
import { type Cell, cellsOf, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

/* ----------------------------------------------------------------- screen */

/**
 * The header bar, a blank row, `head` (p and →), then the body in the
 * middle of what is left, the rule and the key row.
 */
function screen(p: Palette, head: Row, body: Row[]): Row[] {
  const header = trailBarRow({
    width: N,
    palette: p,
    mode: 'convert',
    trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
    slanted: false,
  })
  const keys: Row = [blank(M + 1)]
  for (const [i, [k, w]] of (
    [
      ['↵', 'convert another'],
      ['o', 'open'],
      ['s', 'show in finder'],
    ] as const
  ).entries()) {
    if (i) keys.push(blank(2))
    keys.push(run(` ${k} `, p.fg, fill(p.keycapBg), true), run(` ${w}`, p.dim))
  }
  const quit: Row = [run('ctrl-c', p.fg), run(' quit', p.border)]
  keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)

  const room = H - 2
  const { top } = doneLayout({ height: room, body: body.length, notes: 0 })
  const free = room - 4 - body.length
  const above = Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    header,
    [],
    head,
    [],
    ...blanks(above),
    ...body,
    ...blanks(free - above),
    [run('─'.repeat(N), p.border)],
    keys,
  ]
}
const topKeys = (p: Palette): Row => spread(preset(p), more(p))
const chipRow = (p: Palette): Row => spread([chip(p)], [pill(p)])

/* -------------------------------------------------------------------- bar */

interface BarLook {
  rows?: number
  /** The band's fill: the panel grey by default. */
  band?: string | undefined
  /** Hatching on every other column, quieter. */
  sparse?: boolean
  /** The name on its own plate, three rows, just past the band. */
  plate?: boolean
  /** The block's width and left margin, for a bar inside a card. */
  width?: number
  margin?: number
}

function bar(p: Palette, look: BarLook = {}): Row[] {
  const { rows = 5, sparse = false, plate = false, width = BLOCK, margin = M } = look
  const band = look.band ?? fill(p.panelBand)
  const kept = receiptBars(F.before.bytes, F.after.bytes, width).after
  const label: Run[] = [run(' '), ...name(p, width - 4), run(' ')]
  const plateW = rowWidth(label) + 2
  const plateAt = kept + 1
  return Array.from({ length: rows }, (_, r) => {
    const cells: Cell[] = Array.from({ length: width }, (_, i): Cell => {
      if (i < kept) return { ch: ' ', bg: band }
      if (sparse && (i - kept) % 2 === 1) return { ch: ' ' }
      return { ch: '╱', fg: p.shedHatch }
    })
    const mid = rows >> 1
    if (plate) {
      if (r >= mid - 1 && r <= mid + 1) {
        for (let i = plateAt; i < plateAt + plateW && i < width; i++) {
          cells[i] = { ch: ' ', bg: fill(p.keycapBg) }
        }
        if (r === mid) over(cells, plateAt + 1, label)
      }
    } else if (r === mid) over(cells, 0, label)
    return [blank(margin), ...rowOf(cells)]
  })
}

/* --------------------------------------------------------------- concepts */

interface Concept {
  id: string
  name: string
  idea: string
  draw: (p: Palette) => Row[]
}

const CONCEPTS: Concept[] = [
  {
    id: '19',
    name: 'The locked layout',
    idea: 'Exactly what you asked for, drawn plainly: p and → on one row at the top; the chip and the saving on the row touching the bar; the bar five rows tall with the name in it; now and was under it. Every other concept here is this, drawn differently.',
    draw: (p) => screen(p, topKeys(p), [chipRow(p), ...bar(p), [], sizes(p)]),
  },
  {
    id: '20',
    name: 'p and → on a toolbar',
    idea: 'The top row becomes a strip on the field’s grey, the block’s width, p at one end and → at the other: it reads as the screen’s toolbar, apart from the result below.',
    draw: (p) => {
      // The strip: the block's width on the shelf grey, p a cell in from its
      // start and → a cell in from its end.
      const shelf = fill(p.shelf)
      const l: Run[] = [run(' '), ...preset(p)]
      const r: Run[] = [...more(p), run(' ')]
      const inside = cellsOf([...l, blank(BLOCK - rowWidth(l) - rowWidth(r)), ...r])
      const strip: Row = [blank(M), ...rowOf(inside.map((c) => ({ ...c, bg: c.bg ?? shelf })))]
      return screen(p, strip, [chipRow(p), ...bar(p), [], sizes(p)])
    },
  },
  {
    id: '21',
    name: 'The name on a plate',
    idea: 'The name sits on its own plate in the key grey, three rows of the bar, just past the band, so it reads cleanly and never runs into the hatching. The band itself stays bare.',
    draw: (p) => screen(p, topKeys(p), [chipRow(p), ...bar(p, { plate: true }), [], sizes(p)]),
  },
  {
    id: '22',
    name: 'Quieter hatching',
    idea: 'The shed part hatched on every other column, so it is half as dense: still unmistakably “gone”, but the bar is calmer and the name and band stand out more.',
    draw: (p) => screen(p, topKeys(p), [chipRow(p), ...bar(p, { sparse: true }), [], sizes(p)]),
  },
  {
    id: '23',
    name: 'The band in green',
    idea: 'The band — the new file — takes the green tint that the new size and the saving already have, so the bar, “now” and the saving read as one colour story. The hatching stays as it is.',
    draw: (p) =>
      screen(p, topKeys(p), [
        chipRow(p),
        ...bar(p, { band: fill(mix(p.ok, p.canvas, 0.7)) }),
        [],
        sizes(p),
      ]),
  },
  {
    id: '24',
    name: 'The saving as type, not a pill',
    idea: 'The chip row’s right end drops the pill: “278 KB saved” bold in green, “89.6% smaller” quiet after it. Less boxed, so the chip on the left is the only filled thing on the row.',
    draw: (p) => {
      const [saved = '', pct = ''] = CHANGE.split(' · ')
      const words: Run[] = [
        run(saved, p.ok, undefined, true),
        run('  ·  ', p.border),
        run(pct, p.dim),
      ]
      return screen(p, topKeys(p), [spread([chip(p)], words), ...bar(p), [], sizes(p)])
    },
  },
  {
    id: '25',
    name: 'A ruler under the bar',
    idea: 'A thin ruler hangs under the bar, ticked where the band ends and where the bar ends; now and was sit right on it, so each size reads against the point it measures.',
    draw: (p) => {
      const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
      const line = mix(p.border, p.canvas, 0.45)
      const cells: Cell[] = Array.from({ length: BLOCK }, (_, i) => ({
        ch: i === 0 ? '└' : i === BLOCK - 1 ? '┘' : i === kept - 1 ? '┴' : '─',
        fg: line,
      }))
      return screen(p, topKeys(p), [chipRow(p), ...bar(p), [blank(M), ...rowOf(cells)], sizes(p)])
    },
  },
  {
    id: '26',
    name: 'The result on a card',
    idea: 'The chip row, the bar and the sizes share one card on the field’s grey, with a cell of padding round them; p and → stay outside it at the top. The result reads as one object.',
    draw: (p) => {
      const shelf = fill(p.shelf) ?? p.canvas
      const inner = BLOCK - 4
      const pad = (row: Row): Row => {
        const cells = cellsOf(row)
        while (cells.length < inner) cells.push({ ch: ' ' })
        return [
          blank(M),
          run('  ', undefined, shelf),
          ...rowOf(cells.slice(0, inner).map((c) => ({ ...c, bg: c.bg ?? shelf }))),
          run('  ', undefined, shelf),
        ]
      }
      const innerSpread = (l: Run[], r: Run[]): Row => [
        ...l,
        blank(Math.max(1, inner - rowWidth(l) - rowWidth(r))),
        ...r,
      ]
      const bars = bar(p, { width: inner, margin: 0 }).map((r) => r.slice(1))
      return screen(p, topKeys(p), [
        pad([]),
        pad(innerSpread([chip(p)], [pill(p)])),
        ...bars.map(pad),
        pad([]),
        pad(innerSpread(now(p), was(p))),
        pad([]),
      ])
    },
  },
]

const p = modePalette(DARK, 'convert')
writeFileSync(
  'mockups/done-2026-10-round8.html',
  feedbackPage({
    page: 'done-round8',
    title: 'Forge · Done, round fourteen',
    heading: 'Done, the locked layout, drawn eight ways',
    lede: 'Locked, from your answers: p and → on one row at the top; the chip and the saving on the row touching the bar; the bar five rows tall with the name in it; now and was under it. Every concept keeps that layout exactly; only how the pieces are drawn changes. Dark, 80 × 24.',
    concepts: CONCEPTS.map((c) => ({
      id: c.id,
      name: c.name,
      idea: c.idea,
      html: termHtml(p, toGrid(c.draw(p), N)),
    })),
  }),
)
console.log('wrote mockups/done-2026-10-round8.html')
