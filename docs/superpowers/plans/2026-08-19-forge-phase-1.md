# Forge Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Forge a designed interface — two themes, an identity, framed
result blocks — plus the two pieces of user state it has never had: a chosen
theme and a default output folder.

**Architecture:** A new `src/config/` module owns a JSON preferences file and
is the only thing that touches it. `core/` never reads it — preferences are
loaded at the process edge and passed *into* `convertAction.options()` as a
parameter, preserving the invariant that `core/` performs no ambient I/O. In
the shell, a React context carries the active `Palette`; no component names a
colour directly. Everything else is rendering.

**Tech Stack:** TypeScript strict ESM · React 19 + Ink 7.1.1 · Vitest 4 ·
ink-testing-library 4 · Biome · Node 20+

**Spec:** [docs/superpowers/specs/2026-08-19-forge-phase-1-design.md](../specs/2026-08-19-forge-phase-1-design.md)
(extends [2026-08-19-forge-design.md](../specs/2026-08-19-forge-design.md))

## Global Constraints

These apply to every task. They come from `CLAUDE.md` and the specs.

- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to
  stdout. They may import *types* from `src/config/`, never its functions.
- No hardcoded list of formats anywhere. Targets come from `targetsFor(source)`;
  any format-derived list comes from `FORMATS` / `readableFormats()`.
- Sources are probed by content, never by file extension. The path-completion
  filter in Task 11 is an advisory display filter only and never decides
  whether a conversion happens.
- Writes are atomic — temp file then rename. This now includes the config file.
- Progress is never fabricated.
- Every status carries a symbol **and** a word (`✓ done`, `✕ failed`,
  `⚠ warning`). Colour is never the sole carrier of meaning.
- `NO_COLOR` and non-TTY output are honoured. `applyColourPreference()` must
  keep running before Ink is imported — see the comment in `src/shell/theme.ts`.
- Width bands from base spec §13: `< 60` compact, `60–100` normal, `> 100` wide.
  Content is truncated with `middleEllipsis`, never wrapped.
- Work on branch `dev`. Never commit to `main`.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`.

### Testing colour

Chalk fixes its colour level the first time it is imported and never
reconsults the environment, and vitest externalises `node_modules` so
`vi.resetModules()` cannot re-import it. Under `ink-testing-library` in a
normal vitest run, stdout is not a TTY, so **`lastFrame()` contains no ANSI
codes at all**.

Consequence: assert *structure* (text, glyph position, padding) in ordinary
tests. Any assertion about actual colour must run in a spawned child process
with `FORCE_COLOR` set, following the existing pattern in
`tests/helpers/colour-frame-child.ts`. Task 3 builds that helper.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/config/preferences.ts` | Load, validate, and atomically write the preferences file. The only module that knows the config path. |
| `src/cli/config-command.ts` | `forge config list/set/path` — pure string output, no shell. |
| `src/shell/ThemeContext.tsx` | React context carrying the active `Palette`. Kept out of `theme.ts` so `theme.ts` stays React-free. |
| `src/shell/components/Banner.tsx` | The anvil mark, wordmark, and status line. |
| `src/shell/components/ThemePicker.tsx` | First-run two-option theme chooser, rendered in a neutral palette. |
| `src/shell/complete.ts` | Pure path-completion logic. No React, no Ink. |
| `tests/helpers/theme-frame-child.ts` | Renders a frame with `FORCE_COLOR` in a fresh process so colour can be asserted. |

**Modified**

| File | Change |
| --- | --- |
| `src/shell/theme.ts` | Add `Palette`, `DARK`, `LIGHT`, `NEUTRAL`. Delete the dead `COLOURS`. Keep `SYMBOLS`, `colourEnabled`, `applyColourPreference` untouched. |
| `src/shell/App.tsx` | Accept `prefs`, render `Banner`, host the theme picker, handle `d`. |
| `src/shell/launch.tsx` | Load preferences, provide the theme, pass prefs down. |
| `src/shell/blocks.tsx` | Route colours through the palette; redesign result block. |
| `src/shell/components/FileCard.tsx` | Framed card with the format tag in the border. |
| `src/shell/components/Select.tsx` | Full-width selection band; takes `width`. |
| `src/shell/components/PathInput.tsx` | `default` tag, `d` key, pass `width` to `Select`. |
| `src/shell/components/Prompt.tsx` | Tab completion and match list. |
| `src/shell/components/Hints.tsx` | Palette colours. |
| `src/shell/components/Slider.tsx` | Palette colours. |
| `src/core/actions.ts` | `options()` takes `prefs`; Desktop preset; `quality` default from prefs. |
| `src/cli/args.ts` | `config` subcommand added to `Intent`. |
| `src/index.ts` | Route the `config` intent; banner on `--version`. |

---

## Task 1: Preferences module

**Files:**
- Create: `src/config/preferences.ts`
- Test: `tests/config/preferences.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Preferences {
    theme?: 'dark' | 'light'
    defaultOutput: string
    quality: number
  }
  export const DEFAULT_PREFERENCES: Preferences
  export function configPath(): string
  export function expandTilde(path: string): string
  export function loadPreferences(): Promise<{ prefs: Preferences; warning?: string }>
  export function savePreferences(patch: Partial<Preferences>): Promise<void>
  ```

`savePreferences` takes a **patch**, not a whole object: it re-reads the file,
merges the patch over the raw parsed JSON, and writes. That is what preserves
unknown keys written by a future version, and it keeps call sites to
`savePreferences({ theme: 'dark' })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/config/preferences.test.ts`:

```ts
import { mkdtemp, readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  configPath,
  expandTilde,
  loadPreferences,
  savePreferences,
} from '../../src/config/preferences.js'

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-cfg-'))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

const write = async (contents: string) => {
  await mkdir(join(dir, 'forge'), { recursive: true })
  await writeFile(join(dir, 'forge', 'config.json'), contents)
}

describe('configPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(configPath()).toBe(join(dir, 'forge', 'config.json'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME
    expect(configPath()).toBe(join(homedir(), '.config', 'forge', 'config.json'))
  })
})

describe('expandTilde', () => {
  it('expands a bare tilde', () => {
    expect(expandTilde('~')).toBe(homedir())
  })
  it('expands a leading tilde path', () => {
    expect(expandTilde('~/Desktop')).toBe(join(homedir(), 'Desktop'))
  })
  it('leaves an absolute path alone', () => {
    expect(expandTilde('/tmp/x')).toBe('/tmp/x')
  })
  it('does not expand a tilde in the middle', () => {
    expect(expandTilde('/tmp/~/x')).toBe('/tmp/~/x')
  })
})

describe('loadPreferences', () => {
  it('returns defaults with no warning when the file is missing', async () => {
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeUndefined()
  })

  it('defaults theme to undefined so the first-run picker runs', async () => {
    const { prefs } = await loadPreferences()
    expect(prefs.theme).toBeUndefined()
    expect(prefs.defaultOutput).toBe('~/Desktop')
    expect(prefs.quality).toBe(80)
  })

  it('reads a valid file', async () => {
    await write(JSON.stringify({ theme: 'light', defaultOutput: '~/Pictures', quality: 60 }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual({ theme: 'light', defaultOutput: '~/Pictures', quality: 60 })
    expect(warning).toBeUndefined()
  })

  it('falls back to defaults with a warning on unparseable JSON', async () => {
    await write('{ not json')
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeTruthy()
    expect(warning).toContain('config')
  })

  it('falls back to defaults with a warning when the root is not an object', async () => {
    await write('[1, 2, 3]')
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeTruthy()
  })

  it('drops only the invalid keys and warns, keeping the valid ones', async () => {
    await write(JSON.stringify({ theme: 'chartreuse', defaultOutput: '~/Pictures', quality: 999 }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs.theme).toBeUndefined()
    expect(prefs.quality).toBe(80)
    expect(prefs.defaultOutput).toBe('~/Pictures')
    expect(warning).toBeTruthy()
  })

  it('never throws when the file cannot be read', async () => {
    await write(JSON.stringify({ theme: 'dark' }))
    await chmod(join(dir, 'forge', 'config.json'), 0o000)
    const { prefs } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    await chmod(join(dir, 'forge', 'config.json'), 0o644)
  })
})

describe('savePreferences', () => {
  it('round-trips', async () => {
    await savePreferences({ theme: 'dark', defaultOutput: '~/Movies', quality: 42 })
    const { prefs } = await loadPreferences()
    expect(prefs).toEqual({ theme: 'dark', defaultOutput: '~/Movies', quality: 42 })
  })

  it('creates the directory when it does not exist', async () => {
    await savePreferences({ theme: 'light' })
    const raw = await readFile(join(dir, 'forge', 'config.json'), 'utf8')
    expect(JSON.parse(raw).theme).toBe('light')
  })

  it('merges a patch instead of replacing the file', async () => {
    await savePreferences({ theme: 'dark', quality: 50 })
    await savePreferences({ defaultOutput: '~/Downloads' })
    const { prefs } = await loadPreferences()
    expect(prefs.theme).toBe('dark')
    expect(prefs.quality).toBe(50)
    expect(prefs.defaultOutput).toBe('~/Downloads')
  })

  it('preserves unknown keys written by a future version', async () => {
    await write(JSON.stringify({ theme: 'dark', futureFeature: { nested: true } }))
    await savePreferences({ quality: 55 })
    const raw = JSON.parse(await readFile(join(dir, 'forge', 'config.json'), 'utf8'))
    expect(raw.futureFeature).toEqual({ nested: true })
    expect(raw.quality).toBe(55)
  })

  it('leaves no temp file behind', async () => {
    const { readdir } = await import('node:fs/promises')
    await savePreferences({ theme: 'dark' })
    const entries = await readdir(join(dir, 'forge'))
    expect(entries).toEqual(['config.json'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/config/preferences.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/preferences.js'`

