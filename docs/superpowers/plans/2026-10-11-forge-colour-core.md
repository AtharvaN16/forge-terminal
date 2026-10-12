# Colour, plan 1 of 2 — neutral greys, colour core, CLI and MCP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This plan does three things:
- Switch the app's greys to neutral greys.
- Build everything colour mode needs below the screen: colour maths, palette extraction, going deeper, scales, the Figma card and pixel sampling.
- Expose it all through `forge palette`, `forge scale` and two MCP tools.

**Architecture:**
- **Pure functions** live in `src/core/colour/`. They take RGB values or a `Pixels` buffer and return data or strings.
- **Pixels are decoded once**, in `src/engines/pixels.ts`, with lazy sharp, `rotate()` first and HEIC through `sips`.
- **The CLI and MCP** call that core in-process, the way `probe` does.
- **The shell screens are plan 2.** They come after the uncommitted W5/G1 work on `dev` lands, because they touch the same `App.tsx` code.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node 26, sharp via `loadSharp`, vitest, biome (line width 100), zod and `@modelcontextprotocol/server`.

**Spec:** `docs/superpowers/specs/2026-10-11-forge-colour-design.md`. Read it with this plan. The section numbers below (§) refer to it.

## Global Constraints

- **Invariant 1:** `src/core/**` imports no React, Ink or Chalk, never writes to stdout, and never imports `sharp` as a value. Sharp only through `loadSharp()` in `src/engines/`.
- **Invariant 3:** sources are probed by content (`probe(path)` from `src/engines/registry.ts`), never by extension.
- **Invariant 4:** `.rotate()` runs before any other sharp operation. HEIC is the exception: `sips` already uprights it (see `decodeHeic`).
- **Opaque pixels:** a pixel is opaque when its alpha is ≥ 128. Only opaque pixels are grouped.
- **Hex output** is always `#RRGGBB`, uppercase. `rgb()` text is `rgb(r g b)`. `oklch()` text is `oklch(L% C h)`: L to 0 decimals, C to 3 decimals, h to 0 decimals.
- **Sample size:** 192 px on the longest side (§2.2).
- **Grouping parameters:**
  - palette: k 8, merge below ΔE_OK 0.06, drop below 1.5%
  - inside a colour: k 4, merge below 0.03, drop below 2%
  - dropped pixels are reassigned to the nearest kept centre, so shares sum to 1
- **Scale** (§4.4):
  - step 500 is the reference, exactly
  - lighter steps 50–400: f = 1, 0.86, 0.68, 0.46, 0.22; L = L₀ + (top − L₀)·f, where top = max(0.975, L₀); C = C₀·(1 − 0.88f)
  - darker steps 600–950: g = 0.2, 0.4, 0.6, 0.8, 1.0; L = L₀ − (L₀ − L_min)·g, where L_min = min(L₀, max(0.16, 0.42·L₀)); C = C₀·(1 − 0.45g)
  - hue is held; a reference with C₀ < 0.015 is grey and every step gets C 0
  - gamut: lower C by 0.002 until the step is in sRGB, then clamp C at 0
- **Contrast** is WCAG 2 against `#FFFFFF` and `#000000`: AAA ≥ 7, AA ≥ 4.5, large ≥ 3, otherwise fails.
- **Exit codes:** 0 ok; 1 a file failed or was refused; 2 invalid arguments, including an unparseable colour.
- **Commits:**
  - one commit per task, on `feat/colour`, from the worktree
  - message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - never `git stash`
- **Before each commit:** `npm run lint` and `npm run typecheck` are clean, and the task's tests pass.

## Review Focus

1. **A fully transparent image.** `palette()` returns `[]`. The CLI reports "nothing to take colours from" with exit 1; it must not crash or print an empty list. Pinned in Task 5 (core) and Task 8 (CLI).
2. **A tiny image (1×1, or fewer pixels than k).** The grouping returns 1–n groups with finite shares that sum to 1. No NaN and no empty group. Pinned in Task 5.
3. **Colour input as people type it.** That covers `6579fd`, ` #6579FD `, `#abc` and `#GGGGGG`. It also covers `forge scale` with no argument, which is what bash passes when `#6579FD` is unquoted. Each parses or is refused with a hint about quoting. Pinned in Task 2 and Task 8.
4. **Extreme references** (`#FFFFFF`, `#000000`, `#0000FF`). Every step is in sRGB, lightness never rises from 50 to 950, and the gamut loop ends. Pinned in Task 4.
5. **Real-world images: EXIF-rotated, animated, or not an image at all.** A rotated photo is sampled upright. An animated GIF uses its first frame. A PDF is refused as "not an image" with exit 1. Pinned in Task 6 and Task 8.

---

### Task 1: Neutral greys, app-wide

The spec's §2.5 table, in code. Every grey token in `DARK` becomes neutral (r = g = b). The secondary text gets more contrast. The mockup-derived cell fixtures are regenerated with the same substitution, so the cell tests keep holding the screens to the mockups.

