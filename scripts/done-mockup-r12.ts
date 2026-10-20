/**
 * The Done screen, round eighteen (2026-10-19). From round seventeen
 * (mockups/feedback/done-round11.json): the bar B13 loved (brighter blue
 * band, grey hatching), the saving S9 loved (a tab in the grey hatching's
 * tone, green words), the sizes T5 loved; every gradient disliked; none of
 * the key concepts K1–K7 liked. → stays at the bottom right; p is unplaced.
 *
 * Asked for: different concepts for the PNG → WebP chip. Round fifteen
 * hated or disliked C2–C6 (solid, two segments, one segmented chip, no
 * fill, a grey tab on the band), so none of those come back. With S9 loved,
 * several here are its twin on the left.
 *
 *   npx tsx scripts/done-mockup-r12.ts   → mockups/done-2026-10-round12.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette, type Palette } from '../src/shell/theme.js'
import { BLOCK, chip as chipAsIs, F, H, M, N, name, spread } from './done-pieces.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const CHANGE = `${formatBytes(F.before.bytes - F.after.bytes)} saved · ${changePhrase(F.before.bytes, F.after.bytes)}`
const NOW = formatBytes(F.after.bytes)
const WAS = formatBytes(F.before.bytes)
const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
const blue = (q: Palette) => modeColours(q, 'convert').fg
/** S9's tab: the grey hatching's tone. */
const tabTone = (q: Palette) => mix(q.border, q.canvas, 0.75)
/** B13's band. */
const bandBlue = (q: Palette) => mix(blue(q), q.canvas, 0.5)
const { before: FROM, after: TO } = { before: F.before.format, after: F.after.format }

/* ------------------------------------------------- the decided pieces */

