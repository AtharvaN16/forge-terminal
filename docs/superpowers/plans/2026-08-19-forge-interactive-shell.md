# Forge Interactive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive shell that bare `forge` opens — a chat-style terminal interface where you drop a file, pick a format from an inline picker, choose a destination, and get a clickable result.

**Architecture:** An Ink/React app under `src/shell/` driving the existing conversion core. Committed history renders through Ink's `<Static>`; only the bottom region is live. An action layer in `src/core/actions.ts` describes each step as data (`select`, `slider`, `path`), so the shell renders three widget kinds and never learns about formats. Nothing in `src/core/` or `src/engines/` gains a UI dependency.

**Tech Stack:** Ink 7.1.1, React 19.2.8, ink-testing-library 4.0.0, supports-hyperlinks 4.5.0, on the existing TypeScript 7 / ESM / Vitest toolchain.

**Spec:** [docs/superpowers/specs/2026-08-19-forge-design.md](../specs/2026-08-19-forge-design.md) — §6 (actions), §10 (the shell), §13 (responsiveness and accessibility). The rest of the spec is already built and shipped in v0.1.

**Prerequisite:** The v0.1 plan is complete and merged. `main` is at `ebb6a03`, 134 tests pass. Read [2026-08-19-forge-core-and-cli.md](2026-08-19-forge-core-and-cli.md) only if you need to understand an existing module.

## Global Constraints

- Command `forge`, package `forge-terminal`. Work on branch `dev`; merge to `main` only when asked.
- ESM only. Relative imports in `src/` carry a `.js` extension — including from `.tsx` files.
- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `strict: true` and `noUncheckedIndexedAccess: true`.
- TypeScript is **7.x**, which does not auto-include `@types/*`. `tsconfig.json` carries `"types": ["node"]`; Task 1 extends it.
- Sharp's ESM typings export named interfaces — `import type { Sharp, Metadata } from 'sharp'`, never `sharp.X` (TS2503).
- **`src/core/` and `src/engines/` must remain free of React, Ink, and every stdout write.** They return data. This is the invariant that lets the CLI and the shell share one execution path — the CLI already depends on it.
- **No hardcoded format list outside `src/core/formats.ts`.** The shell's picker renders whatever `targetsFor(source)` returns.
- **Progress is never fabricated.** Sharp exposes no per-image progress. Single-file conversion shows a phase, never a percentage. Batch progress is driven by real `job:done` / `job:error` events.
- Every status pairs a symbol with a word (`✓ done`, `✕ failed`, `⚠ warning`); selection is marked `❯` **and** bold. Colour is never the sole carrier of meaning. `NO_COLOR` is honoured.
- The shell launches **only** when `process.stdout.isTTY`. Piped invocations must never wait for input.

### Measured facts this plan depends on

Verified on this machine before the plan was written. Do not re-derive; do not assume otherwise.

