# UX Audit — Convert / `forge`

**Date:** 2026-08-31
**Audited:** commit `a44f115` (built binary). HEAD moved to `2ed9750` during
the audit, and uncommitted work on `src/shell/App.tsx` / `src/shell/theme.ts`
appeared partway through — a few presentation details below may already be in
flux.
**Surfaces:** the flag CLI and the interactive shell.

---

## Method

Both front ends were driven for real, not read.

- **CLI** — invoked directly, exit codes captured separately from stdout so a
  pipe could not mask them.
- **Shell** — driven under `tmux` at 48, 72, 100 and 120 columns via
  `send-keys` / `capture-pane`, including `capture-pane -e` to inspect the SGR
  sequences behind a rendered frame.
- **Fixtures** — generated per run, never committed: JPEG, PNG with alpha,
  3000×2000 PNG, 8-bit noise JPEG (4.7 MB), 4-frame animated GIF, HEIC (via
  `sips`), 8-page and 3-page PDFs, and a DOCX with headings, bold, italic and
  bullets.
- **Edge cases** — corrupt file, zero-byte file, empty directory, read-only
  destination, output-is-input, colliding batch outputs, a 97-character
  filename, paths containing spaces in shell-escaped (drag-and-drop) form,
  multi-file paste, `NO_COLOR=1`, non-TTY and piped invocation.

### Priority scale

| | Meaning |
| --- | --- |
| **P0** | Breaks trust or tooling immediately, and affects every user on every run. |
| **P1** | Produces a wrong outcome, a dead end, or an unanswerable question inside a core flow. |
| **P2** | Friction, inconsistency, or an affordance that exists but cannot be found. |
| **P3** | Polish. |

### Counts

| Priority | Count |
| --- | --- |
| P0 | 1 |
| P1 | 10 |
| P2 | 13 |
| P3 | 6 |

---

## At a glance

Thirty findings, one line each. The numbers are stable — they are how the rest
of this document and the companion `UX-Audit.html` refer to a finding.

| # | Finding | P | Surface |
| --- | --- | --- | --- |
| 1 | Every invocation prints a Node `ExperimentalWarning` to stderr — including `--version` | P0 | both |
| 2 | `-o/--output` is silently ignored when compressing — and the error tells you to use it | P1 | CLI |
| 3 | CLI errors tell you to type shell slash-commands | P1 | CLI |
| 4 | A read-only destination reports "Conversion failed", not "permission denied" | P1 | both |
| 5 | Resizing the terminal leaves the old frame on screen, and it accumulates | P1 | shell |
| 6 | Multi-file drop is a false affordance — probed, drawn, then refused | P1 | shell |
| 7 | A failed conversion leaves the file staged, and the next drop *appends* | P1 | shell |
| 8 | Resolution opens on 72 dpi while 150 dpi is labelled "default" | P1 | shell |
| 9 | The result screen never says where the file went | P1 | both |
| 10 | Under `NO_COLOR` the page grid has no cursor at all | P1 | shell |
| 11 | Dropping a folder is refused with a hint recommending folders | P1 | shell |
| 12 | Hint bar is wrong in the "Type a path…" state | P2 | shell |
| 13 | Hint bar omits affordances that exist (`esc`, `↑↓`, `←→`) | P2 | shell |
| 14 | The chosen target format disappears after the picker | P2 | shell |
| 15 | `/pdf` armed before staging is a dead end | P2 | shell |
| 16 | Page ops and multi-output conversions get a one-line result | P2 | shell |
| 17 | Merge output is named after the containing folder, and `--output` is refused | P2 | CLI |
| 18 | Collision error implies nothing was written; one file was | P2 | CLI |
| 19 | `forge --help` never mentions the `config` subcommand | P2 | CLI |
| 20 | `config set output` accepts any path, valid or not | P2 | CLI |
| 21 | No `/quit` or `/exit`, and `/help` does not say how to leave | P2 | shell |
| 22 | `--background` is not validated at parse time | P2 | CLI |
| 23 | Shell defaults to Desktop; CLI writes beside the source | P2 | both |
| 24 | The mouse/DSR handshake ignores `mouseSupported()` | P2 | shell |
| 25 | Three different error styles in one command | P3 | CLI |
| 26 | Banner says `· image`, and the default path is unlabelled | P3 | shell |
| 27 | ~1 s to first prompt, 520 ms of it unskippable animation | P3 | shell |
| 28 | No input history, and `esc` discards a staged file outright | P3 | shell |
| 29 | Theme picker uses a different hint style from every other step | P3 | shell |
| 30 | Low-information format hints — four of six read "likely bigger" | P3 | shell |

