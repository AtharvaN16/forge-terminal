/**
 * The Done screen, round seventeen (2026-10-19). From round sixteen's
 * verdicts (mockups/feedback/done-round10.json):
 *
 * - bar: B10 loved (the band in convert's blue, the hatching grey); B5
 *   green band and B9 blue band with gradient hatching have potential —
 *   "I like the gradient but not on the hatching, maybe some other
 *   elements"; the bar as it was (B1) is now disliked;
 * - now and was: T5 loved (stacked, the size large); T1, T2 liked;
 * - saving: S4 solid green and S5 the hatching tab still potential; S6–S8
 *   disliked or hated;
 * - asked for: concepts for `→ continue editing` and `p save as preset`.
 *
 * Every gallery holds the best of the rest still: the chip as it is, the
 * saving solid green (S4), the bar B10, the sizes T5.
 *
 *   npx tsx scripts/done-mockup-r11.ts   → mockups/done-2026-10-round11.html
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
  N,
  name,
  now as nowTag,
  spread,
  was as wasTag,
} from './done-pieces.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, fill, over, rowOf, run, termHtml, toGrid } from './term-cells.js'

const SAVED = `${formatBytes(F.before.bytes - F.after.bytes)} saved`
const PCT = changePhrase(F.before.bytes, F.after.bytes)
const CHANGE = `${SAVED} · ${PCT}`
const NOW = formatBytes(F.after.bytes)
const WAS = formatBytes(F.before.bytes)
const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
const blue = (q: Palette) => modeColours(q, 'convert').fg
const stops = (q: Palette) => modeGradient(q, 'convert')
const greyHatch = (q: Palette) => mix(q.border, q.canvas, 0.55)
const blueBand = (q: Palette) => mix(blue(q), q.canvas, 0.7)
/** A run of `text`, each character on its own colour from `colourAt(i, n)`. */
const perChar = (text: string, paint: (i: number, n: number) => Partial<Run>): Run[] =>
  [...text].map((ch, i) => ({ text: ch, ...paint(i, text.length) }))

/* -------------------------------------------------------------------- bar */

/** The bar: `bandAt(i, r)` fills the new file's cells, `hatchAt(i)` colours the rest. */
function barWith(
  q: Palette,
  {
    bandAt = (_i: number, _r: number): string | undefined => blueBand(q),
    hatchAt = (_i: number) => greyHatch(q),
  } = {},
): Row[] {
  const label: Run[] = [run(' '), ...name(q, BLOCK - 4), run(' ')]
  return Array.from({ length: 5 }, (_, r) => {
    const cells: Cell[] = Array.from(
      { length: BLOCK },
      (_, i): Cell => (i < kept ? { ch: ' ', bg: bandAt(i, r) } : { ch: '╱', fg: hatchAt(i) }),
    )
    if (r === 2) over(cells, 0, label)
    return [blank(M), ...rowOf(cells)]
  })
}

/* ----------------------------------------------------------- the pieces */

interface Look {
  chip: (q: Palette) => Run[]
  saving: (q: Palette) => Run[]
  bar: (q: Palette) => Row[]
  sizes: (q: Palette) => Row[]
}
const S4 = (q: Palette): Run[] => [run(` ${CHANGE} `, q.ink, q.ok, true)]
const T5 = (q: Palette, nowFg = q.ok, nowRuns?: Run[]): Row[] => [
  [],
  spread([run('now', q.dim)], [run('was', q.border)]),
  spread(nowRuns ?? [run(NOW, nowFg, undefined, true)], [run(WAS, q.fg, undefined, true)]),
]
const BEST: Look = {
  chip: (q) => [chip(q)],
  saving: S4,
  bar: (q) => barWith(q),
  sizes: (q) => T5(q),
}
const body = (q: Palette, look: Partial<Look>): Row[] => {
  const l = { ...BEST, ...look }
  return [spread(l.chip(q), l.saving(q)), ...l.bar(q), ...l.sizes(q)]
}

/* ----------------------------------------------------------------- keys */