| Fact | Value |
| --- | --- |
| Ink | 7.1.1 — exports `Box`, `Text`, `Static`, `useInput`, `useStdout`, `useApp`, `useFocus`, `measureElement`, `render` |
| Ink peer deps | `react >=19.2.0`, `@types/react >=19.2.0`, `react-devtools-core >=6.1.2`; `engines.node >=22` (we run 24) |
| React | 19.2.8 |
| ink-testing-library | 4.0.0 — `render()` returns `{ stdin, lastFrame, frames, rerender, unmount }` |
| Driving input in tests | down = `ESC + '[B'`, up = `ESC + '[A'`, enter = `String.fromCharCode(13)`, where `ESC = String.fromCharCode(27)` |
| `<Static>` | committed items appear above the live region and are not re-rendered |
| supports-hyperlinks | 4.5.0 — `.stdout` / `.stderr` booleans |
| yoga-layout (Ink's layout engine) | uses top-level await, so **the package must be ESM**. Ours already is. |

**A `useInput` component is fully testable.** A probe drove a `<Select>`-shaped component through two arrow keys and Enter, asserted the rendered frame at each step, and confirmed the `<Static>` history committed. This is why every task below is test-first rather than testing only pure helpers — and it supersedes an earlier draft of spec §14 that scoped shell testing to edges only.

### One spec refinement, made during planning

Spec §6 declares `options(s: SourceInfo): OptionSpec[]`. That signature cannot express "show the quality slider only for lossy targets", because whether quality applies depends on the format the user *just picked*, not on the source. This plan uses:

```ts
options(s: SourceInfo, values: Record<string, unknown>): OptionSpec[]
```

The shell re-evaluates it after every answer. Everything else in §6 is unchanged. Recorded here rather than silently diverging.

---

## File structure

```
src/core/
  actions.ts             Action, OptionSpec, the convert action. NO UI IMPORTS.

src/utils/
  unescape-path.ts       shell-escaped paste -> real path

src/shell/
  theme.ts               symbols, colour tokens, whether colour is on at all
  width.ts               width bands, middle-ellipsis truncation
  hyperlink.ts           OSC 8 with graceful degradation
  reveal.ts              open(1) / open -R wrappers for the f and o keys
  components/
    Select.tsx           arrow-key list, the workhorse
    Slider.tsx           quality
    PathInput.tsx        destination, with presets
    Prompt.tsx           the bottom input box
    FileCard.tsx         "photo.jpg · 4.2 MB · JPEG 3024×4032"
    Hints.tsx            the keyboard hint line
  blocks.tsx             history entries rendered inside <Static>
  App.tsx                the flow state machine
  launch.tsx             render() entry point

modified:
  src/cli/execute.ts     the 'shell' intent stops returning exit 2
  src/index.ts           launches the shell when stdout is a TTY
  tsconfig.json          gains "jsx": "react-jsx"
  package.json           gains ink, react, supports-hyperlinks
```

Files are small and single-purpose because a component you can hold in your head is one you can edit reliably. `App.tsx` is the only file that knows the flow; every component below it is dumb and takes props.

---

### Task 1: Shell toolchain

Nothing else can start until an Ink component renders and is testable. This task exists to prove that, not to build product.

**Files:**
- Modify: `package.json`, `tsconfig.json`, `tsconfig.typecheck.json`
- Create: `src/shell/components/Hello.tsx` (deleted in Task 6 — scaffolding, and the plan says so up front)
- Test: `tests/shell/toolchain.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: a working JSX + Ink + ink-testing-library setup

- [ ] **Step 1: Install**

```bash
cd "/Users/atharvanayak/Developer/Convert Terminal"
git switch dev
npm i ink react supports-hyperlinks
npm i -D ink-testing-library @types/react
```

- [ ] **Step 2: Add JSX support to `tsconfig.json`**

Add `"jsx": "react-jsx"` to `compilerOptions`. Leave `"types": ["node"]` alone — it is deliberate (TypeScript 7 does not auto-include `@types/*`) and React's types resolve through the explicit `react` import, not ambient inclusion.

- [ ] **Step 3: Extend both configs to see `.tsx`**

`tsconfig.json`'s `include` stays `["src"]` — it already picks up `.tsx`. In `tsconfig.typecheck.json`, confirm `include` is `["src", "tests", "vitest.config.ts"]` so test components are type-checked too.

- [ ] **Step 4: Write the failing test**

```tsx
// tests/shell/toolchain.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Hello } from '../../src/shell/components/Hello.js'

describe('shell toolchain', () => {
  it('renders an ink component', () => {
    const { lastFrame } = render(<Hello name="Forge" />)
    expect(lastFrame()).toContain('Forge')
  })
})
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run tests/shell/toolchain.test.tsx`
Expected: FAIL — cannot resolve `Hello`

- [ ] **Step 6: Write the component**

```tsx
// src/shell/components/Hello.tsx
import { Text } from 'ink'

export function Hello({ name }: { name: string }) {
  return <Text>Hello {name}</Text>
}
```

- [ ] **Step 7: Verify the whole chain**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

All 134 existing tests must still pass. If `vitest` cannot parse `.tsx`, it needs no extra config — esbuild handles JSX when `tsconfig.json` sets `jsx`. If `tsc` complains it cannot find the JSX runtime, that is the `types: ["node"]` interaction: report it rather than deleting the field, which is load-bearing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(shell): ink and react toolchain"
```

---

### Task 2: Path unescaping — the drag-and-drop mechanism

Dropping a file into a terminal is not a drop API. It pastes a shell-escaped string. This function is the entire feature.

**Files:**
- Create: `src/utils/unescape-path.ts`
- Test: `tests/utils/unescape-path.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `unescapePath(raw: string): string`, `splitPastedPaths(raw: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/unescape-path.test.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitPastedPaths, unescapePath } from '../../src/utils/unescape-path.js'

describe('unescapePath', () => {
  it('leaves a plain path alone', () => {
    expect(unescapePath('/Users/me/photo.jpg')).toBe('/Users/me/photo.jpg')
  })

  it('unescapes backslash-escaped spaces, which is what iTerm pastes', () => {
    expect(unescapePath('/Users/me/My\\ Photo.jpg')).toBe('/Users/me/My Photo.jpg')
  })

  it('unescapes other backslash escapes', () => {
    expect(unescapePath("/Users/me/it\\'s.jpg")).toBe("/Users/me/it's.jpg")
  })

  it('strips single quotes without unescaping inside them', () => {
    expect(unescapePath("'/Users/me/My Photo.jpg'")).toBe('/Users/me/My Photo.jpg')
  })

  it('strips double quotes', () => {
    expect(unescapePath('"/Users/me/My Photo.jpg"')).toBe('/Users/me/My Photo.jpg')
  })

  it('expands a bare tilde', () => {
    expect(unescapePath('~')).toBe(homedir())
  })

  it('expands a tilde prefix', () => {
    expect(unescapePath('~/Desktop/a.jpg')).toBe(join(homedir(), 'Desktop/a.jpg'))
  })

  it('does not expand a tilde in the middle', () => {
    expect(unescapePath('/tmp/~backup/a.jpg')).toBe('/tmp/~backup/a.jpg')
  })

  it('trims surrounding whitespace, which terminals add', () => {
    expect(unescapePath('  /Users/me/a.jpg  ')).toBe('/Users/me/a.jpg')
  })
})

describe('splitPastedPaths', () => {
  it('splits several plain paths', () => {
    expect(splitPastedPaths('/a/one.jpg /a/two.jpg')).toEqual(['/a/one.jpg', '/a/two.jpg'])
  })

  it('does not split on an escaped space', () => {
    expect(splitPastedPaths('/a/My\\ Photo.jpg /a/two.jpg'))
      .toEqual(['/a/My Photo.jpg', '/a/two.jpg'])
  })

  it('does not split inside quotes', () => {
    expect(splitPastedPaths("'/a/My Photo.jpg' /a/two.jpg"))
      .toEqual(['/a/My Photo.jpg', '/a/two.jpg'])
  })

  it('returns one path for one path', () => {
    expect(splitPastedPaths('/a/one.jpg')).toEqual(['/a/one.jpg'])
  })

  it('returns nothing for empty input', () => {
    expect(splitPastedPaths('   ')).toEqual([])
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/utils/unescape-path.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/utils/unescape-path.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Terminals paste a *shell-escaped* path when you drop a file on them.
 * iTerm2 backslash-escapes spaces; some terminals wrap the whole thing in
 * quotes. Inside quotes the backslashes are literal, so the two cases must
 * not both be applied.
 */
export function unescapePath(raw: string): string {
  let s = raw.trim()

  const quoted =
    (s.startsWith("'") && s.endsWith("'") && s.length > 1) ||
    (s.startsWith('"') && s.endsWith('"') && s.length > 1)

  if (quoted) s = s.slice(1, -1)
  else s = s.replace(/\\(.)/g, '$1')

  if (s === '~') return homedir()
  if (s.startsWith('~/')) return join(homedir(), s.slice(2))
  return s
}

/**
 * Splits a paste containing several paths on *unescaped* whitespace, so
 * "My\ Photo.jpg" stays one path. Each result is then unescaped.
 */
export function splitPastedPaths(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === undefined) break

    if (quote) {
      current += c
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      continue
    }
    if (c === '\\') {
      current += c + (raw[i + 1] ?? '')
      i++
      continue
    }
    if (/\s/.test(c)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += c
  }

  if (current) out.push(current)
  return out.map(unescapePath)
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/utils/unescape-path.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): unescape shell-escaped paths from terminal drops"
```

---

### Task 3: Width bands and truncation

**Files:**
- Create: `src/shell/width.ts`
- Test: `tests/shell/width.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type WidthBand = 'compact' | 'normal' | 'wide'`, `bandFor(columns: number): WidthBand`, `middleEllipsis(text: string, max: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shell/width.test.ts
import { describe, expect, it } from 'vitest'
import { bandFor, middleEllipsis } from '../../src/shell/width.js'

describe('bandFor', () => {
  it('uses the spec boundaries', () => {
    expect(bandFor(40)).toBe('compact')
    expect(bandFor(59)).toBe('compact')
    expect(bandFor(60)).toBe('normal')
    expect(bandFor(100)).toBe('normal')
    expect(bandFor(101)).toBe('wide')
    expect(bandFor(200)).toBe('wide')
  })

  it('treats a zero or unknown width as compact rather than crashing', () => {
    expect(bandFor(0)).toBe('compact')
  })
})

describe('middleEllipsis', () => {
  it('leaves short text alone', () => {
    expect(middleEllipsis('photo.jpg', 20)).toBe('photo.jpg')
  })

  it('leaves text of exactly the maximum alone', () => {
    expect(middleEllipsis('123456789', 9)).toBe('123456789')
  })

  it('keeps both ends, which is what matters for paths', () => {
    const out = middleEllipsis('/Users/me/Pictures/holiday/beach.jpg', 20)
    expect(out).toHaveLength(20)
    expect(out.startsWith('/Users')).toBe(true)
    expect(out.endsWith('.jpg')).toBe(true)
    expect(out).toContain('…')
  })

  it('never exceeds the maximum', () => {
    for (const max of [4, 5, 10, 15, 30]) {
      expect(middleEllipsis('/a/very/long/path/to/a/file.jpeg', max).length).toBeLessThanOrEqual(max)
    }
  })

  it('degrades sanely at tiny widths', () => {
    expect(middleEllipsis('abcdefgh', 1)).toBe('…')
    expect(middleEllipsis('abcdefgh', 0)).toBe('')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/width.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/shell/width.ts`**

```ts
export type WidthBand = 'compact' | 'normal' | 'wide'

/** Spec §13: <60 compact, 60-100 normal, >100 wide. */
export function bandFor(columns: number): WidthBand {
  if (columns < 60) return 'compact'
  if (columns <= 100) return 'normal'
  return 'wide'
}

/**
 * Truncates from the middle, because for a path both ends carry meaning —
 * the start says where it lives, the end says what it is.
 */
export function middleEllipsis(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max === 1) return '…'

  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return text.slice(0, head) + '…' + (tail > 0 ? text.slice(text.length - tail) : '')
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/shell/width.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): width bands and middle-ellipsis truncation"
```

---

### Task 4: Hyperlinks and reveal

**Files:**
- Create: `src/shell/hyperlink.ts`, `src/shell/reveal.ts`
- Test: `tests/shell/hyperlink.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `fileLink(label: string, path: string, opts?: { supported?: boolean }): string`, `openPath(p: string): Promise<void>`, `revealPath(p: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shell/hyperlink.test.ts
import { describe, expect, it } from 'vitest'
import { fileLink } from '../../src/shell/hyperlink.js'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

describe('fileLink', () => {
  it('emits an OSC 8 hyperlink where supported', () => {
    const out = fileLink('Open file', '/Users/me/a.webp', { supported: true })
    expect(out).toBe(`${ESC}]8;;file:///Users/me/a.webp${BEL}Open file${ESC}]8;;${BEL}`)
  })

  it('falls back to the bare url where unsupported, since Terminal.app cmd+clicks those', () => {
    const out = fileLink('Open file', '/Users/me/a.webp', { supported: false })
    expect(out).toBe('file:///Users/me/a.webp')
    expect(out).not.toContain(ESC)
  })

  it('percent-encodes spaces so the url is valid', () => {
    const out = fileLink('Open', '/Users/me/My Photo.webp', { supported: false })
    expect(out).toBe('file:///Users/me/My%20Photo.webp')
  })

  it('links a directory for the reveal case', () => {
    expect(fileLink('Reveal', '/Users/me/pics', { supported: false }))
      .toBe('file:///Users/me/pics')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/hyperlink.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/shell/hyperlink.ts`**

```ts
import { pathToFileURL } from 'node:url'
import supportsHyperlinks from 'supports-hyperlinks'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/**
 * OSC 8 turns a word into a click target. iTerm2, Ghostty, WezTerm, Kitty and
 * VS Code's terminal support it; macOS Terminal.app does not — and there a
 * bare file:// URL is still cmd+clickable, so that is the fallback rather
 * than dropping the affordance entirely.
 */
export function fileLink(
  label: string,
  path: string,
  opts: { supported?: boolean } = {},
): string {
  const url = pathToFileURL(path).href
  const supported = opts.supported ?? supportsHyperlinks.stdout
  if (!supported) return url
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`
}
```

- [ ] **Step 4: Write `src/shell/reveal.ts`**

No unit test: this shells out to macOS and asserting it would test the OS, not us. The `f` and `o` keybindings are exercised by hand in Task 14.

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Opens a file with its default application. */
export async function openPath(path: string): Promise<void> {
  await run('open', [path])
}

/** Reveals a file in Finder with it selected. */
export async function revealPath(path: string): Promise<void> {
  await run('open', ['-R', path])
}
```

- [ ] **Step 5: Run and confirm the tests pass**

Run: `npx vitest run tests/shell/hyperlink.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shell): osc 8 hyperlinks with graceful degradation"
```

---

### Task 5: The action layer

**Files:**
- Create: `src/core/actions.ts`
- Test: `tests/core/actions.test.ts`

**Interfaces:**
- Consumes: `SourceInfo`, `Job`, `ConvertOptions`, `FormatId` from `core/types.js`; `targetsFor` from `core/capabilities.js`; `FORMATS`, `primaryExtension` from `core/formats.js`; `resolveOutputPath` from `core/output-path.js`
- Produces:
  - `interface Choice { value: string; label: string; hint?: string }`
  - `interface PathPreset { label: string; path: string }`
  - `type OptionSpec` — the three-member union from spec §6
  - `interface Action { id; label; hint; appliesTo(s); options(s, values); plan(s, values) }`
  - `convertAction: Action`, `ACTIONS: Action[]`, `actionsFor(s: SourceInfo): Action[]`

**This file must not import React or Ink.** It lives in `core/` precisely so the shell renders data it does not author.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/actions.test.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONS, actionsFor, convertAction } from '../../src/core/actions.js'
import type { SourceInfo } from '../../src/core/types.js'

function source(over: Partial<SourceInfo> = {}): SourceInfo {
  return {
    path: '/Users/me/Desktop/photo.jpg',
    format: 'jpeg', width: 3024, height: 4032, bytes: 4_200_000,
    hasAlpha: false, frames: 1, ...over,
  }
}

describe('action registry', () => {
  it('registers exactly one action in this version', () => {
    expect(ACTIONS).toHaveLength(1)
    expect(ACTIONS[0]?.id).toBe('convert')
  })

  it('offers convert for any image', () => {
    expect(actionsFor(source()).map((a) => a.id)).toEqual(['convert'])
  })
})

describe('convert action options', () => {
  it('offers a target select derived from the capability graph, never a fixed list', () => {
    const specs = convertAction.options(source(), {})
    const target = specs.find((s) => s.id === 'target')
    expect(target?.kind).toBe('select')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).toEqual(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])
    expect(target.choices.every((c) => c.label.length > 0 && c.hint !== undefined)).toBe(true)
  })

  it('never offers heic, which sharp cannot encode', () => {
    const target = convertAction.options(source(), {}).find((s) => s.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).not.toContain('heic')
  })

  it('adds a quality slider once a lossy target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' })
    const quality = specs.find((s) => s.id === 'quality')
    expect(quality?.kind).toBe('slider')
    if (quality?.kind !== 'slider') throw new Error('expected slider')
    expect(quality.min).toBe(1)
    expect(quality.max).toBe(100)
    expect(quality.default).toBe(80)
  })

  it('omits the quality slider for a lossless target', () => {
    const specs = convertAction.options(source(), { target: 'png' })
    expect(specs.find((s) => s.id === 'quality')).toBeUndefined()
  })

  it('offers a destination path with presets once a target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' })
    const dest = specs.find((s) => s.id === 'destination')
    expect(dest?.kind).toBe('path')
    if (dest?.kind !== 'path') throw new Error('expected path')
    expect(dest.default).toBe('/Users/me/Desktop')
    expect(dest.presets.map((p) => p.label)).toEqual([
      'Same folder', 'New subfolder', 'Downloads',
    ])
    expect(dest.presets[2]?.path).toBe(join(homedir(), 'Downloads'))
  })
})

describe('convert action plan', () => {
  it('builds one job with the chosen values', () => {
    const s = source()
    const jobs = convertAction.plan(s, {
      target: 'webp', quality: 70, destination: '/Users/me/out',
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.target).toBe('webp')
    expect(jobs[0]?.output).toBe('/Users/me/out/photo.webp')
    expect(jobs[0]?.options.quality).toBe(70)
  })

  it('omits quality for a lossless target rather than passing a meaningless number', () => {
    const jobs = convertAction.plan(source(), { target: 'png', destination: '/Users/me/out' })
    expect(jobs[0]?.options.quality).toBeUndefined()
  })

  it('defaults the background to white so transparency does not become black', () => {
    const jobs = convertAction.plan(source(), { target: 'jpeg', destination: '/out' })
    expect(jobs[0]?.options.background).toBe('#ffffff')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/actions.ts`**

```ts
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { targetsFor } from './capabilities.js'
import { FORMATS } from './formats.js'
import { resolveOutputPath } from './output-path.js'
import type { ConvertOptions, FormatId, Job, SourceInfo } from './types.js'

export interface Choice {
  value: string
  label: string
  hint?: string
}

export interface PathPreset {
  label: string
  path: string
}

export type OptionSpec =
  | { kind: 'select'; id: string; label: string; choices: Choice[]; default: string }
  | {
      kind: 'slider'
      id: string
      label: string
      min: number
      max: number
      step: number
      default: number
    }
  | { kind: 'path'; id: string; label: string; default: string; presets: PathPreset[] }

export interface Action {
  id: string
  label: string
  hint: string
  appliesTo(source: SourceInfo): boolean
  /**
   * Takes the answers so far, because some options depend on earlier ones —
   * the quality slider only makes sense once a lossy target is chosen.
   * (Spec §6 declared this without the second parameter; see the plan.)
   */
  options(source: SourceInfo, values: Record<string, unknown>): OptionSpec[]
  plan(source: SourceInfo, values: Record<string, unknown>): Job[]
}

const DEFAULT_QUALITY = 80

function targetSelect(source: SourceInfo): OptionSpec {
  const targets = targetsFor(source)
  const first = targets[0]
  return {
    kind: 'select',
    id: 'target',
    label: 'Convert to',
    choices: targets.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    default: first ? first.id : '',
  }
}

function destinationPath(source: SourceInfo): OptionSpec {
  const here = dirname(source.path)
  return {
    kind: 'path',
    id: 'destination',
    label: 'Save to',
    default: here,
    presets: [
      { label: 'Same folder', path: here },
      { label: 'New subfolder', path: join(here, 'converted') },
      { label: 'Downloads', path: join(homedir(), 'Downloads') },
    ],
  }
}

export const convertAction: Action = {
  id: 'convert',
  label: 'Convert',
  hint: 'to another format',

  appliesTo: () => true,

  options(source, values) {
    const specs: OptionSpec[] = [targetSelect(source)]

    const target = values.target
    if (typeof target !== 'string') return specs

    const spec = FORMATS[target as FormatId]
    if (spec?.lossy) {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: DEFAULT_QUALITY,
      })
    }

    specs.push(destinationPath(source))
    return specs
  },

  plan(source, values) {
    const target = values.target as FormatId
    const spec = FORMATS[target]

    const options: ConvertOptions = {
      background: '#ffffff',
      keepMetadata: false,
    }
    if (spec?.lossy && typeof values.quality === 'number') options.quality = values.quality

    const destination = typeof values.destination === 'string' ? values.destination : undefined
    const output = resolveOutputPath({
      sourcePath: source.path,
      target,
      ...(destination === undefined ? {} : { output: `${destination}/` }),
    })

    return [{ source, target, output, options }]
  },
}

export const ACTIONS: Action[] = [convertAction]

export function actionsFor(source: SourceInfo): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(source))
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Verify the layering invariant still holds**

```bash
grep -rE "from 'ink'|from 'react'" src/core/ src/engines/ && echo "VIOLATION" || echo "core and engines still UI-free"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): action layer describing steps as data"
```

---

### Task 6: Theme and the Select component

`Select` is the workhorse — the format picker, the destination presets, and any future action menu are all this component.

**Files:**
- Create: `src/shell/theme.ts`, `src/shell/components/Select.tsx`
- Delete: `src/shell/components/Hello.tsx` (Task 1 scaffolding, no longer needed)
- Test: `tests/shell/select.test.tsx`

**Interfaces:**
- Consumes: `Choice` from `core/actions.js`
- Produces:
  - `theme.ts`: `SYMBOLS = { ok: '✓', fail: '✕', warn: '⚠', cursor: '❯' }`, `colourEnabled(): boolean`
  - `Select.tsx`: `<Select items={Choice[]} onSubmit={(value: string) => void} onCancel?={() => void} showHints?={boolean} />`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/select.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Choice } from '../../src/core/actions.js'
import { Select } from '../../src/shell/components/Select.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const ENTER = String.fromCharCode(13)
const ESCAPE = ESC

const items: Choice[] = [
  { value: 'webp', label: 'WebP', hint: 'smaller, modern' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
  { value: 'avif', label: 'AVIF', hint: 'smallest' },
]

const settle = () => new Promise((r) => setTimeout(r, 60))

describe('Select', () => {
  it('marks the first item with a cursor and bold, not colour alone', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('❯ WebP')
    expect(frame).toContain('  PNG')
  })

  it('shows each choice hint', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    expect(lastFrame()).toContain('smaller, modern')
  })

  it('moves the cursor down', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toContain('❯ PNG')
  })

  it('moves the cursor up', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(UP)
    await settle()
    expect(lastFrame()).toContain('❯ WebP')
  })

  it('stops at the ends rather than wrapping', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(UP)
    await settle()
    expect(lastFrame()).toContain('❯ WebP')
    stdin.write(DOWN + DOWN + DOWN + DOWN)
    await settle()
    expect(lastFrame()).toContain('❯ AVIF')
  })

  it('submits the highlighted value on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={onSubmit} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('png')
  })

  it('cancels on escape when a handler is given', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={() => {}} onCancel={onCancel} />)
    stdin.write(ESCAPE)
    await settle()
    expect(onCancel).toHaveBeenCalled()
  })

  it('hides hints when asked, for narrow terminals', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} showHints={false} />)
    expect(lastFrame()).not.toContain('smaller, modern')
    expect(lastFrame()).toContain('WebP')
  })

  it('renders nothing rather than crashing on an empty list', () => {
    const { lastFrame } = render(<Select items={[]} onSubmit={() => {}} />)
    expect(lastFrame()).toBe('')
  })

  it('reports the highlighted index so a parent can preview it', async () => {
    const onHighlight = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={() => {}} onHighlight={onHighlight} />)
    stdin.write(DOWN)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(1)
    stdin.write(UP)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(0)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/select.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/shell/theme.ts`**

```ts
/**
 * Symbols are paired with words at every call site so meaning survives a
 * monochrome terminal — colour is an accent, never the carrier.
 */
export const SYMBOLS = {
  ok: '✓',
  fail: '✕',
  warn: '⚠',
  cursor: '❯',
  arrow: '→',
} as const

export const COLOURS = {
  ok: 'green',
  fail: 'red',
  warn: 'yellow',
  muted: 'gray',
  accent: 'cyan',
} as const

/** Honours NO_COLOR (https://no-color.org) and non-TTY output. */
export function colourEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  return process.stdout.isTTY === true
}
```

- [ ] **Step 4: Write `src/shell/components/Select.tsx`**

```tsx
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { Choice } from '../../core/actions.js'
import { SYMBOLS } from '../theme.js'

interface SelectProps {
  items: Choice[]
  onSubmit: (value: string) => void
  onCancel?: () => void
  showHints?: boolean
  /** Fires whenever the cursor moves, so a parent can preview the highlighted item. */
  onHighlight?: (index: number) => void
}

export function Select({
  items, onSubmit, onCancel, showHints = true, onHighlight,
}: SelectProps) {
  const [index, setIndex] = useState(0)

  const move = (next: number) => {
    setIndex(next)
    if (onHighlight) onHighlight(next)
  }

  useInput((_input, key) => {
    if (items.length === 0) return
    if (key.downArrow) move(Math.min(index + 1, items.length - 1))
    if (key.upArrow) move(Math.max(index - 1, 0))
    if (key.return) {
      const item = items[index]
      if (item) onSubmit(item.value)
    }
    if (key.escape && onCancel) onCancel()
  })

  if (items.length === 0) return null

  const width = Math.max(...items.map((i) => i.label.length))

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const selected = i === index
        return (
          <Text key={item.value}>
            <Text bold={selected}>
              {selected ? `${SYMBOLS.cursor} ` : '  '}
              {item.label.padEnd(width)}
            </Text>
            {showHints && item.hint ? <Text dimColor>{'  ' + item.hint}</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}
```

- [ ] **Step 5: Delete the Task 1 scaffolding**

```bash
rm src/shell/components/Hello.tsx tests/shell/toolchain.test.tsx
```

Its job was to prove the toolchain works; `select.test.tsx` now proves that and more.

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run tests/shell/select.test.tsx`
Expected: PASS, 9 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shell): theme tokens and the Select component"
```

---

### Task 7: Slider component

**Files:**
- Create: `src/shell/components/Slider.tsx`
- Test: `tests/shell/slider.test.tsx`

**Interfaces:**
- Consumes: `SYMBOLS` from `../theme.js`
- Produces: `<Slider label min max step value onChange onSubmit onCancel? />` where `onChange: (n: number) => void` and `onSubmit: (n: number) => void`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/slider.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from '../../src/shell/components/Slider.js'

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)

const settle = () => new Promise((r) => setTimeout(r, 60))

function base(over: Partial<Parameters<typeof Slider>[0]> = {}) {
  return {
    label: 'Quality', min: 1, max: 100, step: 5, value: 80,
    onChange: () => {}, onSubmit: () => {}, ...over,
  }
}

describe('Slider', () => {
  it('shows the label and the current value as a number, not just a bar', () => {
    const { lastFrame } = render(<Slider {...base()} />)
    expect(lastFrame()).toContain('Quality')
    expect(lastFrame()).toContain('80')
  })

  it('draws a filled and unfilled bar', () => {
    const frame = render(<Slider {...base()} />).lastFrame() ?? ''
    expect(frame).toContain('━')
    expect(frame).toContain('●')
  })

  it('increases by one step on right arrow', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange })} />)
    stdin.write(RIGHT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(85)
  })

  it('decreases by one step on left arrow', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange })} />)
    stdin.write(LEFT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('clamps at the maximum', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ value: 99, onChange })} />)
    stdin.write(RIGHT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(100)
  })

  it('clamps at the minimum', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ value: 3, onChange })} />)
    stdin.write(LEFT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('submits the current value on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Slider {...base({ onSubmit })} />)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(80)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/slider.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/shell/components/Slider.tsx`**

```tsx
import { Box, Text, useInput } from 'ink'

interface SliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  onSubmit: (value: number) => void
  onCancel?: () => void
  width?: number
}

const FILLED = '━'
const EMPTY = '━'
const KNOB = '●'

export function Slider({
  label, min, max, step, value, onChange, onSubmit, onCancel, width = 20,
}: SliderProps) {
  useInput((_input, key) => {
    if (key.rightArrow) onChange(Math.min(max, value + step))
    if (key.leftArrow) onChange(Math.max(min, value - step))
    if (key.return) onSubmit(value)
    if (key.escape && onCancel) onCancel()
  })

  const ratio = (value - min) / (max - min)
  const filled = Math.round(ratio * (width - 1))

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Text>
        <Text>{FILLED.repeat(filled)}</Text>
        <Text bold>{KNOB}</Text>
        <Text dimColor>{EMPTY.repeat(Math.max(0, width - 1 - filled))}</Text>
        <Text>{' ' + value}</Text>
      </Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/shell/slider.test.tsx`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): quality slider component"
```

---

### Task 8: PathInput component

**Files:**
- Create: `src/shell/components/PathInput.tsx`
- Test: `tests/shell/path-input.test.tsx`

**Interfaces:**
- Consumes: `PathPreset` from `core/actions.js`, `Select` from `./Select.js`, `unescapePath` from `utils/unescape-path.js`
- Produces: `<PathInput label presets preview onSubmit onCancel? />` where `preview: (path: string) => string` renders the resolved output filename and `onSubmit: (path: string) => void`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/path-input.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { PathPreset } from '../../src/core/actions.js'
import { PathInput } from '../../src/shell/components/PathInput.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = () => new Promise((r) => setTimeout(r, 60))

const presets: PathPreset[] = [
  { label: 'Same folder', path: '/Users/me/Desktop' },
  { label: 'New subfolder', path: '/Users/me/Desktop/converted' },
  { label: 'Downloads', path: '/Users/me/Downloads' },
]

const preview = (p: string) => `${p}/photo.webp`

describe('PathInput', () => {
  it('lists the presets plus a typing option', () => {
    const frame = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={() => {}} />,
    ).lastFrame() ?? ''
    expect(frame).toContain('Same folder')
    expect(frame).toContain('New subfolder')
    expect(frame).toContain('Downloads')
    expect(frame).toContain('Type a path')
  })

  it('shows the resolved output for the highlighted preset', () => {
    const frame = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={() => {}} />,
    ).lastFrame() ?? ''
    expect(frame).toContain('/Users/me/Desktop/photo.webp')
  })

  it('updates the preview as the highlight moves', async () => {
    const { stdin, lastFrame } = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={() => {}} />,
    )
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toContain('/Users/me/Desktop/converted/photo.webp')
  })

  it('submits the chosen preset path', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={onSubmit} />,
    )
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/Desktop/converted')
  })

  it('switches to a text field when the typing option is chosen', async () => {
    const { stdin, lastFrame } = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={() => {}} />,
    )
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('›')
  })

  it('unescapes a dropped path typed into the field', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PathInput label="Save to" presets={presets} preview={preview} onSubmit={onSubmit} />,
    )
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('/Users/me/My\\ Folder')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/path-input.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/shell/components/PathInput.tsx`**

```tsx
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { Choice, PathPreset } from '../../core/actions.js'
import { unescapePath } from '../../utils/unescape-path.js'
import { SYMBOLS } from '../theme.js'
import { Select } from './Select.js'

const TYPE_IT = '__type__'

interface PathInputProps {
  label: string
  presets: PathPreset[]
  preview: (path: string) => string
  onSubmit: (path: string) => void
  onCancel?: () => void
}

export function PathInput({ label, presets, preview, onSubmit, onCancel }: PathInputProps) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState(0)

  const items: Choice[] = [
    ...presets.map((p) => ({ value: p.path, label: p.label, hint: p.path })),
    { value: TYPE_IT, label: 'Type a path…' },
  ]

  useInput(
    (input, key) => {
      if (key.escape) {
        if (onCancel) onCancel()
        return
      }
      if (key.return) {
        onSubmit(unescapePath(text))
        return
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1))
        return
      }
      if (input) setText((t) => t + input)
    },
    { isActive: typing },
  )

  if (typing) {
    return (
      <Box flexDirection="column">
        <Text>{label}</Text>
        <Text>
          {SYMBOLS.cursor === '❯' ? '› ' : '> '}
          {text}
        </Text>
      </Box>
    )
  }

  const highlighted = items[highlight]
  const showPreview = highlighted && highlighted.value !== TYPE_IT

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Select
        items={items}
        onHighlight={setHighlight}
        onSubmit={(value) => {
          if (value === TYPE_IT) setTyping(true)
          else onSubmit(value)
        }}
        {...(onCancel ? { onCancel } : {})}
      />
      {showPreview ? (
        <Text dimColor>
          {'  '}
          {SYMBOLS.arrow} {preview(highlighted.value)}
        </Text>
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/shell/path-input.test.tsx`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): destination picker with presets and preview"
```

---

### Task 9: FileCard, Hints and history blocks

**Files:**
- Create: `src/shell/components/FileCard.tsx`, `src/shell/components/Hints.tsx`, `src/shell/blocks.tsx`
- Test: `tests/shell/blocks.test.tsx`

**Interfaces:**
- Consumes: `SourceInfo`, `Result` from `core/types.js`; `formatBytes`, `percentChange` from `core/units.js`; `FORMATS` from `core/formats.js`; `fileLink` from `../hyperlink.js`; `SYMBOLS` from `../theme.js`; `middleEllipsis` from `../width.js`
- Produces:
  - `<FileCard source={SourceInfo} width={number} />`
  - `<Hints pairs={Array<[string, string]>} />`
  - `type HistoryBlock` — a discriminated union on `kind`: `'file' | 'result' | 'error' | 'note'`
  - `<HistoryEntry block={HistoryBlock} width={number} />`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/blocks.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { fileNotFound } from '../../src/core/errors.js'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { HistoryEntry, type HistoryBlock } from '../../src/shell/blocks.js'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { Hints } from '../../src/shell/components/Hints.js'

const source: SourceInfo = {
  path: '/Users/me/Desktop/photo.jpg',
  format: 'jpeg', width: 3024, height: 4032, bytes: 4_200_000,
  hasAlpha: false, frames: 1,
}

describe('FileCard', () => {
  it('shows name, size, format and dimensions', () => {
    const frame = render(<FileCard source={source} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('4.2 MB')
    expect(frame).toContain('JPEG')
    expect(frame).toContain('3024×4032')
  })

  it('drops the dimensions in a compact terminal', () => {
    const frame = render(<FileCard source={source} width={40} />).lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).not.toContain('3024×4032')
  })
})

describe('Hints', () => {
  it('pairs each key with what it does', () => {
    const frame = render(
      <Hints pairs={[['↑↓', 'choose'], ['↵', 'confirm'], ['esc', 'back']]} />,
    ).lastFrame() ?? ''
    expect(frame).toContain('↑↓')
    expect(frame).toContain('choose')
    expect(frame).toContain('esc')
  })
})

describe('HistoryEntry', () => {
  it('renders a result with a symbol AND a word, both sizes and the change', () => {
    const result: Result = {
      job: {
        source, target: 'webp', output: '/Users/me/Desktop/photo.webp',
        options: { background: '#ffffff', keepMetadata: false },
      },
      outputBytes: 820_000,
      warnings: [],
    }
    const block: HistoryBlock = { kind: 'result', id: 'r1', result }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('✓')
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('photo.webp')
    expect(frame).toContain('4.2 MB')
    expect(frame).toContain('820 KB')
    expect(frame).toContain('80.5% smaller')
  })

  it('renders a warning alongside a successful result', () => {
    const result: Result = {
      job: {
        source, target: 'png', output: '/Users/me/Desktop/photo.png',
        options: { background: '#ffffff', keepMetadata: false },
      },
      outputBytes: 100,
      warnings: [{ code: 'animation-flattened', message: 'only the first frame was converted.' }],
    }
    const frame = render(
      <HistoryEntry block={{ kind: 'result', id: 'r2', result }} width={80} />,
    ).lastFrame() ?? ''
    expect(frame).toContain('⚠')
    expect(frame).toContain('only the first frame')
  })

  it('renders an error with its title, detail and hint', () => {
    const block: HistoryBlock = { kind: 'error', id: 'e1', error: fileNotFound('/a/ghost.jpg') }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('✕')
    expect(frame).toContain('File not found')
    expect(frame).toContain('ghost.jpg')
    expect(frame).toContain('Check the filename')
  })

  it('renders a plain note', () => {
    const frame = render(
      <HistoryEntry block={{ kind: 'note', id: 'n1', text: 'Converting 4 files' }} width={80} />,
    ).lastFrame() ?? ''
    expect(frame).toContain('Converting 4 files')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/blocks.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `src/shell/components/FileCard.tsx`**

```tsx
import { Text } from 'ink'
import { FORMATS } from '../../core/formats.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { bandFor, middleEllipsis } from '../width.js'

