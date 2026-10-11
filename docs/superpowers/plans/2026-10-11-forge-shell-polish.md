# Shell Polish, Round 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five approved visual decisions: mode-owned colour, keycap hints, the receipt card, the header bar, and the logo clear-and-replay.

**Architecture:** All changes live in `src/shell/`. Colour is a palette transform (`modePalette`) applied through the existing `ThemeProvider`, so every component picks it up without edits. The receipt card and header bar are new components. The logo switch is a pure function (`bannerTransition`) in `redraw.ts`, wired into `App` the same way the resize redraw already is.

**Tech Stack:** TypeScript, React 19 + Ink 7, vitest + ink-testing-library, Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-forge-shell-polish-design.md`

## Global Constraints

- `core/` and `engines/` are not touched (CLAUDE.md invariant 1).
- No component names a colour directly; every colour comes from `Palette` (`theme.ts` header comment).
- Symbols are always paired with words; nothing may rely on colour alone (`NO_COLOR` must still read).
- Run single suites with `npx vitest run <file>`; the whole gate is `npm test && npm run typecheck && npm run lint`.
- Work on `dev`. One commit per task, message style `feat(shell): …` / `test(shell): …`, ending with the `Co-Authored-By` trailer.
- Colour assertions need `FORCE_COLOR=3` set in `vi.hoisted`, and live in their own test file (see `tests/shell/result-colour.test.tsx` for why).

## Review Focus

1. Two very long filenames in the receipt card: both must be middle-ellipsed and every line must still be exactly the card width. Pinned in Task 4.
2. A zero-byte source or output (`bytes: 0`): the bar maths must not divide by zero or draw `NaN` cells. Pinned in Task 4.
3. A terminal exactly 60 columns wide, the boundary of the compact band: the receipt card must fit with no line wider than 60. Pinned in Task 4.
4. Returning to idle when history already holds a banner (first run pushes one): there must never be two banners. Pinned in Task 6.
5. A long warning sentence in the receipt: it must wrap inside the card, not overflow or get cut off. Pinned in Task 4.

---

### Task 1: Palette tokens and `modePalette`

**Files:**
- Modify: `src/shell/theme.ts`
- Modify: `src/shell/components/ModeHeader.tsx` (move `ShellMode` out)
- Modify: `src/shell/components/Banner.tsx`, `src/shell/intro.ts` (`accent` → `brand`)
- Test: `tests/shell/mode-palette.test.ts` (new), `tests/shell/banner-brand-colour.test.tsx` (new)

**Interfaces:**
- Produces:
  - `type ShellMode = 'convert' | 'compress' | 'pdf'` exported from `theme.ts`, and re-exported from `ModeHeader.tsx` so existing imports keep working.
  - `Palette.brand: string` and `Palette.keycapBg: string`.
  - `MODE_MARKERS: Record<ShellMode, string>` = `{ convert: '↔', compress: '↓', pdf: '▣' }`.
  - `modeColours(p: Palette, mode: ShellMode): { fg: string; bg: string }`.
  - `modePalette(p: Palette, mode: ShellMode): Palette`.

- [ ] **Step 1: Write the failing test** — `tests/shell/mode-palette.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, MODE_MARKERS, NEUTRAL, modeColours, modePalette } from '../../src/shell/theme.js'

