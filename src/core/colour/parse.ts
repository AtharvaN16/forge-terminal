/**
 * What the colour box reads: a hex, rgb(), hsl(), oklch(), oklab() or a colour
 * name, into one sRGB colour. Out-of-range numbers are refused rather than
 * clamped, so a typo shows as wrong input instead of a quietly different colour.
 */
import { CSS_NAMES, XKCD_NAMES } from './colour-names.js'
import { fromLch, oklabToRgb, type Rgb } from './space.js'

export interface Parsed {
  rgb: Rgb
  /** 0–1 when the input carried one */
  alpha?: number
}

export function parseColour(input: string): Parsed | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (s === '') return undefined
  // Hex first, so a bare `abc` reads as parseHex reads it; no name is all hex digits.
  return hex(s) ?? functional(s) ?? named(s)
}

function hex(s: string): Parsed | undefined {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (!m) return undefined
  const h = m[1] as string
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h
  const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16)
  const rgb = { r: byte(0), g: byte(2), b: byte(4) }
  return full.length === 8 ? { rgb, alpha: byte(6) / 255 } : { rgb }
}

type Num = { n: number; unit: string }

function num(token: string): Num | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/.exec(token)
  return m ? { n: Number(m[1]), unit: m[2] ?? '' } : undefined
}

const within = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? v : undefined)

/** 0–1, or a percentage. */
function alphaOf(t: Num): number | undefined {
  if (t.unit === '%') return within(t.n / 100, 0, 1)
  return t.unit === '' ? within(t.n, 0, 1) : undefined
}

/** 0–255, or a percentage of it. */
function channel(t: Num): number | undefined {
  if (t.unit === '%') return within(t.n, 0, 100) === undefined ? undefined : Math.round(t.n * 2.55)
  return t.unit === '' && within(t.n, 0, 255) !== undefined ? Math.round(t.n) : undefined
}

/** In degrees. A hue goes round, so any value is a hue. */
function hue(t: Num): number | undefined {
  const per: Record<string, number> = { '': 1, deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }
  const k = per[t.unit]
  return k === undefined ? undefined : (((t.n * k) % 360) + 360) % 360
}

/** A percentage, as 0–1. */
function percent(t: Num): number | undefined {
  return t.unit === '%' ? within(t.n / 100, 0, 1) : undefined
}

/** OKLab lightness: 0–1, or a percentage. */
function lightness(t: Num): number | undefined {
  if (t.unit === '%') return within(t.n / 100, 0, 1)
  return t.unit === '' ? within(t.n, 0, 1) : undefined
}

/** OKLab chroma or axis: a number, or a percentage where 100% is 0.4 (CSS Color 4). */
function okNumber(t: Num): number | undefined {
  if (t.unit === '%') return (t.n / 100) * 0.4
  return t.unit === '' ? t.n : undefined
}

/**
 * The three components and the alpha, if any. Legacy syntax separates with
 * commas; modern with spaces and a `/` before alpha. Mixing them is refused.
 */
function args(body: string, legacyAllowed: boolean): { parts: Num[]; alpha?: Num } | undefined {
  let tokens: string[]
  let alpha: string | undefined
  if (body.includes(',')) {
    if (!legacyAllowed || body.includes('/')) return undefined
    tokens = body.split(',').map((t) => t.trim())
    if (tokens.some((t) => t === '' || t.includes(' '))) return undefined
    if (tokens.length === 4) alpha = tokens.pop()
  } else {
    const halves = body.split('/').map((t) => t.trim())
    if (halves.length > 2) return undefined
    tokens = (halves[0] as string).split(' ').filter((t) => t !== '')
    if (halves.length === 2) {
      alpha = halves[1] as string
      if (alpha === '' || alpha.includes(' ')) return undefined
    }
  }
  if (tokens.length !== 3) return undefined
  const parts = tokens.map(num)
  if (parts.some((p) => p === undefined)) return undefined
  if (alpha === undefined) return { parts: parts as Num[] }
  const a = num(alpha)
  return a ? { parts: parts as Num[], alpha: a } : undefined
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) }
}

function functional(s: string): Parsed | undefined {
  const m = /^([a-z]+) ?\((.*)\)$/.exec(s)
  if (!m) return undefined
  const fn = m[1] as string
  const body = m[2] as string
  const got = args(body, fn === 'rgb' || fn === 'rgba' || fn === 'hsl' || fn === 'hsla')
  if (!got) return undefined
  const [x, y, z] = got.parts as [Num, Num, Num]
  let alpha: number | undefined
  if (got.alpha) {
    alpha = alphaOf(got.alpha)
    if (alpha === undefined) return undefined
  }
  const rgb = components(fn, x, y, z)
  if (!rgb) return undefined
  return alpha === undefined ? { rgb } : { rgb, alpha }
}

function components(fn: string, x: Num, y: Num, z: Num): Rgb | undefined {
  switch (fn) {
    case 'rgb':
    case 'rgba': {
      const r = channel(x)
      const g = channel(y)
      const b = channel(z)
      return r === undefined || g === undefined || b === undefined ? undefined : { r, g, b }
    }
    case 'hsl':
    case 'hsla': {
      const h = hue(x)
      const sat = percent(y)
      const l = percent(z)
      return h === undefined || sat === undefined || l === undefined
        ? undefined
        : hslToRgb(h, sat, l)
    }
    case 'oklch': {
      const L = lightness(x)
      const C = okNumber(y)
      const h = hue(z)
      if (L === undefined || C === undefined || C < 0 || h === undefined) return undefined
      return oklabToRgb(fromLch({ L, C, h }))
    }
    case 'oklab': {
      const L = lightness(x)
      const a = okNumber(y)
      const b = okNumber(z)
      return L === undefined || a === undefined || b === undefined
        ? undefined
        : oklabToRgb({ L, a, b })
    }
    default:
      return undefined
  }
}

// Spaces, hyphens and underscores fold away, so "cherry red", "cherry-red" and
// "cherryred" are one name.
const fold = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '')

let names: Map<string, string> | undefined

/** Built on first use. CSS goes in first, so it wins where both lists have a name. */
function nameTable(): Map<string, string> {
  if (names) return names
  names = new Map()
  for (const table of [CSS_NAMES, XKCD_NAMES]) {
    for (const [name, value] of Object.entries(table)) {
      const key = fold(name)
      // Fifteen xkcd names fold onto an earlier one ("blue green", "bluegreen"); the first stays.
      if (!names.has(key)) names.set(key, value)
    }
  }
  return names
}

function named(s: string): Parsed | undefined {
  const value = nameTable().get(fold(s))
  const rgb = value === undefined ? undefined : hex(value)?.rgb
  return rgb && { rgb }
}