export function FileCard({ source, width }: { source: SourceInfo; width: number }) {
  const band = bandFor(width)
  const name = source.path.split('/').pop() ?? source.path
  const parts = [middleEllipsis(name, Math.max(12, width - 30)), formatBytes(source.bytes)]

  if (band !== 'compact') {
    parts.push(`${FORMATS[source.format].label} ${source.width}×${source.height}`)
  }

  return <Text>{parts.join(' · ')}</Text>
}
```

- [ ] **Step 4: Write `src/shell/components/Hints.tsx`**

```tsx
import { Text } from 'ink'

/** Each key is paired with a word, so the line reads in monochrome. */
export function Hints({ pairs }: { pairs: Array<[string, string]> }) {
  return (
    <Text dimColor>
      {pairs.map(([key, what]) => `${key} ${what}`).join(' · ')}
    </Text>
  )
}
```

- [ ] **Step 5: Write `src/shell/blocks.tsx`**

```tsx
import { Box, Text } from 'ink'
import { basename } from 'node:path'
import type { ForgeError } from '../core/errors.js'
import type { Result, SourceInfo } from '../core/types.js'
import { formatBytes, percentChange } from '../core/units.js'
import { FileCard } from './components/FileCard.js'
import { SYMBOLS } from './theme.js'

