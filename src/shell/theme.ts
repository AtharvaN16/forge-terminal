/**
 * Forge's version, everywhere it is shown: the shell, --version and --json.
 * Must match package.json (tests/cli/args.test.ts).
 */
export const VERSION = '0.1.0'

/**
 * Symbols are paired with words at every call site so meaning survives a
 * monochrome terminal — colour is an accent, never the carrier.
 */
export const SYMBOLS = {
  ok: '✓',
  fail: '✕',
  warn: '⚠',
  cursor: '❯',
  /**
   * The picker's selected-row marker: the left edge of its band. A shape as
   * well as a colour, so the selection still reads under NO_COLOR, where the
   * band itself is not drawn.
   */
  strip: '▌',
  /** Marks the saved default among Save to's places. */
  star: '★',
  arrow: '→',
  /**
   * An offer the user can take or ignore — a better format, a merge worth
   * making. Deliberately not `warn`: nothing has gone wrong when one of
   * these appears, the file asked for is already written and correct, and
   * `⚠` is what this shell puts in front of a skipped file, a size it could
   * not read and a command it refused. A glyph that means two opposite
   * things means neither.
   */
  tip: '✧',
  /**
   * The arrow drawn between two things rather than inside a sentence — the
   * before and after of a conversion. Long enough to read as a connector at
   * a glance; the short one still serves inline text like "4 MB → 1 MB".
   */
  longArrow: '──→',
  longArrowDown: '│\n▼',
  /**
   * The target-size search's attempt row. Filled and empty differ in shape as
   * well as intensity, so the row still reads under NO_COLOR — where the two
   * colours it is drawn in collapse into one.
   */
  dotFilled: '●',
  dotEmpty: '○',
} as const

/**
 * Every colour the shell draws. No component names a colour directly, so
 * changing a theme is changing this object and nothing else.
 *
 * Values are hex rather than ANSI names because the two palettes need
 * specific brightnesses: ANSI `yellow` is whatever the user's terminal theme
 * decided it is, which is fine when there is one palette and useless when the
 * entire point is that light and dark differ. NEUTRAL is the exception — see
 * its comment.
 */
export interface Palette {
  name: 'dark' | 'light' | 'neutral'
  /** Primary text. */
  fg: string
  /** Secondary text — sizes, hints, paths. */
  dim: string
  /**
   * The one accent: cursor, selected marker, wordmark edge — and the
   * sentence of an offer, which is drawn in the same colour as the key that
   * takes it so the two read as one thing.
   */
  accent: string
  ok: string
  warn: string
  fail: string
  /**
   * Errors (E5, E5·b): the fill red text is drawn on, and only there. Empty
   * means "no fill" — the error then says `✕` in front instead.
   */
  failTint: string
  /**
   * The grey for E5's hint line, used only on `failTint`. `dim` is tuned for
   * the canvas and falls under AA on the pale red of the light theme.
   */
  failTintDim: string
  /**
   * A conversion result that came out *larger* than its source. Distinct
   * from `warn`: `warn` is a shared, general-purpose "worth a second look"
   * used for several unrelated messages elsewhere, and reusing it here
   * happened to land on a pale gold rather than something that actually
   * reads as orange against `ok`'s green. This is that colour, kept apart so
   * tuning it never drags every other `warn` message's tone along with it.
   */
  larger: string
  /**
   * Done (K3·a): the hatching over the part a file grew by, the mirror of
   * the grey hatching over what a smaller file shed. `larger` mixed 80% of
   * the way into the background, so the hatching reads as orange without
   * outshining the bold phrase beside it.
   */
  grownHatch: string
  /** Format tag inlined into the file card's border. */
  tag: string
  /** Section labels such as CONVERT TO. */
  label: string
  /** Mode header colour for image conversion. */
  modeConvert: string
  modeConvertBg: string
  /** Mode header colour for compression. */
  modeCompress: string
  modeCompressBg: string
  /** Mode header colour for PDF page operations. */
  modePdf: string
  modePdfBg: string
  /** Resting frame colour. */
  border: string
  /** Fill behind the selected row. Empty means "draw no band". */
  selectionBg: string
  /**
   * The picker's band behind its selected row. `selectionBg` outside a mode;
   * `modePalette` hands it the mode's own fill, so the highlight is drawn in
   * the screen's colour. Kept apart from `selectionBg` because that one is
   * also the drop area's fill, which does not follow the mode.
   */
  band: string
  /**
   * The terminal background this theme is designed against. Never painted —
   * motion fades a band in from it and back out to it, so a fade starts from
   * the colour that is (near enough) already on screen. Empty: no fades.
   */
  canvas: string
  /**
   * Fill behind selected *text* inside an input. Deliberately not
   * `selectionBg`: that one is the drop area's own fill, so a selection drawn
   * in it would be invisible against the box it sits in. Empty means "no
   * colour available" — the field falls back to reverse video, which is the
   * only way to show a selection when there is no palette at all.
   */
  textSelectionBg: string
  /**
   * The product's own colour — the anvil's edge and the wordmark's outline.
   * Deliberately not `accent`: `accent` follows the mode (see `modePalette`),
   * and the logo is the one thing that must not.
   */
  brand: string
  /**
   * Fill behind a key in the hint row. Empty means "no fill available" —
   * `Hints` then brackets the key instead, so it still reads as a key.
   */
  keycapBg: string
  /**
   * The far end of convert's gradient (`modeGradient`). Its own field rather
   * than `label`, which has the same value but is handed to the mode by
   * `modePalette`.
   */
  violet: string
  /**
   * Quieter than `border`: text that is still there but has stepped back,
   * such as the drop zone's kinds line while a path is being typed.
   */
  faint: string
  /** The band behind the chosen path completion on the home screen. */
  listBand: string
  /**
   * The band behind the chosen command when the list sits inside the drop
   * surface, one step up from `selectionBg`, which is that surface's fill.
   */
  panelBand: string
  /**
   * Text on a mode's own colour: the header bar's mode chip. Empty means
   * the terminal's own foreground.
   */
  ink: string
  /**
   * A control's empty track: the quality slider after its thumb, and the
   * part of Working's page bar still to fill. Empty means "no fill" — the
   * slider then draws its track as a rule.
   */
  track: string
  /** The quality slider up to its thumb. Grey, never the mode's colour. */
  trackFill: string
  /** The slider's thumb: a pill with the value on it, in `ink`. The brightest thing in the row. */
  thumb: string
  /**
   * Save as: the folder in the sentence while the name is focused, a light
   * grey on the field's fill, so it reads as something to choose.
   */
  folderChip: string
  /** Save as: the folder you are on, as a pill in `ink`. The brightest thing in the field. */
  pill: string
  /** Save as: the band behind the highlighted folder, inside the field. */
  fieldBand: string
  /** Save as: the default folder's tag, a tinted pill at the far end of its row. */
  defaultTagBg: string
  /** The word on `defaultTagBg`: a soft orange, quieter than the row it sits on. */
  defaultTag: string
}

