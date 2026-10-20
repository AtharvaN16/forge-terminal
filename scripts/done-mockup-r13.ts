/**
 * The Done screen, round nineteen (2026-10-19). Round eighteen
 * (mockups/feedback/done-round12.json): R4 loved — the chip row one grey
 * strip, " PNG → " quiet and "WebP" white at its left, the saving green at
 * its right; everything else unselected, and to be left out. Asked for:
 * the strip in other colours, "a more darker grey would look good".
 *
 * Only the strip's fill changes. Greys stay neutral (no blue in them, as
 * everywhere in the app); one dark blue is there for contrast.
 *
 *   npx tsx scripts/done-mockup-r13.ts   → mockups/done-2026-10-round13.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette, type Palette } from '../src/shell/theme.js'
import { BLOCK, F, H, M, N, name, spread } from './done-pieces.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const CHANGE = `${formatBytes(F.before.bytes - F.after.bytes)} saved · ${changePhrase(F.before.bytes, F.after.bytes)}`
const NOW = formatBytes(F.after.bytes)
const WAS = formatBytes(F.before.bytes)
const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
const blue = (q: Palette) => modeColours(q, 'convert').fg

/* --------------------------------------------------------- the decided */

/** B13: the band a brighter blue, the hatching grey, the name on the middle row. */
function bar(q: Palette): Row[] {
  const label: Run[] = [run(' '), ...name(q, BLOCK - 4), run(' ')]
  return Array.from({ length: 5 }, (_, r) => {
    const cells: Cell[] = Array.from(
      { length: BLOCK },
      (_, i): Cell =>
        i < kept
          ? { ch: ' ', bg: mix(blue(q), q.canvas, 0.5) }
          : { ch: '╱', fg: mix(q.border, q.canvas, 0.55) },
    )
    if (r === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}
/**
 * How the strip is padded (2026-10-19): a whole row of its grey above and
 * below the words; half a row each, drawn with half blocks — which leaves
 * half a row of background between the strip and the bar, since a row
 * cannot be half grey and half hatching; or half a row above only, so the
 * strip still rests on the bar.
 */
type Pad = 'full' | 'half' | 'half-top'

/** R4: the strip, " PNG → " quiet, "WebP" white, the saving green at the far end. */
function strip(q: Palette, tone: string, padding: Pad = 'half'): Row[] {
  const row = (ch: string): Row =>
    ch === ' '
      ? [blank(M), run(' '.repeat(BLOCK), undefined, tone)]
      : [blank(M), run(ch.repeat(BLOCK), tone)]
  const cells = Array.from({ length: BLOCK }, (): Cell => ({ ch: ' ', bg: tone }))
  over(cells, 0, [
    run(` ${F.before.format}`, q.dim),
    run(' → ', q.border),
    run(F.after.format, q.fg, undefined, true),
  ])
  const saving = [run(` ${CHANGE} `, q.ok, undefined, true)]
  over(cells, BLOCK - rowWidth(saving), saving)
  const words: Row = [blank(M), ...rowOf(cells)]
  if (padding === 'full') return [row(' '), words, row(' ')]
  if (padding === 'half') return [row('▄'), words, row('▀')]
  return [row('▄'), words]
}
/** T5: stacked, the word quiet over the size. */
const sizes = (q: Palette): Row[] => [
  [],
  spread([run('now', q.dim)], [run('was', q.border)]),
  spread([run(NOW, q.ok, undefined, true)], [run(WAS, q.fg, undefined, true)]),
]
const body = (q: Palette, tone: string, padding: Pad = 'half'): Row[] => [
  ...strip(q, tone, padding),
  ...bar(q),
  ...sizes(q),
]

/** The whole screen: p held at the top left until it has a place, → at the bottom right. */
function screen(q: Palette, rows: Row[]): Row[] {
  const cap = (k: string, w: string): Run[] => [
    run(` ${k} `, q.fg, fill(q.keycapBg), true),
    run(` ${w}`, q.dim),
  ]
  const keys: Row = [blank(M + 1)]
  for (const [i, [k, w]] of (
    [
      ['↵', 'convert another'],
      ['o', 'open'],
      ['s', 'show in finder'],
    ] as const
  ).entries()) {
    if (i) keys.push(blank(2))
    keys.push(...cap(k, w))
  }
  const quit: Row = [run('ctrl-c', q.fg), run(' quit', q.border)]
  keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)
  const more = cap('→', 'continue editing')
  const room = H - 4
  const free = room - 3 - rows.length
  const { top } = doneLayout({ height: room, body: rows.length, notes: 0 })
  const above = Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    trailBarRow({
      width: N,
      palette: q,
      mode: 'convert',
      trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
      slanted: false,
    }),
    [],
    [blank(M), ...cap('p', 'save as preset')],
    [],
    ...blanks(above),
    ...rows,
    ...blanks(free - above),
    [blank(N - 1 - rowWidth(more)), ...more],
    [run('─'.repeat(N), q.border)],
    keys,
  ]
}

/* --------------------------------------------------------------- tones */

interface Tone {
  id: string
  name: string
  idea: string
  tone: (q: Palette) => string
  earlier?: PageConcept['earlier']
}
const TONES: Tone[] = [
  {
    id: 'R4',
    name: 'As you picked it',
    idea: 'The saving tab’s grey, carried across the row.',
    tone: (q) => mix(q.border, q.canvas, 0.75),
    earlier: 'love',
  },
  {
    id: 'R6',
    name: 'A step darker',
    idea: 'One step down from R4, the key caps’ grey: still clearly a strip, a little quieter against the bright blue band.',
    tone: (q) => q.keycapBg,
  },
  {
    id: 'R7',
    name: 'Darker',
    idea: 'Two steps down: the strip recedes and the white WebP and green saving carry it.',
    tone: (q) => mix(q.border, q.canvas, 0.82),
  },
  {
    id: 'R8',
    name: 'Darker still',
    idea: 'The chosen-row grey the lists use: the strip is a shade off the background, just enough to hold the row together.',
    tone: (q) => q.selectionBg,
  },
  {
    id: 'R9',
    name: 'Nearly the background',
    idea: 'The drop field’s grey: the faintest strip that still reads as one, the words almost on their own.',
    tone: (q) => q.shelf,
  },
  {
    id: 'R10',
    name: 'Lighter, the band’s grey',
    idea: 'For contrast, the other way: the panel grey the band used to be. A brighter lid on the bar.',
    tone: (q) => q.panelBand,
  },
  {
    id: 'R11',
    name: 'A dark blue',
    idea: 'Not a grey: a deep shade of convert’s blue, so the strip belongs to the blue band under it. For contrast with the greys.',
    tone: (q) => mix(blue(q), q.canvas, 0.85),
  },
]

const PADS: { id: string; name: string; idea: string; padding: Pad }[] = [
  {
    id: 'V1',
    name: 'Whole rows',
    idea: 'A full row of the grey above and below the words, as you asked last time: the strip is three rows tall and rests on the bar.',
    padding: 'full',
  },
  {
    id: 'V2',
    name: 'Half rows, above and below',
    idea: 'Half a row of grey above the words and half below, drawn with half blocks: the strip is two rows tall. A row cannot be half grey and half hatching, so half a row of background shows between the strip and the bar.',
    padding: 'half',
  },
  {
    id: 'V3',
    name: 'Half a row above only',
    idea: 'Half a row of grey above the words and none below, so the strip still rests on the bar with no gap; the bar’s own top is the strip’s lower edge.',
    padding: 'half-top',
  },
]

/* ---------------------------------------------------------------- page */

const q = modePalette(DARK, 'convert')
const crop = (rows: Row[]) => termHtml(q, toGrid([[], ...rows, []], N))
const hex = (c: string) => `<code>${c}</code>`

const before = `<h2>Where it stands</h2>
<p class="lede">The chip row as R4, padded with half a row of its grey above and below the words (V2) — the bar B13, the sizes T5, → at the bottom right. p is held at the top left until it has a place. Below, only the strip’s fill changes; its colour is under each name.</p>
<div style="margin-top:18px">${termHtml(q, toGrid(screen(q, body(q, mix(q.border, q.canvas, 0.75))), N))}</div>`

writeFileSync(
  'mockups/done-2026-10-round13.html',
  feedbackPage({
    page: 'done-round13',
    title: 'Forge · Done, round nineteen',
    heading: 'Done: the strip in other greys',
    lede: 'Only what you picked is here: the strip (R4) on the screen as it stands. First its padding — whole rows, or halved as you asked — then the strip in darker greys, one lighter and one dark blue for contrast. Half rows use half-block characters: in Ghostty they are seamless; in Apple Terminal they have shown thin seams before, so worth a look there. Dark, 80 × 24.',
    before,
    compact: true,
    concepts: [
      ...PADS.map((v, i) => ({
        id: v.id,
        name: v.name,
        idea: v.idea,
        html: crop(body(q, mix(q.border, q.canvas, 0.75), v.padding)),
        ...(i === 0 ? { section: 'The padding' } : {}),
      })),
      ...TONES.map((t, i) => ({
        id: t.id,
        name: t.name,
        idea: `${t.idea}`,
        html: `<div style="display:flex; flex-direction:column; gap:8px">${crop(body(q, t.tone(q)))}<div style="font:12px 'SF Mono', monospace; color:#8f94a1">strip ${hex(t.tone(q))}</div></div>`,
        earlier: t.earlier,
        ...(i === 0 ? { section: 'The strip’s colour, with V2’s half rows' } : {}),
      })),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round13.html')
