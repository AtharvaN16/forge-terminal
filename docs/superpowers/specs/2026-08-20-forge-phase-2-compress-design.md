# Forge — Phase 2: Slash Commands and Compress

**Date:** 2026-08-20
**Status:** Approved, ready for implementation planning
**Extends:** [2026-08-19-forge-design.md](2026-08-19-forge-design.md),
[2026-08-19-forge-phase-1-design.md](2026-08-19-forge-phase-1-design.md)
**Scope:** a slash-command layer, the compress action, and target-size search.

---

## 1. What phase 2 is

Forge converts. It cannot make a file smaller without also changing what the
file is, which is the single most common thing people actually want from an
image tool. `--quality` without `--to` has been reserved for this since the
original spec (§315) and errors today with "No target format given".

Phase 2 adds compression, and the command layer that makes room for it.

### Why commands rather than a menu

Adding a second action raises the question of how anyone reaches it. A
"Convert or Compress?" menu in front of every file taxes the common path to
serve the rarer one. A slash command taxes nothing, and — with a palette that
opens on `/` — is discoverable rather than hidden.

The deciding argument is what comes after. PDF compression cannot reuse the
image convert flow: different engine, different options, different failure
modes. A registry of commands gives each action its own path without the flow
having to know how many actions exist. `/merge` and `/split` land in the same
place later without touching anything.

---

## 2. Verified technical facts

Measured on this machine, not assumed.

**Target-size search is affordable.** Eight encode attempts on a 4032×3024
JPEG — exactly the worst case §6 bounds the search at:

| Approach | Time |
| --- | --- |
| Re-read and re-decode the file each attempt | 307 ms |
| Decode once to raw pixels, re-encode from memory | 293 ms |
| Memory held by the raw buffer | 34.9 MB |

That is about 38 ms an encode, so a worst-case search costs roughly a third of
a second on a 12MP image, and
**the raw-buffer optimisation is not worth building** — it saves 5% for 35MB
of resident memory. The fixture was a flat colour and a real photograph will
be slower, but not by an order of magnitude.

**`actionsFor()` has never been called.** It exists in `core/actions.ts` and
the shell goes straight to `convertAction`, because with one action there was
nothing to choose between. Phase 2 is the first time that changes.

---

## 3. Decisions

| Decision | Why |
| --- | --- |
| Slash commands, not an action menu | A menu costs every conversion to serve the rarer action. Commands cost nothing on the common path, and PDF compression will need its own path regardless. |
| A palette that opens on `/` | Commands are only worth having if they can be found. The palette is the discovery mechanism, and answers the main objection to commands. |
| Dropping a file still means convert | The fastest path stays fastest, and nothing about the existing flow changes. |
| Compress never changes the format | A file whose extension changes underneath you is a surprise, and anything linking to it breaks. Format changes belong to `/convert`. |
| …but a better format is offered afterwards | The win is real and worth surfacing. It is offered as a next step, not applied. |
| The suggestion is measured, never estimated | Spec §12 forbids fabricated progress; a fabricated size claim is the same offence. The candidate is actually encoded before anything is said about it. |
| Quality slider **and** target size | They answer different questions — "how much quality am I willing to lose" and "what will the upload accept". Neither substitutes for the other. |
| Target-size search adjusts quality only | Silently changing dimensions to hit a number is the surprising behaviour. Resize stays a separate, later action. |
| `core/actions.ts` splits into `core/actions/` | It is ~190 lines and would roughly double. One file per action is also where the PDF actions will want to land. |

---

## 4. The command layer

### The registry

New `src/shell/commands.ts`, holding a list rather than a switch:

```ts
export interface Command {
  name: string           // without the slash
  description: string    // shown in the palette
  /** Whether it needs a staged file to make sense. */
  needsSource: boolean
}

export const COMMANDS: Command[] = [
  { name: 'convert',  description: "change a file's format",        needsSource: true  },
  { name: 'compress', description: 'make a file smaller',           needsSource: true  },
  { name: 'theme',    description: 'switch between light and dark', needsSource: false },
  { name: 'help',     description: 'list these',                    needsSource: false },
]

export function matchCommands(fragment: string): Command[]
export function parseCommand(input: string): Command | undefined
```