export const DARK: Palette = {
  name: 'dark',
  fg: '#e7e7e7',
  // 7.7:1 on a #1e1e1e terminal (AAA). Secondary text here is real content
  // (sizes, paths), so it reads as text, not decoration. Neutral grey: no
  // grey in this palette carries a blue tint (colour spec §2.5).
  dim: '#b0b0b0',
  accent: '#e5a23c',
  ok: '#6fcf7f',
  warn: '#e5c07b',
  fail: '#e8796d',
  // A dark red, as the default's tag in Save as is a dark orange one. `fail`
  // on it measures 5.5:1, `fg` 12.6:1 and `dim` 7.2:1.
  failTint: '#2e2020',
  // `dim` itself: 7.2:1 on the tint already.
  failTintDim: '#b0b0b0',
  // 7.49:1 on #1e1e1e. A true orange (hue ~28°) rather than `warn`'s gold
  // (~40°) — the two need to read as different colours next to each other,
  // not just different words.
  larger: '#f2994a',
  // `larger` mixed 80% into `canvas` (#1e1e1e), as the mockup draws it.
  grownHatch: '#c88041',
  tag: '#63c1d8',
  label: '#a68ce0',
  modeConvert: '#55c7d9',
  modeConvertBg: '#122c33',
  modeCompress: '#79c98b',
  modeCompressBg: '#182c1e',
  modePdf: '#ff6b4a',
  modePdfBg: '#361c16',
  // 4.2:1 on #1e1e1e: dim labels, hints and frames. Above the 3:1 a boundary
  // needs, and still a clear step below `dim`.
  border: '#808080',
  selectionBg: '#2c2c2c',
  band: '#2c2c2c',
  // The background every contrast figure in this palette was measured on.
  canvas: '#1e1e1e',
  // Clearly distinct from selectionBg above, which is the drop area's own
  // fill — a selection has to read against that, not blend into it.
  textSelectionBg: '#3f5c86',
  brand: '#e5a23c',
  // `fg` (#e7e7e7) on this fill measures about 10:1.
  keycapBg: '#333333',
  violet: '#a68ce0',
  faint: '#4d4d4d',
  // One step up from `selectionBg`, so the band reads on the terminal and is
  // not mistaken for the drop surface above it.
  listBand: '#323232',
  panelBand: '#404040',
  ink: '#0c1d22',
  // The slider (G1) is grey and white so the colour on screen stays in the
  // bar, the card's tag and the title. Neutral greys, like every grey here.
  track: '#2e2e2e',
  trackFill: '#515151',
  thumb: '#e7e7e7',
  // Save as (P1): greys stepping up from the field's fill, the pill white,
  // and the default's tag a dark orange tint with a soft orange word, darker
  // than the highlighted row so it never pulls the eye first.
  folderChip: '#414141',
  pill: '#e7e7e7',
  fieldBand: '#3d3d3d',
  defaultTagBg: '#33261a',
  defaultTag: '#c98a4b',
}