export type HistoryBlock =
  | { kind: 'file'; id: string; source: SourceInfo }
  | { kind: 'result'; id: string; result: Result }
  | { kind: 'error'; id: string; error: ForgeError }
  | { kind: 'note'; id: string; text: string }

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

export function HistoryEntry({ block, width }: { block: HistoryBlock; width: number }) {
  if (block.kind === 'file') {
    return (
      <Box marginBottom={1}>
        <FileCard source={block.source} width={width} />
      </Box>
    )
  }

  if (block.kind === 'note') {
    return (
      <Box marginBottom={1}>
        <Text>{block.text}</Text>
      </Box>
    )
  }

  if (block.kind === 'error') {
    const e = block.error
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red">
          {SYMBOLS.fail} {e.title}
        </Text>
        <Text>{'  ' + e.detail}</Text>
        {e.hint ? <Text dimColor>{'  ' + e.hint}</Text> : null}
      </Box>
    )
  }

  const { job, outputBytes, warnings } = block.result
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="green">
        {SYMBOLS.ok} {basename(job.source.path)} {SYMBOLS.arrow} {basename(job.output)}
      </Text>
      <Text dimColor>
        {'  '}
        {formatBytes(job.source.bytes)} {SYMBOLS.arrow} {formatBytes(outputBytes)} ·{' '}
        {changePhrase(job.source.bytes, outputBytes)}
      </Text>
      {warnings.map((w) => (
        <Text key={w.message} color="yellow">
          {SYMBOLS.warn} {w.message}
        </Text>
      ))}
    </Box>
  )
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run tests/shell/blocks.test.tsx`
Expected: PASS, 7 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shell): file card, hints and history blocks"
```