`matchCommands` takes what has been typed after the `/` and returns the
matching commands, prefix-matched and case-insensitive.

`/theme` moves here from the hardcoded branch it occupies in `App.tsx` today,
so there is one place commands are defined and one place they are listed.

### The palette

New `src/shell/components/CommandPalette.tsx`, rendered only while the prompt
buffer starts with `/`:

```
  /convert     change a file's format
  /compress    make a file smaller
  /theme       switch between light and dark
  /help        list these
  ────────────────────────────────────────────
› /co▏
```

It reuses `Select` — the same amber `❯`, the same selection band, the same
width budgeting — with the command name in `palette.accent` and the
description in `palette.dim`. Arrows move, Enter runs the highlighted command,
and deleting the `/` dismisses it. It costs nothing on the normal path because
it is not rendered at all unless the buffer opens with a slash.

Enter on an unmatched command produces an error block naming what exists,
rather than the input being probed as a filename.

### What a command does with a staged file

`needsSource` decides. `/compress` with a file already staged switches that
file into the compress flow. With nothing staged it asks for one, and the next
file dropped goes to compress rather than convert. `/theme` and `/help` ignore
the staged file entirely.

---

## 5. The compress flow

`/compress` on an image:

```
  Compress photo.jpg
❯ By quality        pick a level, see the result
  To a target size  smallest quality that fits

  ↑↓ choose · ↵ confirm · esc back
```

**By quality** reuses the existing `Slider`, opening on `prefs.quality`.

**To a target size** raises a text field accepting `500kb`, `2 MB`, `1.5mb` —
case-insensitive, optional space, KB/MB/GB as powers of 1024. A value that
cannot be parsed is rejected in the field rather than at conversion time.

Both then continue into the destination and name steps unchanged, so
compression inherits the write-safety rules, the default-output setting, and
the collision handling that already exist.

### Naming the output

The default name gains a suffix — `photo.jpg` compresses to `photo-small.jpg`
— because the output shares its extension with the input and would otherwise
collide with it on every run. The name step is already in the flow, so this is
a default the user can overwrite rather than a rule.

---

## 6. Target-size search

New `src/core/compress.ts`, pure and engine-agnostic:

```ts
export interface SearchRequest {
  /** Encodes at a quality and resolves the resulting byte length. */
  encode: (quality: number) => Promise<number>
  targetBytes: number
  min: number          // 1
  max: number          // 100
  onAttempt?: (attempt: number, of: number) => void
}

export interface SearchResult {
  quality: number
  bytes: number
  /** True when even `min` quality overshot the target. */
  missed: boolean
}

export function findQuality(req: SearchRequest): Promise<SearchResult>
```

A binary search over the quality range, returning the **highest** quality
whose output fits. The iteration count is bounded by
`1 + ceil(log2(100))` = 8 — seven bisections plus the one probe at maximum
quality that always runs first — so `onAttempt` reports a real position in a
known sequence, `attempt 3 of 8`, rather than a fabricated percentage.

*(Corrected during implementation: this originally said 7, having counted the
bisections and forgotten the probe. Reporting "attempt 8 of 7" would have been
exactly the dishonesty the bound exists to prevent.)* This satisfies spec §12 honestly: the
denominator is known in advance because the algorithm decides it.

When even quality 1 exceeds the target, `missed` is true and nothing is
written. The shell says so plainly and names the smallest size achievable,
so the user learns what is actually possible rather than receiving a file
that quietly misses the number they asked for.

`findQuality` takes `encode` as a parameter and never imports Sharp, so it is
tested against a synthetic size curve with no image work at all.

---

## 7. The format suggestion

