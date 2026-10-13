# Forge — dark paints its own background

**Date:** 2026-10-13
**Status:** design approved in conversation; spec awaiting review
**Branch:** `dev`
**Origin:** the owner installed Ghostty. Its default background is a blue
(`#282c34`), and Forge's dark theme, tuned against Apple Terminal's
near-black, looked washed out on it. The neutral greys clash with the blue.

---

## 1. Why

Dark draws no background today: every unfilled cell is the terminal's own.
So dark's look depends on the user's terminal profile, and Forge has no say.
Light already solved this for itself (it paints `#ffffff` across the window,
L6). This design gives dark the same treatment, and adds one thing painting
cannot reach: the terminal's own padding around the cell grid.

**Goal:** Forge in any terminal looks the way it does in Apple Terminal with
a black profile. No washed-out greys, no clash with the profile's colour.

Decided in conversation:

- **Dark always paints.** There is no opt-out. "Use my terminal's colours"
  becomes the adaptive theme (§7), a third choice in the theme picker, later.
- **Both A and B.** A: paint the canvas cell by cell. B: set the terminal's
  default background while Forge runs (OSC 11), and put it back after.

## 2. A — dark paints the canvas

`paintsCanvas` (`src/shell/theme.ts:740`) is true for light only. It becomes
true for every palette with a canvas: dark and light. Neutral (`canvas: ''`,
used before a theme is picked and under `NO_COLOR`) still paints nothing.

Dark then takes light's existing path unchanged:

- the window filled with `canvas` (`#1e1e1e`), `PAINT_INSET` = 2 columns each
  side and one blank row on top (`App.tsx:644`, `:3268`);
- each `<Static>` history block wrapped in the canvas too (`App.tsx:3328`),
  so finished screens left in scrollback stay painted;
- the outermost `Text` without a `color` takes `palette.fg` (`Text.tsx:26`),
  so text no longer uses the profile's foreground.

No colour changes. Dark's contrast figures were measured on `#1e1e1e`, and
the places that blend against `canvas` (`motion.ts`, `done-art.ts`,
`home-art.ts`, `bar-art.ts`, `save-as-art.ts`, `Home.tsx`, `colour-art.ts`)
assumed that colour was behind them. Painting makes the assumption true.

The motion fix from the same day stays (a cell neither row fills is left
unfilled mid-fade, `motion.ts` `blendRows`): it is still correct, and still
matters for neutral.

Places that test `p.name === 'light'` for other reasons (`modeGradient`,
`modeWash`, `dotGradient`, `ColourFlow` card theme) are about light's own
colours, not painting, and stay as they are.

## 3. B — the terminal's background follows the canvas

### 3.1 What it does

At launch, after the theme is known, Forge writes OSC 11 with the palette's
`canvas`:

```
ESC ] 11 ; #1e1e1e ESC \
```

This sets the terminal's *default* background, which is what the terminal
uses for its padding around the grid (Ghostty's `window-padding-color`
defaults to it), for cells nothing painted, and for a resize before the
next frame lands. Painting (§2) and this cover each other's gaps.

While Forge runs, the shell output above it in the window takes the colour
too: OSC 11 changes the window's default, not Forge's region. Accepted.

On the way out Forge writes OSC 111, which resets the default background to
the profile's own:

```
ESC ] 111 ESC \
```

A reset, not a restore of a queried value: querying needs a reply on stdin
before Ink starts, and the profile's value is what the user has in every
other window. A background some other program set earlier in the session is
not kept. Accepted.

