/**
 * The Done screen, round fifteen (2026-10-19). The structure is fixed and
 * the user likes how it looks; this round restyles its pieces one at a
 * time, so each can be picked on its own:
 *
 *   header
 *   p save as preset
 *   …
 *   [chip]                                              [the saving]
 *   [the bar, five rows, the name in it]          ← touches the chip's row
 *
 *   [now]                                                     [was]
 *   …
 *                                                → continue editing
 *   keys
 *
 * Each figure is the body only, at full width; everything but the piece
 * in question is drawn as it is now. Where p goes stays open.
 *
 *   npx tsx scripts/done-mockup-r9.ts   → mockups/done-2026-10-round9.html
 */
import { writeFileSync } from 'node:fs'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, doneLayout, receiptBars } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, width as rowWidth } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette, type Palette } from '../src/shell/theme.js'
import {
  BLOCK,
  chip as chipNow,
  F,
  H,
  M,
  more,
  N,
  name,
  now as nowNow,
  pill as pillNow,
  preset,
  spread,
  tint,
  was as wasNow,
} from './done-pieces.js'
import { feedbackPage } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const SAVED = `${formatBytes(F.before.bytes - F.after.bytes)} saved`
const PCT = changePhrase(F.before.bytes, F.after.bytes)
const NOW = formatBytes(F.after.bytes)
const WAS = formatBytes(F.before.bytes)
const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after

/* ------------------------------------------------------------- the pieces */

interface Look {
  chip: (p: Palette) => Run[]
  saving: (p: Palette) => Run[]
  /** The sizes' rows under the bar, the blank row before them included. */
  sizes: (p: Palette) => Row[]
  bar: (p: Palette) => Row[]
}

