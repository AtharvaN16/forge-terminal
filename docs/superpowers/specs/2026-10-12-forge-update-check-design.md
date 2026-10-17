# Check for updates

Decided 2026-10-12 in `mockups/update-check-2026-10.html` (rounds 1–5; the
script is `scripts/update-mockup.ts`). Picks: **V4** for `/update`, **N1** for
home, **A6** after a command. On 2026-10-17 `/update` became **U4**
(`mockups/whatsnew-2026-10.html`, `scripts/whatsnew-mockup.ts`): one column
and a release's notes on what is new.

## What it does

- **Automatic, once a day.** Forge asks `https://registry.npmjs.org/forge-terminal/latest`
  for the latest version number, and that release's `whatsNew` (its notes in
  package.json; npm keeps a package.json's own fields), and keeps the answer in
  `<config dir>/forge/update-check.json`. Only plain releases count; a
  pre-release such as `0.0.0-stage` is never offered. Offline is silent; the
  attempt is still recorded so an offline Mac asks once a day, not every run.
- **On demand.** `/update` in the shell and `forge update` in a terminal ask
  now, whatever the cache says.
- **Installs in place, when asked.** ↵ on `/update` and `forge update` run
  `npm install --global forge-terminal@<version>` with the npm beside the node
  running Forge, so they replace this install. Only a Forge installed with
  `npm i -g` can do this; a checkout or npx says so and names the command.
  When npm is refused (Node installed for the whole Mac), the sudo command is
  shown, with ↵ copy.
- **Off switch.** `forge config set update-check off`, the switch on
  `/update`, `FORGE_NO_UPDATE_CHECK=1`, and always off when `CI` is set.

This is the second thing Forge fetches, after extensions (whose spec says
"`forge extensions` works offline"). It sends nothing about files or the Mac,
and nothing else depends on it.

## Never slows anything down

- One-off commands read the cache only. If it is more than a day old, a
  detached `forge __update-check` refreshes it after the command has exited,
  so the next command knows.
- The shell asks in the background at start-up and shows the band note when
  the answer arrives.
- The automatic note is never printed with `--json`, into a pipe, under MCP,
  or by `forge update` itself.

## What it looks like

- **U4 `/update`:** one column, three blocks a blank row apart. The release:
  `Forge 0.2.2` with a blue `new` tag (✓ when current) and its action pill at
  the far right of the row — `↵ update`, `↵ restart`, `↵ check again`,
  `↵ try again` — with `Your version 0.2.1` under it. Then **Check
  automatically** with Boost's B3 `‹ on ›` pill (←→). Then, once a newer
  release is known, its notes on a grey card (`band`) under a grey
  ` what's new ` chip (`panelBand`) and `in 0.2.2`: each note's name bold in a
  column of its own, its sentence beside it in grey, a blank line between.
  The card is as tall as its notes; past the window's room it scrolls a note
  at a time, with the commands list's bar (S2) on its last column and
  `↓ n more` for the notes still below — never `↑`, as on the commands list.
  ↑↓ goes from the action to the switch to the notes (only when they scroll;
  the thumb brightens and the keys say `↑↓ scroll`). While npm runs, a
  spinner and, after three seconds, a clock take the pill's place
  (invariant 7: npm reports no progress, so there is no percentage); the
  notes stay. Then `✓ installed · restart to use it` and `↵ restart`, which
  exits Ink and starts the same command again.
- **Release notes.** Each release rewrites package.json's `whatsNew`: a list
  of `{ "title", "text" }`, a short name (22 characters at most) and a
  sentence saying what the change does and how to reach it (200 at most;
  20 notes at most). Forge strips control characters from them and cuts what
  is longer; a test holds package.json to the limits.
- **N1 home:** `/update is available · v0.2.1` on the band's baseline. The
  words take the mode colour's opposite: OKLCH hue + 180°, chroma brought into
  sRGB, lightness moved until 4.5:1 on the canvas (`oppositeColour` in
  `home-art.ts`). Dropped, keeping the version, when the band is too short.
- **A6 after a command:** two rows on `newTagBg`:
  `↑ Forge 0.2.2 is available · your version 0.2.1` /
  `In terminal: forge update` (bold). The terminal says `forge update`;
  `/update` only works in the app.

## Known trade-off

At the smallest supported size (80 × 24) the command list's ten rows no
longer fit with the hint bar's rule, so the list scrolls and `/update` is
reached with ↓ or `/u`. The panel was capped one row too tall before; it now
leaves the rule its row.
