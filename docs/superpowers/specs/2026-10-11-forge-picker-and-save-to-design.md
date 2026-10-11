# Forge — the picker, Save to, and motion

Date: 2026-10-11 · Status: approved through mockups
(`mockups/explorations-2026-10.html`, `mockups/motion-2026-10.html`)

The question screens and their option rows are one component, the picker.
After three rounds of mockups the user chose:

- **The picker (every `Select`)**: a band in the mode's fill across the
  selected row, with a `▌` strip in the mode colour at its left edge.
- **Save to (`PathInput`)**: a framed search box. The question sits in the
  frame's top border, an input line comes next, and the places sit below a
  divider, drawn as the picker draws them.

Out of scope: every other screen. That includes the start-screen drop zone,
the Name step, the file card and the hint bar. The launch sweep from the
motion page is also deferred, because the lean-and-fast work is restructuring
the intro animation (`intro.ts`, `launch.tsx`) in parallel.

## 1. The picker (`Select.tsx`)

```
   JPEG
 ▌ WebP      41.8 KB  66% smaller        ← band: the mode's fill, the full row width
   AVIF
```

- **Selected row.** The marker is `▌` in `accent`, replacing `❯ `. Behind
  the row is a band in the new palette role `band`, drawn on a `Box` with an
  explicit `width`. A padded `Text` cannot be used for this: Ink trims
  trailing spaces (see the comment in today's `Select`), so the band would
  not reach the end of the row.
- **`band` palette role.** Its base value is `selectionBg`, so nothing outside
  a mode changes. `modePalette` sets `band` to the mode's background whenever
  that background is non-empty. It does not touch `selectionBg`, because
  `selectionBg` is also the drop area's fill, and the drop area is out of
  scope.
- **Monochrome (NEUTRAL, `NO_COLOR`).** There is no fill, so `▌` alone marks
  the selected row. It is a shape, so it survives without colour.
- **Hints.** Rows show names only. Only the selected row shows its hint, in
  the place where hints already go. A disabled row keeps its hint, because
  that hint is the reason the row is disabled ("needs 2+ files").
- **`speak` prop (optional).** `speak(item)` replaces the hint on the selected
  row. The target picker uses it to show a measured size (§2).
- **`badge`.** A badge is drawn as `★ <badge>` at the far right of its row, in
  `accent`, whether or not the row is selected. `PathInput` is its only
  current user.

## 2. Measured sizes in the format picker

- These apply only to the `target` step, for a single staged **image** source.
  Documents and batches get no size, and the row then shows nothing beyond
  its name.
- Only the highlighted format is measured. The measurement is
  `encodeToBuffer(source, target, { quality })`, using the quality the
  conversion would start from (`livePrefs.quality`).
- Measuring starts 150 ms after the highlight settles, and only one encode is
  in flight at a time. A result that arrives after the highlight has moved
  away is cached, but not shown on another row. Results are cached per
  (source, target) for as long as the step is open.
- **While waiting**, the row says `measuring…`.
- **Once measured**, the row says `74.6 KB  39% smaller` in `ok`, or
  `7% larger` in `larger`. The saving is computed against the source's own
  size.
- **On failure**, the row shows nothing. A failed measurement is not an error
  the user has to deal with.
- Invariant 7 holds: the number is always the result of an encode that
  actually ran, never an estimate.

## 3. Save to (`PathInput.tsx`)

```
 ╭─ Save to ────────────────────────────────────────────╮
 │ ›  type to filter, or drop a file                4/4 │
 ├──────────────────────────────────────────────────────┤
 │ ▌ Desktop        ~/Desktop/test.jpg        ★ default │
 │   Same folder                                        │
 │   Downloads                                          │
 │   New subfolder                                      │
 ╰──────────────────────────────────────────────────────╯
```

- **The frame.** It uses the `border` colour and is `min(width, 72)` columns
  wide. The label is drawn bold in `accent` inside the top border. The input
  sits on its own line, followed by a `├─┤` divider and then the list, which
  is a `Select` running at the frame's inner width.
- **The input.** It shows `› ` followed by the text and the caret. When the
  input is empty it shows a dim placeholder, `type to filter, or drop a
  file`. The match count `n/N` sits dim at the right end of the input line.
- **Typing filters** the places by a case-insensitive substring of their
  label. The "Type a path…" row is gone, because the input now does its job.
- **Path mode.** It applies when the unescaped text starts with `/` or `~`,
  which is what a drag from Finder pastes. The list then has a single row:
  - an existing **file** → `Next to <name>`, which saves to the file's folder;
  - anything else → `Use this folder`, which saves to that path.

  In both cases the row's detail is `preview(folder)`.
- **The selected row** shows `preview(path)`, the full output path. The
  default place carries `★ default` at the far right of its row (§1).
- **Keys:**
  - `↑↓` choose a row, and `↵` saves to the selected row.
  - `esc` clears the text first, and backs out only once the text is empty.
  - `tab` makes the selected place the default. It moves off `d`, because
    letters now type into the input.
  - The existing CR/LF handling for paste and the stray-escape filter are
    kept unchanged.
- **The hint bar** for the destination step becomes `type filter`,
  `↑↓ choose`, `↵ save here`, `tab make default`. In the compact band it is
  `tab make default` alone.
- **The no-match row.** When a filter matches nothing, a single dim row reads
  `no match — type a full path, or drop a file`.

## 4. Motion

All motion is controlled by one switch, `motionEnabled()`. It is true only
when colour is enabled (`colourEnabled()`), output is a TTY, and the palette
is not NEUTRAL. When it is false, every animation below shows its final
frame. Tests render without a TTY, so the existing snapshots are unaffected.

Every animation changes characters or colours in cells, ticks at 33 ms or
slower, and stops when it has finished.

| What | Where | Behaviour |
| --- | --- | --- |
| Cursor glide | `Select` | Over 140 ms, the band fades in on the new row and out on the old one. The fade mixes `band` with the new role `canvas`, the theme's assumed terminal background. Fades happen only between hex colours; otherwise the band switches at once. |
| Measuring shimmer | target picker | A band of light moves along `measuring…` while an encode is running. |
| Drop flash | `PathInput` | When a path arrives as one pasted chunk, the input line flashes in `band` and fades back over 450 ms. |
| Spinner and elapsed time | `converting` step, single file | The `cli/spinner.ts` frames, followed by the existing label and the real elapsed seconds. There is no percentage. Batch and target-size progress are unchanged. |
| Bars draw once | `ReceiptCard` | The "after" bar fills from empty to its measured length over 500 ms, once, when the card mounts. |
| Mode wipe | `HeaderBar` | When the mode changes, the new mode's fill wipes in from the left over 260 ms. |

Helpers live in `src/shell/motion.ts`: `motionEnabled`, `mix`, `useTween`
(0→1 over a duration, restarted by a key) and `useTicker` (frame counter
while active). Neither `core/` nor `engines/` gains any of it (invariant 1).

## 5. Testing

- **The picker:** the `▌` marker; no hint on unselected rows; the disabled
  row's hint kept; `speak` replacing the hint; the badge at the far right; no
  line wider than `width`; the band on a filled `Box`. The existing
  `select*.test.tsx` expectations that name `❯` move to `▌`.
- **Save to:** filtering; the count; path mode for a file and for a folder;
  esc clearing before cancelling; tab making the default; the CR/LF and
  stray-escape tests carried over; width bounds at 40, 55 and 80 columns.
- **Measurement:** the measurement function is injected, so tests control
  when it resolves. The tests cover `measuring…` changing to the number, a
  stale result not showing on another row, a failure showing nothing, and no
  measurement for a document.
- **Motion:** `mix`, plus `useTween` and `useTicker` with fake timers. Each
  animated component is also checked to render its final frame when
  `motionEnabled()` is false.
