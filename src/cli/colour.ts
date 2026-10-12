import { basename, resolve } from 'node:path'
import { paletteCard, scaleCard } from '../core/colour/card.js'
import { onWhiteAndBlack, rate } from '../core/colour/contrast.js'
import { type Group, inside, palette, wholePercents } from '../core/colour/palette.js'
import { scale } from '../core/colour/scale.js'
import { formatOklch, formatRgb, type Rgb, rgbToOklab, toHex } from '../core/colour/space.js'
import { nothingVisible } from '../core/errors.js'
import { paletteJson, scaleJson } from '../core/report-data.js'
import { samplePixels } from '../engines/pixels.js'
import { VERSION } from '../shell/theme.js'
import type { PaletteIntent, ScaleIntent } from './args.js'
import type { ExecuteResult } from './execute.js'

/**
 * `forge palette` and `forge scale` (colour spec §7.1). They print once and
 * exit; nothing is written to disk. A ForgeError thrown here (not an image,
 * nothing visible, corrupt) is reported by `execute`'s own catch, exit 1.
 */
interface Opts {
  json: boolean
  /** True colour on stdout: draw swatches. Off for pipes, --json and NO_COLOR. */
  colour: boolean
}

const swatch = ({ r, g, b }: Rgb, colour: boolean): string =>
  colour ? `\x1b[38;2;${r};${g};${b}m██\x1b[39m  ` : ''

/** The palette colour nearest `to` in OKLab, for `--inside`. */
function nearest(groups: Group[], to: Rgb): Group | undefined {
  const t = rgbToOklab(to)
  let best: Group | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const g of groups) {
    const d = (g.centre.L - t.L) ** 2 + (g.centre.a - t.a) ** 2 + (g.centre.b - t.b) ** 2
    if (d < bestD) {
      bestD = d
      best = g
    }
  }
  return best
}

export async function runPalette(intent: PaletteIntent, opts: Opts): Promise<ExecuteResult> {
  const { pixels } = await samplePixels(intent.input)
  const top = palette(pixels)
  if (top.length === 0) throw nothingVisible(intent.input)
  const parent = intent.inside ? nearest(top, intent.inside) : undefined
  const groups = parent ? inside(pixels, parent) : top
  if (intent.svg) {
    return { exitCode: 0, stdout: [paletteCard(basename(intent.input), groups)], stderr: [] }
  }
  if (opts.json) {
    const doc = paletteJson(VERSION, {
      source: resolve(intent.input),
      ...(parent ? { inside: parent.hex } : {}),
      colours: groups.map((g) => ({
        hex: g.hex,
        rgb: formatRgb(g.rgb),
        oklch: formatOklch(g.rgb),
        share: g.share,
      })),
    })
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  const pcts = wholePercents(groups.map((g) => g.share))
  return {
    exitCode: 0,
    stdout: groups.map(
      (g, i) => `${swatch(g.rgb, opts.colour)}${g.hex}  ${String(pcts[i]).padStart(3)}%`,
    ),
    stderr: [],
  }
}

export async function runScale(intent: ScaleIntent, opts: Opts): Promise<ExecuteResult> {
  const steps = scale(intent.colour)
  if (intent.svg) return { exitCode: 0, stdout: [scaleCard(intent.colour, steps)], stderr: [] }
  const rows = steps.map((s) => ({ ...s, ...onWhiteAndBlack(s.rgb) }))
  if (opts.json) {
    const doc = scaleJson(VERSION, {
      reference: toHex(intent.colour),
      steps: rows.map((s) => ({
        step: s.step,
        hex: s.hex,
        oklch: formatOklch(s.rgb),
        white: s.white,
        black: s.black,
      })),
    })
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  return {
    exitCode: 0,
    stdout: rows.map(
      (s) =>
        `${String(s.step).padStart(4)}  ${swatch(s.rgb, opts.colour)}${s.hex}  ` +
        `white ${s.white.toFixed(1)} ${rate(s.white)} · black ${s.black.toFixed(1)} ${rate(s.black)}`,
    ),
    stderr: [],
  }
}
