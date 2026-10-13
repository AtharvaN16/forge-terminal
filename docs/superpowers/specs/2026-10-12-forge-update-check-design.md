# Check for updates

Decided 2026-10-12 in `mockups/update-check-2026-10.html` (rounds 1–5; the
script is `scripts/update-mockup.ts`). Picks: **V4** for `/update`, **N1** for
home, **A6** after a command.

## What it does

- **Automatic, once a day.** Forge asks `https://registry.npmjs.org/forge-terminal/latest`
  for one thing, the latest version number, and keeps the answer in
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

- **V4 `/update`:** /extensions' split. List: **Forge** with a blue `new` tag
  beside the name (✓ when current), a gap, then **Check automatically** with
  Boost's B3 `‹ on ›` pill (←→). The switch's side of the split is blank.
  Forge's sheet: `Forge 0.2.2`, `Your version: 0.2.1`, `↵ update`. While npm
  runs, a spinner and, after three seconds, a clock (invariant 7: npm reports
  no progress, so there is no percentage). Then `✓ installed · restart to use
  it` and `↵ restart`, which exits Ink and starts the same command again.
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