export const LIGHT: Palette = {
  name: 'light',
  fg: '#23262d',
  // 4.77:1 on white; the previous #8b9099 was 3.21:1.
  dim: '#6e737c',
  // 5.19:1; #a86a06 measured 4.44:1, just under AA. The accent marks the
  // selected row, so it has to clear the bar for text, not for decoration.
  accent: '#9a6005',
  ok: '#1e7a35',
  warn: '#8a6100',
  fail: '#b3261e',
  // A pale red, as dark's is a dark one. On it `fail` (#b3261e) measures
  // 5.32:1 and `fg` (#23262d) 12.32:1, both clearing AA; `dim` 3.88:1.
  failTint: '#f9e3df',
  // 4.90:1 on #f9e3df (and 6.03:1 on white); `dim` is 3.88:1 there.
  failTintDim: '#5f636b',
  // 5.56:1 on white. Same reasoning as DARK's `larger`: a burnt orange
  // (~34°) distinct from `warn`'s brown-gold, clearing AA the way `dim` and
  // `accent` above do.
  larger: '#9c5700',
  // `larger` mixed 80% into `canvas` (#ffffff), as dark's is into its own.
  grownHatch: '#b07933',
  tag: '#0a6b86',
  label: '#6141ad',
  modeConvert: '#087f91',
  modeConvertBg: '#e6f7fa',
  modeCompress: '#24733a',
  modeCompressBg: '#eaf5ec',
  modePdf: '#c83b1d',
  modePdfBg: '#fceee9',
  // 3.11:1, meeting the boundary threshold. #c3bdb2 measured 1.87:1.
  border: '#9a9184',
  selectionBg: '#eae4d8',
  band: '#eae4d8',
  canvas: '#ffffff',
  textSelectionBg: '#b9cfe8',
  brand: '#9a6005',
  // `fg` (#23262d) on this fill measures about 12:1.
  keycapBg: '#e4e1da',
  violet: '#6141ad',
  faint: '#c4bfb6',
  listBand: '#e2dccf',
  // One step down from `selectionBg`, as dark's is one step up from it.
  panelBand: '#dcd4c4',
  // The light theme's mode colours are deep, so the chip's text is light.
  ink: '#ffffff',
  // Dark's slider turned over: a pale track, a mid-grey fill, and the thumb
  // the darkest thing in the row, as dark's is the brightest.
  track: '#e8e4dc',
  trackFill: '#b4aea3',
  thumb: '#23262d',
  // Dark's Save as turned over: greys stepping down from the field's fill,
  // the pill the darkest thing in the field (light `ink` on it, as on the
  // thumb), and the tag a pale orange tint with a burnt orange word —
  // 5.3:1, so it still reads as a word.
  folderChip: '#d8cfbe',
  pill: '#23262d',
  fieldBand: '#ddd6c8',
  defaultTagBg: '#f5e2cc',
  defaultTag: '#8f5000',
}

/**
 * Used before the user has chosen a theme — that is, while the first-run
 * picker is on screen and we genuinely do not know the background. It is the
 * one palette built from ANSI names and empty strings rather than hex: it
 * sets no background fill and no foreground at all, so it inherits the
 * terminal's own colours and is legible on any background by construction.
 */
