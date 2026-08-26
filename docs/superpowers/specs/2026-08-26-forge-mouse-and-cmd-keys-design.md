# Forge — mouse support and Cmd-key fallback design

**Date:** 2026-08-26
**Status:** approved, ready for implementation plan
**Supersedes:** the mouse-support rejection in
[2026-08-19-forge-phase-1-design.md §2](2026-08-19-forge-phase-1-design.md) —
"The absence of mouse support is load-bearing" no longer holds; see §1.

---

## 1. Why

A user reported "mouse click isn't working" and "keyboard shortcuts aren't
working." Investigation found two unrelated things:

**Mouse clicks were never a feature.** `src/shell/mouse.ts` and
`src/shell/useMouse.ts` contain a complete SGR mouse decoder and a
DSR-based cursor-position query, but neither is imported anywhere outside
their own files and tests. They were committed as groundwork
(`481dc55`: "not yet wired... not a live feature") against the phase-1
spec's explicit decision not to build mouse support, on the grounds that
"Ink never exposes the absolute terminal position of its frame" (`mouse.ts`
comment) and that building it was rejected as too costly relative to value
at the time.

**Keyboard shortcuts mostly already work.** Every keypress funnels through
one choke point, `src/shell/useKeys.ts`. Cmd-modified shortcuts
(Cmd+Left/Right/Backspace) depend on the kitty keyboard protocol
(negotiated in `src/shell/launch.tsx:74-77`), which Terminal.app does not
implement — Cmd is unreachable there at the protocol level, not a bug.
`src/shell/components/Prompt.tsx:319-362` already implements Option-key
equivalents (word motion, word delete) as the documented Terminal.app
fallback. This spec does not change that mechanism — it only confirms
coverage and documents it, in §7.

