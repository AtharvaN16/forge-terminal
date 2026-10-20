/**
 * The Done screen, round twenty-five (2026-10-20). Built since round
 * twenty-four: the strip and the → continue editing frame lost their ▄ ▀
 * half rows (Apple Terminal seams them), so both are one row, and the foot
 * has a blank row under it. The user asked to see two ways to give the
 * screen its weight back:
 *
 *   - the body (strip, bar, now and was) raised towards the header;
 *   - the strip given whole rows of its grey above and below, and the bar
 *     made much thicker to match.
 *
 * Later the same day: today with a blank row between the strip and the bar;
 * the thick versions lifted only a row, not up against the header (the user:
 * “just slightly up to compensate”); the thick strip in lighter greys.
 *
 * Here: today as built, each idea alone, the two crossed, a nine-row bar,
 * and a bar that grows to fill the window's spare rows.
 *
 *   npx tsx scripts/done-mockup-r19.ts   → mockups/done-2026-10-round19.html
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
const M = 2
const BLOCK = N - 2 * M
const KB = 1000

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
  after: { format: 'JPEG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.jpg', bytes: 45 * KB },
  trail: ['JPEG', 'Desktop'],
  again: 'convert another',
}

/* -------------------------------------------------------------- pieces */

const grew = (r: Result) => r.after.bytes > r.before.bytes
const outcome = (q: Palette, r: Result) => (grew(r) ? q.larger : q.ok)
const change = (r: Result) => {
  const diff = formatBytes(Math.abs(r.after.bytes - r.before.bytes))
  const phrase = changePhrase(r.before.bytes, r.after.bytes)
  return grew(r) ? `+${diff} · ${phrase}` : `${diff} saved · ${phrase}`
}

/** A whole row of the strip's grey across the block: spaces on a fill, no ▄ ▀. */
const shelfRow = (tone: string): Row => [blank(M), run(' '.repeat(BLOCK), undefined, tone)]

/** The strip: the formats and the change on `tone`; `pad` whole rows above and below. */
function strip(q: Palette, r: Result, pad: 0 | 1, tone = q.shelf): Row[] {
  const cells = Array.from({ length: BLOCK }, (): Cell => ({ ch: ' ', bg: tone }))
  over(cells, 0, [
    run(` ${r.before.format}`, q.dim),
    run(' → ', q.border),
    run(r.after.format, q.fg, undefined, true),
  ])
  const saving = [run(` ${change(r)} `, outcome(q, r), undefined, true)]
  over(cells, BLOCK - rowWidth(saving), saving)
  const words: Row = [blank(M), ...rowOf(cells)]
  return pad ? [shelfRow(tone), words, shelfRow(tone)] : [words]
}

/**
 * The bar, `tall` rows: the band in the mode's colour, the shed part drawn
 * as `shed` (grey hatching unless given), the name in the middle.
 */