/** B13: the band brighter blue, the hatching grey, the name on the middle row. */
function bar(q: Palette): Row[] {
  const label: Run[] = [run(' '), ...name(q, BLOCK - 4), run(' ')]
  return Array.from({ length: 5 }, (_, r) => {
    const cells: Cell[] = Array.from(
      { length: BLOCK },
      (_, i): Cell =>
        i < kept ? { ch: ' ', bg: bandBlue(q) } : { ch: '╱', fg: mix(q.border, q.canvas, 0.55) },
    )
    if (r === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}
/** S9: the saving on the hatching's tone, green and bold. */
const saving = (q: Palette): Run[] => [run(` ${CHANGE} `, q.ok, tabTone(q), true)]
/** T5: stacked, the word quiet over the size. */
const sizes = (q: Palette): Row[] => [
  [],
  spread([run('now', q.dim)], [run('was', q.border)]),
  spread([run(NOW, q.ok, undefined, true)], [run(WAS, q.fg, undefined, true)]),
]
const body = (q: Palette, chipRuns: Run[], afterChip: Run[] = []): Row[] => [
  spread([...chipRuns, ...afterChip], saving(q)),
  ...bar(q),
  ...sizes(q),
]

/* ---------------------------------------------------------------- keys */

const cap = (q: Palette, k: string, words: string): Run[] => [
  run(` ${k} `, q.fg, fill(q.keycapBg), true),
  run(` ${words}`, q.dim),
]
const preset = (q: Palette) => cap(q, 'p', 'save as preset')
const more = (q: Palette) => cap(q, '→', 'continue editing')
const atRight = (runs: Run[]): Row => [blank(N - 1 - rowWidth(runs)), ...runs]

/* -------------------------------------------------------------- screen */

interface Frame {
  /** A row under the header, if p is there. */
  top?: Row
  /** Rows above the rule, the last one at the bottom. */
  foot?: Row[]
  /** The key row's keys. */
  keys?: Array<[string, string]>
}
function screen(q: Palette, rows: Row[], { top, foot, keys: own }: Frame = {}): Row[] {
  const header = trailBarRow({
    width: N,
    palette: q,
    mode: 'convert',
    trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
    slanted: false,
  })
  const list = own ?? [
    ['↵', 'convert another'],
    ['o', 'open'],
    ['s', 'show in finder'],
  ]
  const keys: Row = [blank(M + 1)]
  list.forEach(([k, w], i) => {
    if (i) keys.push(blank(2))
    keys.push(run(` ${k} `, q.fg, fill(q.keycapBg), true), run(` ${w}`, q.dim))
  })
  // The footnote goes when it does not fit, as the key row drops it.
  const quit: Row = [run('ctrl-c', q.fg), run(' quit', q.border)]
  if (rowWidth(keys) + 3 + rowWidth(quit) + 1 <= N) {
    keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)
  }
  const bottom = foot ?? [atRight(more(q))]
  const headRows: Row[] = top ? [top, []] : []
  const room = H - 2 - headRows.length
  const free = room - 2 - bottom.length - rows.length
  const { top: centre } = doneLayout({ height: room, body: rows.length, notes: 0 })
  const above = Math.min(centre, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    header,
    [],
    ...headRows,
    ...blanks(above),
    ...rows,
    ...blanks(free - above),
    ...bottom,
    [run('─'.repeat(N), q.border)],
    keys,
  ]
}
/** Where it stands: p at the top left (unplaced, held there), → at the bottom right. */
const standing = (q: Palette, rows: Row[]) => screen(q, rows, { top: [blank(M), ...preset(q)] })

/* ---------------------------------------------------------------- chips */

interface Chip {
  id: string
  name: string
  idea: string
  draw: (q: Palette) => Run[]
  earlier?: PageConcept['earlier']
}
const CHIPS: Chip[] = [
  {
    id: 'C1',
    name: 'As it is',
    idea: 'Both formats in the mode’s blue on its dark tint.',
    draw: (q) => [chipAsIs(q)],
    earlier: 'potential',
  },
  {
    id: 'C7',
    name: 'The saving’s twin',
    idea: 'The chip on S9’s grey tone, the formats bold in blue: the row is two matching tabs, the formats at the band’s end of the bar and the saving at the hatching’s end, each in its own colour.',
    draw: (q) => [run(` ${FROM} → ${TO} `, blue(q), tabTone(q), true)],
  },
  {
    id: 'C8',
    name: 'The twin, the new format leading',
    idea: 'C7 with the old format dim and the arrow faint, so “WebP” is what you read: what the file is now.',
    draw: (q) => [
      run(` ${FROM}`, q.dim, tabTone(q)),
      run(' → ', q.border, tabTone(q)),
      run(`${TO} `, blue(q), tabTone(q), true),
    ],
  },
  {
    id: 'C9',
    name: 'The twin, in white',
    idea: 'C8 with the new format in white instead of blue: the chip stays neutral, the blue is only the band, the green only the saving.',
    draw: (q) => [
      run(` ${FROM}`, q.dim, tabTone(q)),
      run(' → ', q.border, tabTone(q)),
      run(`${TO} `, q.fg, tabTone(q), true),
    ],
  },
  {
    id: 'C10',
    name: 'The band’s own blue',
    idea: 'The chip filled with B13’s band blue, white words: the band’s label, as S9 is the hatching’s. (A grey tab on the band, C6, was hated; this is the same idea in the new blue — skip it if it is still a no.)',
    draw: (q) => [run(` ${FROM} → ${TO} `, q.fg, bandBlue(q), true)],
  },
  {
    id: 'C11',
    name: 'As extensions',
    idea: 'The formats written as the files’ own extensions, lower case, on the twin tab: “png → webp” reads as the file’s name changing, which is what happened.',
    draw: (q) => [
      run(` ${FROM.toLowerCase()}`, q.dim, tabTone(q)),
      run(' → ', q.border, tabTone(q)),
      run(`${TO.toLowerCase()} `, blue(q), tabTone(q), true),
    ],
  },
  {
    id: 'C12',
    name: 'A longer arrow',
    idea: 'The twin tab with the arrow drawn long, a short rule into its head: the conversion reads as a movement from one to the other, not a list.',
    draw: (q) => [
      run(` ${FROM} `, q.dim, tabTone(q)),
      run('──→', q.border, tabTone(q)),
      run(` ${TO} `, blue(q), tabTone(q), true),
    ],
  },
  {
    id: 'C13',
    name: 'As it is, brighter',
    idea: 'C1 — the one you kept — with its tint a step brighter and the words in white, so it holds its own next to S9 and the brighter band.',
    draw: (q) => [run(` ${FROM} → ${TO} `, q.fg, mix(blue(q), q.canvas, 0.72), true)],
  },
]

/* ------------------------------------------ the chip row as one grey band */

/**
 * The user's idea (2026-10-19): join the chip and the saving with a band in
 * the saving's own grey, so the row is one strip touching the bar. The
 * chip's runs keep their fill where they have one; everything else on the
 * row is the band.
 */
function bandRow(q: Palette, chipRuns: Run[]): Row {
  const tone = tabTone(q)
  const cells = Array.from({ length: BLOCK }, (): Cell => ({ ch: ' ', bg: tone }))
  over(cells, 0, chipRuns)
  const s = saving(q)
  over(cells, BLOCK - rowWidth(s), s)
  return [blank(M), ...rowOf(cells)]
}
const bandBody = (q: Palette, chipRuns: Run[]): Row[] => [
  bandRow(q, chipRuns),
  ...bar(q),
  ...sizes(q),
]

const BANDS: Chip[] = [
  {
    id: 'R1',
    name: 'Your idea: one grey band, the chip as it is',
    idea: 'The chip row filled end to end with the saving’s grey: the blue chip at its left, the saving at its right, one strip between them lying on the bar.',
    draw: (q) => [chipAsIs(q)],
  },
  {
    id: 'R2',
    name: 'One band, the formats on it in blue',
    idea: 'The chip’s own fill goes: the formats are blue words on the grey band, the saving green words on it. One strip, two labels, no boxes inside it.',
    draw: (q) => [run(` ${FROM} → ${TO}`, blue(q), undefined, true)],
  },
  {
    id: 'R3',
    name: 'One band, the new format leading',
    idea: 'R2 with PNG dim and the arrow faint, so “WebP” and the saving are the two bright things on the strip.',
    draw: (q) => [run(` ${FROM}`, q.dim), run(' → ', q.border), run(TO, blue(q), undefined, true)],
  },
  {
    id: 'R4',
    name: 'One band, the formats in white',
    idea: 'R3 with WebP in white: the strip is neutral apart from the saving’s green; the blue stays in the band below.',
    draw: (q) => [run(` ${FROM}`, q.dim), run(' → ', q.border), run(TO, q.fg, undefined, true)],
  },
  {
    id: 'R5',
    name: 'One band, the chip in the band’s blue',
    idea: 'The grey band with the chip filled in B13’s blue, sitting right above the blue band of the bar: the chip reads as the top of the new file, the saving as the top of what was shed.',
    draw: (q) => [run(` ${FROM} → ${TO} `, q.fg, bandBlue(q), true)],
  },
]

/* ------------------------------------------------------- where p goes */

interface Place {
  id: string
  name: string
  idea: string
  frame: (q: Palette) => Frame
}
const PLACES: Place[] = [
  {
    id: 'K8',
    name: 'In the key row',
    idea: 'p joins the keys at the bottom, after ↵: it is one more thing to do next. At 80 columns the key row then has no room for “ctrl-c quit”, and drops it, as it does in any narrow window.',
    frame: () => ({
      keys: [
        ['↵', 'convert another'],
        ['p', 'save as preset'],
        ['o', 'open'],
        ['s', 'show in finder'],
      ],
    }),
  },
  {
    id: 'K9',
    name: 'Beside →, both at the bottom right',
    idea: 'p sits just left of →, the two together at the bottom right: the two things the converted file can go on to, in one place.',
    frame: (q) => ({ foot: [atRight([...preset(q), blank(3), ...more(q)])] }),
  },
  {
    id: 'K10',
    name: 'Above →, at the bottom right',
    idea: 'p on its own row just above →, both ending at the right edge: a short stack in the corner, → on the bottom as decided.',
    frame: (q) => ({ foot: [atRight(preset(q)), atRight(more(q))] }),
  },
  {
    id: 'K11',
    name: 'At the top right',
    idea: 'p on the row under the header, at the right: out of the way of the result, across the screen from →.',
    frame: (q) => ({ top: atRight(preset(q)) }),
  },
]

/* ---------------------------------------------------------------- page */

const q = modePalette(DARK, 'convert')
const crop = (rows: Row[]) => termHtml(q, toGrid([[], ...rows, []], N))
const base = body(q, [chipAsIs(q)])

const before = `<h2>Where it stands</h2>
<p class="lede">Your loves together: the bar B13 (brighter blue band, grey hatching), the saving S9 (a tab on the hatching’s grey), the sizes T5 (stacked); the chip as it is; → at the bottom right. p sits at the top left only because it has to sit somewhere — where it goes is the second section.</p>
<div style="margin-top:18px">${termHtml(q, toGrid(standing(q, base), N))}</div>`

writeFileSync(
  'mockups/done-2026-10-round12.html',
  feedbackPage({
    page: 'done-round12',
    title: 'Forge · Done, round eighteen',
    heading: 'Done: the PNG → WebP chip, and where p goes',
    lede: 'Concepts for the formats’ chip, each on the screen as it stands; then four new places for p save as preset, none of them K1–K7. Dark, 80 × 24. Your “Why?” notes from last round did not reach me — if you wrote any, they are worth a second try here.',
    before,
    compact: true,
    concepts: [
      ...BANDS.map((c, i) => ({
        id: c.id,
        name: c.name,
        idea: c.idea,
        html: crop(bandBody(q, c.draw(q))),
        ...(i === 0 ? { section: 'The chip and the saving joined by one grey band' } : {}),
      })),
      ...CHIPS.map((c, i) => ({
        id: c.id,
        name: c.name,
        idea: c.idea,
        html: crop(body(q, c.draw(q))),
        earlier: c.earlier,
        ...(i === 0 ? { section: 'The PNG → WebP chip' } : {}),
      })),
      ...PLACES.map((pl, i) => ({
        id: pl.id,
        name: pl.name,
        idea: pl.idea,
        html: termHtml(q, toGrid(screen(q, base, pl.frame(q)), N)),
        ...(i === 0
          ? { section: 'Where p save as preset goes (→ stays at the bottom right)' }
          : {}),
      })),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round12.html')