Light does the same with `#ffffff`, which matters for a light theme on a dark
profile (the owner's own Apple Terminal setup).

### 3.2 When it is skipped

Written only when all hold:

- the palette paints (§2): not neutral, so not before a theme is picked and
  not under `NO_COLOR`;
- not inside tmux, screen or Zellij. A multiplexer would pass the sequence to
  the outer terminal behind its back, and the colour would leak into every
  other pane. The test is the one `inline-image.ts` already makes; it moves
  to a shared helper so both read the same rule.

A terminal that does not know OSC 11 ignores it. Painting still covers the
whole grid there.

### 3.3 Every way out restores it

| How Forge stops | Today's cleanup | OSC 111 written by |
| --- | --- | --- |
| quit, ctrl-c (Ink `exitOnCtrlC`) | Ink unmount, effect cleanups | the exit path |
| SIGINT, SIGTERM, SIGHUP | `useMouse` re-raises after clearing | the same handler |
| uncaught exception, rejected promise | `reportFatal` | a `process.on('exit')` hook, written with `writeSync` |
| `/theme` to the other theme | — | the new canvas is written at once |
| restart (`restart.ts`) | relaunch | reset, then set again by the new launch |
| ctrl-z (SIGTSTP) | **nothing** (mouse stays on too) | reset before stopping; set again on SIGCONT |
| `kill -9` | nothing can run | nothing can run; the user's next `reset` or new window |

The exit hook writes synchronously to the tty fd, as `useMouse` does today
for `MOUSE_OFF`, because `process.on('exit')` cannot wait for a stream.

Suspend is new. On SIGTSTP Forge resets the background, turns mouse
reporting off and leaves raw mode (so the shell it returns to reads lines
normally), then stops itself with SIGSTOP; on SIGCONT it enters raw mode,
sets the background and mouse again, and asks Ink to redraw. Mouse is fixed here because it has the same hole and
the same handler is the place for it.

### 3.4 Where the code goes

- `src/shell/terminal-background.ts`: builds the two sequences and holds
  the skip rule. Pure: takes a palette and an env, returns strings or null.
  No writes, so it is tested without a terminal.
- `launch.tsx` owns setting and resetting, beside Ink's own lifecycle, and
  registers the exit, signal and suspend handlers once.
- The App tells launch when the theme changes (it already owns `theme`
  state), so a `/theme` switch rewrites the default at once.

## 4. Windows

Windows Terminal is expected to honour OSC 11 and OSC 111; the classic
console to ignore both, and paint as everywhere else. No platform branch. Unverified on a real
Windows PC (§8).

## 5. Testing

- `terminal-background` unit tests: the sequence for dark and for light; null
  for neutral, `NO_COLOR`, `TMUX`, `STY`, `ZELLIJ`, `TERM=screen*`/`tmux*`.
- Lifecycle tests: the reset is written on exit, on each signal, and on
  SIGTSTP; the set is written again on SIGCONT; a theme change writes the new
  canvas.
- App tests that assumed dark has no margin are updated to dark's new
  `PAINT_INSET` layout.
- The light-audit harness (`scripts/light-audit`) runs over dark too, to check
  nothing in dark draws text without a colour on the painted canvas.
- By eye with `npm run dev`: Ghostty (default profile), Apple Terminal (the
  owner's black profile, and the white "Basic" profile), iTerm2. On each:
  launch, switch modes, `/theme`, ctrl-z then `fg`, quit. After quit the
  prompt sits on the profile's own background.

## 6. Out of scope

- The adaptive theme (§7).
- Restoring a background set by another program before Forge started (§3.1).
- An opt-out for painting (decided against, §1).

## 7. Next: adaptive theme (C)

A third theme that reads the terminal's colours (OSC 10/11 query at start)
and derives its palette from them, so Forge follows the user's profile
instead of covering it. Its own design, after this ships. Open questions
for it: whether it picks dark or light by the measured background, or
derives every grey from it; how it meets the no-blue-tint rule for greys.

## 8. Unverified

- Apple Terminal's support for OSC 11 set and OSC 111 reset. If it ignores
  them, painting still covers the grid; Apple Terminal has no padding gap to
  speak of.
- Windows Terminal behaviour, until the friend's PC test.
- Whether Ghostty's padding takes the OSC 11 colour in every
  `window-padding-color` mode (`background` is the default; `extend` and
  `extend-always` copy the edge cells, which are painted anyway).