---

### Task 10: The flow — file to format to options

This is the state machine. Everything before it was parts; this is the product.

**Files:**
- Create: `src/shell/components/Prompt.tsx`, `src/shell/App.tsx`
- Test: `tests/shell/app-flow.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–9; `probe` from `engines/registry.js`; `actionsFor`, `convertAction` from `core/actions.js`
- Produces:
  - `<Prompt value onChange onSubmit placeholder />`
  - `<App initialWidth?={number} />`
  - `type Stage = 'idle' | 'target' | 'quality' | 'destination' | 'converting' | 'result'`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/app-flow.test.tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

describe('shell flow', () => {
  it('starts by asking for a file', () => {
    const frame = render(<App initialWidth={80} />).lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('probes a typed path and shows what the file is', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('JPEG')
  })

  it('offers targets derived from the file, never a fixed list, and never heic', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Convert to')
    expect(frame).toContain('WebP')
    expect(frame).toContain('PNG')
    expect(frame).not.toContain('HEIC')
  })

  it('reports a bad path as a readable error and stays usable', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write('/definitely/not/here.jpg')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✕')
    expect(frame).toContain('File not found')
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('unescapes a dropped path with a space in it', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'my photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${dir}/my\\ photo.jpg`)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame()).toContain('my photo.jpg')
  })

  it('shows a quality slider after choosing a lossy target', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    stdin.write(DOWN + DOWN)    // targets are ordered jpeg, png, webp… so reach webp
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('Quality')
  })

  it('skips the quality slider for a lossless target', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    stdin.write(DOWN)           // move to png
    await settle()
    stdin.write(ENTER)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('Quality')
    expect(frame).toContain('Save to')
  })
})
```

Note the target order comes from the capability graph. If `webp` is not first for a JPEG source, adjust which key presses select it rather than changing the graph — the ordering is the registry's, deliberately.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/app-flow.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `src/shell/components/Prompt.tsx`**

```tsx
import { Box, Text, useInput } from 'ink'