function bar(q: Palette, r: Result, tall: number, shed?: Cell): Row[] {
  const rest: Cell = shed ?? { ch: '╱', fg: mix(q.border, q.canvas, 0.55) }
  const bars = receiptBars(r.before.bytes, r.after.bytes, BLOCK)
  const shared = Math.min(bars.before, bars.after)
  const band = mix(modeColours(q, r.mode).fg, q.canvas, 0.5)
  const label: Run[] = [
    run(' '),
    run('✓ ', q.ok, undefined, true),
    run(middleEllipsis(r.after.name, BLOCK - 6), q.fg, undefined, true),
    run(' '),
  ]
  return Array.from({ length: tall }, (_, row) => {
    const cells: Cell[] = Array.from(
      { length: BLOCK },
      (_, i): Cell => (i < shared ? { ch: ' ', bg: band } : { ...rest }),
    )
    if (row === tall >> 1) over(cells, 0, label)
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
  const line = (a: Run, b: Run): Row => [blank(M), a, blank(BLOCK - rowWidth([a, b])), b]
  return [[], line(now[0], was[0]), line(now[1], was[1])]
}

/** `gap`: a blank row between the strip and the bar; `tone`: the strip's grey; `shed`: the bar's shed cells. */
const body = (
  q: Palette,
  r: Result,
  pad: 0 | 1,
  tall: number,
  { gap = false, tone = q.shelf, shed }: { gap?: boolean; tone?: string; shed?: Cell } = {},
): Row[] => [
  ...strip(q, r, pad, tone),
  ...(gap ? [[]] : []),
  ...bar(q, r, tall, shed),
  ...sizes(q, r),
]

/* -------------------------------------------------------------- screen */

/**
 * The foot as built: p save as preset quiet at the bottom left, → continue
 * editing on one row of the shelf grey ending on the block's edge, then a
 * blank row above the rule.
 */
function foot(q: Palette): Row[] {
  const left: Run[] = [run('p', q.dim, undefined, true), run(' save as preset', q.border)]
  const frame: Run[] = [
    run(' ', undefined, q.shelf),
    run(' → ', q.fg, fill(q.keycapBg), true),
    run(' continue editing', q.fg, q.shelf),
    run(' ', undefined, q.shelf),
  ]
  const gap = N - M - M - rowWidth(left) - rowWidth(frame)
  return [[blank(M), ...left, blank(gap), ...frame], []]
}

function keys(q: Palette, r: Result): Row {
  const row: Row = [blank(M + 1)]
  ;(
    [
      ['↵', r.again],
      ['o', 'open'],
      ['s', 'show in Finder'],
    ] as const
  ).forEach(([k, w], i) => {
    if (i) row.push(blank(3))
    row.push(run(` ${k} `, q.fg, fill(q.keycapBg), true), run(` ${w}`, q.dim))
  })
  const quit: Row = [run('ctrl-c', q.fg), run(' quit', q.border)]
  row.push(blank(N - M - 1 - rowWidth(row) - rowWidth(quit)), ...quit)
  return row
}

/**
 * `centred` is Done as built (doneLayout). `up` lifts a taller body a little
 * to make room for it: a blank row less above than below, never fewer than
 * one under the header's own.
 */
type Place = 'centred' | 'up'

/** Rows of the window the body has: all but the header, its blank row, the foot, the rule and the keys. */
const roomFor = (h: number) => h - 2 - 2 - 2

function screen(q: Palette, r: Result, rows: Row[], place: Place, h: number): Row[] {
  const room = roomFor(h)
  const centred = doneLayout({ height: h - 2, body: rows.length, notes: 0 }).top
  const free = room - rows.length
  const above = place === 'up' ? Math.max(1, Math.floor((free - 1) / 2)) : Math.min(centred, free)
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
    ...blanks(above),
    ...rows,
    ...blanks(room - above - rows.length),
    ...foot(q),
    [blank(M), run('─'.repeat(BLOCK), q.border)],
    keys(q, r),
  ]
}

/* ------------------------------------------------------------ concepts */

const q = modePalette(DARK, 'convert')
const shot = (rows: Row[], place: Place, h = 24) =>
  termHtml(q, toGrid(screen(q, CONVERT, rows, place, h), N))

/** The bar that fills: every row the window spares but one above the body and one below it. */
const filling = (h: number, pad: 0 | 1) => roomFor(h) - (pad ? 3 : 1) - 3 - 2
const fills = (h: number) => shot(body(q, CONVERT, 1, filling(h, 1)), 'up', h)

/** Lighter greys for the three-row strip, from the palette's own. */
const LIGHTER: Array<[string, string, string]> = [
  ['L1', '#2c2c2c', 'the selection band’s grey'],
  ['L2', '#333333', 'the key caps’ grey'],
  ['L3', '#3a3a3a', 'between the key caps and the panels'],
  ['L4', '#404040', 'the panels’ grey, as the Save as field'],
]

interface Concept {
  id: string
  name: string
  idea: string
  html: string
  section?: string
  tab?: string
}
const CONCEPTS: Concept[] = [
  {
    id: 'N0',
    name: 'Today, as built',
    idea: 'The strip one row, the bar five, centred in the spare rows. Here to compare against.',
    html: shot(body(q, CONVERT, 0, 5), 'centred'),
    tab: 'Today · a gap',
  },
  {
    id: 'N6',
    name: 'Your idea: a gap under the strip',
    idea: 'Today as built, with one blank row between the strip and the bar. Centred.',
    html: shot(body(q, CONVERT, 0, 5, { gap: true }), 'centred'),
  },
  {
    id: 'N2',
    name: 'A thick strip, a thicker bar, a little higher',
    idea: 'The strip three rows — a whole row of its grey above and below the words — and the bar seven. The block sits a row higher than centred, not against the header.',
    html: shot(body(q, CONVERT, 1, 7), 'up'),
    tab: 'Thicker, a little higher',
  },
  {
    id: 'N4',
    name: 'A much thicker bar',
    idea: 'The three-row strip on a nine-row bar, lifted the same way. At 24 rows that leaves one blank row above it.',
    html: shot(body(q, CONVERT, 1, 9), 'up'),
  },
  {
    id: 'N5',
    name: 'The bar fills the window',
    idea: 'The three-row strip, and the bar takes every spare row but one above and one below. At 24 rows, then 32.',
    html: `<div style="display:flex;flex-direction:column;gap:24px">${fills(24)}${fills(32)}</div>`,
  },
  ...LIGHTER.map(
    ([id, tone, from], i): Concept => ({
      id,
      name: `A lighter strip, ${tone}`,
      idea: `N2 with the strip in ${tone}, ${from}.`,
      html: shot(body(q, CONVERT, 1, 7, { tone }), 'up'),
      ...(i === 0 ? { tab: 'Lighter strips' } : {}),
    }),
  ),
  ...LIGHTER.map(
    ([, tone], i): Concept => ({
      id: `H${i + 1}`,
      name: `Hatching in the strip’s grey, ${tone}`,
      idea: `${LIGHTER[i]?.[0]}’s strip in ${tone}, and the bar’s hatching drawn in the same ${tone} instead of today’s lighter grey.`,
      html: shot(body(q, CONVERT, 1, 7, { tone, shed: { ch: '╱', fg: tone } }), 'up'),
      ...(i === 0 ? { tab: 'Hatching in the strip’s grey' } : {}),
    }),
  ),
  {
    id: 'H5',
    name: 'No hatching: the shed part filled with the strip’s grey',
    idea: 'L2’s strip in #333333, and what the file shed drawn as a solid block of the same #333333, so the strip and the old size read as one material.',
    html: shot(body(q, CONVERT, 1, 7, { tone: '#333333', shed: { ch: ' ', bg: '#333333' } }), 'up'),
  },
]

writeFileSync(
  'mockups/done-2026-10-round19.html',
  feedbackPage({
    page: 'done-round19',
    title: 'Forge · Done, round twenty-five',
    heading: 'Done: thicker, a little higher',
    lede: 'The strip and the → frame are one row each now (the half rows seamed in Apple Terminal). Today against a gap under the strip, the thicker strip and bar lifted only a little, the thick strip in lighter greys, and the hatching in the strip’s grey. Dark, 80 × 24.',
    concepts: CONCEPTS,
  }),
)
console.log('wrote mockups/done-2026-10-round19.html')
