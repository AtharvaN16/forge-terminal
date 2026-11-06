import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { card, paletteCard, scaleCard } from '../core/colour/card.js'
import { onWhiteAndBlack, rate } from '../core/colour/contrast.js'
import { readColourList } from '../core/colour/list.js'
import { type Group, inside, palette, wholePercents } from '../core/colour/palette.js'
import { parseColour } from '../core/colour/parse.js'
import { scale } from '../core/colour/scale.js'
import { formatOklch, formatRgb, type Rgb, rgbToOklab, toHex } from '../core/colour/space.js'
import {
  fileNotFound,
  noColours,
  notAFile,
  notColours,
  nothingVisible,
  permissionDenied,
  unreadablePath,
} from '../core/errors.js'
import { cardJson, paletteJson, scaleJson } from '../core/report-data.js'
import { samplePixels } from '../engines/pixels.js'
import { VERSION } from '../shell/theme.js'
import { displayName } from '../utils/display-path.js'
import type { CardIntent, PaletteIntent, ScaleIntent } from './args.js'
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
    const svg = paletteCard(displayName(intent.input), groups, 'light', parent?.hex)
    return { exitCode: 0, stdout: [svg], stderr: [] }
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw fileNotFound(path)
    if (code === 'EISDIR') throw notAFile(path)
    if (code === 'EACCES' || code === 'EPERM') throw permissionDenied(path)
    throw unreadablePath(path, e)
  }
}

const hexAndAlpha = (c: { hex: string; alpha?: number }): string =>
  c.alpha === undefined ? c.hex : `${c.hex} ${Math.round(c.alpha * 100)}%`

/**
 * `forge card`: a palette file's named colours, as rows, the card (`--svg`)
 * or JSON. Any line that is not a colour refuses the whole card, so nothing
 * half-right reaches Figma (exit 1, every bad line named).
 */
export async function runCard(
  intent: CardIntent,
  opts: Opts,
  stdin: () => Promise<string> = readStdin,
): Promise<ExecuteResult> {
  const fromStdin = intent.input === '-'
  const text = fromStdin ? await stdin() : await readText(intent.input)
  const label = fromStdin ? 'the text from stdin' : displayName(intent.input)
  const { colours, bad } = readColourList(text)
  if (bad.length > 0) throw notColours(label, bad)
  if (colours.length === 0) throw noColours(label)
  if (intent.svg) {
    const title =
      intent.title ??
      (fromStdin ? 'Colours' : basename(intent.input).replace(/\..*$/, '') || 'Colours')
    const n = colours.length
    const items = colours.map((c) => ({
      id: c.name,
      name: c.name,
      value: hexAndAlpha(c),
      hex: c.hex,
      ...(c.alpha === undefined ? {} : { alpha: c.alpha }),
    }))
    const svg = card(title, `${n} colour${n === 1 ? '' : 's'}`, items, 'light', { perRow: 8 })
    return { exitCode: 0, stdout: [svg], stderr: [] }
  }
  if (opts.json) {
    const doc = cardJson(VERSION, { source: fromStdin ? '-' : resolve(intent.input), colours })
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  return {
    exitCode: 0,
    stdout: colours.map((c) => {
      const rgb = parseColour(c.hex)?.rgb ?? { r: 0, g: 0, b: 0 }
      return `${swatch(rgb, opts.colour)}${hexAndAlpha(c)}  ${c.name}`
    }),
    stderr: [],
  }
}