- [ ] **Step 3: Implement the module**

Create `src/config/preferences.ts`:

```ts
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface Preferences {
  /**
   * Undefined means no theme has ever been chosen — the shell shows the
   * first-run picker. It is the only field that can legitimately be absent.
   */
  theme?: 'dark' | 'light'
  /** Stored with `~` unexpanded so the file survives being copied between machines. */
  defaultOutput: string
  /** The value the quality slider opens on for lossy targets. */
  quality: number
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultOutput: '~/Desktop',
  quality: 80,
}

/** Read at call time, not module load, so tests can set XDG_CONFIG_HOME per case. */
export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME
  const root = base && base.length > 0 ? base : join(homedir(), '.config')
  return join(root, 'forge', 'config.json')
}

export function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validates field by field rather than all-or-nothing: one bad key should not
 * cost the user the settings that are fine. Collects what it rejected so the
 * caller can say so once, then proceeds.
 */
function validate(raw: Record<string, unknown>): { prefs: Preferences; rejected: string[] } {
  const prefs: Preferences = { ...DEFAULT_PREFERENCES }
  const rejected: string[] = []

  if (raw.theme !== undefined) {
    if (raw.theme === 'dark' || raw.theme === 'light') prefs.theme = raw.theme
    else rejected.push('theme')
  }

  if (raw.defaultOutput !== undefined) {
    if (typeof raw.defaultOutput === 'string' && raw.defaultOutput.trim().length > 0) {
      prefs.defaultOutput = raw.defaultOutput
    } else rejected.push('defaultOutput')
  }

  if (raw.quality !== undefined) {
    const q = raw.quality
    if (typeof q === 'number' && Number.isInteger(q) && q >= 1 && q <= 100) prefs.quality = q
    else rejected.push('quality')
  }

  return { prefs, rejected }
}

/** Returns the parsed file, or undefined if it is missing, unreadable or not an object. */
async function readRaw(): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(configPath(), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Never throws and never blocks a conversion. A missing file is not a
 * problem and produces no warning; anything else that goes wrong produces
 * defaults plus a sentence the caller renders once.
 */
export async function loadPreferences(): Promise<{ prefs: Preferences; warning?: string }> {
  let text: string
  try {
    text = await readFile(configPath(), 'utf8')
  } catch (e) {
    // A file that exists but cannot be read is worth mentioning; one that was
    // never created is the normal first-run case and is silent.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { prefs: DEFAULT_PREFERENCES }
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `Could not read the config at ${configPath()} — using defaults.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `The config at ${configPath()} is not valid JSON — using defaults.`,
    }
  }

  if (!isRecord(parsed)) {
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `The config at ${configPath()} is not an object — using defaults.`,
    }
  }

  const { prefs, rejected } = validate(parsed)
  if (rejected.length === 0) return { prefs }
  return {
    prefs,
    warning: `Ignored invalid config ${rejected.length === 1 ? 'setting' : 'settings'}: ${rejected.join(', ')}.`,
  }
}

/**
 * Merges `patch` over whatever is on disk and writes atomically (invariant 6).
 * Re-reading rather than writing a whole in-memory object is what preserves
 * keys a later version of Forge may have written.
 */
export async function savePreferences(patch: Partial<Preferences>): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })

  const existing = (await readRaw()) ?? {}
  const merged: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value
  }

  const temp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    await rename(temp, path)
  } catch (e) {
    await unlink(temp).catch(() => {})
    throw e
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/config/preferences.test.ts`
Expected: PASS, all cases.

Then: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/preferences.ts tests/config/preferences.test.ts
git commit -m "feat(config): preferences file with per-key validation and atomic writes"
```

---

## Task 2: `forge config` CLI subcommand

**Files:**
- Create: `src/cli/config-command.ts`
- Modify: `src/cli/args.ts`, `src/index.ts`
- Test: `tests/cli/config-command.test.ts`

**Interfaces:**
- Consumes: `loadPreferences`, `savePreferences`, `configPath`, `Preferences` (Task 1).
- Produces:
  ```ts
  export type ConfigIntent =
    | { kind: 'config'; action: 'list' }
    | { kind: 'config'; action: 'path' }
    | { kind: 'config'; action: 'set'; key: 'output' | 'theme' | 'quality'; value: string }
  export function runConfig(intent: ConfigIntent): Promise<{ stdout: string[]; exitCode: number }>
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/config-command.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runConfig } from '../../src/cli/config-command.js'
import { loadPreferences } from '../../src/config/preferences.js'

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-cfgcmd-'))
  process.env.XDG_CONFIG_HOME = dir
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

describe('forge config', () => {
  it('list prints every setting and its value', async () => {
    const { stdout, exitCode } = await runConfig({ kind: 'config', action: 'list' })
    expect(exitCode).toBe(0)
    const text = stdout.join('\n')
    expect(text).toContain('output')
    expect(text).toContain('~/Desktop')
    expect(text).toContain('quality')
    expect(text).toContain('80')
  })

  it('list says when no theme has been chosen', async () => {
    const { stdout } = await runConfig({ kind: 'config', action: 'list' })
    expect(stdout.join('\n')).toMatch(/theme\s+not set/)
  })

  it('path prints the config location', async () => {
    const { stdout, exitCode } = await runConfig({ kind: 'config', action: 'path' })
    expect(exitCode).toBe(0)
    expect(stdout[0]).toBe(join(dir, 'forge', 'config.json'))
  })

  it('set output writes the value', async () => {
    const { exitCode } = await runConfig({
      kind: 'config', action: 'set', key: 'output', value: '~/Pictures',
    })
    expect(exitCode).toBe(0)
    expect((await loadPreferences()).prefs.defaultOutput).toBe('~/Pictures')
  })

  it('set theme writes the value', async () => {
    await runConfig({ kind: 'config', action: 'set', key: 'theme', value: 'light' })
    expect((await loadPreferences()).prefs.theme).toBe('light')
  })

  it('set quality writes a number', async () => {
    await runConfig({ kind: 'config', action: 'set', key: 'quality', value: '55' })
    expect((await loadPreferences()).prefs.quality).toBe(55)
  })

  it('rejects an invalid theme with exit code 2 and leaves config untouched', async () => {
    const { exitCode, stdout } = await runConfig({
      kind: 'config', action: 'set', key: 'theme', value: 'chartreuse',
    })
    expect(exitCode).toBe(2)
    expect(stdout.join('\n')).toContain('dark')
    expect((await loadPreferences()).prefs.theme).toBeUndefined()
  })

  it('rejects an out-of-range quality with exit code 2', async () => {
    const { exitCode } = await runConfig({
      kind: 'config', action: 'set', key: 'quality', value: '500',
    })
    expect(exitCode).toBe(2)
    expect((await loadPreferences()).prefs.quality).toBe(80)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cli/config-command.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/config-command.js'`

- [ ] **Step 3: Implement the command and wire the intent**

Create `src/cli/config-command.ts`:

```ts
import { configPath, loadPreferences, savePreferences } from '../config/preferences.js'

export type ConfigKey = 'output' | 'theme' | 'quality'

export type ConfigIntent =
  | { kind: 'config'; action: 'list' }
  | { kind: 'config'; action: 'path' }
  | { kind: 'config'; action: 'set'; key: ConfigKey; value: string }

export interface ConfigResult {
  stdout: string[]
  exitCode: number
}

/**
 * Returns lines rather than printing them, for the same reason the rest of
 * cli/ does: the caller owns the streams, so this stays testable without
 * capturing stdout.
 */
export async function runConfig(intent: ConfigIntent): Promise<ConfigResult> {
  if (intent.action === 'path') {
    return { stdout: [configPath()], exitCode: 0 }
  }

  if (intent.action === 'list') {
    const { prefs, warning } = await loadPreferences()
    const lines = [
      `output    ${prefs.defaultOutput}`,
      `theme     ${prefs.theme ?? 'not set'}`,
      `quality   ${prefs.quality}`,
      '',
      configPath(),
    ]
    if (warning) lines.unshift(`⚠ ${warning}`, '')
    return { stdout: lines, exitCode: 0 }
  }

  const { key, value } = intent

  if (key === 'theme') {
    if (value !== 'dark' && value !== 'light') {
      return { stdout: [`Theme must be dark or light, not ${value}.`], exitCode: 2 }
    }
    await savePreferences({ theme: value })
    return { stdout: [`theme is now ${value}`], exitCode: 0 }
  }

  if (key === 'quality') {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return {
        stdout: [`Quality must be a whole number between 1 and 100, not ${value}.`],
        exitCode: 2,
      }
    }
    await savePreferences({ quality: n })
    return { stdout: [`quality is now ${n}`], exitCode: 0 }
  }

  if (value.trim().length === 0) {
    return { stdout: ['Output must be a folder path.'], exitCode: 2 }
  }
  await savePreferences({ defaultOutput: value })
  return { stdout: [`output is now ${value}`], exitCode: 0 }
}
```

In `src/cli/args.ts`, add `ConfigIntent` to the `Intent` union and parse the
subcommand **before** Commander runs, since `config` is a positional that
Commander would otherwise treat as an input file. At the top of `parseArgs`:

```ts
import type { ConfigIntent, ConfigKey } from './config-command.js'

const CONFIG_KEYS: ConfigKey[] = ['output', 'theme', 'quality']

function parseConfigArgs(argv: string[]): ConfigIntent {
  const [, action, key, ...rest] = argv
  if (action === undefined || action === 'list') return { kind: 'config', action: 'list' }
  if (action === 'path') return { kind: 'config', action: 'path' }
  if (action === 'set') {
    if (key === undefined || !CONFIG_KEYS.includes(key as ConfigKey)) {
      throw invalidArguments(
        `Unknown config setting ${key ?? '(none)'}.`,
        `Try one of: ${CONFIG_KEYS.join(', ')}.`,
      )
    }
    const value = rest.join(' ')
    if (value.length === 0) {
      throw invalidArguments(`forge config set ${key} needs a value.`)
    }
    return { kind: 'config', action: 'set', key: key as ConfigKey, value }
  }
  throw invalidArguments(
    `Unknown config action ${action}.`,
    'Try: forge config list, forge config set <setting> <value>, or forge config path.',
  )
}
```

Change the `Intent` union to include `| ConfigIntent`, and make `parseArgs`
short-circuit on its first line:

```ts
export function parseArgs(argv: string[]): Intent {
  if (argv[0] === 'config') return parseConfigArgs(argv)
  const program = new Command()
  // …unchanged from here
```

In `src/index.ts`, route it inside the existing `try`, immediately after
`const intent = parseArgs(argv)` and before the `intent.kind === 'shell'`
branch:

```ts
if (intent.kind === 'config') {
  const { runConfig } = await import('./cli/config-command.js')
  const result = await runConfig(intent)
  process.stdout.write(`${result.stdout.join('\n')}\n`)
  process.exitCode = result.exitCode
  return
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cli/config-command.test.ts tests/cli/args.test.ts`
Expected: PASS. The existing `args.test.ts` must still pass — the
short-circuit only fires on a literal first argument of `config`.

Then: `npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/cli/config-command.ts src/cli/args.ts src/index.ts tests/cli/config-command.test.ts
git commit -m "feat(cli): forge config list/set/path"
```

---

## Task 3: Palettes

**Files:**
- Modify: `src/shell/theme.ts`
- Create: `tests/helpers/theme-frame-child.ts`
- Test: `tests/shell/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Palette {
    name: 'dark' | 'light' | 'neutral'
    fg: string; dim: string; accent: string
    ok: string; warn: string; fail: string
    tag: string; label: string; border: string; selectionBg: string
  }
  export const DARK: Palette
  export const LIGHT: Palette
  export const NEUTRAL: Palette
  export function paletteFor(theme: 'dark' | 'light' | undefined): Palette
  ```

`theme.ts` stays React-free — `tests/helpers/colour-frame-child.ts` imports it
before Ink loads, and that ordering is load-bearing.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, NEUTRAL, type Palette, paletteFor } from '../../src/shell/theme.js'