---

## Two things to know first

1. **`npm test` is red on `dev`.** `tests/index.test.ts:84` fails, and it fails
   for finding #1 below — the suite already catches it.
2. The audit left one artefact on the Desktop, `~/Desktop/photo.png`, written
   by a shell run that used the configured default destination. Not deleted,
   since it is outside the repo.

---

## P0

### 1. Every invocation prints a Node warning to stderr — including `--version`

**Type:** Trust / Scripting · **Surfaces:** both

```console
$ forge --version
0.1.0
(node:95249) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
```

`--trace-warnings` traces it to `node_modules/docx/dist/index.mjs:4337`, pulled
in eagerly through `src/engines/registry.ts` → `src/engines/word.ts` on Node 26.

Three consequences:

- Every scripted use of `forge` gets noise on stderr, including `--version` and
  `--formats`, which touch no engine at all.
- It is **the first thing on screen when the shell launches**, printed above the
  banner — the app looks broken before it has drawn anything.
- The project's own suite asserts `stderr === ''` (`tests/index.test.ts:84`) and
  is failing on it.

**Fix:** lazy-load `docx` behind the Word engine's `run()`. This also removes it
from the ~270 ms cold start (#27).

---

## P1

### 2. `-o/--output` is silently ignored when compressing — and the error tells you to use it

**Type:** Silent no-op / Misleading guidance · **Surface:** CLI

```console
$ forge noisy.jpg --quality 40 -o elsewhere/
✓ noisy.jpg → noisy-small.jpg
$ ls elsewhere/          # empty — the file was written beside the source
```

`CompressIntent` in `src/cli/args.ts` has no `output` field, so `-o` is parsed
and dropped. The closed loop: run it twice and the collision error says

> Pass `--force` to replace it, **or choose a different `--output`**.

which cannot work, because `--output` does nothing on this path.

**Fix:** honour `-o`, or refuse it explicitly the way `--separate` and page-op
`--output` are already refused. Silently dropping a flag someone typed is the
defect the page-op branch was written to avoid — the compress branch needs the
same rule.

### 3. CLI errors tell you to type shell slash-commands

**Type:** Cross-surface copy leak · **Surface:** CLI

```console
$ forge noisy.jpg --max-size 1kb --force
✕ Cannot get that small

  noisy.jpg is 11.6 KB even at the lowest quality, which is still over 1 KB.

  Try a larger target, or /convert to a smaller format.
```

There is no `/convert` in the CLI. Four sites in `src/core/errors.ts` —
lines **181** (`/pdf`, `/convert`), **193** (`/convert`), **201** (`/convert`),
**236** (`/convert`).

The hints are *correct* in the shell, where the app even auto-falls-back to the
convert picker after `Nothing to compress`. So the copy is right for one surface
and wrong for the other.

**Fix:** a surface-aware hint, or two hint fields on `ForgeError`.

### 4. A read-only destination reports "Conversion failed", not "permission denied"

**Type:** Error classification · **Surfaces:** both

```console
$ chmod 500 locked && forge big.png --to jpeg -o locked/
✕ Conversion failed

  big.png could not be converted.

  Run again with --debug for the underlying error.
```

`--debug` reveals the actual cause plainly:

```
system error: Permission denied
```

There is already a `permission-denied` code, and §11 of the design explains
that Node reports `EACCES` reliably — but only *input* paths are pre-checked
with `fs.access`. Output paths are not.

Two compounding problems:

- A precise, actionable diagnosis is discarded in favour of a generic one.
- **The shell shows the same text**, telling an interactive user to "run again
  with `--debug`" — a flag their surface does not have. The mirror image of #3.

### 5. Resizing the terminal leaves the old frame on screen, and it accumulates

**Type:** Rendering · **Surface:** shell

One orphaned copy of the live region is left behind per resize. After four:

```console
$ tmux capture-pane -p | grep -c "current mode"
5
```

Mid-flow it is worse — the previous 50-column file card is left hard-wrapped and
interleaved with the new one:

```
╭─ PNG ─────────────────────────────────────────
───╮
│ a-really-quite-extraordi…y-use-but-people-do.p
 current mode: convert  use / to change mode

 convert  / to change
```

§13 says width changes are observed via `resize` on Ink's `useStdout()` stream,
and the *new* frame is correct at every band — but the old one is never erased.

### 6. Multi-file drop is a false affordance

**Type:** Dead end · **Surface:** shell

Drop two files. Both are probed, and a rich card is drawn — per-file format,
dimensions, count, total size:

```
╭─ MIXED ×2 ───────────────────────────────────────╮
│ JPEG photo.jpg                          1200×800 │
│ PNG  big.png                           3000×2000 │
│                                                  │
│ 2 files · 86.6 KB                                │
╰──────────────────────────────────────────────────╯
```

Only **after** the user presses Enter:

```
⚠ Converting several files at once isn't supported yet. Drop a single file,
  or esc to clear the list.
```

The interface builds the expectation, spends the probe cost on both files, then
refuses. There is also no way to remove *one* file — it is the whole list or
nothing.

Note this makes spec §10 ("One path per drop … `splitPastedPaths` is
deliberately not wired in") stale: splitting *is* wired in now.

**Fix:** either say it in the card at staging time, or don't stage the second
file.

### 7. A failed conversion leaves the file staged, and the next drop *appends*

**Type:** Flow trap · **Surface:** shell

The natural recovery from an error — drop the file again, or drop a different
one — walks straight into #6:

```
✕ Conversion failed  (big.png)

 current mode: convert  big.png          ← still staged

› photo.jpg  ⏎

╭─ MIXED ×2 ───╮ … ⚠ Converting several files at once isn't supported yet.
```

After a **successful** conversion the state resets correctly and a new drop
replaces the old file, so this is specific to the error path. `ctrl-n` clears
it, but the warning text points at `esc`, not `ctrl-n`.

### 8. The Resolution step opens on 72 dpi while 150 dpi is labelled "default"

**Type:** Wrong default / Correctness · **Surface:** shell

```
Resolution
❯ 72 dpi   screen
  150 dpi  default          ← says default, is not selected
  300 dpi  print
```

Verified on the output: rasterised pages came out **595×842**, i.e. 72 dpi.

`dpiSelect()` declares `default: '150'` (`src/core/actions/convert.ts:47`), but
`Select` initialises to `firstEnabled(items)` and no call site passes an initial
index — **`OptionSpec.default` is dead for every select in the shell**. It only
bites here today because dpi is the one spec whose default is not index 0
(`pages`, target, `rotate`, `split`, `extract`, `compress` all happen to have
theirs first).

Anyone pressing Enter through a PDF rasterisation silently gets
screen-resolution images, and 150 is the documented default everywhere else —
`--dpi`'s Commander default, `invalidDpi`'s message, and the choice's own hint.

### 9. The result screen never says where the file went

**Type:** Feedback · **Surfaces:** both

In the shell, a destination typed with a stray leading `d` (left over from the
hint bar's `d make default` — see #12) caused Forge to silently create
`d/nonexistent-root-xyz/out/` three levels deep, write there, and report:

```
✓ done

╭─ PNG ────────╮  ──→  ╭─ JPEG ───────╮
│ big.png      │       │ big.jpg      │
╰──────────────╯       ╰──────────────╯

  83.4 KB → 18 KB · 78.5% smaller
```

No folder anywhere on screen. With the shell defaulting to Desktop and the CLI
defaulting to alongside-the-source (#23), "where is it?" is the one question the
result screen has to answer.

The CLI has the same gap for a single file — these two runs print byte-identical
success lines:

```console
$ forge photo.jpg --to png -o out/
✓ photo.jpg → photo.png
$ forge photo.jpg --to png -o deep/nested/dir/
✓ photo.jpg → photo.png
```

The batch report already does the right thing (`Output: batchout/`).

### 10. Under `NO_COLOR`, the page grid has no cursor at all

**Type:** Accessibility · **Surface:** shell

Focus in `PageGrid` is a background tint and nothing else — no `❯`, no bold, no
border change. `NO_COLOR=1` correctly strips all colour (zero SGR sequences in
the captured frame), which leaves eight identical boxes:

```
0 of 8 selected

╭───╮   ╭───╮   ╭───╮   ╭───╮   ╭───╮   ╭───╮   ╭───╮   ╭───╮
│ 1 │   │ 2 │   │ 3 │   │ 4 │   │ 5 │   │ 6 │   │ 7 │   │ 8 │
╰───╯   ╰───╯   ╰───╯   ╰───╯   ╰───╯   ╰───╯   ╰───╯   ╰───╯
```

Pressing `→ → space` was the only way to discover the cursor had been on page 3.
Selection is correctly symbol-based (`✓` in the top border); focus needs the
same treatment.

This contradicts the project's own §13 invariant: *"Selected rows are marked
with `❯` and bold, not colour alone."* `Select` honours it; `PageGrid` does not.

### 11. Dropping a folder is refused with a hint recommending folders

**Type:** Wrong error copy · **Surface:** shell

```
╭──────────────────────────────────────────────────╮
│ ✕ Not a file                                     │
│ tree is not a file.                              │
│ Point Forge at an image, or at a directory of    │
│ images.                                          │
╰──────────────────────────────────────────────────╯
```

`tree/` *is* a directory of images. `src/core/errors.ts:79` — the hint is
written for the CLI, where directories work. In the shell it is advice to
repeat the failure.

---

## P2

| # | Finding | Type | Where |
| --- | --- | --- | --- |
| 12 | **Hint bar is wrong in the "Type a path…" state.** It still reads `↑↓ choose · ↵ next · d make default` while the field is a text input — `d` types a literal `d`. This is how #9's typo happened. | Wrong affordance | shell |
| 13 | **Hint bar omits affordances that exist.** `esc back` is missing at the destination step (it works); `↑↓` is missing while the command palette is open (it works); `←→` is missing in the page grid (it works). These are the steps where changing your mind is most likely. | Discoverability | shell |
| 14 | **The chosen target format disappears after the picker.** At the Quality step only the *source* card is on screen — nothing states what you are converting to until the destination preview reveals it. §10 says a picker "becomes part of the scrollback"; it does not. | Orientation | shell |
| 15 | **`/pdf` armed before staging is a dead end.** The mode line reads `current mode: pdf`, the app prints `→ /pdf for page operations`, and Enter does nothing at all. You must retype `/pdf` after staging to reach the operation picker. | Dead end | shell |
| 16 | **Page ops and multi-output conversions get a one-line result.** `✓ merged 2 files into forge-audit-merged.pdf` and `✓ converted into 2 files` — no path, no size, no `o open` / `s show in finder`. Single-file conversions get the full result screen. | Consistency | shell |
| 17 | **Merge output is named after the containing folder** (`pdfw-merged.pdf`, `src/core/output-path.ts:202`) and `--output` is explicitly refused for page ops — so a CLI user cannot name a merge result. The shell can, via `n rename`. Run it in `~/Downloads` and you get `Downloads-merged.pdf`. | Naming / parity | CLI |
| 18 | **Collision error implies nothing was written; one file was.** *"a.jpg and a.webp **would both become** a.avif"* — but `checkWriteSafety` keeps the first claimant, so `a.avif` exists. It is printed *after* `✓ 2 converted`, which does not name which 2. | Accuracy | CLI |
| 19 | **`forge --help` never mentions the `config` subcommand.** `config list` / `set` / `path` are fully undiscoverable from help. | Discoverability | CLI |
| 20 | **`config set output` accepts anything.** `/nonexistent/nope/deeper` was stored without complaint and then displayed in the shell banner as the default destination. `quality` and `theme` *are* validated. | Validation | CLI |
| 21 | **No `/quit` or `/exit`.** `/quit` → *"no command matches /quit — try /help"*, and `/help` does not say how to leave either. `ctrl-c` is in the hint bar, but the command palette is where people will look. | Discoverability | shell |
| 22 | **`--background` is not validated at parse time.** `--background notacolour` succeeds silently on a source without alpha, and fails as an opaque `Conversion failed` on one with alpha — same flag value, two outcomes depending on the file. Every other flag validates up front. | Validation | CLI |
| 23 | **Shell defaults to Desktop; CLI writes beside the source.** Same tool, two answers to "where does my file go?", and #9 means the shell never tells you which it used. | Consistency | both |
| 24 | **The mouse/DSR handshake ignores `mouseSupported()`.** `useMouse` gates only on `isTTY`, so cursor-position queries go out even where the app has already decided mouse support is absent and hidden the result links. Under tmux the unconsumed reply prints on screen at launch: `^[[22;1R`. | Rendering | shell |

---

## P3

| # | Finding | Type | Where |
| --- | --- | --- | --- |
| 25 | **Three error styles in one command.** `config set bogus 1` → full `✕ Invalid arguments` block; `config set quality 999` → bare one-liner with no symbol (breaks §13's "symbol and a word"); `--to` with no value → raw Commander `error: option '-t, --to <format>' argument missing`. | Consistency | CLI |
| 26 | **Banner says `· image`.** Hardcoded at `src/shell/intro.ts:111`, stale now that PDF page operations and Word conversion are headline features. The default path on the right is unlabelled — nothing says it is the destination. | Copy | shell |
| 27 | **~1 s to first prompt** — ~270 ms Node start (mostly #1, plus eager sharp/pdfium) and 520 ms of unskippable intro animation (5 frames × 130 ms). No flag skips it. | Performance | shell |
| 28 | **No input history.** `↑` does nothing at the prompt, and `esc` discards a staged file outright — so recovering from #7 or #11 means retyping the whole path. | Efficiency | shell |
| 29 | **Theme picker uses a different hint style** (`↑↓ choose · ↵ confirm · …`, no rule) from every other step's bordered `HintBar` with `│` separators. | Consistency | shell |
| 30 | **Low-information format hints.** For a JPEG source, four of six targets read "likely bigger". The cursor also starts on PNG ("likely bigger") rather than WebP ("smaller, modern"). | Copy | shell |

---

## What works well

Worth recording, because it is most of the surface.

- **The error taxonomy is unusually good.** `✕ Cannot get that small` names the
  smallest size actually achievable; `--extract 99` names the page count;
  `unsupported-target` lists available formats derived from the capability
  graph rather than a hardcoded list.
- **Compact-width banding is genuinely well done.** At 48 columns the file card
  collapses to a single line, choice hints drop, and the hint bar reduces to
  `↵ send │ / commands`. Nothing overflows.
- **Middle-ellipsis truncation** handles a 97-character filename cleanly at both
  72 and 48 columns.
- **Animation is handled honestly** — GIF→WebP keeps all 4 frames; GIF→PNG
  converts the first and says so: *"anim2.gif has 4 frames, and PNG cannot
  animate. Only the first frame was converted."*
- **The overwrite consent choice** (Keep both / Replace / Cancel, with
  `photo (1).webp` named in the row) is exactly right.
- **The merge ordering screen** — `space pick up`, `s sort`, `x remove`,
  `n rename`, with a live output preview and page total.
- **The LibreOffice-absent warning** is prominent and tells you the exact
  `brew` command.
- **Argument validation** for `--quality`, `--dpi`, `--rotate`,
  `--split every=N` and `--max-size` is thorough, with messages that name the
  bad value and the valid range.
- **Exit codes follow §9** in every case checked: 0 all succeeded, 1 some
  failed, 2 invalid arguments.
- **Non-TTY handling** is correct — `forge < /dev/null` prints
  *"Forge needs a file and a target format"* rather than hanging on a keypress.

---

## Not covered

- **Real Terminal.app.** Everything shell-side ran under tmux, which reports no
  hyperlink or mouse support — #24 and the `mouseSupported()`-gated result links
  may behave differently there.
- The **LibreOffice-present** conversion path (not installed on this machine).
- **Encrypted PDFs** and `--password-stdin`.
- Batches large enough to exercise **concurrency limits**.
- The **light theme**.
