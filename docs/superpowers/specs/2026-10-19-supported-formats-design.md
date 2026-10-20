# Supported formats on the drop zone (2026-10-19)

The drop zone's second line listed every format ("JPEG · PNG · WebP · AVIF ·
HEIC · GIF · TIFF · PDF · Word"): too long, and edit's was nearly as long.
Mockups: `mockups/kinds-2026-10.html` (script `scripts/kinds-mockup.ts`).

## Decided

- **The line groups by kind.** `MODE_KINDS` in `src/shell/home-art.ts`:
  convert `Images · Video · Sound · Documents`, compress `Images · Video ·
  Sound · PDF`, edit `Images · Video · Sound`, pdf `split · merge · rotate ·
  extract · delete` (all five actions). colour and transcribe keep their lines. Convert names video
  and sound because it takes them now (`src/core/formats.ts`); the old line
  had not caught up.
- **Tab lists the formats (Q2).** On a bare home (nothing staged, field empty)
  in convert, compress or edit, Tab swaps the drop surface's dots for a plain
  surface: "Supported formats" in the mode's colour, a rule, a line a kind
  (`MODE_FORMATS`, `formatRows`). Past the surface's rows the first lines stay
  and a thin bar plus "↓ n more" say there are more, as the commands list does.
  A short surface gives up its top blank, then its rule, to keep lines.
- **Not `?`.** It is shift-/ and some terminals send it as a `/` with shift held, which opens the menu (user, 2026-10-19). Tab does nothing on an empty field otherwise.
- **Until the next key, not "while held".** A terminal never reports that a
  letter key came up (the kitty protocol does so only for keys sent as escape
  codes, which the shell does not ask for), and auto-repeat cannot be told from
  typing. So Tab opens the list and the next key closes it; Tab or esc only
  close it, any other key closes it and is then handled as usual (a mode digit
  switches mode).
- **The hint is the key alone (K2).** A ` tab ` on the key row's grey cap at the
  field's far end (`fieldCap` in `src/shell/field-key.ts`), inverted while the
  list shows, `[?]` without colour. It sits right of the ⌘V paste hint when
  both show. It is the exception to the in-field chip (mode colour + words,
  2026-10-16): the user chose the quieter grey cap with no words.
- **The / menu's box has no line (M1).** `MenuPopup` draws its ring as fill
  only (spaces on the fill, same footprint); with no colour the rounded line
  stays, since the fill is what shows the box.

## Not decided / left out

- A list that outgrows the surface cannot scroll: nothing is held to press ↓
  against. Convert's real list (23 formats, four kinds) fits.
- The formats are what a drop is understood as, not output formats; targets
  still come from `targetsFor`.