interface PromptProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  isActive: boolean
  bordered: boolean
}

export function Prompt({ value, onChange, onSubmit, placeholder, isActive, bordered }: PromptProps) {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit(value)
        return
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1))
        return
      }
      if (input && !key.escape) onChange(value + input)
    },
    { isActive },
  )

  const body = (
    <Text>
      <Text dimColor>{'› '}</Text>
      {value ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>}
    </Text>
  )

  if (!bordered) return <Box>{body}</Box>

  return (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      {body}
    </Box>
  )
}
```

- [ ] **Step 4: Write `src/shell/App.tsx`**

```tsx
import { Box, Static, Text, useStdout } from 'ink'
import { useCallback, useMemo, useState } from 'react'
import { type OptionSpec, convertAction } from '../core/actions.js'
import { isForgeError } from '../core/errors.js'
import { primaryExtension } from '../core/formats.js'
import type { FormatId, Result, SourceInfo } from '../core/types.js'
import { probe } from '../engines/registry.js'
import { type HistoryBlock, HistoryEntry } from './blocks.js'
import { Hints } from './components/Hints.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { bandFor } from './width.js'

export type Stage = 'idle' | 'target' | 'quality' | 'destination' | 'converting' | 'result'

let blockSeq = 0
const nextId = () => `b${++blockSeq}`

