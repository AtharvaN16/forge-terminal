import { hueName } from './names.js'
import type { Group } from './palette.js'
import type { Step } from './scale.js'
import { formatRgb, type Rgb, toHex } from './space.js'

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
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'colour'
const FONT = 'font-family="Inter"'

export function card(
  title: string,
  subtitle: string,
  items: CardItem[],
  theme: 'light' | 'dark' = 'light',
): string {
  const dark = theme === 'dark'
  const ink = dark ? '#FAFAFA' : '#111111'
  const grey = dark ? '#A1A1AA' : '#71717A'
  const edge = dark ? '#FFFFFF' : '#000000'
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
        `<rect id="swatch" width="${sw}" height="${sw}" rx="${rx}" fill="${it.hex}" stroke="${edge}" stroke-opacity="0.08"/>` +
        `<text id="name" x="1" y="${sw + 22}" ${FONT} font-size="13" font-weight="600" fill="${ink}">${esc(it.name)}</text>` +
        `<text id="value" x="1" y="${sw + 40}" ${FONT} font-size="11" fill="${grey}">${esc(it.value)}</text></g>`,
    )
    .join('\n')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<g id="${slug(title)}">\n` +
    `<rect id="card" width="${w}" height="${h}" rx="0" fill="${dark ? '#18181B' : '#FFFFFF'}"/>\n` +
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

export function scaleCard(
  reference: Rgb,
  steps: Step[],
  theme: 'light' | 'dark' = 'light',
): string {
  const name = hueName(reference)
  return card(
    `${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`,
    `from ${toHex(reference)} · 50–950 in OKLCH`,
    steps.map((s) => ({ id: `${name}-${s.step}`, name: String(s.step), value: s.hex, hex: s.hex })),
    theme,
  )
}
