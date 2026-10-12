/**
 * sRGB ⇄ OKLab ⇄ OKLCH, and the one way colours are written. Pure maths: no
 * I/O, no dependencies. OKLab is Björn Ottosson's (2020); its distances follow
 * how different two colours look, which is why grouping and scales work in it.
 */
export type Rgb = { r: number; g: number; b: number }
export type Lab = { L: number; a: number; b: number }
export type Lch = { L: number; C: number; h: number }

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** `#RRGGBB` or `#RGB`, with or without the `#`, any case, surrounding space ignored. */
export function parseHex(input: string): Rgb | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return undefined
  const h = m[1] as string
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

export function rgbToOklab({ r, g, b }: Rgb): Lab {
  const R = toLinear(r / 255)
  const G = toLinear(g / 255)
  const B = toLinear(b / 255)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** Linear sRGB, unclamped: outside 0–1 means outside the gamut. */
export function oklabToLinear({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Clamped into sRGB and rounded: the colour a screen would show. */
export function oklabToRgb(lab: Lab): Rgb {
  const [r, g, b] = oklabToLinear(lab).map((v) =>
    Math.round(Math.max(0, Math.min(1, toGamma(Math.max(0, v)))) * 255),
  ) as [number, number, number]
  return { r, g, b }
}

export function inGamut(lab: Lab): boolean {
  return oklabToLinear(lab).every((v) => v >= -1e-4 && v <= 1 + 1e-4)
}

export function toLch({ L, a, b }: Lab): Lch {
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

export function fromLch({ L, C, h }: Lch): Lab {
  const rad = (h * Math.PI) / 180
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) }
}

export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}

export function formatOklch(c: Rgb): string {
  const { L, C, h } = toLch(rgbToOklab(c))
  return `oklch(${(L * 100).toFixed(0)}% ${C.toFixed(3)} ${h.toFixed(0)})`
}