type KeyLook = (q: Palette, k: string, words: string, primary?: boolean) => Run[]
/** As it is: the key on the key grey, the words dim. */
const capKeys: KeyLook = (q, k, words) => [
  run(` ${k} `, q.fg, fill(q.keycapBg), true),
  run(` ${words}`, q.dim),
]

/* --------------------------------------------------------------- screen */

/**
 * Header, then `top` (p's row, if p is there), the body in the middle of
 * what is left, `hint` on the row above the rule, the rule, the keys.
 */
function screen(q: Palette, rows: Row[], { top, hint }: { top?: Row; hint?: Row }): Row[] {
  const header = trailBarRow({
    width: N,
    palette: q,
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
    keys.push(run(` ${k} `, q.fg, fill(q.keycapBg), true), run(` ${w}`, q.dim))
  }
  const quit: Row = [run('ctrl-c', q.fg), run(' quit', q.border)]
  keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)
  const headRows: Row[] = top ? [top, []] : []
  const room = H - 2 - headRows.length
  const free = room - 3 - rows.length
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
    hint ?? [],
    [run('─'.repeat(N), q.border)],
    keys,
  ]
}
/** `runs` ending a cell short of the window's edge, as the key row's footnote does. */
const atRight = (runs: Run[]): Row => [blank(N - 1 - rowWidth(runs)), ...runs]

/* -------------------------------------------------------------- styles */

interface Style {
  id: string
  name: string
  idea: string
  look: Partial<Look>
  earlier?: PageConcept['earlier']
}

const BARS: Style[] = [
  {
    id: 'B10',
    name: 'Blue band, grey hatching',
    idea: 'The band in convert’s blue, the hatching neutral grey.',
    look: {},
    earlier: 'love',
  },
  {
    id: 'B5',
    name: 'The band in green',
    idea: 'The band on the green tint the new size has, the hatching green.',
    look: {
      bar: (q) =>
        barWith(q, { bandAt: () => fill(mix(q.ok, q.canvas, 0.7)), hatchAt: () => q.shedHatch }),
    },
    earlier: 'potential',
  },
  {
    id: 'B9',
    name: 'Blue band, gradient hatching',
    idea: 'The blue band, the hatching through the header’s gradient. You liked the gradient, not on the hatching.',
    look: {
      bar: (q) =>
        barWith(q, {
          hatchAt: (i) => mix(gradientAt(i, BLOCK, stops(q)), q.canvas, 0.45),
        }),
    },
    earlier: 'potential',
  },
  {
    id: 'B11',
    name: 'The gradient on the band',
    idea: 'B10, with the header’s gradient moved from the hatching onto the band: blue at its start into violet at its end. The hatching stays grey.',
    look: {
      bar: (q) => barWith(q, { bandAt: (i) => mix(gradientAt(i, kept, stops(q)), q.canvas, 0.6) }),
    },
  },
  {
    id: 'B12',
    name: 'The gradient down the band',
    idea: 'B10, the band lighter at its top row and deeper at its bottom, blue into violet: a little depth, as if lit from above.',
    look: {
      bar: (q) => barWith(q, { bandAt: (_i, r) => mix(gradientAt(r, 5, stops(q)), q.canvas, 0.6) }),
    },
  },
  {
    id: 'B13',
    name: 'A brighter blue band',
    idea: 'B10 with the band a clear step brighter, so the new file is the brightest thing in the bar; the name stays white.',
    look: { bar: (q) => barWith(q, { bandAt: () => mix(blue(q), q.canvas, 0.5) }) },
  },
]