describe('modePalette', () => {
  it('gives the role colours to the mode', () => {
    for (const base of [DARK, LIGHT, NEUTRAL]) {
      const c = modePalette(base, 'compress')
      expect(c.accent).toBe(base.modeCompress)
      expect(c.tag).toBe(base.modeCompress)
      expect(c.label).toBe(base.modeCompress)
      expect(modePalette(base, 'convert').accent).toBe(base.modeConvert)
      expect(modePalette(base, 'pdf').accent).toBe(base.modePdf)
    }
  })

  it('never moves the outcome colours or the brand', () => {
    const c = modePalette(DARK, 'pdf')
    expect(c.ok).toBe(DARK.ok)
    expect(c.fail).toBe(DARK.fail)
    expect(c.warn).toBe(DARK.warn)
    expect(c.larger).toBe(DARK.larger)
    expect(c.brand).toBe(DARK.brand)
  })

  it('keeps NEUTRAL on ANSI names so first run reads on any background', () => {
    expect(modePalette(NEUTRAL, 'convert').accent).toBe('cyan')
  })

  it('pairs each mode with its fill and marker', () => {
    expect(modeColours(DARK, 'convert')).toEqual({ fg: DARK.modeConvert, bg: DARK.modeConvertBg })
    expect(modeColours(DARK, 'pdf')).toEqual({ fg: DARK.modePdf, bg: DARK.modePdfBg })
    expect(MODE_MARKERS).toEqual({ convert: '↔', compress: '↓', pdf: '▣' })
  })

  it('defines brand and keycapBg on every real palette', () => {
    for (const p of [DARK, LIGHT]) {
      expect(p.brand).toMatch(/^#[0-9a-f]{6}$/)
      expect(p.keycapBg).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(NEUTRAL.keycapBg).toBe('')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/shell/mode-palette.test.ts`
Expected: FAIL — `modePalette` is not exported.

- [ ] **Step 3: Implement in `theme.ts`**

Add to the `Palette` interface (with doc comments in the file's style):

```ts
  /**
   * The product's own colour — the anvil's edge and the wordmark's outline.
   * Deliberately not `accent`: `accent` now follows the mode (see
   * `modePalette`), and the logo is the one thing that must not.
   */
  brand: string
  /**
   * Fill behind a key in the hint row. Empty means "no fill available" —
   * `Hints` then brackets the key instead, so it still reads as a key.
   */
  keycapBg: string
```

Values: DARK `brand: '#e5a23c'`, `keycapBg: '#2e3340'` (comment: `fg` #e4e8f0 on it measures ≈ 11:1). LIGHT `brand: '#9a6005'`, `keycapBg: '#e4e1da'` (comment: `fg` #23262d on it measures ≈ 12:1). NEUTRAL `brand: 'yellow'`, `keycapBg: ''`.

Below the palettes:

```ts
export type ShellMode = 'convert' | 'compress' | 'pdf'

/** Paired with the mode's name wherever it is drawn, so it survives NO_COLOR. */
export const MODE_MARKERS: Record<ShellMode, string> = { convert: '↔', compress: '↓', pdf: '▣' }

export function modeColours(p: Palette, mode: ShellMode): { fg: string; bg: string } {
  if (mode === 'compress') return { fg: p.modeCompress, bg: p.modeCompressBg }
  if (mode === 'pdf') return { fg: p.modePdf, bg: p.modePdfBg }
  return { fg: p.modeConvert, bg: p.modeConvertBg }
}

/**
 * The palette a screen is drawn in while the shell is in `mode`: the three
 * role colours — accent, tag, label — become the mode's own, so one screen
 * tells one colour story. Outcome colours and the brand never move.
 */
export function modePalette(p: Palette, mode: ShellMode): Palette {
  const { fg } = modeColours(p, mode)
  return { ...p, accent: fg, tag: fg, label: fg }
}
```

In `ModeHeader.tsx`, delete the local `ShellMode` type and add `export type { ShellMode } from '../theme.js'` (import it for local use too).

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/shell/mode-palette.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing brand test** — `tests/shell/banner-brand-colour.test.tsx`

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Banner } from '../../src/shell/components/Banner.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('the logo keeps the brand colour in every mode', () => {
  it('draws the wordmark edge in brand, not the mode colour', () => {
    const frame =
      render(
        <ThemeProvider palette={modePalette(DARK, 'compress')}>
          <Banner width={100} version="0.1.0" defaultOutput="~/Desktop" />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    expect(frame).toContain(rgb(DARK.brand))
    expect(frame).not.toContain(rgb(DARK.modeCompress))
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**, then in `Banner.tsx` replace both `palette.accent` uses with `palette.brand`, and in `intro.ts` replace `palette.accent` with `palette.brand`. Re-run: PASS.

- [ ] **Step 7: Run the related suites**

Run: `npx vitest run tests/shell/palette.test.ts tests/shell/banner.test.tsx tests/shell/mode-header.test.tsx`
Expected: PASS. If `palette.test.ts` has a key list, add `'brand'` and `'keycapBg'` to it.

- [ ] **Step 8: Commit**

```bash
git add src/shell/theme.ts src/shell/components/ModeHeader.tsx src/shell/components/Banner.tsx src/shell/intro.ts tests/shell/mode-palette.test.ts tests/shell/banner-brand-colour.test.tsx tests/shell/palette.test.ts
git commit -m "feat(shell): a palette per mode, with the logo kept on the brand colour"
```

---

### Task 2: Wire `modePalette` into `App`

**Files:**
- Modify: `src/shell/App.tsx` (palette derivation near line 420, `modeBg`/`modeColour` near line 442, the provider at line ~2084)
- Test: `tests/shell/mode-colour-app.test.tsx` (new)

**Interfaces:**
- Consumes: `modePalette`, `modeColours` from Task 1.

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { DARK } from '../../src/shell/theme.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('the screen is drawn in the mode colour', () => {
  it('draws the picker cursor in convert cyan, not the old amber', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const app = render(<App initialWidth={80} prefs={prefs} />)
    app.stdin.write(jpg)
    await settle(150)
    app.stdin.write(ENTER)
    await settle()
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('❯')
    expect(frame).toContain(rgb(DARK.modeConvert))
    expect(frame).not.toContain(rgb(DARK.accent))
  })
})
```

- [ ] **Step 2: Run it and confirm it fails** (`npx vitest run tests/shell/mode-colour-app.test.tsx`; amber is still present).

- [ ] **Step 3: Implement**

In `App.tsx`:
- Rename the current `const palette = paletteFor(theme)` to `const basePalette = paletteFor(theme)`.
- After `mode` is declared, add `const palette = modePalette(basePalette, mode)`. Every existing `palette.` use in `App` then resolves through it.
- Replace the two `modeBg` / `modeColour` ternaries with `const { fg: modeColour, bg: modeBg } = modeColours(basePalette, mode)`.
- Change the root `<ThemeProvider palette={paletteFor(theme)}>` to `<ThemeProvider palette={palette}>`.
- Update the long comment above `palette` to say it is the mode palette, and why the base is kept separately (the banner uses `brand`, and `modeColours` needs the unmodified fills).

- [ ] **Step 4: Run it and confirm it passes**, then run `npx vitest run tests/shell/` and fix any colour assertions that pinned amber (`DARK.accent`) on the cursor or keys so they pin the mode colour instead. Do not delete them.

- [ ] **Step 5: Commit**

```bash
git add src/shell/App.tsx tests/shell/mode-colour-app.test.tsx tests/shell
git commit -m "feat(shell): each mode owns the screen's colour"
```

---

### Task 3: Keycap hints

**Files:**
- Modify: `src/shell/components/Hints.tsx`, `src/shell/components/HintBar.tsx`
- Modify: `src/shell/App.tsx` (the result step's hand-built bordered box, near line 2560)
- Test: `tests/shell/hints-keycaps.test.tsx` (new), `tests/shell/hints-keycaps-colour.test.tsx` (new)

**Interfaces:**
- Produces: `Hints({ pairs, compact }: { pairs: Array<[string, string]>; compact?: boolean })`. `HintBar` keeps its signature and passes `compact={bandFor(width) === 'compact'}`.

- [ ] **Step 1: Write the failing layout test** — `tests/shell/hints-keycaps.test.tsx`

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { HintBar } from '../../src/shell/components/HintBar.js'
import { Hints } from '../../src/shell/components/Hints.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, NEUTRAL } from '../../src/shell/theme.js'

const pairs: Array<[string, string]> = [['↵', 'confirm'], ['esc', 'back']]
const frame = (node: JSX.Element, palette = DARK) =>
  render(<ThemeProvider palette={palette}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('keycap hints', () => {
  it('pads each key into a cap and drops the │ dividers', () => {
    const f = frame(<Hints pairs={pairs} />)
    expect(f).toContain(' ↵  confirm')
    expect(f).toContain(' esc  back')
    expect(f).not.toContain('│')
  })

  it('separates pairs by five spaces, or three when compact', () => {
    expect(frame(<Hints pairs={pairs} />)).toContain('confirm      esc')
    expect(frame(<Hints pairs={pairs} compact />)).toContain('confirm    esc')
  })

  it('brackets keys when there is no fill to draw them on', () => {
    const f = frame(<Hints pairs={pairs} />, NEUTRAL)
    expect(f).toContain('[↵] confirm')
    expect(f).toContain('[esc] back')
  })

  it('draws no rule above the hint bar', () => {
    const f = frame(<HintBar width={60} pairs={pairs} />)
    expect(f).not.toContain('─')
    expect(f).toContain('confirm')
  })
})
```

The gaps above are measured between the end of a label and the start of the next cap: `confirm` + 5 spaces + ` esc ` gives `confirm      esc` (six spaces, because the cap's own leading space follows the five). Compact gives `confirm    esc` (four).

- [ ] **Step 2: Write the failing colour test** — `tests/shell/hints-keycaps-colour.test.tsx`, with the `FORCE_COLOR` hoist and the `rgb` helper from Task 1:

```tsx
it('fills the cap with keycapBg and never uses the accent', () => {
  const f = render(<ThemeProvider palette={DARK}><Hints pairs={[['↵', 'go']]} /></ThemeProvider>).lastFrame() ?? ''
  expect(f).toContain(`48;2;${rgb(DARK.keycapBg)}`)
  expect(f).not.toContain(`38;2;${rgb(DARK.accent)}`)
})
```

- [ ] **Step 3: Run both and confirm they fail.**

- [ ] **Step 4: Implement `Hints`**

```tsx
export function Hints({ pairs, compact = false }: { pairs: Array<[string, string]>; compact?: boolean }) {
  const palette = useTheme()
  const gap = ' '.repeat(compact ? 3 : 5)
  const capped = palette.keycapBg !== ''
  return (
    <Text>
      {pairs.map(([key, what], i) => (
        <Text key={key}>
          {i > 0 ? <Text>{gap}</Text> : null}
          {capped ? (
            <Text backgroundColor={palette.keycapBg} color={colourProp(palette.fg)} bold>
              {` ${key} `}
            </Text>
          ) : (
            <Text bold>{`[${key}]`}</Text>
          )}
          <Text color={colourProp(palette.dim)}>{` ${what}`}</Text>
        </Text>
      ))}
    </Text>
  )
}
```

Rewrite the doc comment: the cap's shape now carries "this is a key"; amber is no longer used because `accent` follows the mode, and keys are not mode-specific. Under `NO_COLOR`, brackets carry the same meaning.

- [ ] **Step 5: Implement `HintBar`**

```tsx
export function HintBar({ pairs, width }: { pairs: Array<[string, string]>; width: number }) {
  return (
    <Box width={width} marginTop={1}>
      <Hints pairs={pairs} compact={bandFor(width) === 'compact'} />
    </Box>
  )
}
```

Update its comment: one blank row now separates hints from content; the caps separate themselves.

- [ ] **Step 6: Update the result step in `App.tsx`.** The hand-built `<Box … borderStyle="single" … borderBottom={false}…>` that wraps `<Hints>` and the mode line becomes `<Box flexDirection="column" width={width} marginTop={1}>`, passing `compact={band === 'compact'}` to `Hints`. Fix the comment above it to match.

- [ ] **Step 7: Run the new tests (PASS), then `npx vitest run tests/shell/`.** Update assertions that matched `  │  ` separators or a `────` rule above hints so they match the keycap form. Do not delete them.

- [ ] **Step 8: Commit**

```bash
git add src/shell/components/Hints.tsx src/shell/components/HintBar.tsx src/shell/App.tsx tests/shell
git commit -m "feat(shell): key hints as keycaps"
```

---

### Task 4: Receipt card

**Files:**
- Create: `src/shell/components/ReceiptCard.tsx`
- Modify: `src/shell/blocks.tsx` (the `result` branch: replace the paired and stacked layouts; keep the compact single-line form)
- Test: `tests/shell/receipt-card.test.tsx` (new), `tests/shell/receipt-card-colour.test.tsx` (new)

**Interfaces:**
- Produces:
  - `receiptBars(before: number, after: number, cells: number): { before: number; after: number; grew: boolean }`
  - `wrapWords(text: string, width: number): string[]`
  - `ReceiptCard({ result, width }: { result: Result; width: number })`, which requires `result.job.op === 'convert'`.
  - `RECEIPT_MAX = 68`

- [ ] **Step 1: Write the failing test** — `tests/shell/receipt-card.test.tsx`

```tsx
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import { RECEIPT_MAX, ReceiptCard, receiptBars, wrapWords } from '../../src/shell/components/ReceiptCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const src = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  kind: 'image', path: '/Users/me/Desktop/test.png', format: 'png',
  width: 2756, height: 774, bytes: 122_449, hasAlpha: true, frames: 1, ...over,
})
const result = (over: { source?: Partial<SourceInfo>; out?: string; bytes?: number; warnings?: string[] } = {}): Result => ({
  job: {
    op: 'convert', sources: [src(over.source)], outputs: [over.out ?? '/Users/me/Desktop/test.jpg'],
    target: 'jpeg', options: { background: '#ffffff', keepMetadata: false },
  },
  outputBytes: over.bytes ?? 76_390,
  warnings: (over.warnings ?? []).map((message) => ({ message })),
}) as Result
const frame = (r: Result, width: number) =>
  render(<ThemeProvider palette={DARK}><ReceiptCard result={r} width={width} /></ThemeProvider>).lastFrame() ?? ''

describe('receiptBars', () => {
  it('gives the larger side every cell and scales the other', () => {
    expect(receiptBars(122_449, 76_390, 24)).toEqual({ before: 24, after: 15, grew: false })
    expect(receiptBars(100, 400, 24)).toEqual({ before: 6, after: 24, grew: true })
    expect(receiptBars(500, 500, 24)).toEqual({ before: 24, after: 24, grew: false })
  })
  it('never draws an empty bar for a non-zero size', () => {
    expect(receiptBars(10_000_000, 1, 24).after).toBe(1)
  })
  it('survives zero bytes on either side', () => {
    expect(receiptBars(0, 0, 24)).toEqual({ before: 24, after: 24, grew: false })
    expect(receiptBars(100, 0, 24)).toEqual({ before: 24, after: 0, grew: false })
  })
})

describe('wrapWords', () => {
  it('wraps on spaces and never exceeds the width', () => {
    const lines = wrapWords('one two three four five six seven', 10)
    expect(lines).toEqual(['one two', 'three four', 'five six', 'seven'])
  })
  it('hard-breaks a word longer than the width', () => {
    expect(wrapWords('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

describe('the receipt card', () => {
  it('is titled DONE and carries both names, both sizes and the saving', () => {
    const f = frame(result(), 100)
    expect(f).toContain('╭─ ✓ DONE')
    expect(f).toContain('test.png  ──→  test.jpg')
    expect(f).toContain('before')
    expect(f).toContain('after')
    expect(f).toContain('122 KB')
    expect(f).toContain('smaller')
    expect(f).toContain('saved to ~/Desktop/test.jpg')
  })

  it('draws every line at exactly the card width', () => {
    for (const w of [60, 72, 80, 100, 160]) {
      const lines = frame(result(), w).split('\n')
      const expected = Math.min(w, RECEIPT_MAX)
      for (const line of lines) expect(stringWidth(line)).toBe(expected)
    }
  })

  it('ellipses two very long names and still keeps its width', () => {
    const long = 'Screenshot 2026-08-17 at 3.52.36 PM with an absurdly long suffix'
    const f = frame(result({ source: { path: `/tmp/${long}.png` }, out: `/tmp/${long}.jpg` }), 80)
    expect(f).toContain('…')
    for (const line of f.split('\n')) expect(stringWidth(line)).toBe(68)
  })

  it('wraps a long warning inside the card', () => {
    const msg = 'Animation was flattened to its first frame because JPEG cannot store more than one frame'
    const f = frame(result({ warnings: [msg] }), 72)
    expect(f).toContain('⚠ Animation was flattened')
    expect(f).toContain('frame')
    for (const line of f.split('\n')) expect(stringWidth(line)).toBe(68)
  })

  it('says larger when the result grew', () => {
    expect(frame(result({ bytes: 400_000 }), 80)).toContain('larger')
  })

  it('leaves the compact band on the single-line form', () => {
    const block = { kind: 'result' as const, id: 'r', result: result() }
    const f = render(<ThemeProvider palette={DARK}><HistoryEntry block={block} width={50} /></ThemeProvider>).lastFrame() ?? ''
    expect(f).not.toContain('╭')
    expect(f).toContain('✓ done')
  })

  it('is what a history result block renders in the normal band', () => {
    const block = { kind: 'result' as const, id: 'r', result: result() }
    const f = render(<ThemeProvider palette={DARK}><HistoryEntry block={block} width={80} /></ThemeProvider>).lastFrame() ?? ''
    expect(f).toContain('✓ DONE')
  })
})
```

Before writing the expected values, check `Warning`'s real shape in `src/core/types.ts` and `formatBytes(122_449)`'s exact output, and adjust the literals to match.

- [ ] **Step 2: Write the failing colour test** — `tests/shell/receipt-card-colour.test.tsx`, with the `FORCE_COLOR` hoist and `rgb` helper:

```tsx
it('draws the after bar in ok when smaller and in larger when it grew', () => {
  const smaller = frame(result(), 80)          // reuse the helpers from receipt-card.test (copy them in)
  expect(smaller).toContain(`38;2;${rgb(DARK.ok)}m███`)
  const grew = frame(result({ bytes: 400_000 }), 80)
  expect(grew).toContain(`38;2;${rgb(DARK.larger)}m███`)
})
it('keeps an ok border even when the file grew', () => {
  expect(frame(result({ bytes: 400_000 }), 80)).toContain(`38;2;${rgb(DARK.ok)}m╭`)
})
```

- [ ] **Step 3: Run both and confirm they fail** (the module does not exist).

- [ ] **Step 4: Implement `src/shell/components/ReceiptCard.tsx`**

```tsx
import { basename, dirname } from 'node:path'
import { Text } from 'ink'
import stringWidth from 'string-width'
import type { Result } from '../../core/types.js'
import { formatBytes, percentChange } from '../../core/units.js'
import { displayPath } from '../../utils/display-path.js'
import { fileLink, hyperlinksSupported } from '../hyperlink.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { middleEllipsis } from '../width.js'

/** The card never grows past this, however wide the terminal is. */
export const RECEIPT_MAX = 68
const BAR_CELLS = 24
const TITLE = `${SYMBOLS.ok} DONE`

export function receiptBars(before: number, after: number, cells: number) {
  const big = Math.max(before, after)
  if (big === 0) return { before: cells, after: cells, grew: false }
  const scale = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round((cells * n) / big)))
  return { before: scale(before), after: scale(after), grew: after > before }
}

export function wrapWords(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (stringWidth(w) > width) {
      if (line) { out.push(line); line = '' }
      out.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!line) line = w
    else if (stringWidth(`${line} ${w}`) <= width) line = `${line} ${w}`
    else { out.push(line); line = w }
  }
  if (line) out.push(line)
  return out
}

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

export function ReceiptCard({ result, width }: { result: Result; width: number }) {
  const palette = useTheme()
  const { job, outputBytes, warnings } = result
  if (job.op !== 'convert') throw new Error(`ReceiptCard cannot render a "${job.op}" result`)
  const source = job.sources[0]
  const output = job.outputs[0]

  const W = Math.min(width, RECEIPT_MAX)
  const inner = W - 2
  const T = inner - 4 // two columns of padding each side
  const pad = (s: string) => ' '.repeat(Math.max(0, T - stringWidth(s)))
  const edge = colourProp(palette.ok)

  const row = (content: JSX.Element, plain: string, key: string) => (
    <Text key={key}>
      <Text color={edge}>{'│  '}</Text>
      {content}
      <Text>{pad(plain)}</Text>
      <Text color={edge}>{'  │'}</Text>
    </Text>
  )
  const blank = (key: string) => <Text key={key} color={edge}>{`│${' '.repeat(inner)}│`}</Text>

  // Names: each side gets half of what the arrow leaves.
  const ARROW = `  ${SYMBOLS.longArrow}  `
  const half = Math.floor((T - stringWidth(ARROW)) / 2)
  const from = middleEllipsis(basename(source.path), half)
  const to = middleEllipsis(basename(output), half)
  const names = `${from}${ARROW}${to}`

  // Sizes and bars.
  const before = formatBytes(source.bytes)
  const after = formatBytes(outputBytes)
  const sizeW = Math.max(stringWidth(before), stringWidth(after))
  const phrase = changePhrase(source.bytes, outputBytes)
  const cells = Math.max(8, Math.min(BAR_CELLS, T - 8 - 2 - sizeW - 2 - stringWidth(phrase)))
  const bars = receiptBars(source.bytes, outputBytes, cells)
  const outcome = colourProp(bars.grew ? palette.larger : palette.ok)
  const bar = (n: number, colour: string | undefined) => (
    <>
      <Text color={colour}>{'█'.repeat(n)}</Text>
      <Text color={colourProp(palette.border)}>{'░'.repeat(cells - n)}</Text>
    </>
  )
  const beforeText = `before  ${'█'.repeat(cells)}  ${before.padEnd(sizeW)}`
  const afterText = `after   ${'█'.repeat(cells)}  ${after.padEnd(sizeW)}  ${phrase}`

  // Destination: the full path, folder linked where the terminal allows it.
  const label = 'saved to '
  const shown = middleEllipsis(displayPath(output), T - label.length)
  const folder = dirname(output)

  const rule = '─'.repeat(Math.max(0, inner - stringWidth(TITLE) - 3))
  const warningLines = warnings.flatMap((w) => wrapWords(`${SYMBOLS.warn} ${w.message}`, T))

  return (
    <>
      <Text>
        <Text color={edge}>{'╭─ '}</Text>
        <Text color={edge} bold>{TITLE}</Text>
        <Text color={edge}>{` ${rule}╮`}</Text>
      </Text>
      {blank('b1')}
      {row(<Text color={colourProp(palette.fg)} bold>{names}</Text>, names, 'names')}
      {blank('b2')}
      {row(
        <>
          <Text color={colourProp(palette.dim)}>{'before  '}</Text>
          {bar(bars.before, colourProp(palette.dim))}
          <Text color={colourProp(palette.dim)}>{`  ${before.padEnd(sizeW)}`}</Text>
        </>,
        beforeText,
        'before',
      )}
      {row(
        <>
          <Text color={colourProp(palette.dim)}>{'after   '}</Text>
          {bar(bars.after, outcome)}
          <Text color={colourProp(palette.fg)} bold>{`  ${after.padEnd(sizeW)}`}</Text>
          <Text color={outcome} bold>{`  ${phrase}`}</Text>
        </>,
        afterText,
        'after',
      )}
      {blank('b3')}
      {row(
        <>
          <Text color={colourProp(palette.dim)}>{label}</Text>
          <Text color={colourProp(palette.fg)}>{hyperlinksSupported() ? fileLink(shown, folder) : shown}</Text>
        </>,
        `${label}${shown}`,
        'saved',
      )}
      {warningLines.map((line, i) =>
        row(<Text color={colourProp(palette.warn)}>{line}</Text>, line, `w${i}`),
      )}
      <Text color={edge}>{`╰${'─'.repeat(inner)}╯`}</Text>
    </>
  )
}
```

Wrap the fragment in `<Box flexDirection="column" marginBottom={1}>` (import `Box`). Add a doc comment at the top of the file explaining what the card replaces and why the sizes are the hero (spec §5). `fileLink` only adds escape bytes around `shown`, so padding is computed from `shown`, never from the link.

- [ ] **Step 5: Use it in `blocks.tsx`.** In the `result` branch, keep the `if (job.op !== 'convert') throw …` guard and the existing compact single-line return, but gate it on `bandFor(width) === 'compact'` instead of `!paired`. Replace everything after it (the `CONNECTOR`/`cell`/`stacked`/side-by-side code) with `return <ReceiptCard result={block.result} width={width} />`. Delete the code that is no longer reached, and the now-unused imports. Keep `changePhrase` and `changeColour` if the compact form still uses them.

- [ ] **Step 6: Run the new tests (PASS), then `npx vitest run tests/shell/`.** Update `blocks-design`, `result-colour`, `result-destination`, `rasterise-result` and any others that asserted the two-box layout or `✓ done` in the normal band, so they assert the receipt (`✓ DONE`, `saved to …/name`, bars). Do not delete them.

- [ ] **Step 7: Commit**

```bash
git add src/shell/components/ReceiptCard.tsx src/shell/blocks.tsx tests/shell
git commit -m "feat(shell): a receipt card with size bars for finished conversions"
```

---

### Task 5: Header bar

**Files:**
- Create: `src/shell/components/HeaderBar.tsx`
- Modify: `src/shell/App.tsx` (the mode bar near line 2111, and the one under the result hints near line 2583)
- Test: `tests/shell/header-bar.test.tsx` (new)

**Interfaces:**
- Consumes: `MODE_MARKERS`, `modeColours`, `ShellMode` (Task 1).
- Produces: `HeaderBar({ mode, detail, defaultOutput, width }: { mode: ShellMode; detail?: string; defaultOutput: string; width: number })`; `isWorking(step: string, staged: number): boolean`, exported from `HeaderBar.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { HeaderBar, isWorking } from '../../src/shell/components/HeaderBar.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const frame = (p: Partial<Parameters<typeof HeaderBar>[0]> = {}) =>
  render(
    <ThemeProvider palette={DARK}>
      <HeaderBar mode="convert" defaultOutput="/Users/me/Desktop" width={90} {...p} />
    </ThemeProvider>,
  ).lastFrame() ?? ''

describe('header bar', () => {
  it('names the product and the mode, with the default folder on the right', () => {
    const f = frame()
    expect(f).toMatch(/^ ↔ FORGE {3}convert +~\/Desktop $/)
    expect(stringWidth(f)).toBe(90)
  })
  it('carries the staged file when given one', () => {
    expect(frame({ detail: 'report.pdf' })).toContain('convert · report.pdf')
  })
  it('uses each mode marker', () => {
    expect(frame({ mode: 'compress' })).toContain('↓ FORGE   compress')
    expect(frame({ mode: 'pdf' })).toContain('▣ FORGE   pdf')
  })
  it('shrinks to the marker and mode when compact', () => {
    const f = frame({ width: 50 })
    expect(f.trim()).toBe('↔ convert')
    expect(stringWidth(f)).toBe(50)
  })
  it('ellipses a long default folder instead of overflowing', () => {
    const f = frame({ defaultOutput: `/Users/me/${'deep/'.repeat(30)}out`, width: 70 })
    expect(stringWidth(f)).toBe(70)
    expect(f).toContain('…')
  })
})

describe('isWorking', () => {
  it('is false only at an empty idle prompt and on the theme picker', () => {
    expect(isWorking('idle', 0)).toBe(false)
    expect(isWorking('theme', 0)).toBe(false)
    expect(isWorking('idle', 1)).toBe(true)
    expect(isWorking('target', 1)).toBe(true)
    expect(isWorking('result', 0)).toBe(true)
  })
})
```

Check what `displayPath` returns for `/Users/me/Desktop` in a test (it abbreviates the real home folder). If the test's fake home isn't abbreviated, use `os.homedir()` + `/Desktop` as the input.

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement `HeaderBar.tsx`**

```tsx
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { displayPath } from '../../utils/display-path.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_MARKERS, modeColours, type ShellMode } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'

/** Everything but an empty idle prompt (and the first-run picker) is "working". */
export function isWorking(step: string, staged: number): boolean {
  if (step === 'theme') return false
  return !(step === 'idle' && staged === 0)
}

export function HeaderBar({ mode, detail, defaultOutput, width }: {
  mode: ShellMode; detail?: string; defaultOutput: string; width: number
}) {
  const palette = useTheme()
  const { fg, bg } = modeColours(palette, mode)
  const marker = MODE_MARKERS[mode]

  if (bandFor(width) === 'compact') {
    const text = ` ${marker} ${mode}`
    return (
      <Box width={width} backgroundColor={colourProp(bg)}>
        <Text color={colourProp(fg)} bold>{text}</Text>
        <Text>{' '.repeat(Math.max(0, width - stringWidth(text)))}</Text>
      </Box>
    )
  }

  const brand = ` ${marker} FORGE `
  const middle = `  ${mode}${detail ? ` · ${detail}` : ''}`
  const room = width - stringWidth(brand) - stringWidth(middle) - 3
  const right = middleEllipsis(displayPath(defaultOutput), Math.max(4, room))
  const gap = Math.max(1, width - stringWidth(brand) - stringWidth(middle) - stringWidth(right) - 1)
  return (
    <Box width={width} backgroundColor={colourProp(bg)}>
      <Text color={colourProp(fg)} bold>{brand}</Text>
      <Text color={colourProp(palette.dim)}>{middle}</Text>
      <Text>{' '.repeat(gap)}</Text>
      <Text color={colourProp(palette.dim)}>{right}</Text>
      <Text>{' '}</Text>
    </Box>
  )
}
```

Add a doc comment: it replaces the `current mode:` bar once the user is working (spec §4), the mode name is always paired with its marker, and the folder is the one the next file will go to.

- [ ] **Step 4: Run it and confirm it passes.**

- [ ] **Step 5: Wire into `App.tsx`**

- Add `const working = isWorking(step, stage.sources.length)` near `band`.
- At the top mode bar (line ~2111): when `working`, render `<Box marginBottom={1}><HeaderBar mode={mode} detail={step === 'idle' && source && !stagedBatch ? basename(source.path) : undefined} defaultOutput={livePrefs.defaultOutput} width={width} /></Box>`; otherwise keep today's `modeLine(true)` box unchanged.
- Under the result hints (line ~2583): replace the `<Box … backgroundColor={modeBg}>{modeLine(false)}</Box>` with `<Box marginTop={1}><HeaderBar mode={mode} defaultOutput={livePrefs.defaultOutput} width={width} /></Box>`.
- `modeLine`'s staged-file branch becomes unreachable (idle with a stage is now "working"). Remove that branch and update its comment.

- [ ] **Step 6: Run `npx vitest run tests/shell/`.** Update assertions of `current mode: <x>` made while a file is staged or a flow is open (`sticky-context`, `palette-flow`, `pdf-mode-arming`, `compress-flow`) to the header bar (`↔ FORGE` / `▣ FORGE   pdf` / `↓ FORGE   compress`). Assertions made at an empty idle prompt keep `current mode:`.

- [ ] **Step 7: Commit**

```bash
git add src/shell/components/HeaderBar.tsx src/shell/App.tsx tests/shell
git commit -m "feat(shell): a header bar replaces the mode line while working"
```

---

### Task 6: Logo clear-and-replay

**Files:**
- Modify: `src/shell/redraw.ts` (add `bannerTransition`)
- Modify: `src/shell/App.tsx` (`introPending` → `bannerState`; the resize handler; `chooseTheme`; a new effect on `working`)
- Test: `tests/shell/redraw.test.ts` (extend), `tests/shell/banner-transition-app.test.tsx` (new)

**Interfaces:**
- Consumes: `isWorking` (Task 5), `historyForRedraw`, `CLEAR_SCREEN`.
- Produces:

```ts
export interface BannerState { enabled: boolean; onScreen: boolean }
export function bannerTransition(
  history: HistoryBlock[],
  working: boolean,
  state: BannerState,
  makeBanner: () => HistoryBlock,
): { history: HistoryBlock[]; state: BannerState } | null
```

`null` means nothing to do. Any non-null result means "write `CLEAR_SCREEN` and replay".

- [ ] **Step 1: Write the failing tests** — append to `tests/shell/redraw.test.ts`

```ts
import { bannerTransition } from '../../src/shell/redraw.js'

describe('the logo makes way while you work', () => {
  const banner: HistoryBlock = { kind: 'banner', id: 'B', width: 90, defaultOutput: '~/Desktop' }
  const note: HistoryBlock = { kind: 'note', id: 'n', text: 'hi' }
  const make = () => ({ ...banner, id: 'B2' })

  it('removes the logo when work starts', () => {
    const t = bannerTransition([banner, note], true, { enabled: true, onScreen: true }, make)
    expect(t?.history).toEqual([note])
    expect(t?.state).toEqual({ enabled: true, onScreen: false })
  })

  it('removes the intro logo even though it was never in history', () => {
    const t = bannerTransition([note], true, { enabled: true, onScreen: true }, make)
    expect(t?.history).toEqual([note])
  })

  it('puts the logo back on top when the prompt is empty again', () => {
    const t = bannerTransition([note], false, { enabled: true, onScreen: false }, make)
    expect(t?.history).toEqual([{ ...banner, id: 'B2' }, note])
    expect(t?.state.onScreen).toBe(true)
  })

  it('never stacks two logos', () => {
    const t = bannerTransition([banner, note], false, { enabled: true, onScreen: false }, make)
    expect(t?.history.filter((b) => b.kind === 'banner')).toHaveLength(1)
    expect(t?.history[0]?.kind).toBe('banner')
  })

  it('does nothing when already in the right state', () => {
    expect(bannerTransition([note], true, { enabled: true, onScreen: false }, make)).toBeNull()
    expect(bannerTransition([banner], false, { enabled: true, onScreen: true }, make)).toBeNull()
  })

  it('does nothing in a session that never showed a logo', () => {
    expect(bannerTransition([note], false, { enabled: false, onScreen: false }, make)).toBeNull()
    expect(bannerTransition([note], true, { enabled: false, onScreen: false }, make)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement in `redraw.ts`**

```ts
/**
 * Whether the logo should be on screen, and the history that makes it so.
 *
 * The full logo belongs to an empty prompt; once there is work on screen the
 * header bar takes over (spec 2026-10-11 §4). Scrollback cannot be edited, so
 * either direction is a clear-and-replay — the same move a width change
 * makes. `enabled` is false for a session that never drew a logo (tests,
 * and nothing else today), which keeps this from inventing one.
 */
export interface BannerState {
  enabled: boolean
  onScreen: boolean
}

export function bannerTransition(
  history: HistoryBlock[],
  working: boolean,
  state: BannerState,
  makeBanner: () => HistoryBlock,
): { history: HistoryBlock[]; state: BannerState } | null {
  if (!state.enabled) return null
  const rest = history.filter((b) => b.kind !== 'banner')
  if (working && state.onScreen) return { history: rest, state: { ...state, onScreen: false } }
  if (!working && !state.onScreen) {
    return { history: [makeBanner(), ...rest], state: { ...state, onScreen: true } }
  }
  return null
}
```

- [ ] **Step 4: Run it and confirm it passes.**

- [ ] **Step 5: Wire into `App.tsx`**

- Replace `const introPending = useRef(introShown)` with `const bannerState = useRef<BannerState>({ enabled: introShown, onScreen: introShown })`.
- Resize handler: replace the `introPending` block with:

```ts
setHistory((h) => {
  const intro: HistoryBlock | undefined =
    bannerState.current.onScreen && !h.some((b) => b.kind === 'banner')
      ? { kind: 'banner', id: nextId(), width: columns, defaultOutput: defaultOutputRef.current }
      : undefined
  return historyForRedraw(h, columns, intro)
})
```

- `chooseTheme`: before the `push`, set `bannerState.current = { enabled: true, onScreen: true }`.
- New effect, placed after `working` is defined:

```ts
// biome-ignore lint/correctness/useExhaustiveDependencies: fires on the working/idle edge only; history and width are read at that moment
useEffect(() => {
  const t = bannerTransition(history, working, bannerState.current, () => ({
    kind: 'banner', id: nextId(), width, defaultOutput: livePrefs.defaultOutput,
  }))
  if (!t) return
  bannerState.current = t.state
  if (stdout) writeToTerminal(CLEAR_SCREEN, stdout)
  setHistory(historyForRedraw(t.history, width))
  setStaticGeneration((g) => g + 1)
}, [working])
```

Remove the now-stale comments about `introPending`, and fix the doc comment on `introShown`.

- [ ] **Step 6: Write the app-level test** — `tests/shell/banner-transition-app.test.tsx`

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const WORDMARK_ROW = '███████╗ ██████╗'

describe('the logo in a running session', () => {
  it('gives way to the header bar once a file is dropped', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: undefined, defaultOutput: dir }
    const app = render(<App initialWidth={100} prefs={prefs} />)
    app.stdin.write('\r') // first-run picker: accept dark, which pushes the logo
    await settle()
    expect(app.frames.join('\n')).toContain(WORDMARK_ROW)
    const before = app.frames.length
    app.stdin.write(jpg)
    await settle()
    app.stdin.write('\r')
    await settle()
    const after = app.frames.slice(before).join('\n')
    expect(after).toContain('↔ FORGE')
    expect(after).not.toContain(WORDMARK_ROW)
  })
})
```

Check first that the first-run picker's default choice and its confirm key match (`ThemePicker.tsx`), and that `frames` includes `<Static>` output in this ink-testing-library version. If it doesn't, assert on `lastFrame()` for the header bar only and leave the logo's absence to the unit tests.

- [ ] **Step 7: Run `npx vitest run tests/shell/` (PASS), then commit**

```bash
git add src/shell/redraw.ts src/shell/App.tsx tests/shell/redraw.test.ts tests/shell/banner-transition-app.test.tsx
git commit -m "feat(shell): the logo shows on an empty prompt and makes way while working"
```

---

### Task 7: Whole-suite gate and visual check

- [ ] **Step 1:** `npm test && npm run typecheck && npm run lint`. All green; fix anything that isn't.
- [ ] **Step 2:** `npm run build`, then drive the shell in tmux (`tmux new-session -d -x <w> -y 40 "node dist/index.js"`) at 48, 72, 100 and 120 columns through: launch → drop `Test Images/test.png` → JPEG → quality → "Same folder" → name → result → `↵` convert another. Capture with `tmux capture-pane -e -p` at each step. Check:
  - The logo shows at launch, disappears on drop, and comes back after "convert another".
  - The header bar is one row and exactly the window's width.
  - The receipt card is aligned at 72, 100 and 120 columns, and the compact form is shown at 48.
  - Keycaps appear on every step.
  - The cursor, tag, labels and slider are cyan in convert and green in `/compress`.
- [ ] **Step 3:** Repeat one pass with `NO_COLOR=1` (keys bracketed, bars still readable) and one with the light theme (`/theme`).
- [ ] **Step 4:** Commit any fixes as `fix(shell): …`.
