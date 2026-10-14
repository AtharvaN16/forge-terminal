import { hueName } from './names.js'
import type { Group } from './palette.js'
import { DEFAULT_STEPS, type Step, type StepSpec } from './scale.js'
import { formatRgb, type Rgb, toHex } from './space.js'
import { MODE_NAMES, type Mode, type System } from './system.js'

/**
 * What `c` puts on the clipboard: an SVG card as plain text, which Figma turns
 * into real shapes and text layers on ⌘V (verified, colour spec §2.1). The F1
 * card: square outer card, rounded swatches in a row, the name bold and the
 * value grey under each. Deterministic, so a snapshot can hold it.
 */
export interface CardItem {
  /** Becomes the layer's name in Figma; reduced to [a-z0-9-]. */
  id: string
  name: string
  value: string
  hex: string
  /** 0 to 1: the swatch is drawn see-through over a checkerboard. */
  alpha?: number
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'colour'
const FONT = 'font-family="Inter"'
const capital = (s: string): string => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`

/** The card's colours: ink, the grey under it, the swatch edge, and the card itself. */
function look(theme: 'light' | 'dark') {
  const dark = theme === 'dark'
  return {
    ink: dark ? '#FAFAFA' : '#111111',
    grey: dark ? '#A1A1AA' : '#71717A',
    edge: dark ? '#FFFFFF' : '#000000',
    paper: dark ? '#18181B' : '#FFFFFF',
  }
}

/** The usual transparency checkerboard: white and #E5E5E5 squares, 8 px. */
const CHECKER =
  '<defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">' +
  '<rect width="16" height="16" fill="#FFFFFF"/>' +
  '<rect width="8" height="8" fill="#E5E5E5"/>' +
  '<rect x="8" y="8" width="8" height="8" fill="#E5E5E5"/></pattern></defs>\n'

export function card(
  title: string,
  subtitle: string,
  items: CardItem[],
  theme: 'light' | 'dark' = 'light',
): string {
  const { ink, grey, edge, paper } = look(theme)
  const sw = items.length > 8 ? 64 : 104
  const gap = 10
  const w = 48 + items.length * sw + Math.max(0, items.length - 1) * gap
  const h = 84 + sw + 56
  const rx = sw > 80 ? 12 : 10
  const head =
    `<text id="title" x="24" y="38" ${FONT} font-size="15" font-weight="600" fill="${ink}">${esc(title)}</text>` +
    `<text id="subtitle" x="24" y="58" ${FONT} font-size="12" fill="${grey}">${esc(subtitle)}</text>`
  const body = items
    .map(
      (it, i) =>
        `<g id="${slug(it.id)}" transform="translate(${24 + i * (sw + gap)} 80)">` +
        (it.alpha === undefined
          ? ''
          : `<rect id="checker" width="${sw}" height="${sw}" rx="${rx}" fill="url(#checker)"/>`) +
        `<rect id="swatch" width="${sw}" height="${sw}" rx="${rx}" fill="${it.hex}"` +
        (it.alpha === undefined ? '' : ` fill-opacity="${it.alpha.toFixed(3)}"`) +
        ` stroke="${edge}" stroke-opacity="0.08"/>` +
        `<text id="name" x="1" y="${sw + 22}" ${FONT} font-size="13" font-weight="600" fill="${ink}">${esc(it.name)}</text>` +
        `<text id="value" x="1" y="${sw + 40}" ${FONT} font-size="11" fill="${grey}">${esc(it.value)}</text></g>`,
    )
    .join('\n')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    (items.some((it) => it.alpha !== undefined) ? CHECKER : '') +
    `<g id="${slug(title)}">\n` +
    `<rect id="card" width="${w}" height="${h}" rx="0" fill="${paper}"/>\n` +
    `${head}\n${body}\n</g>\n</svg>`
  )
}

export function paletteCard(
  fileName: string,
  groups: Group[],
  theme: 'light' | 'dark' = 'light',
  /** These are the shades of this colour, not the image's colours. */
  inside?: string,
): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  const n = groups.length
  return card(
    fileName,
    inside
      ? `${n} shade${n === 1 ? '' : 's'} of ${inside}`
      : `${n} colour${n === 1 ? '' : 's'}, most of the image first`,
    groups.map((g, i) => ({
      id: `${base}-${i + 1}`,
      name: g.hex,
      value: formatRgb(g.rgb),
      hex: g.hex,
    })),
    theme,
  )
}

/** What a card says of its steps: nothing extra for the default, which is what it always was. */
function stepsWords(spec: StepSpec): string {
  if (spec.set === 'radix') return 'Radix 1–12'
  if (spec.set === 'even') return `${spec.start}–${spec.end}, ${spec.count} even steps`
  const d = DEFAULT_STEPS
  return spec.start === d.start && spec.end === d.end
    ? '50–950'
    : `Tailwind ${spec.start}–${spec.end}`
}

export function scaleCard(
  reference: Rgb,
  steps: Step[],
  theme: 'light' | 'dark' = 'light',
  spec: StepSpec = DEFAULT_STEPS,
): string {
  const name = hueName(reference)
  return card(
    capital(name),
    `from ${toHex(reference)} · ${stepsWords(spec)} in OKLCH`,
    steps.map((s) => ({ id: `${name}-${s.step}`, name: String(s.step), value: s.hex, hex: s.hex })),
    theme,
  )
}

/**
 * A palette from one colour as one card: the step names across the top, a
 * row per family named down the left, the neutral last and set a little
 * apart. Each swatch is its own layer, `red-500`, as the F1 card's are.
 */
export function systemCard(
  base: Rgb,
  sys: System,
  mode: Mode,
  spec: StepSpec = DEFAULT_STEPS,
  theme: 'light' | 'dark' = 'light',
): string {
  const { ink, grey, edge, paper } = look(theme)
  const title = `${capital(hueName(base))} palette`
  const subtitle = `from ${toHex(base)} · ${MODE_NAMES[mode]} · ${stepsWords(spec)} in OKLCH`
  const rows = [
    ...sys.rows.map((r) => ({ name: r.name, steps: r.steps })),
    { name: 'neutral', steps: sys.neutral },
  ]
  const steps = rows[0]?.steps.map((s) => s.step) ?? []
  const sw = 44
  const gap = 6
  const rowH = sw + 10
  const top = 92
  // Room for the longest name at 13 px bold, never less than the mockup's 92.
  const left = 24 + Math.max(92, ...rows.map((r) => r.name.length * 8 + 12))
  const grid = left + steps.length * sw + Math.max(0, steps.length - 1) * gap + 24
  // And room for the subtitle at 12 px, when there are few steps.
  const w = Math.max(grid, 48 + Math.ceil(subtitle.length * 6.5))
  const h = top + rows.length * rowH + 24 + 10
  const head =
    `<text id="title" x="24" y="38" ${FONT} font-size="15" font-weight="600" fill="${ink}">${esc(title)}</text>` +
    `<text id="subtitle" x="24" y="58" ${FONT} font-size="12" fill="${grey}">${esc(subtitle)}</text>`
  const numbers = steps
    .map(
      (n, i) =>
        `<text id="step-${n}" x="${left + i * (sw + gap) + 1}" y="${top - 10}" ${FONT} font-size="11" font-weight="600" fill="${grey}">${n}</text>`,
    )
    .join('')
  const body = rows
    .map((r, k) => {
      const y = top + k * rowH + (k === rows.length - 1 ? 10 : 0)
      const id = slug(r.name)
      return (
        `<g id="${id}"><text id="name" x="24" y="${y + sw / 2 + 4}" ${FONT} font-size="13" font-weight="600" fill="${ink}">${esc(r.name)}</text>` +
        r.steps
          .map(
            (s, i) =>
              `<g id="${id}-${s.step}"><rect id="swatch" x="${left + i * (sw + gap)}" y="${y}" width="${sw}" height="${sw}" rx="8" fill="${s.hex}" stroke="${edge}" stroke-opacity="0.08"/></g>`,
          )
          .join('') +
        '</g>'
      )
    })
    .join('\n')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<g id="${slug(title)}">\n` +
    `<rect id="card" width="${w}" height="${h}" rx="0" fill="${paper}"/>\n` +
    `${head}\n<g id="steps">${numbers}</g>\n${body}\n</g>\n</svg>`
  )
}