**Files:**
- Modify: `src/shell/theme.ts` (the `DARK` block, about lines 158–202)
- Modify: `scripts/home-mockup-fixture.mjs` (substitute the greys in the mockup's script before running it)
- Regenerate: `tests/shell/fixtures/home-mockup.json`, `commands-mockup.json`, `bar-mockup.json`
- Test: `tests/shell/palette.test.ts`

**Interfaces:**
- Produces: `DARK.fg` `#e7e7e7`, `dim` `#b0b0b0`, `border` `#808080`, `faint` `#4d4d4d`, `selectionBg`/`band` `#2c2c2c`, `keycapBg` `#333333`, `listBand` `#323232`, `panelBand` `#404040`. The token names do not change.

- [ ] **Step 1: Write the failing tests** (append to `tests/shell/palette.test.ts`, inside the existing `describe('palette contrast', …)`, which already has `contrast()` and `DARK_BG`):

```ts
  it('dark greys are neutral: no blue tint anywhere', () => {
    const greys = ['fg', 'dim', 'border', 'faint', 'selectionBg', 'band', 'keycapBg', 'listBand', 'panelBand'] as const
    for (const k of greys) {
      const h = DARK[k]
      expect(h.slice(1, 3), `DARK.${k}`).toBe(h.slice(3, 5))
      expect(h.slice(3, 5), `DARK.${k}`).toBe(h.slice(5, 7))
    }
  })

  it('secondary text reads at AAA on the canvas, dim labels at 4:1', () => {
    expect(contrast(DARK.dim, DARK_BG)).toBeGreaterThanOrEqual(7)
    expect(contrast(DARK.border, DARK_BG)).toBeGreaterThanOrEqual(4)
  })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/shell/palette.test.ts`
Expected: FAIL. The first test fails on `DARK.fg` (`e4` ≠ `e8`), and the second on `dim` at 5.4.

- [ ] **Step 3: Change the tokens** in `src/shell/theme.ts` `DARK`. Replace the values, and the comments that quote ratios, with:

```ts
  fg: '#e7e7e7',
  // 7.7:1 on a #1e1e1e terminal (AAA). Secondary text here is real content
  // (sizes, paths), so it reads as text, not decoration. Neutral grey: no
  // grey in this palette carries a blue tint (spec 2026-10-11 colour §2.5).
  dim: '#b0b0b0',
```

```ts
  // 4.2:1 on #1e1e1e: dim labels, hints and frames. Above the 3:1 a boundary
  // needs, and still a clear step below `dim`.
  border: '#808080',
  selectionBg: '#2c2c2c',
  band: '#2c2c2c',
```

```ts
  // `fg` (#e7e7e7) on this fill measures about 10:1.
  keycapBg: '#333333',
```

```ts
  faint: '#4d4d4d',
  // One step up from `selectionBg`, so the band reads on the terminal and is
  // not mistaken for the drop surface above it.
  listBand: '#323232',
  panelBand: '#404040',
```

Leave `textSelectionBg: '#3f5c86'` as it is. It is a selection colour, not a grey.

- [ ] **Step 4: Run the palette tests**

Run: `npx vitest run tests/shell/palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the fixtures with the same substitution.** In `scripts/home-mockup-fixture.mjs`, right after the `const script = [...html.matchAll(...)]…join('\n')` chain (before the first `.replace(HOOK, …)`), map the frozen mockup's greys to the new ones. Do it as a separate step, so the frozen HTML itself never changes:

```js
/**
 * The app's greys went neutral after the mockup was frozen (colour spec
 * §2.5). Each old blue-tinted grey is swapped for its neutral replacement in
 * the mockup's script before it runs, so every derived colour (the drop
 * zone's dots are mixes of the panel colour) is recomputed from the new
 * values rather than patched afterwards.
 */
const NEUTRAL = {
  '#e4e8f0': '#e7e7e7', '#8b93a6': '#b0b0b0', '#5f6879': '#808080', '#3d4350': '#4d4d4d',
  '#252c3a': '#2c2c2c', '#2b3343': '#333333', '#2e3340': '#333333', '#2a3242': '#323232',
  '#33405a': '#404040', '#2a2e37': '#2e2e2e',
}
const neutral = (s) => s.replace(/#[0-9a-fA-F]{6}\b/g, (h) => NEUTRAL[h.toLowerCase()] ?? h)
```

Apply `neutral(...)` to the joined script before the hook replacements, for example `const script = neutral([...].join('\n')).replace(HOOK, …)`.

Then run: `node scripts/home-mockup-fixture.mjs`
Expected: it rewrites the three fixture JSONs, and `git diff --stat tests/shell/fixtures` shows only colour values changed.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. If a test hard-codes an old grey, change it to read the theme token. `tests/shell/motion.test.tsx` passes literal colours to `Shimmer`, does not depend on the theme, and stays as it is.

- [ ] **Step 7: Commit**

```bash
git add src/shell/theme.ts scripts/home-mockup-fixture.mjs tests/shell/palette.test.ts tests/shell/fixtures
git commit -m "feat(theme): neutral greys everywhere, more contrast on secondary text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Colour spaces, parsing and formatting

**Files:**
- Create: `src/core/colour/space.ts`
- Test: `tests/core/colour/space.test.ts`

**Interfaces:**
- Produces:
  - `type Rgb = { r: number; g: number; b: number }` (0–255 integers)
  - `type Lab = { L: number; a: number; b: number }`
  - `type Lch = { L: number; C: number; h: number }` (h in degrees, 0–360)
  - `parseHex(input: string): Rgb | undefined`
  - `toHex(c: Rgb): string`
  - `rgbToOklab(c: Rgb): Lab`
  - `oklabToLinear(lab: Lab): [number, number, number]`
  - `oklabToRgb(lab: Lab): Rgb`
  - `inGamut(lab: Lab): boolean`
  - `toLch(lab: Lab): Lch`
  - `fromLch(lch: Lch): Lab`
  - `formatRgb(c: Rgb): string`
  - `formatOklch(c: Rgb): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  formatOklch, formatRgb, fromLch, inGamut, oklabToRgb, parseHex, rgbToOklab, toHex, toLch,
} from '../../../src/core/colour/space.js'

describe('parseHex', () => {
  it('reads six and three digits, with or without #, any case, trimmed', () => {
    expect(parseHex('#6579FD')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('6579fd')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('  #6579FD  ')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })
  it('refuses anything else', () => {
    for (const bad of ['', '#', '#GGGGGG', '#12345', '#1234567', 'rgb(1 2 3)', 'blue']) {
      expect(parseHex(bad), bad).toBeUndefined()
    }
  })
})

describe('OKLab', () => {
  it('matches the reference values', () => {
    const red = rgbToOklab({ r: 255, g: 0, b: 0 })
    expect(red.L).toBeCloseTo(0.628, 3)
    expect(red.a).toBeCloseTo(0.2249, 3)
    expect(red.b).toBeCloseTo(0.1258, 3)
    expect(rgbToOklab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(1, 4)
    expect(rgbToOklab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 6)
  })
  it('round-trips every 17th sRGB colour exactly', () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          expect(oklabToRgb(rgbToOklab({ r, g, b }))).toEqual({ r, g, b })
        }
  })
  it('knows the sRGB gamut', () => {
    expect(inGamut(rgbToOklab({ r: 0, g: 0, b: 255 }))).toBe(true)
    expect(inGamut(fromLch({ L: 0.5, C: 0.4, h: 140 }))).toBe(false)
  })
  it('LCh is LCh: hue in degrees, 0 to 360', () => {
    const blue = toLch(rgbToOklab({ r: 0, g: 0, b: 255 }))
    expect(blue.h).toBeCloseTo(264.1, 1)
    expect(blue.C).toBeCloseTo(0.3132, 3)
  })
})

describe('formatting', () => {
  it('writes hex, rgb and oklch the one way', () => {
    expect(toHex({ r: 101, g: 121, b: 253 })).toBe('#6579FD')
    expect(formatRgb({ r: 53, g: 103, b: 35 })).toBe('rgb(53 103 35)')
    expect(formatOklch({ r: 101, g: 121, b: 253 })).toBe('oklch(63% 0.196 273)')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/core/colour/space.test.ts`
Expected: FAIL, "Failed to resolve import … space.js".

- [ ] **Step 3: Implement `src/core/colour/space.ts`**

```ts
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
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/core/colour/space.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/colour/space.ts tests/core/colour/space.test.ts
git commit -m "feat(colour): sRGB, OKLab and OKLCH, hex parsing and formatting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Contrast ratings and colour-family names

**Files:**
- Create: `src/core/colour/contrast.ts`, `src/core/colour/names.ts`
- Test: `tests/core/colour/contrast.test.ts`

**Interfaces:**
- Consumes: `Rgb`, `rgbToOklab`, `toLch` (Task 2).
- Produces:
  - `contrast(a: Rgb, b: Rgb): number`
  - `type Rating = 'AAA' | 'AA' | 'large' | 'fails'`
  - `rate(ratio: number): Rating`
  - `onWhiteAndBlack(c: Rgb): { white: number; black: number }` (each rounded to 1 decimal)
  - `hueName(c: Rgb): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { contrast, onWhiteAndBlack, rate } from '../../../src/core/colour/contrast.js'
import { hueName } from '../../../src/core/colour/names.js'
import { parseHex } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as NonNullable<ReturnType<typeof parseHex>>

describe('contrast', () => {
  it('is the WCAG 2 ratio', () => {
    expect(contrast(hex('#000000'), hex('#FFFFFF'))).toBeCloseTo(21, 5)
    expect(contrast(hex('#777777'), hex('#FFFFFF'))).toBeCloseTo(4.48, 2)
    expect(contrast(hex('#FFFFFF'), hex('#777777'))).toBeCloseTo(4.48, 2)
  })
  it('rates at the WCAG thresholds', () => {
    expect([7, 6.99, 4.5, 4.49, 3, 2.99].map(rate)).toEqual(['AAA', 'AA', 'AA', 'large', 'large', 'fails'])
  })
  it('gives white and black to one decimal', () => {
    expect(onWhiteAndBlack(hex('#6579FD'))).toEqual({ white: 3.7, black: 5.7 })
  })
})

describe('hueName', () => {
  it('names the family, or grey when there is no colour to name', () => {
    expect(['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#6579FD', '#808080', '#FFFFFF']
      .map((h) => hueName(hex(h))))
      .toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'blue', 'grey', 'grey'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/core/colour/contrast.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`src/core/colour/contrast.ts`:

```ts
import type { Rgb } from './space.js'

const lin = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ({ r, g, b }: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** The WCAG 2 contrast ratio, 1 to 21, in either order. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export type Rating = 'AAA' | 'AA' | 'large' | 'fails'

export function rate(ratio: number): Rating {
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'large' : 'fails'
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const one = (n: number): number => Math.round(n * 10) / 10

/** How white text and black text read on this colour, to one decimal. */
export function onWhiteAndBlack(c: Rgb): { white: number; black: number } {
  return { white: one(contrast(c, WHITE)), black: one(contrast(c, BLACK)) }
}
```

`src/core/colour/names.ts`:

```ts
import { type Rgb, rgbToOklab, toLch } from './space.js'

/**
 * A colour family, for the Figma card's title and its layer ids (`blue-500`).
 * A fixed table of OKLCH hue ranges, measured on the sRGB primaries and
 * secondaries (red 29°, orange 53°, yellow 110°, green 142°, cyan 195°, blue
 * 264°). A label, not a naming service.
 */
const FAMILIES: [number, string][] = [
  [15, 'rose'], [45, 'red'], [70, 'orange'], [95, 'amber'], [120, 'yellow'], [140, 'lime'],
  [165, 'green'], [185, 'teal'], [215, 'cyan'], [250, 'sky'], [280, 'blue'], [295, 'indigo'],
  [315, 'violet'], [340, 'purple'], [355, 'pink'], [360, 'rose'],
]

export function hueName(c: Rgb): string {
  const { C, h } = toLch(rgbToOklab(c))
  if (C < 0.03) return 'grey'
  return (FAMILIES.find(([upTo]) => h < upTo) ?? [360, 'rose'])[1]
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/core/colour/contrast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/colour/contrast.ts src/core/colour/names.ts tests/core/colour/contrast.test.ts
git commit -m "feat(colour): WCAG contrast ratings and colour-family names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The tonal scale

**Files:**
- Create: `src/core/colour/scale.ts`
- Test: `tests/core/colour/scale.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Rgb`, `rgbToOklab`, `toLch`, `fromLch`, `inGamut`, `oklabToRgb`, `toHex`).
- Produces:
  - `STEPS: readonly number[]` (`[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]`)
  - `interface Step { step: number; rgb: Rgb; hex: string; reference: boolean }`
  - `scale(ref: Rgb): Step[]` (always 11 entries, with index 5 the reference)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { scale, STEPS } from '../../../src/core/colour/scale.js'
import { inGamut, parseHex, rgbToOklab, toLch } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as NonNullable<ReturnType<typeof parseHex>>
const L = (h: string) => rgbToOklab(hex(h)).L

describe('scale', () => {
  it('pins the measured #6579FD scale, the reference exact at 500', () => {
    const s = scale(hex('#6579FD'))
    expect(s.map((x) => x.step)).toEqual([...STEPS])
    expect(s.map((x) => x.hex)).toEqual([
      '#F4F6FF', '#DFE6FE', '#C4D0FE', '#A3B6FF', '#8297FE', '#6579FD',
      '#5465DA', '#4351B7', '#343F96', '#252D76', '#161B58',
    ])
    expect(s.filter((x) => x.reference).map((x) => x.step)).toEqual([500])
  })

  it('pins #343F96 made the centre (the r key)', () => {
    expect(scale(hex('#343F96')).map((x) => x.hex)).toEqual([
      '#F4F6FF', '#D5DCF4', '#B0BAE1', '#8492CA', '#5867AF', '#343F96',
      '#2A3380', '#21286B', '#181D57', '#0F1344', '#070931',
    ])
  })

  const SWEEP = ['#FFFFFF', '#000000', '#808080', '#0000FF', '#00FF00', '#FF0000', '#FFFF00',
    '#00FFFF', '#FF00FF', '#E8B44C', '#F26E69', '#356723', '#F4F6FF', '#070931', '#7F7F80']

  it('never brightens from 50 to 950, for any reference', () => {
    for (const ref of SWEEP) {
      const ls = scale(hex(ref)).map((x) => L(x.hex))
      for (let i = 1; i < ls.length; i++) {
        expect(ls[i], `${ref} step ${STEPS[i]}`).toBeLessThanOrEqual((ls[i - 1] as number) + 0.002)
      }
    }
  })

  it('keeps every step in sRGB and the hue of the reference', () => {
    for (const ref of SWEEP) {
      const refLch = toLch(rgbToOklab(hex(ref)))
      for (const x of scale(hex(ref))) {
        expect(inGamut(rgbToOklab(x.rgb))).toBe(true)
        const lch = toLch(rgbToOklab(x.rgb))
        if (refLch.C >= 0.015 && lch.C >= 0.03) {
          const d = Math.abs(((lch.h - refLch.h + 540) % 360) - 180)
          expect(d, `${ref} → ${x.hex}`).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('a grey reference gives a grey scale', () => {
    for (const x of scale(hex('#808080'))) {
      expect(x.rgb.r).toBe(x.rgb.g)
      expect(x.rgb.g).toBe(x.rgb.b)
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/core/colour/scale.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement `src/core/colour/scale.ts`**

```ts
import { fromLch, inGamut, oklabToRgb, type Rgb, rgbToOklab, toHex, toLch } from './space.js'

/**
 * A tonal scale with the reference always at 500 (colour spec §2.3, §4.4).
 * Lightness follows a fixed ladder away from the reference, chroma thins
 * towards the ends, the hue is held, and a step outside sRGB gives up chroma
 * until it fits. The numbers were tuned on the mockups and are pinned by the
 * tests; change them only with new measurements.
 */
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export interface Step {
  step: number
  rgb: Rgb
  hex: string
  /** True for 500, which is the reference exactly. */
  reference: boolean
}

const UP = [1.0, 0.86, 0.68, 0.46, 0.22]
const DOWN = [0.2, 0.4, 0.6, 0.8, 1.0]

export function scale(ref: Rgb): Step[] {
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const grey = C0 < 0.015
  const top = Math.max(0.975, L0)
  const floor = Math.min(L0, Math.max(0.16, 0.42 * L0))
  return STEPS.map((step, i) => {
    if (i === 5) return { step, rgb: { ...ref }, hex: toHex(ref), reference: true }
    const lighter = i < 5
    const f = lighter ? (UP[i] as number) : (DOWN[i - 6] as number)
    const L = lighter ? L0 + (top - L0) * f : L0 - (L0 - floor) * f
    let C = grey ? 0 : C0 * (lighter ? 1 - 0.88 * f : 1 - 0.45 * f)
    while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
    const rgb = oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
    return { step, rgb, hex: toHex(rgb), reference: false }
  })
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/core/colour/scale.test.ts`
Expected: PASS. If one pinned hex is off by one in a channel, the `Math.max(0, C)` clamp is the only difference from the measured script (`/tmp/forge-colour/data.mjs`, which did not clamp). Check which step hit a negative C. Do not change the pinned values to match.

- [ ] **Step 5: Commit**

```bash
git add src/core/colour/scale.ts tests/core/colour/scale.test.ts
git commit -m "feat(colour): tonal scale with the reference at 500

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Palette, going deeper and the photo map

**Files:**
- Create: `src/core/colour/group.ts` (k-means, merge, drop), `src/core/colour/palette.ts`
- Test: `tests/core/colour/palette.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Rgb`, `Lab`, `rgbToOklab`, `toHex`).
- Produces (all from `palette.ts`):
  - `interface Pixels { width: number; height: number; rgba: Uint8Array }`
  - `interface Group { rgb: Rgb; hex: string; share: number; centre: Lab; members: Uint32Array }`
  - `palette(px: Pixels): Group[]`
  - `inside(px: Pixels, parent: Group): Group[]`
  - `canOpen(px: Pixels, g: Group): boolean`
  - `wholePercents(shares: number[]): number[]`
  - `photoMap(px: Pixels, groups: Group[], max?: number): number[][]`
  - the constants `TRANSPARENT = -1` and `OUTSIDE = -2`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  canOpen, inside, OUTSIDE, type Pixels, palette, photoMap, TRANSPARENT, wholePercents,
} from '../../../src/core/colour/palette.js'

/** w × h pixels, each from paint(x, y) → [r, g, b, a]. */
function pixels(w: number, h: number, paint: (x: number, y: number) => number[]): Pixels {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(paint(x, y), (y * w + x) * 4)
  return { width: w, height: h, rgba }
}
const quadrants = pixels(40, 40, (x, y) =>
  x < 20 ? (y < 20 ? [230, 30, 30, 255] : [30, 160, 60, 255]) : y < 20 ? [40, 70, 220, 255] : [240, 200, 40, 255])

describe('palette', () => {
  it('finds the four colours of a quadrant image, a quarter each', () => {
    const g = palette(quadrants)
    expect(g.map((x) => x.hex).sort()).toEqual(['#1EA03C', '#2846DC', '#E61E1E', '#F0C828'])
    for (const x of g) expect(x.share).toBeCloseTo(0.25, 5)
  })
  it('one flat colour is one group', () => {
    const g = palette(pixels(30, 30, () => [10, 20, 30, 255]))
    expect(g).toHaveLength(1)
    expect(g[0]?.share).toBe(1)
  })
  it('a tiny image never yields NaN or empty groups', () => {
    for (const p of [pixels(1, 1, () => [1, 2, 3, 255]), pixels(3, 1, (x) => [x * 100, 0, 0, 255])]) {
      const g = palette(p)
      expect(g.length).toBeGreaterThan(0)
      expect(g.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9)
      for (const x of g) expect(x.members.length).toBeGreaterThan(0)
    }
  })
  it('leaves transparent pixels out; a fully transparent image has no palette', () => {
    const half = pixels(20, 20, (x) => (x < 10 ? [200, 0, 0, 255] : [0, 0, 200, 0]))
    expect(palette(half).map((x) => x.hex)).toEqual(['#C80000'])
    expect(palette(pixels(5, 5, () => [9, 9, 9, 0]))).toEqual([])
  })
  it('is deterministic', () => {
    const noisy = pixels(64, 64, (x, y) => [(x * 37 + y * 11) % 256, (x * 5) % 256, (y * 9) % 256, 255])
    expect(palette(noisy).map((x) => x.hex)).toEqual(palette(noisy).map((x) => x.hex))
  })
  it('reports a colour that is really in the image', () => {
    const grad = pixels(64, 8, (x) => [x * 4, 100, 255 - x * 4, 255])
    const present = new Set<string>()
    for (let i = 0; i < grad.rgba.length; i += 4) {
      present.add([grad.rgba[i], grad.rgba[i + 1], grad.rgba[i + 2]].join())
    }
    for (const g of palette(grad)) {
      expect(present.has([g.rgb.r, g.rgb.g, g.rgb.b].join()), `${g.hex} is a pixel of the image`).toBe(true)
    }
  })
})

describe('inside', () => {
  it('splits a group the palette merged back into its two colours', () => {
    // ΔE_OK between these two reds is 0.042: under the palette's 0.06 merge
    // (one colour at the top) and over the inside 0.03 (two shades within).
    const twoReds = pixels(40, 40, (x, y) =>
      x < 20 ? (y < 30 ? [230, 30, 30, 255] : [210, 25, 25, 255]) : [20, 20, 200, 255])
    const top = palette(twoReds)
    expect(top).toHaveLength(2)
    const red = top.find((g) => g.rgb.r > 100) ?? expect.fail('no red group')
    const shades = inside(twoReds, red)
    expect(shades.map((s) => s.hex).sort()).toEqual(['#D21919', '#E61E1E'])
    expect(shades.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9)
    expect(canOpen(twoReds, red)).toBe(true)
  })
  it('a flat group cannot be opened', () => {
    const flat = pixels(20, 20, () => [5, 5, 5, 255])
    expect(canOpen(flat, palette(flat)[0] as never)).toBe(false)
  })
})

describe('wholePercents', () => {
  it('adds up to the rounded total by largest remainder', () => {
    expect(wholePercents([0.333, 0.333, 0.334])).toEqual([33, 33, 34])
    // floors 19 19 17 16 15 11 = 97; the three largest remainders (.9 .8 .7) get one each.
    expect(wholePercents([0.196, 0.19, 0.177, 0.169, 0.15, 0.118])).toEqual([19, 19, 18, 17, 15, 12])
    expect(wholePercents([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0)).toBe(100)
    // Inside a colour after small shades were dissolved, shares still sum to 1.
    expect(wholePercents([0.68, 0.126, 0.101, 0.093])).toEqual([68, 13, 10, 9])
  })
})

describe('photoMap', () => {
  it('keeps the aspect, at most 24 a side, transparent cells marked', () => {
    const wide = pixels(96, 48, (x) => (x < 48 ? [200, 0, 0, 255] : [0, 0, 200, 0]))
    const map = photoMap(wide, palette(wide))
    expect(map).toHaveLength(12)
    expect(map[0]).toHaveLength(24)
    expect(map[0]?.[0]).toBe(0)
    expect(map[0]?.[23]).toBe(TRANSPARENT)
  })
  it('cells outside the given groups are OUTSIDE', () => {
    const top = palette(quadrants)
    const first = top[0] as NonNullable<(typeof top)[0]>
    const map = photoMap(quadrants, inside(quadrants, first))
    expect(map.flat().filter((c) => c === OUTSIDE).length).toBeGreaterThan(0)
    expect(map.flat().filter((c) => c >= 0).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/core/colour/palette.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement `src/core/colour/group.ts`**

```ts
/**
 * k-means in OKLab on typed arrays, then two clean-ups: centres closer than
 * `merge` are joined, and groups under `minShare` are dissolved into the
 * nearest one that stays. Deterministic: the first centre is the mean, each
 * next one the point farthest from all centres so far (ties: lowest index).
 */
export interface GroupOptions {
  k: number
  /** ΔE in OKLab below which two centres become one. */
  merge: number
  /** Fraction of the points below which a group is dissolved. */
  minShare: number
}

export interface RawGroup {
  centre: [number, number, number]
  /** Positions into the input arrays. */
  members: number[]
}

const d2 = (L: Float64Array, A: Float64Array, B: Float64Array, i: number, c: number[]) =>
  (L[i] - c[0]) ** 2 + (A[i] - c[1]) ** 2 + (B[i] - c[2]) ** 2

export function group(L: Float64Array, A: Float64Array, B: Float64Array, opts: GroupOptions): RawGroup[] {
  const n = L.length
  if (n === 0) return []
  const k = Math.min(opts.k, n)
  const centres: number[][] = []
  let mL = 0
  let mA = 0
  let mB = 0
  for (let i = 0; i < n; i++) {
    mL += L[i] as number
    mA += A[i] as number
    mB += B[i] as number
  }
  centres.push([mL / n, mA / n, mB / n])
  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  while (centres.length < k) {
    const last = centres[centres.length - 1] as number[]
    let far = 0
    let farD = -1
    for (let i = 0; i < n; i++) {
      const d = d2(L, A, B, i, last)
      if (d < (nearest[i] as number)) nearest[i] = d
      if ((nearest[i] as number) > farD) {
        farD = nearest[i] as number
        far = i
      }
    }
    centres.push([L[far] as number, A[far] as number, B[far] as number])
  }

  const owner = new Int32Array(n).fill(-1)
  for (let it = 0; it < 30; it++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Number.POSITIVE_INFINITY
      for (let c = 0; c < centres.length; c++) {
        const d = d2(L, A, B, i, centres[c] as number[])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (owner[i] !== best) {
        owner[i] = best
        moved++
      }
    }
    const sum = centres.map(() => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const s = sum[owner[i] as number] as number[]
      s[0] += L[i] as number
      s[1] += A[i] as number
      s[2] += B[i] as number
      s[3] += 1
    }
    sum.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    })
    if (moved === 0) break
  }

  let groups: RawGroup[] = centres
    .map((centre, c) => ({ centre: centre as [number, number, number], members: [] as number[] }))
  for (let i = 0; i < n; i++) groups[owner[i] as number]?.members.push(i)
  groups = groups.filter((g) => g.members.length > 0)

  // Merge the closest pair while it is closer than the threshold.
  for (;;) {
    let pair: [number, number] | undefined
    let pairD = opts.merge ** 2
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        const [x, y] = [(groups[a] as RawGroup).centre, (groups[b] as RawGroup).centre]
        const d = (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2
        if (d < pairD) {
          pairD = d
          pair = [a, b]
        }
      }
    if (!pair) break
    const [a, b] = [groups[pair[0]] as RawGroup, groups[pair[1]] as RawGroup]
    const na = a.members.length
    const nb = b.members.length
    const centre = a.centre.map((v, j) => (v * na + (b.centre[j] as number) * nb) / (na + nb))
    groups = groups.filter((_, i) => i !== pair[0] && i !== pair[1])
    groups.push({ centre: centre as [number, number, number], members: [...a.members, ...b.members] })
  }

  // Dissolve small groups into the nearest kept one (the largest always stays).
  groups.sort((x, y) => y.members.length - x.members.length)
  const keep = groups.filter((g, i) => i === 0 || g.members.length / n >= opts.minShare)
  for (const g of groups) {
    if (keep.includes(g)) continue
    for (const i of g.members) {
      let best = keep[0] as RawGroup
      let bestD = Number.POSITIVE_INFINITY
      for (const k2 of keep) {
        const d = d2(L, A, B, i, k2.centre)
        if (d < bestD) {
          bestD = d
          best = k2
        }
      }
      best.members.push(i)
    }
  }
  return keep
}
```

- [ ] **Step 4: Implement `src/core/colour/palette.ts`**

```ts
import { group, type GroupOptions } from './group.js'
import { type Lab, type Rgb, rgbToOklab, toHex } from './space.js'

/** Decoded pixels, RGBA, row by row. Made by `engines/pixels.ts`. */
export interface Pixels {
  width: number
  height: number
  rgba: Uint8Array
}

export interface Group {
  /** The real pixel nearest the group's centre (spec §2.2): never an average. */
  rgb: Rgb
  hex: string
  /** Of the opaque pixels (palette) or of the parent's pixels (inside). */
  share: number
  centre: Lab
  /** Pixel indices (into width × height), ascending. */
  members: Uint32Array
}

export const PALETTE: GroupOptions = { k: 8, merge: 0.06, minShare: 0.015 }
export const INSIDE: GroupOptions = { k: 4, merge: 0.03, minShare: 0.02 }
export const TRANSPARENT = -1
export const OUTSIDE = -2
const OPAQUE = 128
const MIN_TO_OPEN = 64

const rgbAt = (px: Pixels, i: number): Rgb => ({
  r: px.rgba[i * 4] as number,
  g: px.rgba[i * 4 + 1] as number,
  b: px.rgba[i * 4 + 2] as number,
})

function groupIndices(px: Pixels, indices: number[], opts: GroupOptions): Group[] {
  const n = indices.length
  const L = new Float64Array(n)
  const A = new Float64Array(n)
  const B = new Float64Array(n)
  indices.forEach((p, j) => {
    const lab = rgbToOklab(rgbAt(px, p))
    L[j] = lab.L
    A[j] = lab.a
    B[j] = lab.b
  })
  return group(L, A, B, opts)
    .map((g) => {
      let best = g.members[0] as number
      let bestD = Number.POSITIVE_INFINITY
      for (const j of g.members) {
        const d = ((L[j] as number) - g.centre[0]) ** 2 + ((A[j] as number) - g.centre[1]) ** 2 + ((B[j] as number) - g.centre[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
      const rgb = rgbAt(px, indices[best] as number)
      return {
        rgb,
        hex: toHex(rgb),
        share: g.members.length / n,
        centre: { L: g.centre[0], a: g.centre[1], b: g.centre[2] },
        members: Uint32Array.from(g.members.map((j) => indices[j] as number)).sort(),
      }
    })
    .sort((x, y) => y.share - x.share || (x.hex < y.hex ? -1 : 1))
}

/** The image's main colours, most of the image first. `[]` when nothing is opaque. */
export function palette(px: Pixels): Group[] {
  const opaque: number[] = []
  for (let i = 0; i < px.width * px.height; i++) if ((px.rgba[i * 4 + 3] as number) >= OPAQUE) opaque.push(i)
  return groupIndices(px, opaque, PALETTE)
}

/** The shades a group is made of; shares are of the group. */
export function inside(px: Pixels, parent: Group): Group[] {
  return groupIndices(px, [...parent.members], INSIDE)
}

/** Whether → can open this group: enough pixels, and more than one shade inside. */
export function canOpen(px: Pixels, g: Group): boolean {
  return g.members.length >= MIN_TO_OPEN && inside(px, g).length > 1
}

/** Whole percentages adding up to the rounded total, by largest remainder. */
export function wholePercents(shares: number[]): number[] {
  const raw = shares.map((s) => s * 100)
  const out = raw.map(Math.floor)
  let left = Math.round(raw.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0)
  raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => {
      if (left-- > 0) out[i] = (out[i] as number) + 1
    })
  return out
}

/**
 * The image as a grid at most `max` a side (aspect kept): each cell is the
 * index of the group owning the pixel at its centre, `TRANSPARENT`, or
 * `OUTSIDE` (opaque but in none of `groups`, as when they are one colour's shades).
 */
export function photoMap(px: Pixels, groups: Group[], max = 24): number[][] {
  const owner = new Int32Array(px.width * px.height).fill(OUTSIDE)
  groups.forEach((g, gi) => {
    for (const i of g.members) owner[i] = gi
  })
  const wide = px.width >= px.height
  const cols = wide ? max : Math.max(1, Math.round((max * px.width) / px.height))
  const rows = wide ? Math.max(1, Math.round((max * px.height) / px.width)) : max
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      const sx = Math.min(px.width - 1, Math.floor(((x + 0.5) * px.width) / cols))
      const sy = Math.min(px.height - 1, Math.floor(((y + 0.5) * px.height) / rows))
      const i = sy * px.width + sx
      return (px.rgba[i * 4 + 3] as number) < OPAQUE ? TRANSPARENT : (owner[i] as number)
    }),
  )
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/core/colour/palette.test.ts`
Expected: PASS. If "a tiny image" fails, check `k = Math.min(opts.k, n)` and that empty groups are filtered before merging.

- [ ] **Step 6: Commit**

```bash
git add src/core/colour/group.ts src/core/colour/palette.ts tests/core/colour/palette.test.ts
git commit -m "feat(colour): palette, going deeper, photo map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sampling pixels from a file

**Files:**
- Create: `src/engines/pixels.ts`
- Modify: `src/core/errors.ts` (add `notAnImage`, `nothingVisible`)
- Test: `tests/engines/pixels.test.ts`

**Interfaces:**
- Consumes:
  - `probe(path)` (`src/engines/registry.ts`)
  - `loadSharp` (`src/engines/libs.ts`)
  - `decodeHeic`, `heicDecodable` (`src/engines/heic.ts`)
  - `heicDecoderUnavailable`, `corruptSource` (`src/core/errors.ts`)
  - `Pixels` (Task 5)
- Produces:
  - `samplePixels(path: string, longest?: number): Promise<{ source: ImageInfo; pixels: Pixels }>`
  - `notAnImage(path: string, detected: string): ForgeError` (code `unsupported-source`)
  - `nothingVisible(path: string): ForgeError` (code `unsupported-source`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { palette } from '../../src/core/colour/palette.js'
import { samplePixels } from '../../src/engines/pixels.js'
import {
  makeAnimatedGif, makeCorruptFile, makeJpeg, makeOrientedJpeg, makePdf, makeTempDir,
} from '../helpers/fixtures.js'

describe('samplePixels', () => {
  it('shrinks to 192 on the longest side, RGBA', async () => {
    const dir = await makeTempDir()
    const { pixels, source } = await samplePixels(await makeJpeg(dir, 'a.jpg'))
    expect(Math.max(pixels.width, pixels.height)).toBeLessThanOrEqual(192)
    expect(pixels.rgba.length).toBe(pixels.width * pixels.height * 4)
    expect(source.kind).toBe('image')
  })
  it('reads an EXIF-rotated photo upright', async () => {
    const dir = await makeTempDir()
    // Stored 40 × 80 (portrait) with orientation 6: displayed 80 × 40.
    const { pixels } = await samplePixels(await makeOrientedJpeg(dir, 'r.jpg', 6))
    expect(pixels.width).toBeGreaterThan(pixels.height)
  })
  it('takes the first frame of an animation', async () => {
    const dir = await makeTempDir()
    const { pixels } = await samplePixels(await makeAnimatedGif(dir, 'a.gif', 3))
    expect(palette(pixels).length).toBeGreaterThan(0)
  })
  it('refuses a PDF as not an image, by content', async () => {
    const dir = await makeTempDir()
    await expect(samplePixels(await makePdf(dir, 'looks.png'))).rejects.toMatchObject({
      code: 'unsupported-source',
      title: 'Not an image',
    })
  })
  it('reports a corrupt file as corrupt', async () => {
    const dir = await makeTempDir()
    await expect(samplePixels(await makeCorruptFile(dir, 'bad.jpg'))).rejects.toMatchObject({
      code: expect.stringMatching(/corrupt-source|unsupported-source/),
    })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/engines/pixels.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Add the two errors** to `src/core/errors.ts`, after `unsupportedSource`:

```ts
/** A palette needs pixels. `detected` is what probing found, such as "a PDF". */
export function notAnImage(path: string, detected: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Not an image',
    detail: `${basename(path)} is ${detected}, not an image.`,
    hint: 'A palette is taken from a photo, a screenshot or artwork.',
  })
}

/** Every pixel is transparent, so there is no colour to take. */
export function nothingVisible(path: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Nothing to take colours from',
    detail: `${basename(path)} has no visible pixels.`,
  })
}
```

- [ ] **Step 4: Implement `src/engines/pixels.ts`**

```ts
import type { Pixels } from '../core/colour/palette.js'
import { corruptSource, heicDecoderUnavailable, isForgeError, notAnImage } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { ImageInfo } from '../core/types.js'
import { decodeHeic, heicDecodable } from './heic.js'
import { loadSharp } from './libs.js'
import { probe } from './registry.js'

/**
 * The pixels colour mode works on: the image shrunk to `longest` on its
 * longest side (192 is measured to keep a palette under 0.1 s, colour spec
 * §2.2), upright, RGBA. Not an Engine: it plans no jobs and writes nothing.
 * It lives here so sharp never enters core (invariant 1).
 */
export async function samplePixels(
  path: string,
  longest = 192,
): Promise<{ source: ImageInfo; pixels: Pixels }> {
  const source = await probe(path)
  if (source.kind !== 'image') {
    const label = FORMATS.find((f) => f.id === source.format)?.label ?? source.format
    throw notAnImage(path, `a ${label}`)
  }
  const heic = source.format === 'heic'
  if (heic && !(await heicDecodable())) throw heicDecoderUnavailable(path)
  const decoded = heic ? await decodeHeic(path) : undefined
  try {
    const sharp = await loadSharp()
    // sips already uprights HEIC; everything else is rotated first (invariant 4).
    const input = sharp(decoded?.path ?? path, { animated: false })
    const { data, info } = await (heic ? input : input.rotate())
      .resize(longest, longest, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      source,
      pixels: { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.length) },
    }
  } catch (e) {
    if (isForgeError(e)) throw e
    throw corruptSource(path, e)
  } finally {
    await decoded?.cleanup()
  }
}
```

Check `FORMATS` entries in `src/core/formats.ts`. If the human-readable field is not called `label`, use the field that exists (for example `name`). The detail must read like "report.pdf is a PDF, not an image."

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/engines/pixels.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engines/pixels.ts src/core/errors.ts tests/engines/pixels.test.ts
git commit -m "feat(colour): sample an image's pixels, upright, by content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Figma card

**Files:**
- Create: `src/core/colour/card.ts`
- Test: `tests/core/colour/card.test.ts`

**Interfaces:**
- Consumes: `Group` (Task 5), `Step` (Task 4), `hueName` (Task 3), `formatRgb` and `Rgb` (Task 2).
- Produces:
  - `interface CardItem { id: string; name: string; value: string; hex: string }`
  - `card(title: string, subtitle: string, items: CardItem[], theme?: 'light' | 'dark'): string`
  - `paletteCard(fileName: string, groups: Group[], theme?: 'light' | 'dark'): string`
  - `scaleCard(reference: Rgb, steps: Step[], theme?: 'light' | 'dark'): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { card, scaleCard } from '../../../src/core/colour/card.js'
import { scale } from '../../../src/core/colour/scale.js'

const ref = { r: 101, g: 121, b: 253 }

describe('card', () => {
  it('a square outer card, rounded swatches, one layer per item', () => {
    const svg = scaleCard(ref, scale(ref))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toMatch(/<rect id="card" width="\d+" height="\d+" rx="0" fill="#FFFFFF"\/>/)
    expect(svg.match(/<g id="blue-\d+"/g)).toHaveLength(11)
    expect(svg).toContain('<g id="blue-500"')
    expect(svg).toMatch(/<rect id="swatch" width="64" height="64" rx="10" fill="#6579FD"/)
    expect(svg).toContain('>Blue</text>')
    expect(svg).toContain('from #6579FD · 50–950 in OKLCH')
  })
  it('dark theme gives the dark card', () => {
    expect(scaleCard(ref, scale(ref), 'dark')).toContain('fill="#18181B"')
  })
  it('escapes text and keeps ids to [a-z0-9-]', () => {
    const svg = card('a <b> & "c"', 'x', [{ id: 'My File!.jpg-1', name: '<n>', value: 'v', hex: '#000000' }])
    expect(svg).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(svg).toContain('<g id="my-file-jpg-1"')
    expect(svg).not.toContain('<n>')
  })
  it('is deterministic', () => {
    expect(scaleCard(ref, scale(ref))).toBe(scaleCard(ref, scale(ref)))
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/core/colour/card.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement `src/core/colour/card.ts`**

```ts
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
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'colour'
const FONT = 'font-family="Inter"'

export function card(title: string, subtitle: string, items: CardItem[], theme: 'light' | 'dark' = 'light'): string {
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
    `<g id="${slug(title)}">\n<rect id="card" width="${w}" height="${h}" rx="0" fill="${dark ? '#18181B' : '#FFFFFF'}"/>\n` +
    `${head}\n${body}\n</g>\n</svg>`
  )
}

export function paletteCard(fileName: string, groups: Group[], theme: 'light' | 'dark' = 'light'): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  return card(
    fileName,
    `${groups.length} colours, most of the image first`,
    groups.map((g, i) => ({ id: `${base}-${i + 1}`, name: g.hex, value: formatRgb(g.rgb), hex: g.hex })),
    theme,
  )
}

export function scaleCard(reference: Rgb, steps: Step[], theme: 'light' | 'dark' = 'light'): string {
  const name = hueName(reference)
  return card(
    name[0]?.toUpperCase() + name.slice(1),
    `from ${toHex(reference)} · 50–950 in OKLCH`,
    steps.map((s) => ({ id: `${name}-${s.step}`, name: String(s.step), value: s.hex, hex: s.hex })),
    theme,
  )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/core/colour/card.test.ts`
Expected: PASS.

- [ ] **Step 5: Paste-check by hand (once).** Run `npx tsx -e "import('./src/core/colour/card.ts').then(m=>import('./src/core/colour/scale.ts').then(s=>process.stdout.write(m.scaleCard({r:101,g:121,b:253},s.scale({r:101,g:121,b:253})))))" | pbcopy` and paste into Figma. Expected: a square white card with eleven rounded swatches, step and hex under each, and layers named `blue-50` … `blue-950`. If you cannot reach Figma, say so in the task report; do not skip this silently.

- [ ] **Step 6: Commit**

```bash
git add src/core/colour/card.ts tests/core/colour/card.test.ts
git commit -m "feat(colour): the Figma card, as SVG text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `forge palette` and `forge scale`

**Files:**
- Modify: `src/cli/args.ts` (intents, claiming, `COMMANDS_HELP`)
- Create: `src/cli/colour.ts` (runs both and renders text)
- Modify: `src/cli/execute.ts` (dispatch; `ExecuteOptions.colour`)
- Modify: `src/core/report-data.ts` (`PaletteJson`, `ScaleJson` and builders)
- Modify: `src/index.ts` (pass `colour`)
- Test: `tests/cli/colour.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces:
  - `PaletteIntent { kind: 'palette'; input: string; inside?: Rgb; svg: boolean }` and `ScaleIntent { kind: 'scale'; colour: Rgb; svg: boolean }`, both in `Intent`
  - `type ColourJson = { hex: string; rgb: string; oklch: string; share: number }`
  - `type PaletteJson = { forge: string; ok: boolean; palette: { source: string; inside?: string; colours: ColourJson[] }; failures: FailureJson[] }`
  - `type StepJson = { step: number; hex: string; oklch: string; white: number; black: number }`
  - `type ScaleJson = { forge: string; ok: boolean; scale: { reference: string; steps: StepJson[] }; failures: FailureJson[] }`
  - `paletteJson(...)` and `scaleJson(...)` builders
  - `runPalette(intent, opts)` and `runScale(intent, opts)` in `src/cli/colour.ts`, each returning `ExecuteResult`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeJpeg, makePdf, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

const run = (argv: string[], colour = false) =>
  execute(parseArgs(argv), { json: argv.includes('--json'), colour })

describe('forge scale', () => {
  it('prints eleven rows, plain when colour is off', async () => {
    const out = await run(['scale', '6579FD'])
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toHaveLength(11)
    expect(out.stdout[5]).toBe(' 500  #6579FD  white 3.7 large · black 5.7 AA')
    expect(out.stdout.join('\n')).not.toContain('\x1b[')
  })
  it('draws swatches in true colour when colour is on', async () => {
    const out = await run(['scale', '#6579FD'], true)
    expect(out.stdout[5]).toContain('\x1b[38;2;101;121;253m██\x1b[39m')
  })
  it('--json is the scale document', async () => {
    const doc = JSON.parse((await run(['scale', '#6579fd', '--json'])).stdout[0] ?? '')
    expect(doc.ok).toBe(true)
    expect(doc.scale.reference).toBe('#6579FD')
    expect(doc.scale.steps[5]).toEqual({ step: 500, hex: '#6579FD', oklch: 'oklch(63% 0.196 273)', white: 3.7, black: 5.7 })
  })
  it('--svg prints the card', async () => {
    const out = await run(['scale', '6579FD', '--svg'])
    expect(out.stdout[0]?.startsWith('<svg')).toBe(true)
  })
  it('a missing or bad colour is invalid arguments (exit 2), with a hint about quoting', () => {
    // Unquoted `forge scale #6579FD` in bash arrives as `forge scale`.
    expect(() => parseArgs(['scale'])).toThrow(expect.objectContaining({ code: 'invalid-arguments', hint: expect.stringMatching(/quote/) }))
    for (const bad of ['blue', '#GGGGGG', '#12345']) {
      expect(() => parseArgs(['scale', bad]), bad).toThrow(expect.objectContaining({ code: 'invalid-arguments', detail: `${bad} is not a colour.` }))
    }
  })
})

describe('forge palette', () => {
  it('prints one row per colour with whole percentages adding to 100', async () => {
    const dir = await makeTempDir()
    const out = await run(['palette', await makeJpeg(dir, 'a.jpg')])
    expect(out.exitCode).toBe(0)
    const pcts = out.stdout.map((l) => Number(/(\d+)%$/.exec(l)?.[1]))
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    for (const l of out.stdout) expect(l).toMatch(/^#[0-9A-F]{6} {2}\s*\d+%$/)
  })
  it('--json validates and --inside lists one colour\'s shades', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const doc = JSON.parse((await run(['palette', jpg, '--json'])).stdout[0] ?? '')
    expect(doc.palette.colours.length).toBeGreaterThan(0)
    const first = doc.palette.colours[0].hex
    const inner = JSON.parse((await run(['palette', jpg, '--inside', first, '--json'])).stdout[0] ?? '')
    expect(inner.palette.inside).toBe(first)
  })
  it('a PDF is refused as not an image, exit 1', async () => {
    const dir = await makeTempDir()
    const out = await run(['palette', await makePdf(dir, 'x.png')])
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('not an image')
  })
  it('a fully transparent image has nothing to take colours from, exit 1', async () => {
    const dir = await makeTempDir()
    // makeTransparentPng is 32 × 32, alpha 0 everywhere.
    const out = await run(['palette', await makeTransparentPng(dir, 't.png')])
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('no visible pixels')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/cli/colour.test.ts`
Expected: FAIL. `palette` and `scale` are parsed as input files.

- [ ] **Step 3: Parse the two subcommands** in `src/cli/args.ts`. Add the intents and include them in `Intent`:

```ts
/** `forge palette <image>`: an image's main colours (colour spec §7.1). */
export interface PaletteIntent {
  kind: 'palette'
  input: string
  /** `--inside <hex>`: the shades of the palette colour nearest this one. */
  inside?: Rgb
  svg: boolean
}

/** `forge scale <colour>`: 50–950 with the colour at 500. */
export interface ScaleIntent {
  kind: 'scale'
  colour: Rgb
  svg: boolean
}
```

```ts
function colourArg(raw: string | undefined): Rgb {
  if (raw === undefined) {
    throw invalidArguments(
      'No colour given.',
      "Try: forge scale 6579FD — or quote it, '#6579FD', because an unquoted # starts a comment in the shell.",
    )
  }
  const rgb = parseHex(raw)
  if (!rgb) throw invalidArguments(`${raw} is not a colour.`, 'Try a hex code, for example 6579FD or #6579FD.')
  return rgb
}

/** Claimed before Commander, like `probe`: Commander would read the word as a filename. */
function parseColourArgs(argv: string[]): PaletteIntent | ScaleIntent {
  const [cmd, ...rest0] = argv
  const rest = rest0.filter((a) => a !== '--json')
  const svg = rest.includes('--svg')
  const args = rest.filter((a) => a !== '--svg')
  const at = args.indexOf('--inside')
  const insideRaw = at === -1 ? undefined : args[at + 1]
  if (at !== -1) args.splice(at, 2)
  const flag = args.find((a) => a.startsWith('-') && !/^#?[0-9a-f]{3,6}$/i.test(a))
  if (flag !== undefined) throw invalidArguments(`forge ${cmd} does not take ${flag}.`, `Try: forge ${cmd} --help`)
  if (cmd === 'scale') {
    if (args.length > 1) throw invalidArguments('forge scale takes one colour.', 'Try: forge scale 6579FD')
    return { kind: 'scale', colour: colourArg(args[0]), svg }
  }
  if (args.length !== 1) {
    throw invalidArguments(args.length === 0 ? 'No image given.' : 'forge palette takes one image.', 'Try: forge palette photo.jpg')
  }
  return {
    kind: 'palette',
    input: args[0] as string,
    svg,
    ...(at === -1 ? {} : { inside: colourArg(insideRaw) }),
  }
}
```

In `parseArgs`, next to `probe`:

```ts
  if (argv[0] === 'palette' || argv[0] === 'scale') return parseColourArgs(argv)
```

Import `parseHex` and `type Rgb` from `../core/colour/space.js`. `space.ts` is pure and import-light, so the lazy-load rule (parse first, import second) holds. Add to `COMMANDS_HELP`:

```
  forge palette <image>    an image's main colours (--json, --svg, --inside <hex>)
  forge scale <colour>     50–950 from one colour, with it at 500 (--json, --svg)
```

- [ ] **Step 4: Add the JSON documents** to `src/core/report-data.ts`:

```ts
export type ColourJson = { hex: string; rgb: string; oklch: string; share: number }
export type PaletteJson = {
  forge: string
  ok: boolean
  palette: { source: string; inside?: string; colours: ColourJson[] }
  failures: FailureJson[]
}
export type StepJson = { step: number; hex: string; oklch: string; white: number; black: number }
export type ScaleJson = {
  forge: string
  ok: boolean
  scale: { reference: string; steps: StepJson[] }
  failures: FailureJson[]
}

export function paletteJson(forge: string, palette: PaletteJson['palette']): PaletteJson {
  return { forge, ok: true, palette, failures: [] }
}

export function scaleJson(forge: string, scale: ScaleJson['scale']): ScaleJson {
  return { forge, ok: true, scale, failures: [] }
}
```

- [ ] **Step 5: Implement `src/cli/colour.ts`**

```ts
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

interface Opts {
  json: boolean
  /** True colour on stdout: draw swatches. Off for pipes and NO_COLOR. */
  colour: boolean
}

const swatch = ({ r, g, b }: Rgb, colour: boolean): string =>
  colour ? `\x1b[38;2;${r};${g};${b}m██\x1b[39m  ` : ''

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
  if (intent.svg) return { exitCode: 0, stdout: [paletteCard(basename(intent.input), groups)], stderr: [] }
  const pcts = wholePercents(groups.map((g) => g.share))
  if (opts.json) {
    const doc = paletteJson(VERSION, {
      source: resolve(intent.input),
      ...(parent ? { inside: parent.hex } : {}),
      colours: groups.map((g) => ({ hex: g.hex, rgb: formatRgb(g.rgb), oklch: formatOklch(g.rgb), share: g.share })),
    })
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  return {
    exitCode: 0,
    stdout: groups.map((g, i) => `${swatch(g.rgb, opts.colour)}${g.hex}  ${String(pcts[i]).padStart(3)}%`),
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
      steps: rows.map((s) => ({ step: s.step, hex: s.hex, oklch: formatOklch(s.rgb), white: s.white, black: s.black })),
    })
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  return {
    exitCode: 0,
    stdout: rows.map(
      (s) =>
        `${String(s.step).padStart(4)}  ${swatch(s.rgb, opts.colour)}${s.hex}  white ${s.white} ${rate(s.white)} · black ${s.black} ${rate(s.black)}`,
    ),
    stderr: [],
  }
}
```

With colour off, the palette row is `#356723   19%`. The test's regex `/^#[0-9A-F]{6} {2}\s*\d+%$/` allows the padding. The scale row is `' 500  #6579FD  white 3.7 large · black 5.7 AA'`, which matches the test.

- [ ] **Step 6: Dispatch** in `src/cli/execute.ts`. Add `colour?: boolean` to `ExecuteOptions` (document it: "true colour swatches on stdout; set by index.ts for a TTY without NO_COLOR"). In `execute`, before the `shell` line:

```ts
    if (intent.kind === 'palette' || intent.kind === 'scale') {
      // Lazy: colour pulls in sharp only through samplePixels, and only here.
      const { runPalette, runScale } = await import('./colour.js')
      const o = { json, colour: opts.colour ?? false }
      return intent.kind === 'palette' ? await runPalette(intent, o) : await runScale(intent, o)
    }
```

A `ForgeError` thrown inside (not an image, nothing visible, corrupt) falls through to the existing `catch` → `renderCommandFailure`, which gives exit 1. Invalid arguments were already thrown by `parseArgs` and get exit 2.

`runIntent` and any exhaustive `switch` on `intent.kind` must still typecheck. If `runIntent`'s parameter type is `Intent`, narrow it to the kinds it handles, or add the two kinds to the early returns as above.

- [ ] **Step 7: Pass `colour` from `src/index.ts`.** In the `execute(intent, { json, … })` call, add:

```ts
      colour: Boolean(process.stdout.isTTY) && !json && (process.env.NO_COLOR ?? '') === '',
```

- [ ] **Step 8: Run the tests, the lazy-load test and typecheck**

Run: `npx vitest run tests/cli/colour.test.ts tests/cli/lazy-load.test.ts tests/cli/args.test.ts && npm run typecheck`
Expected: PASS. If the lazy-load test lists the modules `--version` may load, `core/colour/space.js` may need adding to its allowed set. It is pure and tiny, and it is needed at parse time to refuse a bad colour with exit 2.

- [ ] **Step 9: Commit**

```bash
git add src/cli/args.ts src/cli/colour.ts src/cli/execute.ts src/core/report-data.ts src/index.ts tests/cli/colour.test.ts
git commit -m "feat(colour): forge palette and forge scale, with --json, --svg and --inside

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: MCP tools `forge_palette` and `forge_scale`

**Files:**
- Modify: `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`
- Test: `tests/mcp/schemas.test.ts` (extend), `tests/mcp/server.test.ts` (extend)

**Interfaces:**
- Consumes: `runPalette`, `runScale` (Task 8). The tools build the same documents by calling those functions with `{ json: true, colour: false }` and parsing `stdout[0]`, so the CLI and MCP cannot drift. Also `parseHex` (Task 2).
- Produces:
  - `PaletteInput`, `ScaleInput`, `PaletteOutput`, `ScaleOutput` (zod)
  - `paletteTool(args)` and `scaleTool(args)`, each returning `Promise<CallToolResult>`
  - the tools `forge_palette` and `forge_scale`, annotated `READS`

- [ ] **Step 1: Write the failing tests.** Add to `tests/mcp/schemas.test.ts` under "output schemas match what the CLI prints":

```ts
  it('a palette document parses as PaletteOutput', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(PaletteOutput.safeParse(await jsonOf(['palette', jpg])).success).toBe(true)
  })

  it('a scale document parses as ScaleOutput', async () => {
    expect(ScaleOutput.safeParse(await jsonOf(['scale', '6579FD'])).success).toBe(true)
  })
```

(Import `PaletteOutput` and `ScaleOutput` from `../../src/mcp/schemas.js`. `jsonOf` already appends `--json`.)

Open `tests/mcp/server.test.ts` and find the test that lists the tools (it expects five names). Change the expectation to seven names, adding `forge_palette` and `forge_scale`. Add one call test written the way that file calls `forge_probe`:

```ts
  it('forge_scale returns the scale document', async () => {
    const result = await callTool('forge_scale', { colour: '#6579FD' })
    expect(result.isError).toBeFalsy()
    expect((result.structuredContent as { scale: { reference: string } }).scale.reference).toBe('#6579FD')
  })
```

`callTool` stands for whatever helper `server.test.ts` already uses to call a tool. Use that helper's real name and shape.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/mcp`
Expected: FAIL. The schema exports are missing and the tool count is 5.

- [ ] **Step 3: Schemas** in `src/mcp/schemas.ts`:

```ts
const Hex = z.string().describe('A hex colour: #RRGGBB, #RGB, or without the #')

export const PaletteInput = z.object({
  path: z.string().describe('An image file: a photo, a screenshot or artwork'),
  inside: Hex.optional().describe('Show the shades of the palette colour nearest this one'),
})
export const ScaleInput = z.object({ colour: Hex })

const FailureList = z.array(FailureOut)

export const PaletteOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  palette: z.strictObject({
    source: z.string(),
    inside: z.string().optional(),
    colours: z.array(z.strictObject({ hex: z.string(), rgb: z.string(), oklch: z.string(), share: z.number() })),
  }),
  failures: FailureList,
})
export const ScaleOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  scale: z.strictObject({
    reference: z.string(),
    steps: z.array(z.strictObject({ step: z.number(), hex: z.string(), oklch: z.string(), white: z.number(), black: z.number() })),
  }),
  failures: FailureList,
})
export type PaletteArgs = z.infer<typeof PaletteInput>
export type ScaleArgs = z.infer<typeof ScaleInput>
```

`FailureOut` is the failure schema `RunOutput` already uses in this file. Use its real name if it differs.

A refusal (not an image) comes back as `errorJson`, which is the `RunOutput` shape, not `PaletteOutput`. Return refusals with `isError: true` and no `structuredContent` (text only). That way the declared output schema is never violated. Check how `server.test.ts` treats `isError` results, and match it.

- [ ] **Step 4: Handlers** in `src/mcp/tools.ts`:

```ts
export async function paletteTool(args: PaletteArgs): Promise<CallToolResult> {
  const inside = args.inside === undefined ? undefined : parseHex(args.inside)
  if (args.inside !== undefined && !inside) return textError(`${args.inside} is not a colour. Try #RRGGBB.`)
  try {
    const { runPalette } = await import('../cli/colour.js')
    const out = await runPalette(
      { kind: 'palette', input: args.path, svg: false, ...(inside ? { inside } : {}) },
      { json: true, colour: false },
    )
    const doc = JSON.parse(out.stdout[0] ?? '{}') as PaletteJson
    const text = doc.palette.colours.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join('\n')
    return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
  } catch (e) {
    if (isForgeError(e)) return textError(`${e.title}: ${e.detail}`)
    throw e
  }
}

export async function scaleTool(args: ScaleArgs): Promise<CallToolResult> {
  const colour = parseHex(args.colour)
  if (!colour) return textError(`${args.colour} is not a colour. Try #RRGGBB.`)
  const { runScale } = await import('../cli/colour.js')
  const out = await runScale({ kind: 'scale', colour, svg: false }, { json: true, colour: false })
  const doc = JSON.parse(out.stdout[0] ?? '{}') as ScaleJson
  const text = doc.scale.steps.map((s) => `${s.step} ${s.hex} white ${s.white} black ${s.black}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
}

function textError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
```

Imports: `parseHex` from `../core/colour/space.js`; `isForgeError` (add to the existing errors import); `type PaletteJson`, `type ScaleJson` from `../core/report-data.js`; `type PaletteArgs`, `type ScaleArgs` from `./schemas.js`.

- [ ] **Step 5: Register them** in `src/mcp/server.ts`, after `forge_pdf`:

```ts
  server.registerTool(
    'forge_palette',
    {
      title: 'Colours of an image',
      description:
        "An image's main colours, most of the image first, each as hex, rgb and OKLCH with its share. With inside, the shades that one colour is made of. Writes nothing.",
      inputSchema: PaletteInput,
      outputSchema: PaletteOutput,
      annotations: READS,
    },
    (args) => paletteTool(args),
  )

  server.registerTool(
    'forge_scale',
    {
      title: 'Tonal scale',
      description:
        'A 50–950 tonal scale built in OKLCH with the given colour at 500, each step with its contrast against white and black text. Writes nothing.',
      inputSchema: ScaleInput,
      outputSchema: ScaleOutput,
      annotations: READS,
    },
    (args) => scaleTool(args),
  )
```

Update the doc comment above `createForgeServer`, which says "with five tools on purpose", to say seven, and to say why these two belong: they are read-only, small, and the colour equivalent of `forge_probe`.

- [ ] **Step 6: Run MCP and the full suite**

Run: `npx vitest run tests/mcp && npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp tests/mcp
git commit -m "feat(colour): forge_palette and forge_scale MCP tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After plan 1

Plan 1 is done. A fresh whole-branch review found one critical issue and two important ones, all fixed with tests:
- contrast was rated on a rounded ratio
- `--help` was refused
- `forge_palette` accepted a relative path

The review's minor findings were deferred and are listed here so plan 2 can pick them up:

- **Very dark references.** A reference with L < 0.16 holds steps 600–950 at its own lightness, but the spec says lightness falls strictly. Use `floor = 0.42·L₀` below 0.16, and add `#0A0A2A` and `#00000A` to the scale sweep.
- **Hue drift on near-black steps.** Hue drifts up to 4.8° on near-black saturated steps (8-bit quantisation). Note the exception, or loosen the hue tolerance with lightness.
- **Weak engine tests.** Pin the GIF's first frame (`#282828`, 8×8) and the rotation direction (a two-colour oriented fixture).
- **MCP percentages.** `forge_palette` text uses `Math.round`, so its percentages can add up to 99 or 101. Use `wholePercents`.
- **MCP hints.** Colour refusals over MCP drop `ForgeError.hint`. Append it.
- **`--inside` on `forge scale`.** It is silently ignored. Refuse it.
- **Card subtitle.** It says "1 colours". With `--inside --svg`, it captions the shades as if they were the image's colours.
- **Grey `oklch()`.** An achromatic colour prints a noise hue, e.g. `oklch(57% 0.000 90)`. Print 0 when C < 0.0005.
- **CLI swatches.** They ignore `FORGE_TRUECOLOR=0` and 256-colour terminals. Use the shell's `trueColour()` once plan 2 adds it.

Plan 2 covers the shell (spec §6): the fourth mode, `modeGradient` stops, C1, the field, Palette (D2/D1/inside), Scale (S9/`r`/`#`), the trail and history, `trueColour` fallbacks and the mockup-cell fixtures. Write it once the W5/G1 work has landed on `dev` and this branch is rebased onto it, because it edits the same parts of `App.tsx`, `theme.ts` and `trail.ts`.
