# Forge — Phase 1: Identity, Theme, and Preferences

**Date:** 2026-08-19
**Status:** Approved, ready for implementation planning
**Supersedes:** nothing. Extends [2026-08-19-forge-design.md](2026-08-19-forge-design.md).
**Scope:** the visual design pass, the theme system, the configuration layer,
destination defaults, and path completion.

---

## 1. What phase 1 is

The 0.1 shell works and is correct. It is not designed. Every gap between it
and the references it was modelled on — Claude Code, Gemini CLI, Codex CLI —
is a design gap, not a functional one: one accent colour that is declared and
never used, layout vocabulary consisting entirely of `marginBottom={1}`, and
no identity at all.

Phase 1 closes that, and adds the two pieces of state the app has never had:
a theme the user chose and a default output folder the user set.

It is deliberately first. The design language and the preferences layer are
both touched by every screen that phases 2-4 add. Building compress and PDF
first means designing their screens twice.

### The phases

| Phase | Contains |
| --- | --- |
| **1 — this spec** | Visual pass · themes · identity · config layer · destination defaults · path completion |
| 2 | Compress action — quality slider, target size, optional format switch, resize |
| 3 | PDF engine — images→PDF, PDF→images, merge, split |
| 4 | PDF shrinking (macOS Quartz), then PDF→DOCX if still wanted |

Each later phase gets its own spec. Nothing in this document depends on them.

---

## 2. Verified technical facts

Measured on this machine, not assumed, following §2 of the base spec.

**Ink 7.1.1** (`node_modules/ink/build/components/Text.d.ts`):

| Capability | Result |
| --- | --- |
| `inverse` (reverse video) on `<Text>` | available |
| `backgroundColor` on `<Text>` | available, accepts named or hex |
| `dimColor`, `bold` | available |
| Mouse input — any `useMouse`, SGR handling, click events | **absent**. No mouse API is exported |

The absence of mouse support is load-bearing: it is why the side panel
discussed during design was dropped rather than deferred. A pointer-driven
file tree would require hand-rolling SGR 1006 escape parsing on stdin, and
enabling mouse reporting disables the terminal's own text selection.

**Distribution** (npm registry, queried 2026-08-19):

| Name | Status |
| --- | --- |
| `forge-terminal` on npm | available (404) |
| `forge` on npm | taken |
| `forge` as a command name | collides with Foundry's Solidity toolchain |