const GRADIENTS: Style[] = [
  {
    id: 'G1',
    name: 'The chip in the gradient',
    idea: 'The PNG → WebP chip filled with the header’s gradient, dark ink on it: the gradient appears twice, at the top of the screen and on the result.',
    look: {
      chip: (q) =>
        perChar(` ${F.before.format} → ${F.after.format} `, (i, n) => ({
          fg: q.ink,
          bg: gradientAt(i, n, stops(q)),
          bold: true,
        })),
    },
  },
  {
    id: 'G2',
    name: 'The saving in the gradient',
    idea: 'The saving’s pill filled with the header’s gradient instead of green: the brightest, most decorated thing on the screen, as the news.',
    look: {
      saving: (q) =>
        perChar(` ${CHANGE} `, (i, n) => ({
          fg: q.ink,
          bg: gradientAt(i, n, stops(q)),
          bold: true,
        })),
    },
  },
  {
    id: 'G3',
    name: 'The new size in the gradient',
    idea: 'T5’s stacked sizes, the new size’s figures in the gradient, letter by letter: the one number that matters, drawn in the app’s colours.',
    look: {
      sizes: (q) =>
        T5(
          q,
          q.ok,
          perChar(NOW, (i, n) => ({ fg: gradientAt(i, n, stops(q)), bold: true })),
        ),
    },
  },
]

const SAVINGS: Style[] = [
  {
    id: 'S4',
    name: 'Solid green',
    idea: 'The pill filled with the green, dark ink on it.',
    look: {},
    earlier: 'potential',
  },
  {
    id: 'S5',
    name: 'A tab on the hatching',
    idea: 'The saving in the hatching’s green, a tab off the bar’s top-right corner.',
    look: {
      saving: (q) => [run(` ${CHANGE} `, q.ok, fill(mix(q.shedHatch, q.canvas, 0.55)), true)],
    },
    earlier: 'potential',
  },
  {
    id: 'S9',
    name: 'A tab on the grey hatching',
    idea: 'S5 for the B10 bar: the tab takes the grey hatching’s tone, the words green and bold on it, so it labels what was shed in the shed part’s own colour.',
    look: {
      saving: (q) => [run(` ${CHANGE} `, q.ok, fill(mix(q.border, q.canvas, 0.75)), true)],
    },
  },
  {
    id: 'S10',
    name: 'Solid blue',
    idea: 'S4’s solid pill in convert’s blue instead of green, matching the band and the chip: one colour across the result.',
    look: { saving: (q) => [run(` ${CHANGE} `, q.ink, blue(q), true)] },
  },
]

const TAGS: Style[] = [
  {
    id: 'T5',
    name: 'Stacked, the size large',
    idea: 'The word quiet on top, the size bold under it.',
    look: {},
    earlier: 'love',
  },
  {
    id: 'T1',
    name: 'As it was',
    idea: 'Two-part tags: the word on grey, the size on its fill.',
    look: { sizes: (q) => [[], spread(nowTag(q), wasTag(q))] },
    earlier: 'like',
  },
  {
    id: 'T2',
    name: 'Words, no fills',
    idea: '“now” and “was” dim, the sizes bold after them.',
    look: {
      sizes: (q) => [
        [],
        spread(
          [run('now ', q.dim), run(NOW, q.ok, undefined, true)],
          [run('was ', q.border), run(WAS, q.dim, undefined, true)],
        ),
      ],
    },
    earlier: 'like',
  },
  {
    id: 'T10',
    name: 'Stacked, the new size in blue',
    idea: 'T5 with the new size in the band’s blue, not green: the band and its size are the same colour, the green kept for the saving.',
    look: { sizes: (q) => T5(q, blue(q)) },
  },
]

/* Keys: where p goes and how both look. → stays at the bottom right. */
const modeKeys: KeyLook = (q, k, words) => [
  run(` ${k} `, q.ink, blue(q), true),
  run(` ${words}`, q.dim),
]
const pillKeys: KeyLook = (q, k, words) => [
  run(` ${k}  `, q.fg, fill(q.keycapBg), true),
  run(`${words} `, q.dim, fill(q.keycapBg)),
]
const ghostKeys: KeyLook = (q, k, words) => [
  run(k, blue(q), undefined, true),
  run(` ${words}`, q.dim),
]
const primaryKeys: KeyLook = (q, k, words, primary) =>
  primary ? [run(` ${k}  ${words} `, q.ink, blue(q), true)] : pillKeys(q, k, words)

