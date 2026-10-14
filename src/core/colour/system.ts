import { familyAt, hueName } from './names.js'
import { DEFAULT_STEPS, referenceIndex, type Step, type StepSpec, scale } from './scale.js'
import { fromLch, type Lch, oklabToRgb, type Rgb, rgbToOklab, toHex, toLch } from './space.js'

/**
 * A palette from one colour (the "palette from one colour" mockup, round two).
 * The colour takes its place among the common families, or a harmony is put
 * round the wheel from it, and every row is a `scale()` of its own 500. Four
 * Photoshop-style tweaks move every row, yours included, and the neutral.
 */

export type Mode = 'full' | 'mono' | 'analogous' | 'opposite' | 'split' | 'triad' | 'pastel'
export const MODES: readonly Mode[] = [
  'full',
  'mono',
  'analogous',
  'opposite',
  'split',
  'triad',
  'pastel',
]
export const MODE_NAMES: Record<Mode, string> = {
  full: 'Full set',
  mono: 'Monochromatic',
  analogous: 'Analogous',
  opposite: 'Complementary',
  split: 'Split complementary',
  triad: 'Triadic',
  pastel: 'Pastel',
}

export interface Tweak {
  /** −100 to +100: towards black at −100, towards white at +100 (Photoshop's Lightness). */
  brightness: number
  /** −100 to +100: grey at −100, as vivid as sRGB allows at +100. */
  saturation: number
  /** −180 to +180: degrees round the wheel, every row together. */
  hue: number
  /** −100 to +100: each scale drawn in to its reference at −100, spread twice as far at +100. */
  contrast: number
}
export const NO_TWEAK: Tweak = { brightness: 0, saturation: 0, hue: 0, contrast: 0 }
export const isTweaked = (t: Tweak): boolean =>
  !!(t.brightness || t.saturation || t.hue || t.contrast)

export interface SystemRow {
  name: string
  role?: 'danger' | 'warning' | 'success' | 'info'
  steps: Step[]
  /** The row made from the colour itself. */
  yours: boolean
}
export interface System {
  rows: SystemRow[]
  neutral: Step[]
}

/**
 * The common families, each at its Tailwind 500 (v4, OKLCH): where its hue
 * sits and how light it naturally is. Yellow is light, blue is dark; that
 * stays true in every system.
 */
const FAMILY: { name: string; hex: Rgb; role?: SystemRow['role'] }[] = [
  { name: 'red', hex: { r: 0xfb, g: 0x2c, b: 0x36 }, role: 'danger' },
  { name: 'orange', hex: { r: 0xff, g: 0x69, b: 0x00 } },
  { name: 'yellow', hex: { r: 0xef, g: 0xb1, b: 0x00 }, role: 'warning' },
  { name: 'green', hex: { r: 0x00, g: 0xc9, b: 0x50 }, role: 'success' },
  { name: 'teal', hex: { r: 0x00, g: 0xbb, b: 0xa7 } },
  { name: 'blue', hex: { r: 0x2b, g: 0x7f, b: 0xff }, role: 'info' },
  { name: 'purple', hex: { r: 0xad, g: 0x46, b: 0xff } },
  { name: 'pink', hex: { r: 0xf6, g: 0x33, b: 0x9a } },
]

/** Where on the wheel each of a harmony's colours sits, from yours. */
const TURNS: Partial<Record<Mode, number[]>> = {
  analogous: [-30, 0, 30],
  opposite: [0, 180],
  split: [0, 150, 210],
  triad: [0, 120, 240],
}

/** The neutral's reference: a soft tint of the colour's hue (decided for neutrals). */
const NEUTRAL_L = 0.553
const NEUTRAL_C = 0.024

const lchOf = (c: Rgb): Lch => toLch(rgbToOklab(c))
const rgbOf = (L: number, C: number, h: number): Rgb =>
  oklabToRgb(fromLch({ L, C: Math.max(0, C), h: (h + 360) % 360 }))
const hueGap = (a: number, b: number): number => ((a - b + 540) % 360) - 180

/** Whether a colour survives the trip to 8-bit sRGB, near enough. */
function fits(L: number, C: number, h: number): boolean {
  const lab = fromLch({ L, C, h })
  const back = rgbToOklab(oklabToRgb(lab))
  return Math.hypot(back.L - lab.L, back.a - lab.a, back.b - lab.b) < 0.003
}

/** The most chroma a lightness and hue can have inside sRGB. */
function maxC(L: number, h: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (fits(L, m, h)) lo = m
    else hi = m
  }
  return lo
}

/** How vivid a colour is, 0 to 1: its chroma over the most its L and h allow. */
function vividness({ L, C, h }: Lch): number {
  const most = maxC(L, h)
  // Black and white allow none; they are as vivid as they can be, which is not at all.
  return most > 0 ? Math.min(1, C / most) : 0
}

/** Brightness: towards white above 0, towards black below. */
const lighten = (L: number, k: number): number =>
  k >= 0 ? L + (0.98 - L) * (k / 100) : L + (L - 0.05) * (k / 100)
/** Saturation: towards grey below 0, towards the most vivid sRGB allows above. */
const saturate = (C: number, most: number, k: number): number =>
  k >= 0 ? C + (Math.max(C, most) - C) * (k / 100) : C * (1 + k / 100)

/** Your colour with the tweaks on it; untouched when there are none. */
function tweakRgb(c: Rgb, t: Tweak): Rgb {
  if (!(t.brightness || t.saturation || t.hue)) return c
  const { L: L0, C: C0, h: h0 } = lchOf(c)
  const L = lighten(L0, t.brightness)
  const h = (h0 + t.hue + 360) % 360
  let C = saturate(C0, maxC(L, h), t.saturation)
  for (let k = 0; k < 40 && C > 0 && !fits(L, C, h); k++) C -= 0.005
  return rgbOf(L, C, h)
}