/** The F1 card of a neutral made from `base`, saying how strong its tint is. */
export function neutralCard(
  base: Rgb,
  steps: Step[],
  tint: string,
  theme: 'light' | 'dark' = 'light',
  spec: StepSpec = DEFAULT_STEPS,
): string {
  return card(
    `${capital(hueName(base))} neutral`,
    `from ${toHex(base)} · ${tint} tint · ${stepsWords(spec)} in OKLCH`,
    steps.map((s) => ({ id: `neutral-${s.step}`, name: String(s.step), value: s.hex, hex: s.hex })),
    theme,
  )
}

/**
 * The F1 card of a colour's alpha steps: each swatch see-through over a
 * checkerboard, as it would sit over a page, with its #RRGGBBAA under it.
 */
export function alphaCard(
  base: Rgb,
  alphas: { step: number; rgb: Rgb; a: number; hex8: string }[],
  over: 'white' | 'black',
  theme: 'light' | 'dark' = 'light',
  spec: StepSpec = DEFAULT_STEPS,
): string {
  const name = hueName(base)
  return card(
    `${capital(name)} alpha`,
    `from ${toHex(base)} · over ${over} · ${stepsWords(spec)}`,
    alphas.map((a) => ({
      id: `${name}-alpha-${a.step}`,
      name: String(a.step),
      value: a.hex8,
      hex: toHex(a.rgb),
      alpha: a.a,
    })),
    theme,
  )
}