interface KeyStyle {
  id: string
  name: string
  idea: string
  where: 'top' | 'bottom' | 'chip'
  look: KeyLook
}
const KEYS: KeyStyle[] = [
  {
    id: 'K1',
    name: 'As it is',
    idea: 'p alone at the top left, → at the bottom right, both as the key row draws keys: the key on grey, the words dim.',
    where: 'top',
    look: capKeys,
  },
  {
    id: 'K2',
    name: 'p at the bottom left',
    idea: 'p joins → on the row above the rule, one at each end, the way the key row under them has keys left and a footnote right. Nothing above the result.',
    where: 'bottom',
    look: capKeys,
  },
  {
    id: 'K3',
    name: 'p beside the chip',
    idea: 'p back where it was built, a cell after the chip: saving a preset is about this conversion, and the chip names it.',
    where: 'chip',
    look: capKeys,
  },
  {
    id: 'K4',
    name: 'Keys in the mode’s colour',
    idea: 'The keys’ caps in convert’s blue with dark ink, as the field’s key hints are drawn app-wide: they read as this screen’s own actions, apart from the grey key row.',
    where: 'bottom',
    look: modeKeys,
  },
  {
    id: 'K5',
    name: 'Buttons',
    idea: 'Key and words on one grey pill each: each reads as a button, not a hint.',
    where: 'bottom',
    look: pillKeys,
  },
  {
    id: 'K6',
    name: '→ as the main button',
    idea: 'Continue editing is the way on, so it is a solid blue button; p save as preset is a quiet grey one at the other end.',
    where: 'bottom',
    look: primaryKeys,
  },
  {
    id: 'K7',
    name: 'Just the keys in blue',
    idea: 'No fills: the key itself bold in convert’s blue, the words dim after it. The lightest; it never competes with the result.',
    where: 'bottom',
    look: ghostKeys,
  },
]

function keysScreen(q: Palette, k: KeyStyle): Row[] {
  const p = k.look(q, 'p', 'save as preset')
  const go = k.look(q, '→', 'continue editing', true)
  const rows = body(q, k.where === 'chip' ? { chip: (r) => [chip(r), blank(1), ...p] } : {})
  if (k.where === 'top') return screen(q, rows, { top: [blank(M), ...p], hint: atRight(go) })
  if (k.where === 'chip') return screen(q, rows, { hint: atRight(go) })
  const left: Row = [blank(M), ...p]
  return screen(q, rows, {
    hint: [...left, blank(N - 1 - rowWidth(left) - rowWidth(go)), ...go],
  })
}

/* ------------------------------------------------------------------ page */

const q = modePalette(DARK, 'convert')
const crop = (rows: Row[]) => termHtml(q, toGrid([[], ...rows, []], N))
const section = (title: string, styles: Style[]): PageConcept[] =>
  styles.map((s, i) => ({
    id: s.id,
    name: s.name,
    idea: s.idea,
    html: crop(body(q, s.look)),
    earlier: s.earlier,
    ...(i === 0 ? { section: title } : {}),
  }))

writeFileSync(
  'mockups/done-2026-10-round11.html',
  feedbackPage({
    page: 'done-round11',
    title: 'Forge · Done, round seventeen',
    heading: 'Done: the blue band, the gradient elsewhere, and the two keys',
    lede: 'From your answers: the bar is B10 (loved) — blue band, grey hatching; the sizes are T5 (loved) — stacked. Every figure holds those, the chip as it is and the solid green saving (S4) still, and changes one piece. Your liked and potential picks lead each section, badged. Last: concepts for → continue editing and p save as preset, as whole screens. Dark, 80 × 24.',
    compact: true,
    concepts: [
      ...section('The bar, near B10', BARS),
      ...section('The gradient, somewhere other than the hatching', GRADIENTS),
      ...section('The saving', SAVINGS),
      ...section('Now and was', TAGS),
      ...KEYS.map((k, i) => ({
        id: k.id,
        name: k.name,
        idea: k.idea,
        html: termHtml(q, toGrid(keysScreen(q, k), N)),
        ...(i === 0 ? { section: 'p save as preset and → continue editing' } : {}),
      })),
    ],
  }),
)
console.log('wrote mockups/done-2026-10-round11.html')