After a same-format compression, Forge encodes one candidate in the strongest
alternative format for the source — WebP for a JPEG or PNG, chosen from the
capability graph, never a hardcoded pairing — at the quality just settled on.

If the candidate is at least 25% smaller than the result, the shell offers it:

```
  ✓ done   photo.jpg → photo-small.jpg
           4.2 MB → 1.1 MB · 73% smaller

  ⚠ WebP would be 480 KB — 56% smaller again.
    ↵ convert another · w convert to WebP · o open · s show in finder
```

The candidate is genuinely encoded before the claim is made. Encoding it costs
one more pass, which §2 measures at roughly 40ms on a 12MP image, and the
alternative — estimating — would be inventing a number, which this codebase
does not do.

The suggestion is skipped when the source is already the strongest format, and
when the saving falls under the threshold.

---

## 8. CLI surface

```bash
forge photo.jpg --quality 60           # compress, same format
forge photo.jpg --max-size 500kb       # compress to fit
forge *.jpg --max-size 1mb             # the batch path already exists
```

`--quality` without `--to` stops being an error and becomes compress.
`--max-size` is new and mutually exclusive with `--quality`: they are two ways
of answering the same question, and accepting both would leave the precedence
undefined. Giving both is a usage error, exit 2.

Exit codes are unchanged from spec §9.

---

## 9. Code layout

`core/actions.ts` becomes a directory:

| File | Holds |
| --- | --- |
| `core/actions/index.ts` | The `Action` interface, `ACTIONS`, `actionsFor` |
| `core/actions/convert.ts` | `convertAction`, unchanged behaviour |
| `core/actions/compress.ts` | `compressAction` |

The `Action` interface gains nothing: compress describes itself with the same
`options()` / `plan()` shape convert already uses, which is what §228 of the
original spec predicted when it said a compress action would need no new UI
components.

`engines/image.ts` gains one export — an encode-to-buffer helper the search
calls — and its existing conversion path is untouched.

---

## 10. Testing

**Commands**
- `matchCommands` prefix-matches case-insensitively and returns everything for
  an empty fragment.
- The palette renders only when the buffer opens with `/`.
- Enter runs the highlighted command; an unmatched name produces an error
  block rather than a probe.
- `/theme` still works after moving into the registry.
- Typing a path that happens to contain a slash later (`~/Desktop/a.png`) does
  not open the palette.

**Target-size search**
- Against a synthetic monotonic size curve, finds the highest quality that
  fits.
- Reports a bounded, honest attempt count.
- Sets `missed` and writes nothing when the target is unreachable.
- Handles a target larger than the original — returns `max` without searching.

**Compress flow**
- `/compress` with a staged file enters compress; with none, asks for a file.
- Quality and target-size branches both reach the destination step.
- The output name defaults to a suffixed form and does not collide with the
  input.
- Size parsing: `500kb`, `2 MB`, `1.5mb`, and rejection of `abc` and `-5mb`.

**Suggestion**
- Offered only when the alternative is genuinely ≥25% smaller.
- The candidate is encoded, not estimated — asserted by the suggestion's
  reported size matching a real encode.
- Skipped when the source is already the strongest format.

**CLI**
- `--quality` without `--to` compresses.
- `--max-size` parses and compresses.
- Both together is a usage error, exit 2.

---

## 11. Invariants

All seven in `CLAUDE.md` hold unchanged. Two deserve a note:

**No hardcoded format lists.** The suggestion picks its candidate from the
capability graph, not a table of pairings.

**Progress is never fabricated.** The search reports a real position in a
sequence whose length the algorithm knows in advance. Nothing reports a
percentage it cannot derive.

---

## 12. Not in phase 2

Resize, PDF compression, and a batch-specific compress interface.

Resize is deliberately excluded rather than merely deferred: a target-size
search that reaches its number by quietly changing an image's dimensions is
exactly the surprising behaviour this design rejects elsewhere. When resize
arrives it should be its own command, asked for explicitly.