export const NEUTRAL: Palette = {
  name: 'neutral',
  fg: '',
  dim: 'gray',
  accent: 'yellow',
  ok: 'green',
  warn: 'yellow',
  fail: 'red',
  // No fill is asserted before the theme is known.
  failTint: '',
  failTintDim: 'gray',
  // No distinct "orange" in the basic 16 ANSI names this palette is built
  // from — same collapse `accent` and `warn` already make here.
  larger: 'yellow',
  // An ANSI name cannot be mixed; the hatching is `larger` itself.
  grownHatch: 'yellow',
  tag: 'cyan',
  label: 'magenta',
  modeConvert: 'cyan',
  modeConvertBg: '',
  modeCompress: 'green',
  modeCompressBg: '',
  modePdf: 'red',
  modePdfBg: '',
  border: 'gray',
  selectionBg: '',
  band: '',
  canvas: '',
  // No colour is asserted before the theme is known, so a selection in this
  // palette is drawn with reverse video instead.
  textSelectionBg: '',
  brand: 'yellow',
  // No fill is asserted before the theme is known; keys are bracketed.
  keycapBg: '',
  violet: 'magenta',
  faint: 'gray',
  listBand: '',
  panelBand: '',
  ink: '',
  track: '',
  trackFill: '',
  thumb: '',
  folderChip: '',
  pill: '',
  fieldBand: '',
  defaultTagBg: '',
  defaultTag: '',
}

export type ShellMode = 'convert' | 'compress' | 'pdf'

/** The modes in the order they are numbered on the home screen: 1, 2, 3. */
export const MODE_ORDER: readonly ShellMode[] = ['convert', 'compress', 'pdf']

/** Paired with the mode's name wherever it is drawn, so it survives NO_COLOR. */
export const MODE_MARKERS: Record<ShellMode, string> = { convert: '↔', compress: '↓', pdf: '▣' }

/** A mode's own colour and the fill drawn behind it. */
export function modeColours(p: Palette, mode: ShellMode): { fg: string; bg: string } {
  if (mode === 'compress') return { fg: p.modeCompress, bg: p.modeCompressBg }
  if (mode === 'pdf') return { fg: p.modePdf, bg: p.modePdfBg }
  return { fg: p.modeConvert, bg: p.modeConvertBg }
}

/**
 * The two colours a mode's gradient runs between, on the home screen's band
 * and dots: convert cyan to violet, compress green to cyan, pdf red to amber.
 * Read from fields `modePalette` never moves, so the result is the same
 * whether `p` is the base palette or a mode's.
 */
export function modeGradient(p: Palette, mode: ShellMode): [string, string] {
  if (mode === 'compress') return [p.modeCompress, p.modeConvert]
  if (mode === 'pdf') return [p.modePdf, p.brand]
  return [p.modeConvert, p.violet]
}

/**
 * The palette a screen is drawn in while the shell is in `mode`: the three
 * role colours — accent, tag, label — become the mode's own, so one screen
 * tells one colour story instead of four. The picker's `band` takes the
 * mode's fill for the same reason. Outcome colours (`ok`, `fail`,
 * `warn`, `larger`) and the `brand` never move.
 */
export function modePalette(p: Palette, mode: ShellMode): Palette {
  const { fg, bg } = modeColours(p, mode)
  return { ...p, accent: fg, tag: fg, label: fg, band: bg === '' ? p.band : bg }
}

export function paletteFor(theme: 'dark' | 'light' | undefined): Palette {
  if (theme === 'dark') return DARK
  if (theme === 'light') return LIGHT
  return NEUTRAL
}

/**
 * Ink treats `undefined` as "do not set this attribute"; the palettes use ''
 * for the same idea, because an interface of optional strings would make
 * every consumer handle absence separately. This is the one adapter between
 * the two conventions.
 */
export function colourProp(value: string): string | undefined {
  return value === '' ? undefined : value
}

/**
 * Glyphs for bar-style controls (e.g. the quality Slider). `filled` and
 * `empty` are deliberately the same character — the design spec's mock
 * distinguishes them by intensity (dim vs normal), not by shape, and the
 * knob's position plus the printed numeric value carry the actual meaning.
 */
export const BAR = {
  filled: '━',
  empty: '━',
  knob: '●',
} as const

/** Honours NO_COLOR (https://no-color.org) and non-TTY output. */
export function colourEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  return process.stdout.isTTY === true
}

/**
 * Spec §13 says `NO_COLOR` is honoured, and nothing downstream does it for
 * us: Ink styles through chalk 5.6.2, whose vendored `supports-color` reads
 * `FORCE_COLOR` and the `--no-color` *flag* and has no reference to the
 * `NO_COLOR` env var at all. Measured: `NO_COLOR=1` on a colour-capable
 * terminal still emitted `[2m`/`[31m`.
 *
 * `FORCE_COLOR` is the one lever chalk does read, and it reads it exactly
 * once, when it is first imported. So this must run before anything pulls
 * Ink in — which is why `src/index.ts` calls it immediately before its
 * `await import('./shell/launch.js')`, and why that import is lazy.
 */
export function applyColourPreference(): void {
  if (!colourEnabled()) process.env.FORCE_COLOR = '0'
}
