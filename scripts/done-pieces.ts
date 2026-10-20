/**
 * The Done screen's pieces for mockup rounds (from round twelve on): the
 * chip, the change, the bar sized by bytes, now and was, p, → and the key
 * row, each drawn from the app's own colours, and the screen they sit in.
 * The facts are the user's screenshot: PNG → WebP, 310 KB → 32.2 KB.
 */
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, type DoneFacts, doneLayout, receiptBars } from '../src/shell/done-art.js'
import {
  blank,
  HOME_MARGIN as M,
  mix,
  type Row,
  type Run,
  width as rowWidth,
} from '../src/shell/home-art.js'
import { modeColours, type Palette } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { type Cell, fill, over, rowOf, run } from './term-cells.js'

export const N = 80
export const H = 24
export { M }
export const BLOCK = N - 2 * M

const KB = 1000
export const F: DoneFacts = {
  mode: 'convert',
  before: { format: 'PNG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.png', bytes: 310 * KB },
  after: { format: 'WebP', name: 'Screenshot 2026-10-19 at 9.43.23 PM.webp', bytes: 32.2 * KB },
}
export const CHANGE = `${formatBytes(F.before.bytes - F.after.bytes)} saved · ${changePhrase(F.before.bytes, F.after.bytes)}`

export const tint = (p: Palette) => fill(mix(p.ok, p.canvas, 0.8))
/** `left` from the block's left edge, `right` ending on its right edge. */
export const spread = (left: Run[], right: Run[] = []): Row => [
  blank(M),
  ...left,
  blank(Math.max(right.length ? 1 : 0, BLOCK - rowWidth(left) - rowWidth(right))),
  ...right,
]
export const chip = (p: Palette): Run => {
  const mode = modeColours(p, F.mode)
  return run(` ${F.before.format} → ${F.after.format} `, mode.fg, fill(mode.bg), true)
}
export const pill = (p: Palette): Run => run(` ${CHANGE} `, p.ok, tint(p), true)
export const changeWords = (p: Palette): Run => run(CHANGE, p.ok, undefined, true)
export const name = (p: Palette, room = BLOCK): Run[] => [
  run('✓ ', p.ok, undefined, true),
  run(middleEllipsis(F.after.name, room - 2), p.fg, undefined, true),
]
export const now = (p: Palette): Run[] => [
  run(' now ', p.dim, fill(p.keycapBg)),
  run(` ${formatBytes(F.after.bytes)} `, p.ok, tint(p), true),
]
export const was = (p: Palette): Run[] => [
  run(' was ', p.border, fill(p.keycapBg)),
  run(` ${formatBytes(F.before.bytes)} `, p.dim, fill(p.panelBand)),
]
export const key = (p: Palette, k: string, words: string): Run[] => [
  run(` ${k} `, p.fg, fill(p.keycapBg), true),
  run(` ${words}`, p.dim),
]
export const preset = (p: Palette) => key(p, 'p', 'save as preset')
export const more = (p: Palette) => key(p, '→', 'continue editing')
/** The chip, then p a cell after it, as built. */
export const chipAndPreset = (p: Palette): Run[] => [chip(p), blank(1), ...preset(p)]

/** now on the left, was on the right. */
export const sizes = (p: Palette): Row => spread(now(p), was(p))
/** now, the change in the middle, was. */
export const sizesWithChange = (p: Palette): Row => {
  const l = now(p)
  const r = was(p)
  const w = changeWords(p)
  const room = BLOCK - rowWidth(l) - rowWidth(r) - rowWidth([w])
  return [blank(M), ...l, blank(room >> 1), w, blank(room - (room >> 1)), ...r]
}

/**
 * The bar, block wide: the grey band as long as the new file, hatching to
 * the old one's length. The name on the middle row, knocked out of the
 * hatching with a cell to spare; with `change`, the change too, at the
 * row's far end, as built.
 */
export function bar(p: Palette, { rows = 5, change = false } = {}): Row[] {
  const kept = receiptBars(F.before.bytes, F.after.bytes, BLOCK).after
  return Array.from({ length: rows }, (_, r) => {
    const cells: Cell[] = Array.from({ length: BLOCK }, (_, i) =>
      i < kept ? { ch: ' ', bg: fill(p.panelBand) } : { ch: '╱', fg: p.shedHatch },
    )
    if (r === rows >> 1) {
      const room = change ? BLOCK - CHANGE.length - 6 : BLOCK - 4
      over(cells, 0, [run(' '), ...name(p, room), run(' ')])
      if (change) over(cells, BLOCK - CHANGE.length - 2, [run(' '), changeWords(p), run(' ')])
    }
    return [blank(M), ...rowOf(cells)]
  })
}

export type Align = 'centre' | 'top'

/** `p` at the bottom left, `→` at the bottom right. */
export const bothBottom = (p: Palette): Row => {
  const left: Row = [blank(M), ...preset(p)]
  return [...left, blank(N - 1 - rowWidth(left) - rowWidth(more(p))), ...more(p)]
}
/** `→` alone at the bottom right, as built. */
export const moreBottom = (p: Palette): Row => [blank(N - 1 - rowWidth(more(p))), ...more(p)]

/**
 * The header bar, the body, then `hint` (the row above the rule, if any),
 * the rule and the key row. `centre` places the body as the app does
 * (`doneLayout`); `top` puts it a blank row under the header.
 */
export function screen(p: Palette, body: Row[], hint?: Row, align: Align = 'centre'): Row[] {
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

  const free = H - 4 - body.length - (hint ? 1 : 0)
  const { top } = doneLayout({ height: H, body: body.length, notes: 0 })
  const above = align === 'top' ? 0 : Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    header,
    [],
    ...blanks(above),
    ...body,
    ...blanks(free - above),
    ...(hint ? [hint] : []),
    [run('─'.repeat(N), p.border)],
    keys,
  ]
}