/** The bar as it is: band grey, hatching green, the name on the middle row. */
function barWith(
  p: Palette,
  { band = fill(p.panelBand), hatchFg = p.shedHatch, sparse = false, plate = false } = {},
): Row[] {
  const label: Run[] = [run(' '), ...name(p, BLOCK - 4), run(' ')]
  return Array.from({ length: 5 }, (_, r) => {
    const cells: Cell[] = Array.from({ length: BLOCK }, (_, i): Cell => {
      if (i < kept) return { ch: ' ', bg: band }
      if (sparse && (i - kept) % 2 === 1) return { ch: ' ' }
      return { ch: '╱', fg: hatchFg }
    })
    if (plate) {
      if (r >= 1 && r <= 3) {
        const w = rowWidth(label) + 2
        for (let i = kept + 1; i < kept + 1 + w; i++) cells[i] = { ch: ' ', bg: fill(p.keycapBg) }
        if (r === 2) over(cells, kept + 2, label)
      }
    } else if (r === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}

const CURRENT: Look = {
  chip: (p) => [chipNow(p)],
  saving: (p) => [pillNow(p)],
  sizes: (p) => [[], spread(nowNow(p), wasNow(p))],
  bar: (p) => barWith(p),
}

const body = (p: Palette, look: Partial<Look>): Row[] => {
  const l = { ...CURRENT, ...look }
  return [spread(l.chip(p), l.saving(p)), ...l.bar(p), ...l.sizes(p)]
}

/* ----------------------------------------------------------------- screen */

/** The fixed screen: header, p at the top left, the body, → at the bottom right, keys. */
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
  const room = H - 2
  const free = room - 5 - rows.length
  const { top } = doneLayout({ height: room, body: rows.length, notes: 0 })
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
/** The body alone, a blank row above and below, for the galleries. */
const crop = (p: Palette, rows: Row[]) => termHtml(p, toGrid([[], ...rows, []], N))

/* ---------------------------------------------------------------- styles */

interface Style {
  id: string
  name: string
  idea: string
  look: Partial<Look>
}

const CHIPS: Style[] = [
  {
    id: 'C1',
    name: 'As it is',
    idea: 'Both formats in the mode’s colour on its tint.',
    look: {},
  },
  {
    id: 'C2',
    name: 'Solid, like the header’s chip',
    idea: 'The mode’s colour as the fill and dark ink on it: the same object as the “convert” chip in the header bar, so the two read as a pair.',
    look: {
      chip: (p) => {
        const m = modeColours(p, 'convert')
        return [run(` ${F.before.format} → ${F.after.format} `, p.ink, m.fg, true)]
      },
    },
  },
  {
    id: 'C3',
    name: 'Two segments, before and after',
    idea: 'The old format on the key grey, quiet; the new one on the mode’s tint, bold; the arrow between them on the canvas. It reads as a change from one thing to another.',
    look: {
      chip: (p) => {
        const m = modeColours(p, 'convert')
        return [
          run(` ${F.before.format} `, p.dim, fill(p.keycapBg)),
          run(' → ', p.border),
          run(` ${F.after.format} `, m.fg, fill(m.bg), true),
        ]
      },
    },
  },
  {
    id: 'C4',
    name: 'One segmented chip',
    idea: 'C3 joined into one chip: the old format’s half on grey, the new format’s half in the mode’s colour, the arrow at the seam.',
    look: {
      chip: (p) => {
        const m = modeColours(p, 'convert')
        return [
          run(` ${F.before.format} `, p.dim, fill(p.panelBand)),
          run('→', p.fg, fill(p.panelBand)),
          run(` ${F.after.format} `, p.ink, m.fg, true),
        ]
      },
    },
  },
  {
    id: 'C5',
    name: 'No fill',
    idea: 'Just the words: the old format dim, the arrow faint, the new format bold in the mode’s colour. The lightest; the bar does the talking.',
    look: {
      chip: (p) => {
        const m = modeColours(p, 'convert')
        return [
          run(F.before.format, p.dim),
          run(' → ', p.border),
          run(F.after.format, m.fg, undefined, true),
        ]
      },
    },
  },
  {
    id: 'C6',
    name: 'A tab on the band',
    idea: 'The chip takes the band’s grey, so it reads as a tab growing out of the bar’s top-left corner: the formats label the file the band is.',
    look: {
      chip: (p) => {
        const m = modeColours(p, 'convert')
        return [
          run(` ${F.before.format} `, p.dim, fill(p.panelBand)),
          run('→ ', p.border, fill(p.panelBand)),
          run(`${F.after.format} `, m.fg, fill(p.panelBand), true),
        ]
      },
    },
  },
]

const SAVINGS: Style[] = [
  {
    id: 'S1',
    name: 'As it is',
    idea: 'One pill, green on its tint, both halves bold.',
    look: {},
  },
  {
    id: 'S2',
    name: 'A split pill',
    idea: 'The amount saved on the green tint, bold; the percentage on the key grey, quiet. The number that matters most is the brightest.',
    look: {
      saving: (p) => [
        run(` ${SAVED} `, p.ok, tint(p), true),
        run(` ${PCT} `, p.dim, fill(p.keycapBg)),
      ],
    },
  },
  {
    id: 'S3',
    name: 'Words, no pill',
    idea: '“278 KB saved” bold in green, “89.6% smaller” dim after it, no fill. The chip is then the only filled thing on the row.',
    look: {
      saving: (p) => [run(SAVED, p.ok, undefined, true), run('  ·  ', p.border), run(PCT, p.dim)],
    },
  },
  {
    id: 'S4',
    name: 'Solid green',
    idea: 'The pill filled with the green itself and dark ink on it: the loudest thing on the screen, as the saving is the news.',
    look: { saving: (p) => [run(` ${SAVED} · ${PCT} `, p.ink, p.ok, true)] },
  },
  {
    id: 'S5',
    name: 'A tab on the hatching',
    idea: 'The saving takes the hatching’s green, a step lighter, so it reads as a tab growing out of the bar’s top-right corner — the label of what was shed. Pairs with C6.',
    look: {
      saving: (p) => [
        run(` ${SAVED} · ${PCT} `, p.ok, fill(mix(p.shedHatch, p.canvas, 0.55)), true),
      ],
    },
  },
]

const line = (p: Palette) => mix(p.border, p.canvas, 0.45)
const TAGS: Style[] = [
  {
    id: 'T1',
    name: 'As it is',
    idea: 'Two-part tags: the word on the key grey, the size on its own fill — green tint for now, grey for was.',
    look: {},
  },
  {
    id: 'T2',
    name: 'Words, no fills',
    idea: '“now” and “was” dim, the sizes bold after them; now’s in green. The quietest: the sizes are just text under the bar’s ends.',
    look: {
      sizes: (p) => [
        [],
        spread(
          [run('now ', p.dim), run(NOW, p.ok, undefined, true)],
          [run('was ', p.border), run(WAS, p.dim, undefined, true)],
        ),
      ],
    },
  },
  {
    id: 'T3',
    name: 'One pill each',
    idea: 'Each tag one pill, word and size together: now on the green tint, was on the grey. Simpler than two parts.',
    look: {
      sizes: (p) => [
        [],
        spread(
          [run(' now ', p.dim, tint(p)), run(`${NOW} `, p.ok, tint(p), true)],
          [
            run(' was ', p.border, fill(p.panelBand)),
            run(`${WAS} `, p.dim, fill(p.panelBand), true),
          ],
        ),
      ],
    },
  },
  {
    id: 'T4',
    name: 'Brackets from the bar’s ends',
    idea: 'No blank row: a thin bracket rises from each tag to the bar it measures — └ under the band’s start for now, ┘ under the bar’s end for was.',
    look: {
      sizes: (p) => [
        spread(
          [run('└─ ', line(p)), run('now ', p.dim), run(NOW, p.ok, undefined, true)],
          [run('was ', p.border), run(WAS, p.dim, undefined, true), run(' ─┘', line(p))],
        ),
      ],
    },
  },
  {
    id: 'T5',
    name: 'Stacked, the size large',
    idea: 'Two rows each: the word small and quiet on top, the size bold under it, now at the left and was at the right. The sizes read as figures, not labels.',
    look: {
      sizes: (p) => [
        [],
        spread([run('now', p.dim)], [run('was', p.border)]),
        spread([run(NOW, p.ok, undefined, true)], [run(WAS, p.fg, undefined, true)]),
      ],
    },
  },
  {
    id: 'T6',
    name: 'Tags hanging off the bar',
    idea: 'No blank row: the tags hang from the bar’s bottom edge like labels — now in the band’s grey under the band, was on the hatching’s green under the bar’s end.',
    look: {
      sizes: (p) => [
        spread(
          [run(' now ', p.dim, fill(p.panelBand)), run(`${NOW} `, p.ok, fill(p.panelBand), true)],
          [
            run(' was ', p.border, fill(mix(p.shedHatch, p.canvas, 0.6))),
            run(`${WAS} `, p.fg, fill(mix(p.shedHatch, p.canvas, 0.6)), true),
          ],
        ),
      ],
    },
  },
]

const BARS: Style[] = [
  {
    id: 'B1',
    name: 'As it is',
    idea: 'The band grey, the hatching green, the name on the middle row knocked out of the hatching.',
    look: {},
  },
  {
    id: 'B2',
    name: 'The name on a plate',
    idea: 'The name on a three-row plate in the key grey, just past the band, so it never touches the hatching.',
    look: { bar: (p) => barWith(p, { plate: true }) },
  },
  {
    id: 'B3',
    name: 'Quieter hatching',
    idea: 'Hatching on every other column: half as dense, so the bar is calmer and the name stands out.',
    look: { bar: (p) => barWith(p, { sparse: true }) },
  },
  {
    id: 'B4',
    name: 'Grey hatching',
    idea: 'The hatching in a neutral grey instead of green: the green is then only the good news — the saving and the new size.',
    look: { bar: (p) => barWith(p, { hatchFg: mix(p.border, p.canvas, 0.55) }) },
  },
  {
    id: 'B5',
    name: 'The band in green',
    idea: 'The band — the new file — on the green tint the new size has, so the band and “now” read as the same thing.',
    look: { bar: (p) => barWith(p, { band: fill(mix(p.ok, p.canvas, 0.7)) }) },
  },
]

/* ------------------------------------------------------------------- page */

const p = modePalette(DARK, 'convert')
const section = (title: string, styles: Style[]) =>
  styles.map((s, i) => ({
    id: s.id,
    name: s.name,
    idea: s.idea,
    html: crop(p, body(p, s.look)),
    ...(i === 0 ? { section: title } : {}),
  }))

const base = `<h2>The fixed screen</h2>
<p class="lede">As it is now, with your decisions: p at the top left, the chip and the saving on the row touching the bar, the bar five rows tall with the name in it, now and was under it, → at the bottom right. Every figure below is the middle of this screen with one piece drawn another way.</p>
<div style="margin-top:18px">${termHtml(p, toGrid(screen(p, body(p, {})), N))}</div>`

writeFileSync(
  'mockups/done-2026-10-round9.html',
  feedbackPage({
    page: 'done-round9',
    title: 'Forge · Done, round fifteen',
    heading: 'Done, each piece drawn other ways',
    lede: 'The structure is fixed and stays as you like it. This page restyles one piece at a time — the chip, the saving, the now and was tags, the bar — so you can pick each on its own; next round puts your picks together. Dark, 80 × 24.',
    before: base,
    compact: true,
    concepts: [
      ...section('The chip', CHIPS),
      ...section('The saving', SAVINGS),
      ...section('Now and was', TAGS),
      ...section('The bar', BARS),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round9.html')