export function App({ initialWidth }: { initialWidth?: number }) {
  const { stdout } = useStdout()
  const width = initialWidth ?? stdout?.columns ?? 80
  const band = bandFor(width)

  const [history, setHistory] = useState<HistoryBlock[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [text, setText] = useState('')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})

  const push = useCallback((block: HistoryBlock) => {
    setHistory((h) => [...h, block])
  }, [])

  const specs: OptionSpec[] = useMemo(
    () => (source ? convertAction.options(source, values) : []),
    [source, values],
  )

  const specFor = (id: string) => specs.find((s) => s.id === id)

  const submitPath = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      setText('')
      try {
        const info = await probe(trimmed)
        setSource(info)
        setValues({})
        push({ kind: 'file', id: nextId(), source: info })
        setStage('target')
      } catch (e) {
        if (isForgeError(e)) push({ kind: 'error', id: nextId(), error: e })
        else throw e
        setStage('idle')
      }
    },
    [push],
  )

  const chooseTarget = (target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = convertAction.options(source!, { target })
    setStage(next.some((s) => s.id === 'quality') ? 'quality' : 'destination')
  }

  const chooseQuality = (quality: number) => {
    setValues((v) => ({ ...v, quality }))
    setStage('destination')
  }

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(block) => <HistoryEntry key={block.id} block={block} width={width} />}
      </Static>

      {stage === 'target' && specFor('target')?.kind === 'select' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{(specFor('target') as Extract<OptionSpec, { kind: 'select' }>).label}</Text>
          <Select
            items={(specFor('target') as Extract<OptionSpec, { kind: 'select' }>).choices}
            onSubmit={chooseTarget}
            onCancel={() => setStage('idle')}
            showHints={band !== 'compact'}
          />
          <Hints pairs={[['↑↓', 'choose'], ['↵', 'confirm'], ['esc', 'back']]} />
        </Box>
      ) : null}

      {stage === 'quality' && specFor('quality')?.kind === 'slider' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Slider
            {...(specFor('quality') as Extract<OptionSpec, { kind: 'slider' }>)}
            value={
              typeof values.quality === 'number'
                ? values.quality
                : (specFor('quality') as Extract<OptionSpec, { kind: 'slider' }>).default
            }
            onChange={(q) => setValues((v) => ({ ...v, quality: q }))}
            onSubmit={chooseQuality}
            onCancel={() => setStage('target')}
          />
          <Hints pairs={[['←→', 'adjust'], ['↵', 'confirm'], ['esc', 'back']]} />
        </Box>
      ) : null}

      {stage === 'destination' && specFor('destination')?.kind === 'path' ? (
        <Box flexDirection="column" marginBottom={1}>
          <PathInput
            label={(specFor('destination') as Extract<OptionSpec, { kind: 'path' }>).label}
            presets={(specFor('destination') as Extract<OptionSpec, { kind: 'path' }>).presets}
            preview={(p) =>
              source && typeof values.target === 'string'
                ? `${p}/${(source.path.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '')}${primaryExtension(values.target as FormatId)}`
                : p
            }
            onSubmit={() => setStage('converting')}
            onCancel={() => setStage('target')}
          />
        </Box>
      ) : null}

      {stage === 'idle' ? (
        <Box flexDirection="column">
          <Prompt
            value={text}
            onChange={setText}
            onSubmit={submitPath}
            placeholder="drop a file or type a path"
            isActive
            bordered={band !== 'compact'}
          />
          <Hints pairs={[['↵', 'send'], ['ctrl-c', 'quit']]} />
        </Box>
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run tests/shell/app-flow.test.tsx`
Expected: PASS, 7 tests

The `source!` non-null assertion in `chooseTarget` is safe because the target stage is only reachable with a source, but Biome may warn. Restructure to take `source` as a parameter rather than suppressing the rule.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shell): flow from file drop through format and options"
```

---

### Task 11: Convert, result, and the result keybindings

**Files:**
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/app-convert.test.tsx`

**Interfaces:**
- Consumes: `runJobs` from `core/run.js`; `buildPlan` is **not** used here — the action's `plan()` already produced the jobs
- Produces: the `converting` and `result` stages, plus `f` / `o` / `↵` / `q` handling

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/app-convert.test.tsx
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

async function driveToResult() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const app = render(<App initialWidth={80} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)   // submit path
  await settle(300)
  app.stdin.write(DOWN + DOWN)  // jpeg, png, webp… reach webp. Accepting the first
  await settle()                // (jpeg) would write photo.jpg over the input and
  app.stdin.write(ENTER)        // fail as output-is-input.
  await settle()
  app.stdin.write(ENTER)   // accept quality
  await settle()
  app.stdin.write(ENTER)   // accept "Same folder"
  await settle(600)        // conversion
  return { ...app, dir }
}

describe('shell conversion', () => {
  it('converts and writes the file', async () => {
    const { dir } = await driveToResult()
    expect(existsSync(join(dir, 'photo.webp'))).toBe(true)
  })

  it('shows the result with both sizes and the change', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✓')
    expect(frame).toContain('photo.webp')
    expect(frame).toMatch(/smaller|larger|same size/)
  })

  it('offers the result keybindings', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('convert another')
    expect(frame).toContain('open')
    expect(frame).toContain('reveal')
  })

  it('returns to the prompt on enter so you can convert another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('keeps the previous result in history after converting another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('photo.webp')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/app-convert.test.tsx`
Expected: FAIL — the destination step currently jumps to `converting` and nothing happens there

- [ ] **Step 3: Add conversion to `src/shell/App.tsx`**

Add these imports. `useApp` and `useInput` join the existing `ink` import line — Task 10 deliberately left them out because nothing used them yet, and an unused import fails lint:

```tsx
import { useApp, useInput } from 'ink'
import { runJobs } from '../core/run.js'
import { openPath, revealPath } from './reveal.js'
import { fileLink } from './hyperlink.js'
```

Add state for the finished result:

```tsx
const [lastResult, setLastResult] = useState<Result | null>(null)
```

Replace the `PathInput`'s `onSubmit` with one that runs the conversion:

```tsx
onSubmit={async (destination) => {
  if (!source) return
  setStage('converting')
  const jobs = convertAction.plan(source, { ...values, destination })
  const summary = await runJobs(jobs, {})
  const result = summary.results[0]
  if (result) {
    setLastResult(result)
    push({ kind: 'result', id: nextId(), result })
    setStage('result')
  } else {
    const failure = summary.failures[0]
    if (failure) push({ kind: 'error', id: nextId(), error: failure.error })
    setStage('idle')
  }
}}
```

Add the converting and result stages before the `idle` block:

```tsx
{stage === 'converting' ? (
  <Box marginBottom={1}>
    <Text dimColor>Converting…</Text>
  </Box>
) : null}

{stage === 'result' && lastResult ? (
  <Box flexDirection="column" marginBottom={1}>
    <Text>
      {fileLink('Open file', lastResult.job.output)}
      {'  ·  '}
      {fileLink('Reveal in Finder', lastResult.job.output.replace(/\/[^/]+$/, ''))}
    </Text>
    <Hints
      pairs={[['↵', 'convert another'], ['f', 'open'], ['o', 'reveal'], ['q', 'quit']]}
    />
  </Box>
) : null}
```

Add the result-stage key handling near the top of the component:

```tsx
const { exit } = useApp()

useInput(
  (input, key) => {
    if (!lastResult) return
    if (key.return) {
      setSource(null)
      setValues({})
      setLastResult(null)
      setStage('idle')
      return
    }
    if (input === 'f') void openPath(lastResult.job.output)
    if (input === 'o') void revealPath(lastResult.job.output)
    if (input === 'q') exit()
  },
  { isActive: stage === 'result' },
)
```

Note the conversion shows a static "Converting…" rather than a percentage. Sharp gives no per-image progress, and inventing one is forbidden by the spec.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/shell/app-convert.test.tsx`
Expected: PASS, 5 tests

- [ ] **Step 5: Run everything**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shell): conversion, result screen and its keybindings"
```

---

### Task 12: Launch wiring

**Files:**
- Create: `src/shell/launch.tsx`
- Modify: `src/cli/execute.ts`, `src/index.ts`
- Test: `tests/cli/shell-launch.test.ts`

**Interfaces:**
- Consumes: `App` from `./App.js`
- Produces: `launchShell(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/shell-launch.test.ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'

describe('shell intent', () => {
  it('bare forge still parses to the shell intent', () => {
    expect(parseArgs([])).toEqual({ kind: 'shell' })
  })

  it('execute no longer treats the shell as an error', async () => {
    const out = await execute({ kind: 'shell' })
    expect(out.exitCode).toBe(0)
    expect(out.stderr.join('\n')).not.toContain('not built yet')
  })

  it('flag invocations are untouched by the shell existing', async () => {
    const out = await execute(parseArgs(['--formats']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('HEIC')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/cli/shell-launch.test.ts`
Expected: FAIL — `execute` returns exit 2 with "not built yet"

- [ ] **Step 3: Write `src/shell/launch.tsx`** (`.tsx`, not `.ts` — it contains JSX; import it as `./launch.js`)

```ts
import { render } from 'ink'
import { App } from './App.js'

/** Renders the shell and resolves when the user exits it. */
export async function launchShell(): Promise<void> {
  const instance = render(<App />)
  await instance.waitUntilExit()
}
```

- [ ] **Step 4: Update `src/cli/execute.ts`**

Replace the `shell` branch so it no longer reports an error:

```ts
if (intent.kind === 'shell') {
  return { exitCode: 0, stdout: [], stderr: [] }
}
```

`execute` does not launch the shell — it returns data, and `src/index.ts` decides. That keeps `execute` testable and keeps the TTY decision in the one file that already owns printing.

- [ ] **Step 5: Update `src/index.ts`**

In `main`, after parsing, replace the non-TTY guard block with:

```ts
if (intent.kind === 'shell') {
  if (!process.stdout.isTTY) {
    process.stderr.write('Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n')
    process.exitCode = 2
    return
  }
  const { launchShell } = await import('./shell/launch.js')
  await launchShell()
  return
}
```

The dynamic import keeps Ink and React out of the startup path for flag invocations, so `forge photo.jpg --to webp` stays fast.

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run tests/cli/shell-launch.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 7: Verify the non-interactive guard by hand**

```bash
npm run build
node dist/index.js | cat ; echo "exit=$?"
```

Expected: the hint, exit 2, and **no hang**. If it hangs, the TTY check is wrong and that is a release blocker.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(shell): launch from bare forge on a tty"
```

---

### Task 13: Responsiveness, monochrome and resize

**Files:**
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/responsive.test.tsx`

**Interfaces:**
- Consumes: `bandFor` from `./width.js`, `colourEnabled` from `./theme.js`
- Produces: no new exports; behaviour only

- [ ] **Step 1: Write the failing test**

```tsx
// tests/shell/responsive.test.tsx
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { colourEnabled } from '../../src/shell/theme.js'

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const originalNoColor = process.env.NO_COLOR

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = originalNoColor
})

describe('responsiveness', () => {
  it('drops the prompt border in a compact terminal', () => {
    const narrow = render(<App initialWidth={40} />).lastFrame() ?? ''
    const normal = render(<App initialWidth={80} />).lastFrame() ?? ''
    expect(normal).toContain('╭')
    expect(narrow).not.toContain('╭')
  })

  it('never emits a line wider than the terminal', () => {
    for (const w of [40, 60, 80, 120]) {
      const frame = render(<App initialWidth={w} />).lastFrame() ?? ''
      for (const line of frame.split('\n')) {
        // eslint-disable-next-line no-control-regex
        const visible = line.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
        expect(visible.length).toBeLessThanOrEqual(w)
      }
    }
  })
})

describe('colour', () => {
  it('is disabled when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1'
    expect(colourEnabled()).toBe(false)
  })

  it('is disabled when stdout is not a tty', () => {
    delete process.env.NO_COLOR
    expect(colourEnabled()).toBe(process.stdout.isTTY === true)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/shell/responsive.test.tsx`
Expected: FAIL on the width assertion, since nothing truncates yet

- [ ] **Step 3: Add resize handling and width clamping to `App.tsx`**

Replace the width derivation with state that follows the terminal:

```tsx
const { stdout } = useStdout()
const [measured, setMeasured] = useState(initialWidth ?? stdout?.columns ?? 80)

useEffect(() => {
  if (initialWidth !== undefined || !stdout) return
  const onResize = () => setMeasured(stdout.columns ?? 80)
  stdout.on('resize', onResize)
  return () => {
    stdout.off('resize', onResize)
  }
}, [initialWidth, stdout])

const width = measured
```

Add `useEffect` to the React import. Then pass `width` down to every child that renders a path or a label, and use `middleEllipsis` in `FileCard` (already done in Task 9) and in the destination preview.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/shell/responsive.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Run everything**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shell): width bands, resize handling and NO_COLOR"
```

---

### Task 14: Manual verification and README

**Files:**
- Modify: `README.md`
- Test: manual, recorded below

- [ ] **Step 1: Build and link**

```bash
npm run build && chmod +x dist/index.js && npm link
```

- [ ] **Step 2: Drive the shell by hand in a real terminal**

```bash
cd /tmp && mkdir -p forge-shell-check && cd forge-shell-check
node -e "require('sharp')({create:{width:1600,height:1200,channels:3,background:'#4488cc'}}).jpeg({quality:95}).toFile('sample.jpg')"
forge
```

Then, in the shell: drag `sample.jpg` from Finder into the terminal and press Enter. Confirm each of these, and record what you actually saw:

- the file card shows name, size, format and dimensions
- the format list appears, `❯` marks the selection, HEIC is absent
- arrow keys move the selection and Enter accepts it
- choosing WebP shows the quality slider; choosing PNG skips it
- the destination step lists Same folder / New subfolder / Downloads / Type a path…, and the preview updates as you move
- conversion produces a result line with both sizes and the percentage
- `f` opens the file, `o` reveals it in Finder, `↵` returns to the prompt with the previous result still in scrollback, `q` quits
- scrolling up in the terminal shows the committed history intact — this is what `<Static>` buys and it is the main thing to check by eye

- [ ] **Step 3: Verify degradation**

```bash
NO_COLOR=1 forge          # readable with no colour; symbols and words still present
forge | cat               # exits 2, does not hang
```

Resize the window narrow while the shell is open and confirm the layout simplifies rather than wrapping.

- [ ] **Step 4: Update `README.md`**

Remove the "does not exist yet" language about the interactive shell and replace the roadmap entry with a usage section showing the real flow. Use terminal output you actually captured in Step 2, not invented examples. Keep the flag CLI documentation exactly as it is — it is unchanged.

- [ ] **Step 5: Final verification**

```bash
cd "/Users/atharvanayak/Developer/Convert Terminal"
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: readme covers the interactive shell"
git push -u origin dev
```

Do not merge to `main` — that is the controller's call after review.

---

## Spec coverage

| Spec section | Covered by |
| --- | --- |
| §6 actions and OptionSpec | Task 5, with the `values` parameter refinement documented in Global Constraints |
| §10 launch on TTY only | Task 12 |
| §10 flow (file → target → options → destination → convert → result) | Tasks 10, 11 |
| §10 `<Static>` rendering | Task 10, verified by eye in Task 14 Step 2 |
| §10 destination step with presets and preview | Tasks 8, 10 |
| §10 result with sizes, percentage and links | Tasks 9, 11 |
| §10 drag and drop / shell-escaped paths | Task 2, exercised through the flow in Task 10 |
| §10 OSC 8 with degradation, `f` / `o` keys | Tasks 4, 11 |
| §13 three width bands | Tasks 3, 13 |
| §13 middle-ellipsis truncation, no horizontal overflow | Tasks 3, 13 |
| §13 symbol + word pairing, `❯` and bold not colour | Tasks 6, 9 |
| §13 `NO_COLOR` and non-TTY | Tasks 6, 13 |
| §14 shell tested through its interaction | every task from 6 onward |

**Not in scope, deliberately:** the action *menu* (only one action exists, so §6 says to skip a menu of one — the data model supports it and Task 5 tests `actionsFor`), batch conversion through the shell, `/slash` commands, and a recent-files list. Each is a small addition on top of this once the single-file flow is proven.

## Carried-over debt this plan should clear if convenient

From the v0.1 final review, two items become live the moment the shell exists:

- **A throwing `onEvent` callback rejects `runJobs` and orphans in-flight workers** (`src/core/run.ts`). The shell is the first real subscriber to that stream. Wrap the `emit` call in try/catch.
- **`engineForTarget` routes on target alone**, ignoring whether the engine can read the source. Harmless with one engine; fix before a second.

Neither blocks this plan. Both are cheap while you are already in those files.
