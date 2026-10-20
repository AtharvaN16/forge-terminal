/**
 * The Done screen, round sixteen (2026-10-19). From round fifteen's
 * verdicts (mockups/feedback/done-round9.json):
 *
 * - chip: as it is (C1, the only one not disliked);
 * - bar: as it is (B1, liked); grey hatching (B4) has potential, and the
 *   user asked to see the hatching in the theme colour (convert's blue),
 *   or both the hatching and the bar;
 * - saving: S4 solid green and S5 a tab on the hatching have potential;
 *   the pill as it is, split, and words alone are disliked;
 * - now and was: T1 as it is, T2 words without fills and T5 stacked are
 *   liked; T4 brackets and T6 hanging tags have potential.
 *
 * So: the bar in blue, a few savings and tags near the liked ones, and the
 * liked pieces put together as whole screens. The structure stays fixed:
 * p at the top left, the chip's row touching the five-row bar with the name
 * in it, now and was under it, → at the bottom right.
 *
 *   npx tsx scripts/done-mockup-r10.ts   → mockups/done-2026-10-round10.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import {
  blank,
  gradientAt,
  mix,
  type Row,
  type Run,
  width as rowWidth,
} from '../src/shell/home-art.js'
import { DARK, modeColours, modeGradient, modePalette, type Palette } from '../src/shell/theme.js'
import {
  BLOCK,
  chip,
  F,
  H,
  M,
  more,
  N,
  name,
  now as nowTag,
  preset,
  spread,
  tint,
  was as wasTag,
} from './done-pieces.js'
import { feedbackPage } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const SAVED = `${formatBytes(F.before.bytes - F.after.bytes)} saved`
const PCT = changePhrase(F.before.bytes, F.after.bytes)
const NOW = formatBytes(F.after.bytes)
const WAS = formatBytes(F.before.bytes)
const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
const blue = (p: Palette) => modeColours(p, 'convert').fg

/* -------------------------------------------------------------------- bar */

/**
 * The bar: `band` fills the new file's length; `hatchAt(i)` colours the
 * hatching's column `i`. The name on the middle row, knocked out.
 */