/** A colour at L, C, h with brightness, saturation and hue tweaked, kept inside sRGB. */
function made(L0: number, C0: number, h0: number, t: Tweak): Rgb {
  const L = lighten(L0, t.brightness)
  const h = (h0 + t.hue + 360) % 360
  const most = maxC(L, h)
  return rgbOf(L, Math.min(most, saturate(C0, most, t.saturation)), h)
}

/** Contrast: every step but the reference moved further from it in lightness, or nearer. */
function contrasted(steps: Step[], k: number, at: number): Step[] {
  if (!k) return steps
  const mid = lchOf((steps[at] as Step).rgb).L
  return steps.map((s, i) => {
    if (i === at) return s
    const c = lchOf(s.rgb)
    const L = Math.max(0.02, Math.min(0.995, mid + (c.L - mid) * (1 + k / 100)))
    const rgb = rgbOf(L, Math.min(c.C, maxC(L, c.h)), c.h)
    return { ...s, rgb, hex: toHex(rgb) }
  })
}

interface Colour {
  name: string
  role?: SystemRow['role']
  rgb: Rgb
  yours: boolean
}

/**
 * The full set's 500s. The colour takes the family nearest its hue, as
 * itself. Every other family keeps its own hue and natural lightness, but
 * moved the way the colour is moved from its family's: as much lighter or
 * darker, as vivid or as muted, and turned half as far round the wheel (at
 * most 10°).
 */
function fullSet(base: Rgb, t: Tweak): Colour[] {
  const b = lchOf(base)
  const nat = FAMILY.map((f) => lchOf(f.hex))
  let slot = 0
  nat.forEach((n, i) => {
    if (Math.abs(hueGap(b.h, n.h)) < Math.abs(hueGap(b.h, (nat[slot] as Lch).h))) slot = i
  })
  const home = nat[slot] as Lch
  const turn = Math.max(-10, Math.min(10, hueGap(b.h, home.h) / 2))
  const vivid = vividness(b)
  return FAMILY.map((f, i) => {
    if (i === slot) return { name: f.name, role: f.role, rgb: tweakRgb(base, t), yours: true }
    const n = nat[i] as Lch
    const matched =
      b.L >= home.L ? n.L + ((b.L - home.L) * (1 - n.L)) / (1 - home.L) : (n.L * b.L) / home.L
    const L = lighten(matched, t.brightness)
    const h = (n.h + turn + t.hue + 360) % 360
    const most = maxC(L, h)
    const own = Math.min(1, vividness(n))
    const C = Math.min(most, saturate(vivid * own * most, most, t.saturation))
    return { name: f.name, role: f.role, rgb: rgbOf(L, C, h), yours: false }
  })
}

/** The 500s of a mode other than the full set. */
function modeColours(base: Rgb, mode: Mode, t: Tweak): Colour[] {
  const b = lchOf(base)
  const fam = hueName(base)
  if (mode === 'mono') {
    return [
      { name: fam, rgb: tweakRgb(base, t), yours: true },
      { name: `${fam} soft`, rgb: made(b.L, b.C * 0.5, b.h, t), yours: false },
      { name: `${fam} dusty`, rgb: made(b.L, b.C * 0.22, b.h, t), yours: false },
    ]
  }
  if (mode === 'pastel') {
    // The untweaked full set, made light and soft; then the tweaks.
    // From a grey, the rows have no hue of their own: each takes its family's.
    return fullSet(base, NO_TWEAK).map((c, i) => {
      const own = lchOf(c.rgb)
      const h = own.C < 0.01 ? lchOf((FAMILY[i] as (typeof FAMILY)[number]).hex).h : own.h
      return { ...c, rgb: made(0.86, Math.min(0.1, maxC(0.86, h)) * 0.85, h, t) }
    })
  }
  const vivid = vividness(b)
  const colours = (TURNS[mode] ?? [0]).map((turn): Colour => {
    if (turn === 0) return { name: fam, rgb: tweakRgb(base, t), yours: true }
    const h = (b.h + turn + 360) % 360
    const C = vivid * maxC(b.L, h)
    // Named untweaked, as yours is, so turning the hue does not rename the rows.
    // A pale harmony keeps its hue's name: a light yellow's opposite is a blue, if a faint one.
    const name = vivid > 0 ? familyAt(h) : hueName(made(b.L, C, h, NO_TWEAK))
    return { name, rgb: made(b.L, C, h, t), yours: false }
  })
  // Your colour first, then round the wheel.
  return colours.sort((x, y) => Number(y.yours) - Number(x.yours))
}

/** The neutral: the tweaks move it as they move the rest: lighter or darker, its tint stronger or fainter, turned with the hue. */
function neutralOf(base: Rgb, t: Tweak, spec: StepSpec): Step[] {
  const h = lchOf(base).h + t.hue
  const C = Math.max(0, NEUTRAL_C * (1 + t.saturation / 100))
  return scale(rgbOf(lighten(NEUTRAL_L, t.brightness), C, h), spec)
}

export function system(
  base: Rgb,
  mode: Mode,
  tweak: Tweak = NO_TWEAK,
  spec: StepSpec = DEFAULT_STEPS,
): System {
  const at = referenceIndex(spec)
  const colours = mode === 'full' ? fullSet(base, tweak) : modeColours(base, mode, tweak)
  const rows = colours.map(
    ({ name, role, rgb, yours }): SystemRow => ({
      name,
      ...(role ? { role } : {}),
      steps: contrasted(scale(rgb, spec), tweak.contrast, at),
      yours,
    }),
  )
  return { rows, neutral: contrasted(neutralOf(base, tweak, spec), tweak.contrast, at) }
}