**What changed the mouse decision:** the user wants buttons, the
converted-file link, and click-to-position-the-caret in the text field to
be clickable, in every terminal, including ones without the kitty
protocol. The specific technical objection recorded in `Prompt.tsx:471-493`
— that a DSR query parks the terminal's *real* cursor on the caret,
producing two visible cursors — turns out to apply only if the origin
query is tied to the *live* caret position. Textualize documents the same
DSR technique for inline (non-alt-screen) apps in production
([Behind the Curtain of Inline Terminal Applications](https://textual.textualize.io/blog/2024/04/20/behind-the-curtain-of-inline-terminal-applications/)):
query where the terminal's cursor is, subtract it from incoming mouse
coordinates, and every click becomes frame-relative. Decoupling the query
from the caret — calibrating the frame's origin on its own schedule
instead of parking the cursor wherever the user is typing — removes the
two-cursor problem, and keeps Forge inline. Alt-screen (which would make
this trivial, at the cost of "History committed to `<Static>` survives
quitting," per phase-1 §"Stay an inline scrollback app") was considered
and rejected; see §3.

---

## 2. Scope

Clickable, in every terminal that reports SGR mouse events:

- Select rows (`src/shell/components/Select.tsx`) — the app's only
  "buttons" today.
- The "Open file" / "Reveal in Finder" links currently rendered as OSC 8
  hyperlinks (`src/shell/blocks.tsx`, per
  [2026-08-19-forge-design.md §"Clickable links"](2026-08-19-forge-design.md)).
  App-level hit-testing replaces dependence on terminal-native hyperlink
  support, so these become single-click (no Cmd modifier) everywhere,
  including Terminal.app, which today only supports its own cmd+click URL
  detection on the printed `file://` fallback.
- Click-to-position-the-caret in `Prompt.tsx`, using the existing
  `offsetForColumn` (`mouse.ts:92-101`), previously blocked for the reason
  above.
- Hover highlighting on the above, while the mouse is over the frame, per
  the user's explicit "best UX in smart terminals too" request.

Everything above remains fully reachable by keyboard. Mouse is strictly
additive — matching the existing rule that no feature depends on terminal
capability (`f`/`o` is the same pattern for links today).

Out of scope: see §9.

---

## 3. Approach

**Cache the frame's origin; invalidate it on events that can move the
frame; do all hit-testing (click and hover) as arithmetic against the
cached value.** Rejected alternatives:

- **DSR-calibrate on every click.** Works for clicks alone (a human-paced
  event can absorb one round trip), but hover requires continuous
  motion events — one DSR round trip per pixel of mouse travel is not
  viable at typical `?1003` event rates.
- **Full alt-screen, whole app.** Makes hit-testing trivial (fixed 1,1
  origin, the route every full-screen TUI takes), but reverses phase-1's
  explicit "History committed to `<Static>` survives quitting" property
  for the entire app, not just the moment mouse support needs it.
- **Hybrid: alt-screen only during interactive steps.** Gets robust
  hit-testing without losing history for completed results, at the cost
  of Forge managing screen-mode transitions (entering/leaving alt-screen,
  re-printing the settled result inline afterward) — meaningfully more
  moving parts than caching an origin, for a gain (robustness) the cached
  approach also gets once invalidation is handled correctly.

The accepted cost: origin caching is only as correct as its invalidation
triggers (§5). A click that lands in the narrow window between an
invalidating event and recalibration completing is treated as a miss,
not misrouted — see §6.

---

## 4. Module interface

### `src/shell/mouse.ts` (extends existing)

```ts
/** Motion reporting on top of press/release — needed for hover. Superset of MOUSE_ON. */
export const MOUSE_ON_WITH_HOVER = '\x1b[?1000h\x1b[?1003h\x1b[?1006h'
```

Existing `MOUSE_ON` (`?1002`, drag-only) stays for the case with no
registered targets — no reason to pay for motion events on a screen
nothing can be hovered on. `parseMouse`, `parseCursorReport`,
`offsetForColumn`, `CURSOR_QUERY` are unchanged.

### `src/shell/useFrameOrigin.ts` (new)

```ts
/**
 * The frame's on-screen origin, cached and recalibrated only on events
 * that can move it. `null` until the first calibration lands.
 */
export function useFrameOrigin(): { row: number; col: number } | null
```

Recalibrates by issuing `CURSOR_QUERY` and reading the reply via the
existing `useCursorReport`. Three triggers, all already observable from
where this hook is mounted (the shell root):

1. Mount.
2. Terminal resize (Ink's `useStdout().stdout` resize event).
3. Immediately after each commit to `<Static>` history — the only thing
   that shifts Forge's live region in its inline layout, per
   [2026-08-19-forge-design.md:367-369](2026-08-19-forge-design.md).

**Open implementation question, to verify against this repo's Ink 7.1.1
before writing the calibration code (per this project's "measured, not
assumed" convention):** whether querying DSR immediately after a render
commits yields the frame's origin directly — because Ink's own cursor
already rests at a known offset from the frame after painting — or
whether an explicit cursor reposition is required first, and if so
whether that is visible. This determines whether calibration is
invisible or a brief single-frame flash; either is acceptable, but which
one it is changes the hook's internals, not its interface above.

### `src/shell/useClickTarget.ts` (new)

```ts
/** A frame-relative hit region a mouse event can land in. */
export interface ClickTarget {
  id: string
  /** Frame-relative, inclusive. */
  rows: { from: number; to: number }
  cols: { from: number; to: number }
  onClick: () => void
  /** Omit for a target with no hover state (there is none today, but the shape allows it). */
  onHover?: (hovering: boolean) => void
}

/** Registers targets for the lifetime of the calling component. */
export function useClickTargets(targets: ClickTarget[]): void
```

Backed by a React Context provided once at the shell root (`App.tsx`),
not module-level state — targets are registered from components scattered
across the tree (`Select.tsx`, `Prompt.tsx`, `blocks.tsx`), and Ink's test
renderer mounts and unmounts multiple independent app instances across a
test run; a module-level singleton would leak registered targets between
tests. The provider holds the current set keyed by `id`; `useClickTargets`
adds its targets on mount and removes them on unmount (or when its `id`s
change), the same registration-cleanup shape `useMouse` already uses for
its signal handlers. `useMouse`, mounted once at the same root, reads the
context: empty registry → `MOUSE_ON` (no motion reporting, cheapest);
non-empty → `MOUSE_ON_WITH_HOVER`. An incoming mouse event's `(x, y)` is
converted to frame-relative coordinates via `useFrameOrigin`'s cached
value, then matched against registered targets' boxes.

**Hover throttling.** Motion events are frequent; re-render only fires
when the matched target's `id` changes from the previous event, not on
every motion event — a hover event landing on the same target as the
last one is a no-op.

### Call sites

| Component | Registers |
| --- | --- |
| `Select.tsx` | One target per enabled row. `onClick` calls the same path `Enter` does today (`onSubmit` with the row's value); `onHover` calls the existing `onHighlight` callback, so a mouse hover moves the same highlight arrow keys already move (`Select.tsx:75`) — no new visual state. |
| `blocks.tsx` (the result links) | One target for "Open file", one for "Reveal in Finder," `onClick` invoking the same `open(1)` calls `f`/`o` already trigger. |
| `Prompt.tsx` | One target spanning the rendered text, `onClick` computing the clicked character via `offsetForColumn` and calling the existing `moveTo` (`Prompt.tsx:150-158`) — click-to-position is therefore "the same as clicking there with the keyboard caret," not a new caret mechanism. |

---

## 5. Data flow

**Click:**

```
SGR report → parseMouse → (x, y) - cached origin → frame-relative (x, y)
  → useClickTargets registry lookup by (row, col) containment → target.onClick()
```

**Hover** (only while `MOUSE_ON_WITH_HOVER` is active, i.e. registry
non-empty):

```
SGR motion report → parseMouse (action: 'move') → frame-relative (x, y)
  → registry lookup → if target id changed since last motion event:
      previous target.onHover?.(false); next target.onHover?.(true)
```

**Recalibration** (§4's three triggers) re-issues `CURSOR_QUERY` and
replaces the cached origin when the reply arrives. Between issuing the
query and the reply landing, the cache keeps its previous value — a click
arriving in that window is resolved against the stale origin, which is
correct unless the triggering event was itself a move (see §6).

---

## 6. Error handling

| Case | Behaviour |
| --- | --- |
| No SGR mouse support in the terminal | `MOUSE_ON`/`MOUSE_ON_WITH_HOVER` is inert; no click/hover events ever arrive; keyboard paths are untouched. Same as today. |
| Non-TTY | Unchanged — `useMouse`'s existing `!out?.isTTY` guard (`useMouse.ts:59-60`) means none of this activates. |
| Click during a stale-origin window | Resolved against the last-known origin. If the frame genuinely moved (a `<Static>` commit lands and the click was in flight before recalibration completes), the click may land on nothing or the wrong target for that one event — treated as a miss (no `onClick` fires), never misrouted to an unintended target, because `<Static>` commits only grow the frame's row offset monotonically and stale coordinates fail the bounds check rather than aliasing onto a different live row. |
| Process exit while `?1003` motion reporting is on | Already covered — `useMouse.ts`'s existing `MOUSE_OFF`-on-every-exit-path logic (SIGINT/SIGTERM/SIGHUP/`process.exit`) is mode-agnostic; no new signal handling needed. |
| Registry empty mid-session (e.g. leaving a step with Select rows) | `useMouse` drops back to `MOUSE_ON` on the next effect run, so hover reporting turns off exactly when nothing can be hovered. |

---

## 7. Keyboard: Cmd-key fallback

No new mechanism. `Prompt.tsx:319-362` already implements:

| Cmd shortcut (kitty-protocol terminals only) | Terminal.app equivalent (already implemented) |
| --- | --- |
| Cmd+Left / Cmd+Right (line start/end) | Home/End, or Ctrl+A/Ctrl+E |
| Cmd+Backspace (kill to line start) | Ctrl+U |
| Cmd+fn+Delete (kill to line end) | Ctrl+K |
| Cmd+A (select all) | not reproducible without the protocol — Ctrl+A stays line-start (readline convention), by design (`Prompt.tsx:259-260`) |

Work for this spec: add a one-line note to the shell's help text (wherever
shortcuts are currently surfaced — confirm during implementation whether
that's a static screen or none exists yet) stating Option/Ctrl as the
Terminal.app-compatible bindings, so this is discoverable without reading
source. No behavioural change; this is documentation only.

---

## 8. Testing

Test-driven, per CLAUDE.md.

- `tests/shell/mouse.test.ts` (existing file) gains coverage for
  `MOUSE_ON_WITH_HOVER` and any new pure functions in `mouse.ts`.
- `tests/shell/use-frame-origin.test.ts` (new) — recalibration fires on
  each of the three triggers and not otherwise; cached value survives
  between triggers; a query in flight does not clobber the cache until
  its specific reply arrives (guards against a stale reply from an
  earlier query landing after a newer one was issued).
- `tests/shell/use-click-target.test.ts` (new) — registry
  containment-matching (including the boundary-inclusive edges), hover
  no-op when the matched target hasn't changed, registry emptying
  switches the reporting mode.
- Per call site: `Select.tsx`, `Prompt.tsx`, and the result-link component
  each get a test asserting a synthetic click at a computed coordinate
  produces the same effect as the equivalent keyboard action — this is
  the assertion that click-to-position genuinely reuses `moveTo` and a
  row click genuinely reuses `onSubmit`/`onHighlight`, not parallel
  mechanisms that could drift apart.

---

## 9. Out of scope

Stated explicitly so the plan does not drift into them:

- **Drag-to-select text in the prompt via mouse.** Click-to-position is in
  scope; extending a selection by dragging is a natural follow-on but a
  separate increment — `useMouse.ts`'s doc comment already notes that
  enabling reporting disables the terminal's own drag-to-select, so this
  needs its own design pass on what replaces it.
- **Mouse wheel scrolling behaviour.** `parseMouse` already decodes wheel
  events (`button: 4/5`, `action: 'wheel'`); nothing in this spec wires
  them to anything. Forge's inline layout has no scrollable region of its
  own — scrollback is the terminal's.
- **X10 mouse mode or pixel-precision protocols** (e.g. SGR-Pixels,
  `?1016`). SGR (`?1006`) is the only protocol in scope, matching the
  existing `mouse.ts` groundwork.
- **A side panel or file tree.** Still not being reopened here — this
  spec restores mouse support for what already exists on screen
  (buttons, links, one text field), not new UI surfaces. If a side panel
  is proposed later, this spec's origin-caching mechanism removes the
  *load-bearing* objection from phase-1 §2, but that is a separate
  product decision, not a consequence of this one.