**Not relevant until phases 3-4, recorded now so it is not re-measured:**
this machine has poppler (`pdftoppm`, `pdftocairo`) and `tesseract`, but has
no Ghostscript, `qpdf`, `mutool`, LibreOffice, or `pandoc`. The poppler and
tesseract binaries are present only because they were installed by hand — a
PDF engine that relies on them works here and fails everywhere else. macOS
ships Quartz PDF filters (visible as Automator's "Compress Images in PDF
Documents"), which is the portable route to PDF shrinking on this platform.

---

## 3. Decisions

| Decision | Why |
| --- | --- |
| Stay an inline scrollback app; no persistent side panel | History committed to `<Static>` survives quitting, which is the property that makes a ten-second tool worth running. A pinned panel requires owning the alt-screen, which forfeits it. Ink has no mouse support regardless (§2). |
| Path completion replaces the panel | Solves the actual problem — getting a file in without typing a full path — in fewer keystrokes than arrowing a tree, and works from any directory. |
| Two full palettes, not one dimmed | A palette that works on `#0e1016` does not work on `#fbfaf7`. Amber at 60% brightness is invisible on paper white; green at dark-theme brightness is unreadable. Each theme gets values chosen for its background. |
| Theme is asked once on first run, not detected | OSC 11 background queries need a stdin round-trip, are not universally answered, and require a timeout when a terminal stays silent. A wrong guess is worse than a question asked once. This is what Claude Code does. |
| Selected row is a filled band, not a border | A border around a row competes with the file card's border. A band reads as "this one" at a glance and matches the reference implementations. |
| No separate region-focus indicator | The band already marks which region owns the keyboard. A second signal for the same fact is noise. |
| Config passed into `core/`, never read by it | Invariant 1: `core/` returns data and performs no ambient I/O. Reading a config file inside `options()` would make the action layer untestable without a filesystem. |
| Desktop is the factory default output | Answers "give me a Desktop preset" and "let me set a default" with one mechanism instead of two. |
| Default is set from the destination step, not a settings menu | The moment you are choosing a destination is the moment you know what your default should be. A settings screen makes you go and find it later. |

---

## 4. Theme system

### Shape

`src/shell/theme.ts` grows a `Palette` type and two instances. Nothing in the
shell may name a colour directly; every colour is read off the active palette.

```ts
export interface Palette {
  fg: string          // bright/primary text
  dim: string         // secondary text
  accent: string      // the one accent — cursor, selected row marker, mark edge
  ok: string
  warn: string
  fail: string
  tag: string         // format tag in the file card border
  label: string       // section labels
  border: string      // resting frame
  selectionBg: string // filled band behind the selected row
}
```

`DARK` and `LIGHT` are the two instances. Values are ANSI colour names where
the terminal theme's own mapping is trustworthy, and hex where a palette needs
a specific value the 16-colour set cannot express.

The active palette reaches components through React context —
`ThemeProvider` / `useTheme()` — rather than a module-level mutable, so tests
can render either theme without global state and `/theme` can switch live.

### `COLOURS`

The existing `COLOURS` export is dead — declared in `theme.ts`, imported
nowhere, with actual colours hardcoded as string literals in `blocks.tsx`.
It is replaced by the palette, and every literal `color="red"`,
`color="green"`, `color="yellow"` in the shell is routed through
`useTheme()`.

### First run

No config file means no theme has been chosen. Before any other screen, the
shell shows a two-option picker rendered in a neutral palette that is legible
on either background — plain foreground, no accent, no background fills. The
answer is written to config, and the picker never appears again.

`/theme` re-opens the same picker.

### `NO_COLOR`

Unchanged from base spec §13. `applyColourPreference()` still runs before Ink
is imported, still sets `FORCE_COLOR=0`, and the palette collapses to plain
text. This must keep working, and the reasoning already documented in
`theme.ts` about chalk reading `FORCE_COLOR` exactly once at import time
stays accurate — the palette is chosen after that point and does not disturb
it. The selected row falls back to `❯` plus bold when colour is off, because
a background band cannot render without colour.

---

## 5. Identity

### The mark

An anvil with a hammer, six rows, rendered left of the wordmark. `FORGE` is
set in an outlined block face — `█` for the face, `╔═╗║╚╝` for the edge.

The outline is the point. Solid-slab block letters at five rows leave `O` and
`G`, and `E` and `F`, with near-identical silhouettes; the edge is what makes
each letter distinguishable, and it is the main reason the reference banners
read cleanly. Six rows rather than five, with a space between letters.

**Colour:** the face takes `palette.fg` — the theme's plain foreground, which
by construction contrasts with the user's background in either mode. The
accent sits on the edge only. A wordmark drawn entirely in accent is a
mid-tone against both backgrounds and reads muddy.

### When it appears

| Context | Shown |
| --- | --- |
| First run | Full mark and wordmark |
| `forge --version` | Full mark and wordmark |
| Every other shell launch | One-line header: `⚒ Forge 0.1.0 · image ─────────── ~/Desktop` |

A six-row banner on every launch pushes the result the user came for off the
top of the screen. The full mark is for the moments when identity is the
point; the header keeps it present everywhere else. The one-line header shows
the current default output folder on the right, which makes the setting
visible without a settings screen.

Both degrade under the compact width band (`< 60`) to the header alone.

---

## 6. Block redesign

Direction C from the design session. All measurements are content, not
chrome — the frame is a single rounded box, not nested panels.

### File card

```
╭─ PNG ─────────────────────────────╮
│  diagram.png                      │
│  2400×1600 · 340 KB · transparent │
╰───────────────────────────────────╯
```

The format tag is inlined into the top border in `palette.tag`. Filename in
`palette.fg`, metadata line in `palette.dim`. The alpha note appears only
when the source actually carries transparency. Width is budgeted off the live
terminal width and truncated with `middleEllipsis`, as today.

### Result

```
✓ done  sunset.heic → sunset.webp
        4.2 MB → 890 KB · 79% smaller
```

`✓ done` in `palette.ok`, filenames in `palette.fg`, the numbers dim, and the
savings phrase in `palette.ok` because it is the payoff of the whole
interaction. Symbol plus word, per base spec §13.

### Selection

```
  CONVERT TO
❯ WebP    smaller, keeps transparency
  JPEG    smallest, no transparency
```

The selected row carries `palette.selectionBg` across the full available
width, with the amber `❯` and bold label on top. Section labels
(`CONVERT TO`, `SAVE TO`) in `palette.label`.

Rendering a full-width band requires padding the row string to the container
width — `<Text backgroundColor>` colours only the characters it is given.
Padding is computed from the measured width, and must account for wide
characters via the existing `string-width` dependency rather than
`String.length`.

### Errors and warnings

Structure unchanged. Colours routed through the palette. Symbol plus word
preserved.

---

## 7. Configuration layer

### Location

`$XDG_CONFIG_HOME/forge/config.json`, defaulting to
`~/.config/forge/config.json`.

### Shape

```json
{
  "theme": "dark",
  "defaultOutput": "~/Desktop",
  "quality": 80
}
```

`defaultOutput` is stored with `~` unexpanded so the file survives being
copied between machines, and expanded on read.

### Module

New `src/config/` — separate from `core/` because it is I/O against a
well-known path, and separate from `shell/` because the CLI reads it too.

```ts
export interface Preferences {
  /** Undefined means no theme has ever been chosen — the shell shows the
      first-run picker. It is the only field that can be absent. */
  theme?: 'dark' | 'light'
  defaultOutput: string
  quality: number
}

export async function loadPreferences(): Promise<{ prefs: Preferences; warning?: string }>
export async function savePreferences(prefs: Preferences): Promise<void>
```

`quality` is the value the quality slider opens on for lossy targets,
replacing the hardcoded `DEFAULT_QUALITY = 80` in `core/actions.ts`. It is
not applied silently — the slider still appears, pre-set to this value.

`loadPreferences` never throws and never blocks a conversion. A missing file
yields defaults with no warning. A corrupt, unparseable, or
wrong-typed file yields defaults plus a warning string the caller renders once
as a history block — the user is told, and the conversion proceeds. Unknown
keys are preserved on write rather than dropped, so a config written by a
later version is not silently destroyed by an earlier one.

`savePreferences` writes atomically — temp file then rename — per invariant 6.

Defaults when no file exists: `theme` absent (triggers the first-run picker),
`defaultOutput` `~/Desktop`, `quality` 80.

A file that exists but has no `theme` key is treated the same as no file for
theme purposes — the picker runs and the answer is written back, leaving the
other keys untouched.

### CLI surface

```
forge config list
forge config set output ~/Desktop
forge config set theme light
forge config path
```

These exit 0 on success and 2 on a usage error, matching base spec §9.

---

## 8. Destination defaults

### Presets

`destinationPath()` gains Desktop and takes the configured default:

| Preset | Path |
| --- | --- |
| Desktop | `~/Desktop` |
| Same folder | source's directory |
| Downloads | `~/Downloads` |
| New subfolder | `<source dir>/converted` |

The configured default is hoisted to the top of the list and preselected. The
existing dedupe by resolved path stays and now matters more — with Desktop
added, a file already on the Desktop collides "Desktop" with "Same folder".
The earlier, more specific preset wins, as today.

### Setting the default in place

```
  SAVE TO
❯ Desktop         ~/Desktop              default
  Same folder     ~/Pictures
  Downloads       ~/Downloads
  New subfolder   ~/Pictures/converted

  → ~/Desktop/diagram.webp
  ↑↓ choose · ↵ save · d make default · esc back
```

`d` on the highlighted row writes it to config, moves the `default` tag, and
commits a history note (`✓ default output is now ~/Desktop`). It does not
advance the flow — the user is still choosing where this conversion goes.

`d` on a row whose path is already the default is a no-op, not an error.

A free-typed path can also be made default with the same key, which is how a
folder that is not one of the four presets becomes the default.

### Interface change

`Action.options()` takes preferences as a third parameter:

```ts
options(source: SourceInfo, values: Record<string, unknown>, prefs: Preferences): OptionSpec[]
```

`core/` still reads nothing from disk and imports nothing from `src/config/`
except the `Preferences` type. The shell loads preferences once at startup and
threads them in. This preserves invariant 1 and keeps the action layer
testable with a literal object.

---

## 9. Path completion

Tab in the idle prompt completes against the filesystem.

- Tab with a unique match completes it inline.
- Tab with several matches completes the longest common prefix and lists
  matches below the prompt, dim, capped at the height the width band allows.
- Directories complete with a trailing `/` so the next Tab descends.
- `~` expands.
- Completion is case-insensitive, matching macOS filesystem behaviour.
- Listing is filtered to sources Forge can actually probe, plus directories —
  offering a `.txt` the app will reject is a dead end.
- Dotfiles appear only when the typed fragment itself starts with `.`.

Completion reads a directory per keystroke at most, and never recurses. If
the directory cannot be read, Tab does nothing rather than raising an error —
an unreadable folder is not a failure the user asked for.

This is the one component in phase 1 independent of the rest. If phase 1 runs
long, it is what gets cut to phase 1.5.

---

## 10. Testing

Per the repo's TDD rule, tests come first. The shell is tested through its
interaction, per base spec §14.

**Theme**
- Both palettes render every block kind; frames asserted via `lastFrame()`.
- `NO_COLOR` collapses both palettes to plain text with no escape sequences.
- The selected row falls back to `❯` plus bold when colour is off.
- First-run picker appears with no config and never appears with one.

**Config**
- Round-trip: save then load returns an equal object.
- Missing file yields defaults, no warning.
- Corrupt JSON, valid JSON of the wrong shape, and unreadable file each yield
  defaults plus a warning, and never throw.
- Unknown keys survive a save.
- Write is atomic: an interrupted write leaves no temp file and does not
  truncate the previous config.
- `XDG_CONFIG_HOME` is honoured when set.

**Destination**
- Configured default is hoisted and preselected.
- Desktop preset present; dedupe holds when the source is already on the
  Desktop.
- `d` writes config, moves the tag, commits a note, and does not advance the
  stage — driven through `ink-testing-library`.
- `d` on the current default is a no-op.

**Completion**
- Unique match completes; multiple matches complete the common prefix.
- Directory completion appends `/`.
- `~` expands; case-insensitive matching.
- Unreadable directory is silent.
- Non-convertible files are excluded from listings.

**Identity**
- Full mark on first run and `--version`; header otherwise.
- Compact width band shows the header only.

---

## 11. Invariants

Phase 1 must not regress any of the seven in `CLAUDE.md`. Two are touched and
need explicit care:

1. **`core/` and `engines/` import no React, Ink, or Chalk and never write to
   stdout.** The config layer lives outside `core/`, and `core/` receives
   `Preferences` as a parameter. `core/` imports the type only.
2. **No hardcoded list of output formats.** The redesign touches how choices
   are rendered, never where they come from. `targetsFor(source)` remains the
   only source of targets.

Invariants 3-7 (content probing, `.rotate()` first, alpha flattening, atomic
writes, honest progress) are untouched by this phase. Atomic writes now also
cover the config file.

---

## 12. Distribution

`forge-terminal` is free on npm and is the package name. Publishing is not
part of phase 1, but the README now documents both the source install and the
eventual `npm install -g forge-terminal`.

**The command name stays `forge` for phase 1.** It collides with Foundry's
Solidity toolchain, which installs a binary of the same name; whichever is
linked last wins. This is documented in the README along with `which -a forge`
to detect it and the `bin` field to rename it locally. The decision is
recorded here because it becomes expensive to reverse once people have
installed: renaming after publication orphans the old command. If the name is
to change, it changes before the first `npm publish`, not after.

---

## 13. Not in phase 1

Compress, resize, PDF in any direction, HEIC encoding, watch mode, a plugin
system, mouse support, a persistent side panel, and alt-screen mode.

Theme customisation beyond the two shipped palettes — user-defined colours,
theme files — is deferred. Two well-made palettes cover the need; a theming
system is a project of its own.