function barWith(
  p: Palette,
  { band = fill(p.panelBand), hatchAt = (_i: number) => p.shedHatch } = {},
): Row[] {
  const label: Run[] = [run(' '), ...name(p, BLOCK - 4), run(' ')]
  return Array.from({ length: 5 }, (_, r) => {
    const cells: Cell[] = Array.from(
      { length: BLOCK },
      (_, i): Cell => (i < kept ? { ch: ' ', bg: band } : { ch: '╱', fg: hatchAt(i) }),
    )
    if (r === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}
/** The header bar's own gradient, dimmed as the hatching is, across the bar. */
const gradientHatch = (p: Palette) => (i: number) =>
  mix(gradientAt(i, BLOCK, modeGradient(p, 'convert')), p.canvas, 0.45)

/* ------------------------------------------------------------ the pieces */

interface Look {
  saving: (p: Palette) => Run[]
  sizes: (p: Palette) => Row[]
  bar: (p: Palette) => Row[]
}
const solidGreen = (p: Palette): Run[] => [run(` ${SAVED} · ${PCT} `, p.ink, p.ok, true)]
const hatchTab = (p: Palette): Run[] => [
  run(` ${SAVED} · ${PCT} `, p.ok, fill(mix(p.shedHatch, p.canvas, 0.55)), true),
]
const T1 = (p: Palette): Row[] => [[], spread(nowTag(p), wasTag(p))]
const T2 = (p: Palette): Row[] => [
  [],
  spread(
    [run('now ', p.dim), run(NOW, p.ok, undefined, true)],
    [run('was ', p.border), run(WAS, p.dim, undefined, true)],
  ),
]
const T5 = (p: Palette): Row[] => [
  [],
  spread([run('now', p.dim)], [run('was', p.border)]),
  spread([run(NOW, p.ok, undefined, true)], [run(WAS, p.fg, undefined, true)]),
]

/** What the galleries hold still: the best-liked of each piece. */
const BEST: Look = { saving: solidGreen, sizes: T1, bar: (p) => barWith(p) }
const body = (p: Palette, look: Partial<Look>): Row[] => {
  const l = { ...BEST, ...look }
  return [spread([chip(p)], l.saving(p)), ...l.bar(p), ...l.sizes(p)]
}

/* ----------------------------------------------------------------- screen */

function screen(p: Palette, rows: Row[]): Row[] {
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
  const hint: Row = [blank(N - 1 - rowWidth(more(p))), ...more(p)]
  const free = H - 7 - rows.length
  const { top } = doneLayout({ height: H - 2, body: rows.length, notes: 0 })
  const above = Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    header,
    [],
    [blank(M), ...preset(p)],
    [],
    ...blanks(above),
    ...rows,
    ...blanks(free - above),
    hint,
    [run('─'.repeat(N), p.border)],
    keys,
  ]
}
const p = modePalette(DARK, 'convert')
const crop = (rows: Row[]) => termHtml(p, toGrid([[], ...rows, []], N))
const whole = (rows: Row[]) => termHtml(p, toGrid(screen(p, rows), N))

/* ----------------------------------------------------------------- styles */

interface Style {
  id: string
  name: string
  idea: string
  look: Partial<Look>
  /** Its verdict in round fifteen, for the badge. */
  earlier?: 'like' | 'potential'
}

/* Round fifteen's liked and potential styles, carried forward with badges. */
const line = (q: Palette) => mix(q.border, q.canvas, 0.45)
const EARLIER_BARS: Style[] = [
  {
    id: 'B1',
    name: 'As it is',
    idea: 'The band grey, the hatching green, the name on the middle row.',
    look: {},
    earlier: 'like',
  },
  {
    id: 'B4',
    name: 'Grey hatching',
    idea: 'The hatching in a neutral grey: green is then only the good news.',
    look: { bar: (q) => barWith(q, { hatchAt: () => mix(q.border, q.canvas, 0.55) }) },
    earlier: 'potential',
  },
  {
    id: 'B5',
    name: 'The band in green',
    idea: 'The band on the green tint the new size has.',
    look: { bar: (q) => barWith(q, { band: fill(mix(q.ok, q.canvas, 0.7)) }) },
    earlier: 'potential',
  },
]
const EARLIER_SAVINGS: Style[] = [
  {
    id: 'S4',
    name: 'Solid green',
    idea: 'The pill filled with the green itself, dark ink on it.',
    look: {},
    earlier: 'potential',
  },
  {
    id: 'S5',
    name: 'A tab on the hatching',
    idea: 'The saving in the hatching’s green, a tab off the bar’s top-right corner.',
    look: { saving: hatchTab },
    earlier: 'potential',
  },
]
const EARLIER_TAGS: Style[] = [
  {
    id: 'T1',
    name: 'As it is',
    idea: 'Two-part tags: the word on grey, the size on its fill.',
    look: {},
    earlier: 'like',
  },
  {
    id: 'T2',
    name: 'Words, no fills',
    idea: '“now” and “was” dim, the sizes bold after them.',
    look: { sizes: T2 },
    earlier: 'like',
  },
  {
    id: 'T5',
    name: 'Stacked, the size large',
    idea: 'The word quiet on top, the size bold under it.',
    look: { sizes: T5 },
    earlier: 'like',
  },
  {
    id: 'T4',
    name: 'Brackets from the bar’s ends',
    idea: 'No blank row: a thin bracket rises from each tag to the bar’s end it measures.',
    look: {
      sizes: (q) => [
        spread(
          [run('└─ ', line(q)), run('now ', q.dim), run(NOW, q.ok, undefined, true)],
          [run('was ', q.border), run(WAS, q.dim, undefined, true), run(' ─┘', line(q))],
        ),
      ],
    },
    earlier: 'potential',
  },
  {
    id: 'T6',
    name: 'Tags hanging off the bar',
    idea: 'No blank row: now on the band’s grey under the band, was on the hatching’s green under the bar’s end.',
    look: {
      sizes: (q) => [
        spread(
          [run(' now ', q.dim, fill(q.panelBand)), run(`${NOW} `, q.ok, fill(q.panelBand), true)],
          [
            run(' was ', q.border, fill(mix(q.shedHatch, q.canvas, 0.6))),
            run(`${WAS} `, q.fg, fill(mix(q.shedHatch, q.canvas, 0.6)), true),
          ],
        ),
      ],
    },
    earlier: 'potential',
  },
]

const BARS: Style[] = [
  {
    id: 'B6',
    name: 'Blue hatching',
    idea: 'The hatching in convert’s blue, dimmed as the green was; the band stays grey. The bar takes the mode’s colour, like the header above it.',
    look: { bar: (q) => barWith(q, { hatchAt: () => mix(blue(q), q.canvas, 0.5) }) },
  },
  {
    id: 'B7',
    name: 'Hatching in the header’s gradient',
    idea: 'The hatching runs through the header bar’s own gradient, blue into violet, left to right: the bar is drawn the way the header is.',
    look: { bar: (q) => barWith(q, { hatchAt: gradientHatch(q) }) },
  },
  {
    id: 'B8',
    name: 'Blue band and blue hatching',
    idea: 'Both in blue: the band a solid tint of it, the hatching the dimmed blue. The whole bar is one colour, the new file solid and the shed part drawn.',
    look: {
      bar: (q) =>
        barWith(q, {
          band: fill(mix(blue(q), q.canvas, 0.7)),
          hatchAt: () => mix(blue(q), q.canvas, 0.5),
        }),
    },
  },
  {
    id: 'B9',
    name: 'Blue band, gradient hatching',
    idea: 'B8’s blue band with B7’s gradient hatching: the band is where the gradient starts, and the shed part fades away from it into violet.',
    look: {
      bar: (q) =>
        barWith(q, { band: fill(mix(blue(q), q.canvas, 0.7)), hatchAt: gradientHatch(q) }),
    },
  },
  {
    id: 'B10',
    name: 'Blue band, grey hatching',
    idea: 'B4’s grey hatching with the band in blue: only the new file has colour; what was shed is neutral.',
    look: {
      bar: (q) =>
        barWith(q, {
          band: fill(mix(blue(q), q.canvas, 0.7)),
          hatchAt: () => mix(q.border, q.canvas, 0.55),
        }),
    },
  },
]

const SAVINGS: Style[] = [
  {
    id: 'S6',
    name: 'Solid green, two tones',
    idea: 'S4’s solid green for “278 KB saved”, and “89.6% smaller” on the green’s tint beside it: the amount is the loudest, the percentage one step back.',
    look: {
      saving: (q) => [run(` ${SAVED} `, q.ink, q.ok, true), run(` ${PCT} `, q.ok, tint(q), true)],
    },
  },
  {
    id: 'S7',
    name: 'Solid, a softer green',
    idea: 'S4, the fill a step darker than the bright green, so it is solid without glowing; white text on it.',
    look: {
      saving: (q) => [run(` ${SAVED} · ${PCT} `, q.fg, mix(q.ok, q.canvas, 0.4), true)],
    },
  },
  {
    id: 'S8',
    name: 'Between S4 and S5',
    idea: 'The tab’s idea — the saving labels the shed part — with more weight: the hatching’s green, brighter, the words in white.',
    look: {
      saving: (q) => [run(` ${SAVED} · ${PCT} `, q.fg, mix(q.shedHatch, q.canvas, 0.15), true)],
    },
  },
]

const TAGS: Style[] = [
  {
    id: 'T7',
    name: 'Stacked, the size on its fill',
    idea: 'T5’s two rows, with T1’s fills on the sizes: the word quiet above, the size on its green or grey below.',
    look: {
      sizes: (q) => [
        [],
        spread([run(' now', q.dim)], [run('was ', q.border)]),
        spread(
          [run(` ${NOW} `, q.ok, tint(q), true)],
          [run(` ${WAS} `, q.dim, fill(q.panelBand), true)],
        ),
      ],
    },
  },
  {
    id: 'T8',
    name: 'Words with brackets',
    idea: 'T2’s words with T4’s brackets: no fills, and a thin corner ties each size to its end of the bar.',
    look: {
      sizes: (q) => [
        spread(
          [run('└ ', line(q)), run('now ', q.dim), run(NOW, q.ok, undefined, true)],
          [run('was ', q.border), run(WAS, q.dim, undefined, true), run(' ┘', line(q))],
        ),
      ],
    },
  },
  {
    id: 'T9',
    name: 'Stacked, hanging off the bar',
    idea: 'T5’s two rows with no blank row above them, so the word sits right under the bar’s edge, as T6’s tags hang.',
    look: {
      sizes: (q) => [
        spread([run('now', q.dim)], [run('was', q.border)]),
        spread([run(NOW, q.ok, undefined, true)], [run(WAS, q.fg, undefined, true)]),
      ],
    },
  },
]

/** The liked pieces as whole screens: two savings by three tag styles. */
const TOGETHER: Style[] = (
  [
    ['S4', solidGreen],
    ['S5', hatchTab],
  ] as const
).flatMap(([s, saving]) =>
  (
    [
      ['T1', T1],
      ['T2', T2],
      ['T5', T5],
    ] as const
  ).map(([t, sizes]) => ({
    id: `${s}+${t}`,
    name: `${s === 'S4' ? 'Solid green' : 'The hatching tab'}, ${t === 'T1' ? 'tags as they are' : t === 'T2' ? 'sizes as words' : 'sizes stacked'}`,
    idea: `The whole screen with the chip as it is, the bar as it is, the saving ${s === 'S4' ? 'solid green (S4)' : 'as a tab on the hatching (S5)'} and now and was ${t === 'T1' ? 'as they are (T1)' : t === 'T2' ? 'as words without fills (T2)' : 'stacked, the sizes under the words (T5)'}.`,
    look: { saving, sizes },
  })),
)

/* ------------------------------------------------------------------- page */

const section = (title: string, styles: Style[], draw: (rows: Row[]) => string) =>
  styles.map((s, i) => ({
    id: s.id,
    name: s.name,
    idea: s.idea,
    html: draw(body(p, s.look)),
    earlier: s.earlier,
    ...(i === 0 ? { section: title } : {}),
  }))

writeFileSync(
  'mockups/done-2026-10-round10.html',
  feedbackPage({
    page: 'done-round10',
    title: 'Forge · Done, round sixteen',
    heading: 'Done, the bar in blue, and the liked pieces together',
    lede: 'Kept from your answers: the chip as it is. Your liked and potential styles from last round are back in each section, badged, ahead of the new ones. The bar in convert’s blue, as you asked; a few savings and tags next to the ones you liked; then whole screens made only of liked pieces. In the galleries everything but the piece in question is the best-liked so far: solid green saving (S4), tags as they are (T1), the bar as it is. Dark, 80 × 24.',
    compact: true,
    concepts: [
      ...section('The bar: yours from last round, then in blue', [...EARLIER_BARS, ...BARS], crop),
      ...section(
        'The saving: yours from last round, then new',
        [...EARLIER_SAVINGS, ...SAVINGS],
        crop,
      ),
      ...section('Now and was: yours from last round, then new', [...EARLIER_TAGS, ...TAGS], crop),
      ...section('Put together: only liked pieces', TOGETHER, whole),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round10.html')
