import { BOOST_MAX_SIDE } from '../core/extension-targets.js'
import {
  RESIZE_MAX,
  RESIZE_MIN,
  RESIZE_STEP,
  resizedSize,
  type Size,
  sizeOverLimit,
} from '../core/resize.js'
import { blank, type Row, type Run, width as widthOf } from './home-art.js'
import { endsRow, SLIDER_WIDTH, sliderRow } from './quality-art.js'
import { modeColours, type Palette, type ShellMode } from './theme.js'

/**
 * Resize (spec 2026-10-12, mockups/resize-2026-10.html, tab "★ Resize
 * slider", H3 and X; drawn there by scripts/resize-mockup.ts): Quality's G1
 * band centred on 100 %, the `#` hint on its own row, what the size becomes
 * under it, and the exact Width × Height pair `#` opens. Pure rows.
 */

/** The band's ends: 0–200 %, so 100 sits in the middle. The thumb stops at 5. */
const BAND_MIN = 0
const BAND_MAX = RESIZE_MAX
/** The hint beside the band (H3), and the gap before it. */
const HINT = 'type an exact size'
const HINT_GAP = 3
/** One box of the pair, fill included. */
const BOX = 18

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const dims = (s: Size) => `${s.width} × ${s.height}`
const grouped = (n: number) => n.toLocaleString('en-US')

/** The `#` key cap, as the key row draws one. */
const keycap = (palette: Palette, k: string): Run =>
  run(` ${k} `, palette.fg, palette.keycapBg, true)

/**
 * The band at `percent` with `#  type an exact size` beside it (H3), and
 * `smaller · same size · larger` under it. The hint goes when the terminal
 * has no room for it beside the band; the key row still says it.
 */
export function resizeSliderRows({
  palette,
  percent,
  width = 80,
  band = SLIDER_WIDTH,
  plain,
}: {
  palette: Palette
  percent: number
  /** Unused: the band carries no mode colour (G1). */
  mode?: ShellMode
  /** The terminal's width. */
  width?: number
  /** The band's width, thumb included. */
  band?: number
  plain?: boolean
}): Row[] {
  const slider = sliderRow({
    palette,
    value: percent,
    min: BAND_MIN,
    max: BAND_MAX,
    width: band,
    unit: '%',
    ...(plain === undefined ? {} : { plain }),
  })
  const hint: Row = [blank(HINT_GAP), keycap(palette, '#'), run(` ${HINT}`, palette.dim)]
  const fits = widthOf(slider) + widthOf(hint) < width
  return [
    fits ? [...slider, ...hint] : slider,
    endsRow({ palette, width: band, ends: ['smaller', 'larger'], middle: 'same size' }),
  ]
}

/**
 * What the slider gives: `same size · 4032 × 3024` at 100 %, else
 * `becomes 2016 × 1512`; past 100 % one quiet line more, that Boost does
 * bigger better.
 */
export function resizeResultRows({
  palette,
  from,
  percent,
}: {
  palette: Palette
  from: Size
  percent: number
}): Row[] {
  const to = dims(resizedSize(from, { percent }))
  const rows: Row[] = [
    [
      blank(1),
      run(percent === 100 ? 'same size · ' : 'becomes ', palette.dim),
      run(to, palette.fg, undefined, true),
    ],
  ]
  if (percent > 100) {
    rows.push([
      blank(1),
      run('stretched, so softer · Boost resolution adds detail', palette.border),
    ])
  }
  return rows
}

/**
 * The exact size (R4): two filled boxes, `W` and `H`, `×` between, and
 * `keeps its shape` after. The box being typed in has its tag in the mode's
 * colour and the cursor; the side Forge worked out (`follows`) is dim.
 * `refusal` is said under the pair in the warning colour.
 */
export function exactPairRows({
  palette,
  mode,
  width,
  height,
  focus,
  follows,
  refusal,
}: {
  palette: Palette
  mode: ShellMode
  width: string
  height: string
  focus: 'width' | 'height'
  /** The other side was worked out from the one typed. */
  follows: boolean
  refusal?: string | undefined
}): Row[] {
  const fill = palette.selectionBg || undefined
  const box = (tag: string, value: string, on: boolean): { mid: Row; pad: Row } => {
    const inner: Row = [
      run(' ', undefined, fill),
      run(tag, on ? modeColours(palette, mode).fg : palette.border, fill, on),
      run('  ', undefined, fill),
      run(value, follows && !on ? palette.dim : palette.fg, fill, on),
    ]
    if (on) inner.push(run(' ', palette.fg, palette.fg || undefined))
    const used = widthOf(inner)
    return {
      mid: used < BOX ? [...inner, run(' '.repeat(BOX - used), undefined, fill)] : inner,
      pad: [run(' '.repeat(BOX), undefined, fill)],
    }
  }
  const w = box('W', width, focus === 'width')
  const h = box('H', height, focus === 'height')
  const rows: Row[] = [
    [blank(1), ...w.pad, blank(3), ...h.pad],
    [
      blank(1),
      ...w.mid,
      run(' × ', palette.border),
      ...h.mid,
      blank(3),
      run('keeps its shape', palette.border),
    ],
    [blank(1), ...w.pad, blank(3), ...h.pad],
  ]
  if (refusal) rows.push([blank(1)], [blank(1), run(refusal, palette.warn)])
  return rows
}

/** The pair's other side when the width is typed: the shape kept. */
export const exactFromWidth = (from: Size, width: number): Size => resizedSize(from, { width })

/** The pair's other side when the height is typed. */
export const exactFromHeight = (from: Size, height: number): Size => resizedSize(from, { height })

/** Why `size` cannot be written, in the pair's words; undefined when it can. */
export function overLimit(size: Size): string | undefined {
  const over = sizeOverLimit(size)
  if (!over) return undefined
  return 'side' in over
    ? `over ${grouped(BOOST_MAX_SIDE)} px a side`
    : `${over.megapixels} MP, over 100 MP`
}

/** The slider's top for `from`: 200 %, or the last step whose size is within the limits. */
export function largestPercent(from: Size): number {
  let p = RESIZE_MAX
  while (p > RESIZE_MIN && sizeOverLimit(resizedSize(from, { percent: p }))) p -= RESIZE_STEP
  return p
}