const KEYS: (keyof Palette)[] = [
  'name', 'fg', 'dim', 'accent', 'ok', 'warn', 'fail', 'tag', 'label', 'border', 'selectionBg',
]

describe('palettes', () => {
  it('both themes define every key', () => {
    for (const p of [DARK, LIGHT]) {
      for (const k of KEYS) {
        expect(p[k], `${p.name} is missing ${k}`).toBeTruthy()
      }
    }
  })

  it('the two palettes are genuinely different, not one dimmed', () => {
    const differing = KEYS.filter((k) => k !== 'name').filter((k) => DARK[k] !== LIGHT[k])
    expect(differing.length).toBeGreaterThan(6)
  })

  it('paletteFor maps the stored theme value', () => {
    expect(paletteFor('dark')).toBe(DARK)
    expect(paletteFor('light')).toBe(LIGHT)
  })

  it('paletteFor falls back to neutral when no theme has been chosen', () => {
    expect(paletteFor(undefined)).toBe(NEUTRAL)
  })

  it('neutral sets no background fill, so it is legible on either terminal', () => {
    expect(NEUTRAL.selectionBg).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/palette.test.ts`
Expected: FAIL — `DARK is not exported from src/shell/theme.js`

- [ ] **Step 3: Implement the palettes**

In `src/shell/theme.ts`, **delete** the dead `COLOURS` export and add below
`SYMBOLS`:

```ts
/**
 * Every colour the shell draws. No component names a colour directly, so
 * swapping a theme is swapping this object and nothing else.
 *
 * Values are hex rather than ANSI names because the two palettes need
 * specific brightnesses: ANSI `yellow` is whatever the user's terminal theme
 * decided, which is fine when there is one palette and useless when the
 * point is that light and dark differ.
 */
export interface Palette {
  name: 'dark' | 'light' | 'neutral'
  /** Primary text. */
  fg: string
  /** Secondary text — sizes, hints, paths. */
  dim: string
  /** The one accent: cursor, selected marker, wordmark edge. */
  accent: string
  ok: string
  warn: string
  fail: string
  /** Format tag inlined into the file card's border. */
  tag: string
  /** Section labels such as CONVERT TO. */
  label: string
  /** Resting frame colour. */
  border: string
  /** Fill behind the selected row. Empty string means "draw no band". */
  selectionBg: string
}

export const DARK: Palette = {
  name: 'dark',
  fg: '#e4e8f0',
  dim: '#6b7385',
  accent: '#e5a23c',
  ok: '#6fcf7f',
  warn: '#e5c07b',
  fail: '#e8796d',
  tag: '#63c1d8',
  label: '#a68ce0',
  border: '#39404f',
  selectionBg: '#252c3a',
}

export const LIGHT: Palette = {
  name: 'light',
  fg: '#23262d',
  dim: '#8b9099',
  accent: '#a86a06',
  ok: '#1e7a35',
  warn: '#8a6100',
  fail: '#b3261e',
  tag: '#0a6b86',
  label: '#6141ad',
  border: '#c3bdb2',
  selectionBg: '#eae4d8',
}

/**
 * Used before the user has chosen a theme — that is, while the first-run
 * picker is on screen and we genuinely do not know the background. It sets
 * no background fill and no hex foreground, so it inherits the terminal's
 * own colours and is legible on any background by construction.
 */
export const NEUTRAL: Palette = {
  name: 'neutral',
  fg: '',
  dim: 'gray',
  accent: 'yellow',
  ok: 'green',
  warn: 'yellow',
  fail: 'red',
  tag: 'cyan',
  label: 'magenta',
  border: 'gray',
  selectionBg: '',
}

export function paletteFor(theme: 'dark' | 'light' | undefined): Palette {
  if (theme === 'dark') return DARK
  if (theme === 'light') return LIGHT
  return NEUTRAL
}
```

An empty-string colour means "do not set this attribute". Consumers convert
with a small helper added at the bottom of `theme.ts`:

```ts
/** Ink treats `undefined` as "no colour"; our palettes use '' for the same idea. */
export function colourProp(value: string): string | undefined {
  return value === '' ? undefined : value
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shell/palette.test.ts`
Expected: PASS.

Run: `npm test` — the whole suite. The `COLOURS` deletion must not break
anything, because nothing imported it. If anything fails, it imported a dead
export and the failure is the proof.

- [ ] **Step 5: Commit**

```bash
git add src/shell/theme.ts tests/shell/palette.test.ts
git commit -m "feat(shell): dark and light palettes, replacing the unused COLOURS export"
```

---

## Task 4: Theme context, threaded through the shell

**Files:**
- Create: `src/shell/ThemeContext.tsx`
- Modify: `src/shell/launch.tsx`, `src/shell/App.tsx`, `src/shell/blocks.tsx`,
  `src/shell/components/Hints.tsx`, `src/shell/components/Slider.tsx`,
  `src/shell/components/Prompt.tsx`
- Test: `tests/shell/theme-context.test.tsx`

**Interfaces:**
- Consumes: `Palette`, `DARK`, `NEUTRAL`, `colourProp`, `paletteFor` (Task 3);
  `Preferences`, `loadPreferences` (Task 1).
- Produces:
  ```ts
  export function ThemeProvider(props: { palette: Palette; children: ReactNode }): JSX.Element
  export function useTheme(): Palette
  ```
  `App` gains props: `{ initialWidth?: number; prefs?: Preferences }`.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/theme-context.test.tsx`:

```tsx
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT, NEUTRAL } from '../../src/shell/theme.js'

function Probe() {
  const palette = useTheme()
  return <Text>{palette.name}</Text>
}

describe('theme context', () => {
  it('provides the palette it is given', () => {
    expect(render(<ThemeProvider palette={LIGHT}><Probe /></ThemeProvider>).lastFrame())
      .toContain('light')
    expect(render(<ThemeProvider palette={DARK}><Probe /></ThemeProvider>).lastFrame())
      .toContain('dark')
  })

  it('defaults to the neutral palette outside a provider', () => {
    expect(render(<Probe />).lastFrame()).toContain(NEUTRAL.name)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/theme-context.test.tsx`
Expected: FAIL — `Cannot find module '../../src/shell/ThemeContext.js'`

- [ ] **Step 3: Implement the context and thread it through**

Create `src/shell/ThemeContext.tsx`:

```tsx
import { createContext, type ReactNode, useContext } from 'react'
import { NEUTRAL, type Palette } from './theme.js'

/**
 * Deliberately a context rather than a module-level mutable: `/theme` swaps
 * the palette live, and tests render either theme without leaking global
 * state between cases. The default is NEUTRAL so a component rendered
 * outside a provider — which only happens in a unit test — still has every
 * key defined rather than throwing.
 */
const ThemeContext = createContext<Palette>(NEUTRAL)

export function ThemeProvider({ palette, children }: { palette: Palette; children: ReactNode }) {
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>
}

export function useTheme(): Palette {
  return useContext(ThemeContext)
}
```

Update `src/shell/launch.tsx` to load preferences and provide the palette:

```tsx
import { render } from 'ink'
import { loadPreferences } from '../config/preferences.js'
import { App } from './App.js'
import { ThemeProvider } from './ThemeContext.js'
import { paletteFor } from './theme.js'

/** Renders the shell and resolves when the user exits it. */
export async function launchShell(): Promise<void> {
  const { prefs, warning } = await loadPreferences()
  const instance = render(
    <ThemeProvider palette={paletteFor(prefs.theme)}>
      <App prefs={prefs} {...(warning ? { configWarning: warning } : {})} />
    </ThemeProvider>,
  )
  await instance.waitUntilExit()
}
```

In `src/shell/App.tsx`, widen the props and surface the warning once:

```tsx
import { DEFAULT_PREFERENCES, type Preferences } from '../config/preferences.js'
import { useTheme } from './ThemeContext.js'

export function App({
  initialWidth,
  prefs = DEFAULT_PREFERENCES,
  configWarning,
}: {
  initialWidth?: number
  prefs?: Preferences
  configWarning?: string
}) {
  const palette = useTheme()
  // …existing state…

  // A bad config is told to the user once, as history, then never again.
  const warned = useRef(false)
  useEffect(() => {
    if (warned.current || !configWarning) return
    warned.current = true
    push({ kind: 'note', id: nextId(), text: `⚠ ${configWarning}` })
  }, [configWarning, push])
```

Replace every hardcoded colour in the shell with a palette read. In
`src/shell/blocks.tsx` the `HistoryEntry` function becomes a component that
calls `useTheme()`; `color="red"` becomes `color={colourProp(palette.fail)}`,
`color="green"` becomes `color={colourProp(palette.ok)}`, `color="yellow"`
becomes `color={colourProp(palette.warn)}`, and every `dimColor` becomes
`color={colourProp(palette.dim)}`.

Apply the same substitution in `Hints.tsx`, `Slider.tsx`, and `Prompt.tsx`.
`Prompt`'s border becomes `borderColor={colourProp(palette.border)}` in place
of `borderDimColor`.

Do **not** touch `applyColourPreference` or the order of the lazy import in
`src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/theme-context.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: all 264 existing tests still pass. The NO_COLOR test in
`tests/shell/` must still pass — if it fails, a hex colour is being emitted
where chalk should have suppressed it, which means `colourProp` was skipped
somewhere.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ThemeContext.tsx src/shell/launch.tsx src/shell/App.tsx \
        src/shell/blocks.tsx src/shell/components tests/shell/theme-context.test.tsx
git commit -m "feat(shell): theme context; every colour now comes from the palette"
```

---

## Task 5: First-run theme picker and `/theme`

**Files:**
- Create: `src/shell/components/ThemePicker.tsx`
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/theme-picker.test.tsx`

**Interfaces:**
- Consumes: `Select` (existing), `savePreferences` (Task 1), `paletteFor`,
  `NEUTRAL` (Task 3), `ThemeProvider` (Task 4).
- Produces: `export function ThemePicker(props: { onChoose: (theme: 'dark' | 'light') => void }): JSX.Element`
- `App` gains stage `'theme'` in its `Stage` union.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/theme-picker.test.tsx`:

```tsx
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

let dir: string
const saved = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-theme-'))
  process.env.XDG_CONFIG_HOME = dir
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

describe('first run theme picker', () => {
  it('appears when no theme has been chosen', () => {
    const frame = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).toMatch(/theme/i)
    expect(frame).toContain('Dark')
    expect(frame).toContain('Light')
  })

  it('does not appear once a theme is stored', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const frame = render(<App initialWidth={80} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).not.toContain('Light')
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('writes the choice and moves on to the prompt', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect((await loadPreferences()).prefs.theme).toBe('light')
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('the picker itself draws no background fill, so it is safe on either terminal', () => {
    const frame = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).not.toContain('[48;2;')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/theme-picker.test.tsx`
Expected: FAIL — no theme text in the frame.

- [ ] **Step 3: Implement the picker**

Create `src/shell/components/ThemePicker.tsx`:

```tsx
import { Box, Text } from 'ink'
import { ThemeProvider } from '../ThemeContext.js'
import { NEUTRAL } from '../theme.js'
import { Select } from './Select.js'

/**
 * Rendered before any theme is known, so it wraps itself in the NEUTRAL
 * palette rather than inheriting one: at this moment we genuinely do not
 * know the terminal's background, and NEUTRAL sets no background fill and no
 * hex foreground, which makes it legible on either.
 */
export function ThemePicker({ onChoose }: { onChoose: (theme: 'dark' | 'light') => void }) {
  return (
    <ThemeProvider palette={NEUTRAL}>
      <Box flexDirection="column" marginBottom={1}>
        <Text>Which theme suits your terminal?</Text>
        <Select
          width={40}
          items={[
            { value: 'dark', label: 'Dark', hint: 'light text on a dark background' },
            { value: 'light', label: 'Light', hint: 'dark text on a light background' },
          ]}
          onSubmit={(value) => onChoose(value === 'light' ? 'light' : 'dark')}
        />
        <Text dimColor>↑↓ choose · ↵ confirm · change it later with /theme</Text>
      </Box>
    </ThemeProvider>
  )
}
```

In `src/shell/App.tsx`: add `'theme'` to the `Stage` union, initialise
`stage` to `prefs.theme === undefined ? 'theme' : 'idle'`, hold the chosen
palette in state so `/theme` can swap it live, and render the picker first.

```tsx
const [theme, setTheme] = useState<'dark' | 'light' | undefined>(prefs.theme)

const chooseTheme = (next: 'dark' | 'light') => {
  setTheme(next)
  setStage('idle')
  // Fire and forget with an explicit catch: this runs from Select's
  // synchronous useInput handler and nothing awaits it, so an unhandled
  // rejection would kill the process. A config that fails to save is worth
  // telling the user about, but must never cost them the session.
  savePreferences({ theme: next }).catch(showError)
}
```

Wrap `App`'s returned tree in a `ThemeProvider` keyed on that state so
`/theme` re-themes without a remount:

```tsx
return (
  <ThemeProvider palette={paletteFor(theme)}>
    <Box flexDirection="column">
      {stage === 'theme' ? <ThemePicker onChoose={chooseTheme} /> : null}
      {/* …existing tree, each branch additionally gated on stage !== 'theme' */}
    </Box>
  </ThemeProvider>
)
```

Add `/theme` to the idle prompt's submit handler, before the path probe in
`submitPath`:

```ts
if (trimmed === '/theme') {
  setStage('theme')
  return
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/theme-picker.test.tsx`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/ThemePicker.tsx src/shell/App.tsx tests/shell/theme-picker.test.tsx
git commit -m "feat(shell): first-run theme picker and /theme"
```

---

## Task 6: Selection band

**Files:**
- Modify: `src/shell/components/Select.tsx`, `src/shell/components/PathInput.tsx`
- Test: `tests/shell/select-band.test.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 4), `colourProp` (Task 3), `stringWidth` (existing dep).
- Produces: `Select` gains a required `width: number` prop. Every existing
  call site must pass it — `App.tsx` (target picker, overwrite picker),
  `PathInput.tsx`, `ThemePicker.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/select-band.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Select } from '../../src/shell/components/Select.js'

const items = [
  { value: 'webp', label: 'WebP', hint: 'smaller, keeps transparency' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
]

describe('Select selection band', () => {
  it('pads the selected row to the full width so a band can fill it', () => {
    const frame = render(<Select width={50} items={items} onSubmit={() => {}} />).lastFrame() ?? ''
    const row = (frame.split('\n').find((l) => l.includes('WebP')) ?? '')
    expect(row.length).toBe(50)
  })

  it('does not pad unselected rows', () => {
    const frame = render(<Select width={50} items={items} onSubmit={() => {}} />).lastFrame() ?? ''
    const row = (frame.split('\n').find((l) => l.includes('PNG')) ?? '')
    expect(row.length).toBeLessThan(50)
  })

  it('keeps the cursor glyph and the label, so meaning survives without colour', () => {
    const frame = render(<Select width={50} items={items} onSubmit={() => {}} />).lastFrame() ?? ''
    expect(frame).toContain('❯ WebP')
  })

  it('budgets padding in terminal columns, not code units', () => {
    const wide = [{ value: 'a', label: '日本語', hint: 'cjk' }]
    const frame = render(<Select width={30} items={wide} onSubmit={() => {}} />).lastFrame() ?? ''
    const row = frame.split('\n')[0] ?? ''
    // Three CJK glyphs occupy six columns but are three code points; a
    // length-based budget would overshoot the row by three columns.
    expect(row.length).toBe(27)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/select-band.test.tsx`
Expected: FAIL — `width` is not a prop, and rows are unpadded.

- [ ] **Step 3: Implement the band**

Rewrite the render body of `src/shell/components/Select.tsx`. Add
`width: number` to `SelectProps`, import `stringWidth`, `useTheme`, and
`colourProp`, then:

```tsx
  const palette = useTheme()
  const labelWidth = Math.max(0, ...items.map((i) => stringWidth(i.label)))

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const selected = i === index
        const cursor = selected ? `${SYMBOLS.cursor} ` : '  '
        const label = item.label.padEnd(labelWidth)
        const hint = showHints && item.hint ? `  ${item.hint}` : ''

        /**
         * `<Text backgroundColor>` colours only the characters it is given,
         * so a band across the row means literally padding the row out to
         * the container width. Budgeted with `stringWidth`, not `.length`:
         * a CJK label is two columns per glyph and one code point, and a
         * length-based pad would overshoot the terminal by the difference.
         */
        const used = stringWidth(cursor) + stringWidth(label) + stringWidth(hint)
        const pad = selected ? ' '.repeat(Math.max(0, width - used)) : ''

        return (
          <Text
            key={item.value}
            {...(selected && palette.selectionBg
              ? { backgroundColor: palette.selectionBg }
              : {})}
          >
            <Text {...(selected ? { color: colourProp(palette.accent) } : {})}>{cursor}</Text>
            <Text bold={selected} {...(selected ? { color: colourProp(palette.fg) } : {})}>
              {label}
            </Text>
            {hint ? <Text color={colourProp(palette.dim)}>{hint}</Text> : null}
            {pad}
          </Text>
        )
      })}
    </Box>
  )
```

Pass `width` at every call site: in `App.tsx` the target picker and the
overwrite picker both get `width={width}`; in `PathInput.tsx` the `Select`
gets `width={width}`; `ThemePicker.tsx` already passes `width={40}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/select-band.test.tsx`
Expected: PASS.

Run: `npm test` — `app-flow`, `app-convert`, `app-safety` and `responsive`
all drive `Select` and must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/Select.tsx src/shell/components/PathInput.tsx \
        src/shell/App.tsx tests/shell/select-band.test.tsx
git commit -m "feat(shell): full-width selection band on the highlighted row"
```

---

## Task 7: File card and result block redesign

**Files:**
- Modify: `src/shell/components/FileCard.tsx`, `src/shell/blocks.tsx`
- Test: `tests/shell/blocks-design.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `colourProp`, `middleEllipsis`, `bandFor`, `formatBytes`,
  `percentChange`.
- Produces: no new exports. `FileCard` keeps its `{ source, width }` signature.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/blocks-design.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import type { SourceInfo } from '../../src/core/types.js'

const source: SourceInfo = {
  path: '/tmp/diagram.png',
  format: 'png',
  width: 2400,
  height: 1600,
  bytes: 348_160,
  hasAlpha: true,
  frames: 1,
}

describe('file card', () => {
  it('draws a frame with the format inlined into the top border', () => {
    const frame = render(<FileCard source={source} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('╭─ PNG')
    expect(frame).toContain('╰')
    expect(frame).toContain('diagram.png')
  })

  it('reports transparency only when the source actually has alpha', () => {
    const opaque = { ...source, hasAlpha: false }
    expect(render(<FileCard source={source} width={80} />).lastFrame()).toContain('transparent')
    expect(render(<FileCard source={opaque} width={80} />).lastFrame())
      .not.toContain('transparent')
  })

  it('drops the frame in the compact band rather than overflowing', () => {
    const frame = render(<FileCard source={source} width={50} />).lastFrame() ?? ''
    expect(frame).not.toContain('╭')
    expect(frame).toContain('diagram.png')
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(50)
  })
})

describe('result block', () => {
  const result = {
    job: {
      source,
      target: 'webp' as const,
      output: '/tmp/diagram.webp',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 114_688,
    warnings: [],
  }

  it('carries symbol and word, not colour alone', () => {
    const frame =
      render(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
        .lastFrame() ?? ''
    expect(frame).toContain('✓ done')
    expect(frame).toContain('diagram.png')
    expect(frame).toContain('diagram.webp')
  })

  it('states the saving in words', () => {
    const frame =
      render(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
        .lastFrame() ?? ''
    expect(frame).toMatch(/\d+% smaller/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/blocks-design.test.tsx`
Expected: FAIL — no `╭─ PNG` in the frame; result says `✓` without `done`.

- [ ] **Step 3: Implement the redesign**

Rewrite `src/shell/components/FileCard.tsx`:

```tsx
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { FORMATS } from '../../core/formats.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'

/**
 * A dropped file, framed, with its format inlined into the top border as a
 * tag. Below the compact band (<60 columns) the frame is dropped entirely
 * rather than eating four of the columns the filename needs — spec §13 says
 * content is truncated, never wrapped, and a border is not content.
 */
export function FileCard({ source, width }: { source: SourceInfo; width: number }) {
  const palette = useTheme()
  const band = bandFor(width)
  const name = source.path.split('/').pop() ?? source.path
  const label = FORMATS[source.format].label

  const facts = [
    `${source.width}×${source.height}`,
    formatBytes(source.bytes),
    ...(source.hasAlpha ? ['transparent'] : []),
  ].join(' · ')

  if (band === 'compact') {
    return (
      <Box flexDirection="column">
        <Text color={colourProp(palette.fg)}>{middleEllipsis(name, width)}</Text>
        <Text color={colourProp(palette.dim)}>{middleEllipsis(`${label} · ${facts}`, width)}</Text>
      </Box>
    )
  }

  const inner = Math.max(20, Math.min(width, 60) - 2)
  // "╭─ " + tag + " " then dashes to the corner.
  const head = stringWidth(label) + 4
  const rule = '─'.repeat(Math.max(0, inner - head))

  const row = (text: string) => {
    const t = middleEllipsis(text, inner - 4)
    return `${t}${' '.repeat(Math.max(0, inner - 4 - stringWidth(t)))}`
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colourProp(palette.border)}>{'╭─ '}</Text>
        <Text color={colourProp(palette.tag)}>{label}</Text>
        <Text color={colourProp(palette.border)}>{` ${rule}╮`}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text color={colourProp(palette.fg)}>{row(name)}</Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text color={colourProp(palette.dim)}>{row(facts)}</Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text color={colourProp(palette.border)}>{`╰${'─'.repeat(inner)}╯`}</Text>
    </Box>
  )
}
```

In `src/shell/blocks.tsx`, convert `HistoryEntry` to call `useTheme()` and
change the result branch to lead with `✓ done` and colour the saving:

```tsx
  const { job, outputBytes, warnings } = block.result
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} done`}</Text>
        <Text>{'  '}</Text>
        <Text color={colourProp(palette.fg)}>{basename(job.source.path)}</Text>
        <Text color={colourProp(palette.dim)}>{` ${SYMBOLS.arrow} `}</Text>
        <Text color={colourProp(palette.fg)}>{basename(job.output)}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.dim)}>
          {`        ${formatBytes(job.source.bytes)} ${SYMBOLS.arrow} ${formatBytes(outputBytes)} · `}
        </Text>
        <Text color={colourProp(palette.ok)}>
          {changePhrase(job.source.bytes, outputBytes)}
        </Text>
      </Text>
      {warnings.map((w) => (
        <Text key={w.message} color={colourProp(palette.warn)}>
          {`${SYMBOLS.warn} ${w.message}`}
        </Text>
      ))}
    </Box>
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/blocks-design.test.tsx`
Expected: PASS.

Run: `npm test`. `tests/shell/responsive.test.tsx` asserts nothing overflows —
if the card overruns a narrow terminal it fails there, which is the point.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/FileCard.tsx src/shell/blocks.tsx tests/shell/blocks-design.test.tsx
git commit -m "feat(shell): framed file card with format tag, and a redesigned result block"
```

---

## Task 8: Identity banner

**Files:**
- Create: `src/shell/components/Banner.tsx`
- Modify: `src/shell/App.tsx`, `src/index.ts`
- Test: `tests/shell/banner.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `colourProp`, `bandFor`, `expandTilde` (Task 1).
- Produces:
  ```ts
  export function Banner(props: { width: number; version: string; defaultOutput: string }): JSX.Element
  export const WORDMARK: readonly string[]
  export const MARK: readonly string[]
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/shell/banner.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Banner, MARK, WORDMARK } from '../../src/shell/components/Banner.js'
import { App } from '../../src/shell/App.js'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'

describe('banner art', () => {
  it('the wordmark rows are all the same width, or the letters shear', () => {
    const widths = new Set(WORDMARK.map((r) => r.length))
    expect(widths.size).toBe(1)
  })

  it('the mark rows are all the same width', () => {
    expect(new Set(MARK.map((r) => r.length)).size).toBe(1)
  })

  it('mark and wordmark are the same height, so they sit side by side', () => {
    expect(MARK.length).toBe(WORDMARK.length)
  })
})

describe('banner rendering', () => {
  it('draws mark and wordmark at normal width', () => {
    const frame =
      render(<Banner width={100} version="0.1.0" defaultOutput="~/Desktop" />).lastFrame() ?? ''
    expect(frame).toContain('█')
    expect(frame).toContain('0.1.0')
    expect(frame).toContain('~/Desktop')
  })

  it('falls back to a one-line header in the compact band', () => {
    const frame =
      render(<Banner width={50} version="0.1.0" defaultOutput="~/Desktop" />).lastFrame() ?? ''
    expect(frame).not.toContain('█')
    expect(frame).toContain('Forge')
    expect(frame.split('\n').filter((l) => l.trim().length > 0).length).toBe(1)
  })

  it('never overflows the terminal', () => {
    for (const w of [50, 60, 80, 100, 120]) {
      const frame =
        render(<Banner width={w} version="0.1.0" defaultOutput="~/Desktop" />).lastFrame() ?? ''
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})

describe('banner in the shell', () => {
  it('shows on every launch, not just the first', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const frame = render(<App initialWidth={100} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).toContain('█')
  })

  it('shows the configured default output folder', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: '~/Pictures' }
    const frame = render(<App initialWidth={100} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).toContain('~/Pictures')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/banner.test.tsx`
Expected: FAIL — `Cannot find module '.../Banner.js'`

- [ ] **Step 3: Implement the banner**

Create `src/shell/components/Banner.tsx`:

```tsx
import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor } from '../width.js'

/**
 * `█` is the letter face; `╔═╗║╚╝` is its edge. The edge is the point:
 * solid-slab block letters leave O and G, and E and F, with near-identical
 * silhouettes at this size, and the outline is what separates them. Six
 * rows, because five does not leave enough vertical room to describe a
 * letterform.
 *
 * Every row must be exactly the same length or the letters shear — there is
 * a test for that, and trailing spaces are significant.
 */
export const WORDMARK = [
  '███████╗ ██████╗ ██████╗  ██████╗ ███████╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝',
  '█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ',
  '██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ',
  '██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗',
  '╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
] as const

/** An anvil, with the hammer above it. Same row count as WORDMARK. */
export const MARK = [
  '   ▟█▙     ',
  '    ▐▌     ',
  ' ▗▄▄▄▄▄▄▄▄▖',
  '▐██████████',
  ' ▝▀▀▐██▌▀▀ ',
  ' ▗▄██████▄▖',
] as const

const GAP = '  '
const FULL_WIDTH = MARK[0].length + GAP.length + WORDMARK[0].length

/**
 * Shown on every shell launch. The status line carries the default output
 * folder, which is what makes that setting discoverable without a settings
 * screen.
 */
export function Banner({
  width,
  version,
  defaultOutput,
}: {
  width: number
  version: string
  defaultOutput: string
}) {
  const palette = useTheme()

  // Below the compact band the art does not fit — 42 columns of wordmark plus
  // 11 of mark needs 55 before any padding — so compact gets the header alone.
  if (bandFor(width) === 'compact' || width < FULL_WIDTH) {
    return (
      <Box marginBottom={1}>
        <Text>
          <Text color={colourProp(palette.accent)}>{'⚒ '}</Text>
          <Text color={colourProp(palette.fg)} bold>
            Forge
          </Text>
          <Text color={colourProp(palette.dim)}>{` ${version}`}</Text>
        </Text>
      </Box>
    )
  }

  const status = ` Convert ${version}  · image`
  const pad = ' '.repeat(Math.max(1, width - status.length - defaultOutput.length - 1))

  return (
    <Box flexDirection="column" marginBottom={1}>
      {WORDMARK.map((word, i) => (
        // Row index is a stable identity here: the art is a fixed constant,
        // never reordered or filtered.
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length constant art
        <Text key={i}>
          <Text color={colourProp(palette.dim)}>{MARK[i]}</Text>
          <Text>{GAP}</Text>
          {splitFace(word).map((run, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length constant art
            <Text key={j} color={colourProp(run.edge ? palette.accent : palette.fg)}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      <Text>
        <Text color={colourProp(palette.dim)}>{status}</Text>
        <Text>{pad}</Text>
        <Text color={colourProp(palette.dim)}>{defaultOutput}</Text>
      </Text>
    </Box>
  )
}

/**
 * Splits a wordmark row into face runs and edge runs so each can take its own
 * colour. The face uses the palette's plain foreground — by construction it
 * contrasts with the user's background in either theme — and the accent sits
 * on the edge only, where it reads as an accent rather than as the letterform.
 */
function splitFace(row: string): { text: string; edge: boolean }[] {
  const runs: { text: string; edge: boolean }[] = []
  for (const ch of row) {
    const edge = ch !== '█'
    const last = runs[runs.length - 1]
    if (last && last.edge === edge) last.text += ch
    else runs.push({ text: ch, edge })
  }
  return runs
}
```

In `src/shell/App.tsx`, render it above the `<Static>` history, gated off the
theme stage so the first-run picker is the only thing on screen:

```tsx
{stage === 'theme' ? null : (
  <Banner width={width} version={VERSION} defaultOutput={prefs.defaultOutput} />
)}
```

Import `VERSION` from `../index.js` — or, to avoid the cycle, add
`export const VERSION = '0.1.0'` to `src/shell/theme.ts` and have
`src/index.ts` re-export it. Take the second option; a shell importing the
entrypoint is a cycle waiting to bite.

For `--version`, in `src/index.ts` catch Commander's version path and print
the art first. Commander already throws with `code === 'commander.version'`
after printing; change the `.version()` call to
`.version(VERSION, '-V, --version', 'show the version')` and, in the catch
branch for `commander.version`, leave behaviour as-is. The banner on
`--version` is delivered by the shell path only when a TTY exists; for a
piped `--version` the bare number is correct and must not change, because
scripts parse it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/banner.test.tsx`
Expected: PASS.

Run: `npm test`. `tests/cli/shell-launch.test.ts` asserts the non-TTY path
prints no shell output — the banner must not appear there.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/Banner.tsx src/shell/App.tsx src/shell/theme.ts \
        src/index.ts tests/shell/banner.test.tsx
git commit -m "feat(shell): anvil mark and outlined wordmark on every launch"
```

---

## Task 9: Desktop preset and preferences in the action layer

**Files:**
- Modify: `src/core/actions.ts`, `src/shell/App.tsx`
- Test: `tests/core/actions.test.ts` (extend)

**Interfaces:**
- Consumes: `Preferences`, `expandTilde` (Task 1) — **type import only** in
  `core/`, plus `expandTilde` which is a pure string function with no I/O.
- Produces:
  ```ts
  options(source: SourceInfo, values: Record<string, unknown>, prefs: Preferences): OptionSpec[]
  ```
  Third parameter is required. Every caller must pass it.

> `core/` importing `expandTilde` from `src/config/` is allowed here because
> it performs no I/O — it is `homedir()` and string concatenation. `core/`
> must not import `loadPreferences` or `savePreferences`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/actions.test.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'

const prefs = DEFAULT_PREFERENCES

describe('destination presets', () => {
  const source = {
    path: '/Users/x/Pictures/diagram.png',
    format: 'png' as const,
    width: 10, height: 10, bytes: 100, hasAlpha: false, frames: 1,
  }

  const destination = (p = prefs) => {
    const spec = convertAction.options(source, { target: 'webp' }, p)
      .find((s) => s.id === 'destination')
    if (spec?.kind !== 'path') throw new Error('no destination spec')
    return spec
  }

  it('offers Desktop', () => {
    expect(destination().presets.map((x) => x.label)).toContain('Desktop')
    expect(destination().presets.find((x) => x.label === 'Desktop')?.path)
      .toBe(join(homedir(), 'Desktop'))
  })

  it('hoists the configured default to the top', () => {
    const p = { ...prefs, defaultOutput: '~/Downloads' }
    expect(destination(p).presets[0]?.path).toBe(join(homedir(), 'Downloads'))
  })

  it('preselects the configured default', () => {
    const p = { ...prefs, defaultOutput: '~/Downloads' }
    expect(destination(p).default).toBe(join(homedir(), 'Downloads'))
  })

  it('adds a default that is not one of the presets', () => {
    const p = { ...prefs, defaultOutput: '/tmp/somewhere' }
    expect(destination(p).presets[0]?.path).toBe('/tmp/somewhere')
  })

  it('still dedupes when the source already lives in the default folder', () => {
    const onDesktop = { ...source, path: join(homedir(), 'Desktop', 'diagram.png') }
    const specs = convertAction.options(onDesktop, { target: 'webp' }, prefs)
    const spec = specs.find((s) => s.id === 'destination')
    if (spec?.kind !== 'path') throw new Error('no destination spec')
    const paths = spec.presets.map((x) => x.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('quality default', () => {
  const source = {
    path: '/tmp/a.png', format: 'png' as const,
    width: 10, height: 10, bytes: 100, hasAlpha: false, frames: 1,
  }

  it('opens the slider on the configured quality', () => {
    const p = { ...prefs, quality: 55 }
    const spec = convertAction.options(source, { target: 'webp' }, p)
      .find((s) => s.id === 'quality')
    if (spec?.kind !== 'slider') throw new Error('no quality spec')
    expect(spec.default).toBe(55)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: FAIL — `options()` takes two parameters; no Desktop preset.

- [ ] **Step 3: Implement**

In `src/core/actions.ts`:

```ts
import { expandTilde, type Preferences } from '../config/preferences.js'

function destinationPath(source: SourceInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  // The configured default leads. It is listed explicitly first so that a
  // default pointing somewhere none of the built-ins cover still appears —
  // and so the dedupe below collapses it into whichever built-in it matches,
  // keeping that preset's more meaningful label.
  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
    { label: 'New subfolder', path: join(here, 'converted') },
  ]

  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })

  return { kind: 'path', id: 'destination', label: 'Save to', default: preferred, presets }
}

/** Names a path the way the built-in presets do, so the hoisted default is not a bare path. */
function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  if (path === join(sourceDir, 'converted')) return 'New subfolder'
  return path.split('/').pop() || path
}
```

Update the `Action` interface and `convertAction.options` to take
`prefs: Preferences` third, replace `DEFAULT_QUALITY` with `prefs.quality`
in the slider spec, and pass `prefs` into `destinationPath`.

In `src/shell/App.tsx`, the `specs` memo passes prefs:

```ts
const specs: OptionSpec[] = useMemo(
  () => (source ? convertAction.options(source, values, prefs) : []),
  [source, values, prefs],
)
```

and `chooseTarget`'s inner call becomes
`convertAction.options(currentSource, { target }, prefs)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/core/actions.ts src/shell/App.tsx tests/core/actions.test.ts
git commit -m "feat(core): Desktop preset and preference-driven destination defaults"
```

---

## Task 10: `d` to make a destination the default

**Files:**
- Modify: `src/shell/components/PathInput.tsx`, `src/shell/App.tsx`
- Test: `tests/shell/set-default.test.tsx`

**Interfaces:**
- Consumes: `savePreferences` (Task 1), `Select`'s `onHighlight` (existing).
- Produces: `PathInput` gains
  `onMakeDefault?: (path: string) => void` and `defaultPath: string`.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/set-default.test.tsx`:

```tsx
import { mkdtemp } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

let cfg: string
const saved = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  cfg = await mkdtemp(join(tmpdir(), 'forge-def-'))
  process.env.XDG_CONFIG_HOME = cfg
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

/** Drives the shell as far as the destination step. */
async function toDestination() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const h = render(<App initialWidth={100} prefs={prefs} />)
  h.stdin.write(jpg)
  await settle()
  h.stdin.write(ENTER)
  await settle(400)
  h.stdin.write(ENTER) // accept the first target
  await settle()
  h.stdin.write(ENTER) // accept the quality slider
  await settle()
  return h
}

describe('making a destination the default', () => {
  it('marks the current default in the list', async () => {
    const { lastFrame } = await toDestination()
    expect(lastFrame() ?? '').toContain('default')
  })

  it('offers the key in the hints', async () => {
    const { lastFrame } = await toDestination()
    expect(lastFrame() ?? '').toContain('make default')
  })

  it('d writes the highlighted folder to config', async () => {
    const { stdin } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    const stored = (await loadPreferences()).prefs.defaultOutput
    expect(stored).not.toBe(DEFAULT_PREFERENCES.defaultOutput)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('d does not advance the flow — the user is still choosing', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write('d')
    await settle(400)
    expect(lastFrame() ?? '').toContain('Save to')
  })

  it('commits a note saying what changed', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    expect(lastFrame() ?? '').toMatch(/default output is now/i)
  })

  it('d on the row that is already default is a no-op, not an error', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write('d')
    await settle(300)
    stdin.write('d')
    await settle(300)
    expect(lastFrame() ?? '').not.toContain('✕')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/set-default.test.tsx`
Expected: FAIL — no `default` tag, no `make default` hint.

- [ ] **Step 3: Implement**

In `src/shell/components/PathInput.tsx`, add the two props, tag the default
row, and handle `d`. The `useInput` that handles `d` must be **separate** from
the typing handler and gated on `!typing`, because Ink delivers input to every
mounted hook and a `d` typed into the free-text field must stay a `d`:

```tsx
  useInput(
    (input) => {
      if (input !== 'd' || !onMakeDefault) return
      const item = items[highlight]
      if (!item || item.value === TYPE_IT) return
      if (item.value === defaultPath) return // already the default: no-op, not an error
      onMakeDefault(item.value)
    },
    { isActive: !typing },
  )
```

Build the hint column so the default row is tagged:

```tsx
  const items: Choice[] = [
    ...presets.map((p) => ({
      value: p.path,
      label: p.label,
      hint:
        p.path === defaultPath
          ? `${middleEllipsis(p.path, Math.max(8, hintBudget - 10))}   default`
          : middleEllipsis(p.path, hintBudget),
    })),
    { value: TYPE_IT, label: 'Type a path…' },
  ]
```

In `src/shell/App.tsx`, pass the handler and extend the destination hints:

```tsx
<PathInput
  label={destinationSpec.label}
  presets={destinationSpec.presets}
  defaultPath={expandTilde(prefs.defaultOutput)}
  preview={previewDestination}
  onSubmit={(destination) => void convert(destination)}
  onMakeDefault={makeDefault}
  onCancel={() => setStage('target')}
  width={width}
  showHints={band !== 'compact'}
/>
```

```tsx
/**
 * Writes the folder to config and says so, without advancing the flow — the
 * user is still choosing where *this* conversion goes. `prefs` is held in
 * state so the tag and the preselected row follow the change immediately
 * rather than waiting for the next launch.
 */
const [livePrefs, setLivePrefs] = useState(prefs)

const makeDefault = (path: string) => {
  setLivePrefs((p) => ({ ...p, defaultOutput: path }))
  push({ kind: 'note', id: nextId(), text: `${SYMBOLS.ok} default output is now ${path}` })
  savePreferences({ defaultOutput: path }).catch(showError)
}
```

Replace every other read of `prefs` in `App` with `livePrefs` — the `specs`
memo, the `Banner`, and `defaultPath` — so one state value drives all three.

Add `['d', 'make default']` to the destination step's `Hints` pairs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/set-default.test.tsx`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/PathInput.tsx src/shell/App.tsx tests/shell/set-default.test.tsx
git commit -m "feat(shell): d makes the highlighted folder the default output"
```

---

## Task 11: Path completion

**Files:**
- Create: `src/shell/complete.ts`
- Modify: `src/shell/components/Prompt.tsx`, `src/shell/App.tsx`
- Test: `tests/shell/complete.test.ts`, `tests/shell/prompt-complete.test.tsx`

**Interfaces:**
- Consumes: `readableFormats()` from `src/core/capabilities.js`, `FORMATS`
  from `src/core/formats.js`, `expandTilde` (Task 1).
- Produces:
  ```ts
  export interface Completion { completed: string; matches: string[] }
  export function completePath(fragment: string): Promise<Completion>
  ```

> The extension filter here is **advisory display only**. Invariant 3 —
> sources are probed by content, never by extension — is untouched: `probe()`
> still decides, and a file the filter hides can still be typed in full and
> converted.

- [ ] **Step 1: Write the failing tests**

Create `tests/shell/complete.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completePath } from '../../src/shell/complete.js'
import { makeTempDir } from '../helpers/fixtures.js'

async function tree() {
  const dir = await makeTempDir()
  await writeFile(join(dir, 'sunset.jpg'), 'x')
  await writeFile(join(dir, 'sunrise.jpg'), 'x')
  await writeFile(join(dir, 'notes.txt'), 'x')
  await writeFile(join(dir, '.hidden.jpg'), 'x')
  await mkdir(join(dir, 'Photos'))
  return dir
}

describe('completePath', () => {
  it('completes a unique match', async () => {
    const dir = await tree()
    const { completed } = await completePath(join(dir, 'notes'))
    expect(completed).toBe(join(dir, 'notes.txt'))
  })

  it('completes the longest common prefix and lists the matches', async () => {
    const dir = await tree()
    const { completed, matches } = await completePath(join(dir, 'sun'))
    expect(completed).toBe(join(dir, 'sun'))
    expect(matches.sort()).toEqual(['sunrise.jpg', 'sunset.jpg'])
  })

  it('appends a slash to a directory so the next Tab descends', async () => {
    const dir = await tree()
    const { completed } = await completePath(join(dir, 'Pho'))
    expect(completed).toBe(join(dir, 'Photos') + '/')
  })

  it('matches case-insensitively, as the macOS filesystem does', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 'pho'))).completed).toBe(join(dir, 'Photos') + '/')
  })

  it('expands a leading tilde', async () => {
    const { completed } = await completePath('~/')
    expect(completed.startsWith(homedir())).toBe(true)
  })

  it('hides dotfiles unless the fragment starts with a dot', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 's'))).matches).not.toContain('.hidden.jpg')
    expect((await completePath(join(dir, '.'))).matches).toContain('.hidden.jpg')
  })

  it('lists directories and convertible files, not unrelated ones', async () => {
    const dir = await tree()
    const { matches } = await completePath(`${dir}/`)
    expect(matches).toContain('Photos/')
    expect(matches).toContain('sunset.jpg')
    expect(matches).not.toContain('notes.txt')
  })

  it('is silent when the directory cannot be read', async () => {
    const { completed, matches } = await completePath('/definitely/not/here/x')
    expect(completed).toBe('/definitely/not/here/x')
    expect(matches).toEqual([])
  })
})
```

Create `tests/shell/prompt-complete.test.tsx`:

```tsx
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { makeTempDir } from '../helpers/fixtures.js'

const TAB = String.fromCharCode(9)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('tab completion in the prompt', () => {
  it('completes a unique path in place', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'sunset.jpg'), 'x')
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(join(dir, 'suns'))
    await settle(100)
    stdin.write(TAB)
    await settle()
    expect(lastFrame() ?? '').toContain('sunset.jpg')
  })

  it('lists the candidates when several match', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'sunset.jpg'), 'x')
    await writeFile(join(dir, 'sunrise.jpg'), 'x')
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(join(dir, 'sun'))
    await settle(100)
    stdin.write(TAB)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('sunset.jpg')
    expect(frame).toContain('sunrise.jpg')
  })

  it('does nothing on an empty prompt', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(TAB)
    await settle()
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/shell/complete.test.ts tests/shell/prompt-complete.test.tsx`
Expected: FAIL — `Cannot find module '../../src/shell/complete.js'`

- [ ] **Step 3: Implement completion**

Create `src/shell/complete.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expandTilde } from '../config/preferences.js'
import { readableFormats } from '../core/capabilities.js'
import { FORMATS } from '../core/formats.js'

export interface Completion {
  /** The fragment with as much appended as could be resolved unambiguously. */
  completed: string
  /** Basenames of every candidate, directories suffixed with `/`. Empty when unique. */
  matches: string[]
}

/**
 * Derived from the capability graph, never hardcoded (invariant 2). This is
 * an *advisory display filter* only: `probe()` still decides what a file
 * actually is, by content (invariant 3), so a file hidden here can still be
 * typed in full and converted.
 */
function convertibleExtensions(): Set<string> {
  const set = new Set<string>()
  for (const id of readableFormats()) {
    for (const ext of FORMATS[id].extensions) set.add(ext.toLowerCase())
  }
  return set
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0] ?? ''
  for (const v of values.slice(1)) {
    let i = 0
    while (i < prefix.length && i < v.length && prefix[i]?.toLowerCase() === v[i]?.toLowerCase()) {
      i++
    }
    prefix = prefix.slice(0, i)
  }
  return prefix
}

/**
 * Reads exactly one directory and never recurses. An unreadable directory
 * returns the fragment unchanged with no matches — Tab doing nothing is the
 * correct response to a folder the user cannot read, not an error they did
 * not ask for.
 */
export async function completePath(fragment: string): Promise<Completion> {
  if (fragment.trim().length === 0) return { completed: fragment, matches: [] }

  const expanded = expandTilde(fragment)
  const endsWithSep = expanded.endsWith('/')
  const dir = endsWithSep ? expanded : dirname(expanded)
  const stem = endsWithSep ? '' : basename(expanded)

  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { completed: fragment, matches: [] }
  }

  const allowed = convertibleExtensions()
  const showHidden = stem.startsWith('.')

  const candidates = entries
    .filter((e) => showHidden || !e.name.startsWith('.'))
    .filter((e) => e.name.toLowerCase().startsWith(stem.toLowerCase()))
    .filter((e) => {
      if (e.isDirectory()) return true
      const dot = e.name.lastIndexOf('.')
      return dot > 0 && allowed.has(e.name.slice(dot).toLowerCase())
    })
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (candidates.length === 0) return { completed: fragment, matches: [] }

  if (candidates.length === 1) {
    const only = candidates[0]
    if (!only) return { completed: fragment, matches: [] }
    return { completed: join(dir, only.name) + (only.dir ? '/' : ''), matches: [] }
  }

  const prefix = longestCommonPrefix(candidates.map((c) => c.name))
  return {
    completed: prefix.length > stem.length ? join(dir, prefix) : fragment,
    matches: candidates.map((c) => c.name + (c.dir ? '/' : '')),
  }
}
```

In `src/shell/components/Prompt.tsx`, add `onTab?: () => void` and
`matches?: string[]`, fire `onTab` when `key.tab` is pressed, and render the
match list under the box:

```tsx
      if (key.tab) {
        onTab?.()
        return
      }
```

```tsx
  {matches && matches.length > 0 ? (
    <Text color={colourProp(palette.dim)}>
      {`  ${matches.slice(0, band === 'wide' ? 12 : 6).join('   ')}`}
    </Text>
  ) : null}
```

In `src/shell/App.tsx`:

```tsx
const [matches, setMatches] = useState<string[]>([])

const complete = () => {
  const fragment = text
  void completePath(fragment)
    .then(({ completed, matches: found }) => {
      // The user kept typing while the directory was being read — their
      // keystrokes win, exactly as a superseded probe result is dropped.
      if (fragment !== textRefForCompletion.current) return
      if (completed !== fragment) setText(completed)
      setMatches(found)
    })
    .catch(showError)
}
```

Mirror `text` into a ref (`textRefForCompletion`) on each render, as
`Prompt` already does for its own buffer, and clear `matches` in `submitPath`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shell/complete.test.ts tests/shell/prompt-complete.test.tsx`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run lint`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/shell/complete.ts src/shell/components/Prompt.tsx src/shell/App.tsx \
        tests/shell/complete.test.ts tests/shell/prompt-complete.test.tsx
git commit -m "feat(shell): tab completion for paths in the prompt"
```

---

## Task 12: Colour assertions and the README

**Files:**
- Create: `tests/helpers/theme-frame-child.ts`, `tests/shell/theme-colour.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

This is the one place actual colour is asserted, and it needs a spawned
process for the reason documented in `tests/helpers/colour-frame-child.ts`.

- [ ] **Step 1: Write the failing test and its child**

Create `tests/helpers/theme-frame-child.ts`:

```ts
/**
 * Renders the shell's idle frame with a chosen theme in a *fresh* process and
 * prints it as JSON. Fresh, because chalk fixes its colour level the first
 * time it is imported and vitest externalises node_modules, so an in-process
 * test cannot make Ink emit ANSI after the fact. See colour-frame-child.ts.
 *
 * Usage: node --import tsx theme-frame-child.ts dark
 */
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

const theme = process.argv[2] === 'light' ? 'light' : 'dark'

const { render } = await import('ink-testing-library')
const { createElement } = await import('react')
const { App } = await import('../../src/shell/App.js')
const { ThemeProvider } = await import('../../src/shell/ThemeContext.js')
const { paletteFor } = await import('../../src/shell/theme.js')
const { DEFAULT_PREFERENCES } = await import('../../src/config/preferences.js')

const frame =
  render(
    createElement(
      ThemeProvider,
      { palette: paletteFor(theme) },
      createElement(App, { initialWidth: 100, prefs: { ...DEFAULT_PREFERENCES, theme } }),
    ),
  ).lastFrame() ?? ''

process.stdout.write(JSON.stringify(frame))
```

Create `tests/shell/theme-colour.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT } from '../../src/shell/theme.js'

const run = promisify(execFile)
const child = fileURLToPath(new URL('../helpers/theme-frame-child.ts', import.meta.url))

async function frameFor(theme: 'dark' | 'light'): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', child, theme],
    { env: { ...process.env, FORCE_COLOR: '3', NO_COLOR: '' } },
  )
  return JSON.parse(stdout) as string
}

/** '#e5a23c' -> '229;162;60', the body of an SGR truecolor sequence. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('palettes actually reach the terminal', () => {
  it('the dark theme emits its own accent', async () => {
    const frame = await frameFor('dark')
    expect(frame).toContain(rgb(DARK.accent))
  }, 30_000)

  it('the light theme emits its own accent and not the dark one', async () => {
    const frame = await frameFor('light')
    expect(frame).toContain(rgb(LIGHT.accent))
    expect(frame).not.toContain(rgb(DARK.accent))
  }, 30_000)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/theme-colour.test.ts`
Expected: FAIL — the helper does not exist yet, or no accent appears.

- [ ] **Step 3: Make it pass and document the features**

The implementation already exists from Tasks 3–11; if these fail, a component
is still hardcoding a colour instead of reading the palette. Find it and fix
it — that is exactly what this test is for.

Then add to `README.md`, after the Installation section:

````markdown
## Configuration

Forge stores preferences at `~/.config/forge/config.json`
(`$XDG_CONFIG_HOME/forge/config.json` when that is set).

```bash
forge config list                    # show every setting
forge config set output ~/Desktop    # default output folder
forge config set theme light         # dark or light
forge config set quality 80          # what the quality slider opens on
forge config path                    # where the file lives
```

A corrupt config never blocks a conversion — Forge falls back to defaults,
says so once, and carries on.

### Themes

Forge asks which theme suits your terminal the first time you run it, and
remembers. Change it any time with `/theme` in the shell, or
`forge config set theme light`. `NO_COLOR` is honoured and turns both
palettes off.

### Default output folder

The shell's "Save to" step marks your current default and preselects it.
Press `d` on any folder in that list to make it the new default — it takes
effect immediately and is remembered.
````

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, including the pre-existing NO_COLOR test.

Then check it by hand, which no test replaces:

```bash
npm run build && chmod +x dist/index.js
forge                      # banner, theme picker on a fresh config
NO_COLOR=1 forge           # no escape codes at all
COLUMNS=50 forge           # compact band: header only, nothing overflows
forge config list
```

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/theme-frame-child.ts tests/shell/theme-colour.test.ts README.md
git commit -m "test(shell): assert palettes reach the terminal; document config and themes"
```

---

## Self-Review

Run against the spec after the plan is written.

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §4 Theme system — palettes, context, first run, `/theme`, `NO_COLOR` | 3, 4, 5, 12 |
| §5 Identity — mark, wordmark, every launch, compact fallback, CLI silent | 8 |
| §6 Block redesign — file card, result, selection band, errors | 6, 7 |
| §7 Config layer — path, shape, validation, atomic write, CLI surface | 1, 2 |
| §8 Destination defaults — Desktop, hoisting, `d`, interface change | 9, 10 |
| §9 Path completion — all eight listed behaviours | 11 |
| §10 Testing — every listed case | 1–12 |
| §11 Invariants — `core/` purity, no hardcoded formats | 9 (type-only import), 11 (derived extensions) |
| §12 Distribution — README | 12 (Task 2 of the earlier session already added Installation) |

No gaps.

**Placeholder scan:** no "TBD", no "add error handling", no "similar to Task
N". Every code step carries the actual code.

**Type consistency:** `Preferences`, `loadPreferences`, `savePreferences`,
`configPath`, `expandTilde` (Task 1) are used with identical signatures in
Tasks 2, 4, 5, 9, 10, 11. `Palette`, `colourProp`, `paletteFor` (Task 3) are
used identically in Tasks 4–8. `Select` gains `width` in Task 6 and every
call site is enumerated there. `options(source, values, prefs)` is introduced
in Task 9 and both call sites are named.

One consistency note carried forward: Task 10 introduces `livePrefs` state
and explicitly replaces *every* other read of `prefs` in `App`. Task 11's
completion code and Task 8's `Banner` must read `livePrefs`, not `prefs`, if
Task 10 has already landed. Execute tasks in order and this resolves itself.
