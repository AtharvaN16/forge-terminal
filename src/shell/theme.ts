/**
 * Forge's version, everywhere it is shown: the shell, --version and --json.
 * Must match package.json (tests/cli/args.test.ts).
 */
export const VERSION = '0.4.0'

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
   * Done (B6a): the hatching over what a smaller file shed — `ok` mixed half
   * way into the background, a tint rather than a bright green, so the
   * change written inside it leads.
   */
  shedHatch: string
  /**
   * Done (B6a): the fill over what a larger file grew by — `larger` mixed 16%
   * of the way out of the background. Empty means "no fill": the growth is
   * drawn in `▒` instead.
   */
  grownFill: string
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
  /** Mode header colour for colour (palette and scale). */
  modeColour: string
  modeColourBg: string
  /** Mode header colour for edit (Sharpen, Boost resolution, Remove background). */
  modeEdit: string
  modeEditBg: string
  /** Mode header colour for transcribe (notes and transcripts from video and sound). */
  modeTranscribe: string
  modeTranscribeBg: string
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
   * The background this theme is designed against, and paints across the
   * window (see `paintsCanvas`). Motion fades a band in from it and back out
   * to it. Empty: nothing painted, no fades.
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
   * The home field's fill (P2): a recessed shelf attached under the drop
   * zone, `selectionBg` stepped back towards the background, so the drop
   * zone reads as the thing and the field as its edge. Empty: no shelf, the
   * field is its line alone.
   */
  shelf: string
  /** Home's active mode tab (H2): a dark grey chip a step off the background. */
  tabChip: string
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
  /**
   * Save as (V10c): the tag on a path that does not exist yet — the default's
   * tag in blue rather than orange, where the default's sits.
   */
  newTagBg: string
  /** The word on `newTagBg`. */
  newTag: string
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
  // `ok` mixed half way into `canvas`, and `larger` 16% out of it.
  shedHatch: '#47774f',
  grownFill: '#403225',
  tag: '#63c1d8',
  label: '#a68ce0',
  modeConvert: '#55c7d9',
  modeConvertBg: '#122c33',
  modeCompress: '#79c98b',
  modeCompressBg: '#182c1e',
  modePdf: '#ff6b4a',
  modePdfBg: '#361c16',
  modeColour: '#f27ba8',
  modeColourBg: '#3a1e2b',
  modeEdit: '#b39ae8',
  modeEditBg: '#2a2238',
  // Of the reds tried, the furthest (OKLab) from pdf's orange-red and from fail.
  modeTranscribe: '#e63946',
  modeTranscribeBg: '#3a1a1d',
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
  // `selectionBg` mixed 55% into `canvas`.
  shelf: '#242424',
  // `canvas` stepped 55% towards `selectionBg`.
  tabChip: '#262626',
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
  // #5b8def stepped 20% into `canvas`, and the tag's fill 20% out of it.
  newTagBg: '#2a3448',
  newTag: '#4f77c5',
}

export const LIGHT: Palette = {
  name: 'light',
  fg: '#262626',
  // Light audit (2026-10-12, scripts/light-audit): every text colour here
  // holds at least the contrast its dark twin has on the same surface, and
  // 4.5:1 wherever it is words — the round 5 greys fell short of dark's on
  // every surface (dim on the drop zone 3.73:1, where dark's is 6.44:1).
  // 5.58:1 on panelBand, its darkest surface; dark's dim is 4.78:1 there.
  dim: '#4f4f4f',
  // 4.5:1 on selectionBg (the command list's headings), 5.73:1 on white.
  accent: '#915a01',
  // 4.54:1 on listBand, where "59% smaller" sits on a highlighted row.
  ok: '#0e702c',
  warn: '#8a6100',
  // Dark's chroma (0.140): the round 5 red was the hottest thing in light.
  fail: '#a43c32',
  // A pale red, as dark's is a dark one. On it `fail` measures 5.22:1 and
  // `fg` (#262626) 12.31:1, both clearing AA.
  failTint: '#f9e3df',
  // 7.21:1 on #f9e3df, dark's own ratio on its tint.
  failTintDim: '#4a4a4a',
  // A burnt orange (~60°) distinct from `warn`'s brown-gold; 4.53:1 on
  // panelBand, where Done's "+51 B" sits.
  larger: '#8b4d01',
  // As dark's: `ok` mixed half way into the canvas.
  shedHatch: '#87b896',
  grownFill: '#ece3d6',
  tag: '#0a6b86',
  // Dark's chroma (0.123), as `violet`.
  label: '#5e4b99',
  // 4.51:1 on listBand: the "(1)" of a taken name, on the highlighted row.
  modeConvert: '#036b7b',
  modeConvertBg: '#e6f7fa',
  modeCompress: '#24733a',
  modeCompressBg: '#eaf5ec',
  // 4.54:1 on listBand, 4.6:1 on tabChip (its tab number).
  modePdf: '#b82a06',
  modePdfBg: '#fceee9',
  modeColour: '#b0306a',
  modeColourBg: '#f7e3ec',
  // Dark's chroma (0.114): round 5's violet was the most vivid colour in light.
  modeEdit: '#64569f',
  modeEditBg: '#f0ebfa',
  // As deep as light's other modes (about 6.2:1 on white).
  modeTranscribe: '#c0102c',
  modeTranscribeBg: '#fef0ef',
  // 4.54:1 on white (dark: 4.22:1 on its canvas) — the hint row's tail and
  // the quiet tab numbers are words. 3.09:1 on fieldBand (dark: 2.75:1).
  border: '#767676',
  selectionBg: '#e4e4e4',
  band: '#e4e4e4',
  canvas: '#ffffff',
  textSelectionBg: '#b9cfe8',
  // As `accent`.
  brand: '#915a01',
  // `fg` (#262626) on this fill measures about 11.6:1.
  keycapBg: '#e1e1e1',
  // Dark's chroma, as `label`.
  violet: '#5e4b99',
  // 2.12:1 on white, 1.65:1 on selectionBg: dark's own ratios for a word
  // that has stepped back.
  faint: '#b2b2b2',
  listBand: '#dcdcdc',
  // `selectionBg` mixed 55% into `canvas`, as dark's is.
  shelf: '#f3f3f3',
  tabChip: '#f0f0f0',
  // One step down from `selectionBg`, as dark's is one step up from it.
  panelBand: '#d5d5d5',
  // The light theme's mode colours are deep, so the chip's text is light.
  ink: '#ffffff',
  // Dark's slider turned over: a pale track, a mid-grey fill, and the thumb
  // the darkest thing in the row, as dark's is the brightest.
  track: '#e4e4e4',
  trackFill: '#afafaf',
  thumb: '#262626',
  // Dark's Save as turned over: greys stepping down from the field's fill,
  // the pill the darkest thing in the field (light `ink` on it, as on the
  // thumb), and the tag a pale orange tint with a burnt orange word —
  // 5.3:1, so it still reads as a word.
  folderChip: '#d0d0d0',
  pill: '#262626',
  fieldBand: '#d7d7d7',
  defaultTagBg: '#f5e2cc',
  defaultTag: '#8f5000',
  // A deep blue on a pale one, as the default's tag is a burnt orange on a pale orange.
  newTagBg: '#e1e7f4',
  // Dark's chroma (0.128).
  newTag: '#3358a3',
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
  // An ANSI name cannot be mixed: the hatching is `ok` itself, and no fill is asserted.
  shedHatch: 'green',
  grownFill: '',
  tag: 'cyan',
  label: 'magenta',
  modeConvert: 'cyan',
  modeConvertBg: '',
  modeCompress: 'green',
  modeCompressBg: '',
  modePdf: 'red',
  modePdfBg: '',
  modeColour: 'magenta',
  modeColourBg: '',
  modeEdit: 'magenta',
  modeEditBg: '',
  // pdf has 'red'.
  modeTranscribe: 'redBright',
  modeTranscribeBg: '',
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
  shelf: '',
  tabChip: '',
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
  newTagBg: '',
  newTag: '',
}

export type ShellMode = 'convert' | 'compress' | 'pdf' | 'colour' | 'edit' | 'transcribe'

/** The modes in the order they are numbered on the home screen: 1, 2, 3, … */
export const MODE_ORDER: readonly ShellMode[] = [
  'convert',
  'compress',
  'pdf',
  'edit',
  'colour',
  'transcribe',
]

/** The digits that pick a mode, as the key rows say them: "1–6". */
export const MODE_KEYS = `1–${MODE_ORDER.length}`

/** A tab on home's tab row: the modes, then "/ menu". */
export type HomeTab = ShellMode | 'menu'

/**
 * The tab beside `from` on home's tab row: what ← and → go to. They stop at
 * the ends rather than wrap (decided 2026-10-14), so `from` itself there.
 * The menu is not on the row (2026-10-17): from it, ← goes to the last mode.
 */
export function tabStep(from: HomeTab, delta: 1 | -1): HomeTab {
  const tabs: readonly HomeTab[] = MODE_ORDER
  const from_ = from === 'menu' ? tabs.length : tabs.indexOf(from)
  const at = Math.max(0, Math.min(tabs.length - 1, from_ + delta))
  return tabs[at] as HomeTab
}

/** The mode digit `input` names, or undefined: `1` is convert, and so on. */
export function modeForKey(input: string): ShellMode | undefined {
  return /^[1-9]$/.test(input) ? MODE_ORDER[Number(input) - 1] : undefined
}

/** Paired with the mode's name wherever it is drawn, so it survives NO_COLOR. */
export const MODE_MARKERS: Record<ShellMode, string> = {
  convert: '↔',
  compress: '↓',
  pdf: '▣',
  colour: '◐',
  edit: '✦',
  transcribe: '¶',
}

/** Edit's hatching runs violet to a deeper violet (mockups/extensions-2026-10.html). */
const EDIT_END = '#7d6ad0'
/** Transcribe's runs red to lilac: convert's cyan-to-violet, mirrored (mockups/transcribe-2026-10-round2.html). */
const TRANSCRIBE_END = '#cc8ae2'

/** A mode's own colour and the fill drawn behind it. */
export function modeColours(p: Palette, mode: ShellMode): { fg: string; bg: string } {
  if (mode === 'compress') return { fg: p.modeCompress, bg: p.modeCompressBg }
  if (mode === 'pdf') return { fg: p.modePdf, bg: p.modePdfBg }
  if (mode === 'colour') return { fg: p.modeColour, bg: p.modeColourBg }
  if (mode === 'edit') return { fg: p.modeEdit, bg: p.modeEditBg }
  if (mode === 'transcribe') return { fg: p.modeTranscribe, bg: p.modeTranscribeBg }
  return { fg: p.modeConvert, bg: p.modeConvertBg }
}

/**
 * The colours a mode's gradient runs through, on the home screen's band, its
 * dots and the header bar's hatching: convert cyan to violet, compress green
 * to cyan, pdf red to amber, colour through a spectrum (colour spec §6.1)
 * where true colour can show one, and edit violet to a deeper violet.
 * Read from fields `modePalette` never moves, so the result is the same
 * whether `p` is the base palette or a mode's.
 *
 * `menu` is the menu's own (K1, round 5): the brand's gold.
 */
const SPECTRUM = ['#f26e69', '#e5a23c', '#ace02c', '#55c7d9', '#6579fd', '#ad95e9'] as const

/** What a gradient is drawn for: a mode, or the menu. */
export type Scheme = ShellMode | 'menu'

/** The menu's gold, in dark: the brand stepping up to a pale gold. */
const MENU_DARK = ['#e5a23c', '#f2cf6b'] as const

/**
 * Light's bands (L6, mockups/round-5-2026-10.html): dark's hues walked in
 * OKLCH — the hue turning the short way round, a stop every few columns so
 * the straight blend between neighbours never strays — each at one
 * lightness (0.62) and as much chroma as sRGB holds there, yellows lifted
 * so ambers stay clear. Light's mode colours are deep, for text; a band of
 * them was dark and muddy. Made by `scripts/round5-mockup.ts` (`stopsAt`).
 */
const LIGHT_BAND: Record<ShellMode, readonly string[]> = {
  convert: [
    '#1e96a7',
    '#1e94b3',
    '#1e92c0',
    '#1d8ed2',
    '#1b86ef',
    '#4a7df8',
    '#6974f8',
    '#816af8',
    '#995cf8',
  ],
  compress: [
    '#24b459',
    '#22ab6d',
    '#21a479',
    '#209f81',
    '#1f9c89',
    '#1f9a91',
    '#1e9998',
    '#1e97a0',
    '#1e96a7',
  ],
  pdf: [
    '#eb4319',
    '#e3541a',
    '#de601b',
    '#db6a1c',
    '#d9731d',
    '#d87c1e',
    '#d8841f',
    '#d98c20',
    '#d99522',
  ],
  edit: [
    '#9b5af8',
    '#985cf8',
    '#965ef8',
    '#945ff8',
    '#9161f8',
    '#8f62f8',
    '#8d64f8',
    '#8a65f8',
    '#8867f8',
  ],
  // Red to lilac, by the same walk (OKLCH 0.62, as much chroma as sRGB holds).
  transcribe: [
    '#f3233e',
    '#f12259',
    '#ee2270',
    '#ea2186',
    '#e6219b',
    '#e121b0',
    '#da22c6',
    '#d122dc',
    '#c723f2',
  ],
  colour: [
    '#f42335',
    '#e05b1a',
    '#d87d1e',
    '#da9b23',
    '#d2b427',
    '#b4c027',
    '#5bbf23',
    '#20a27c',
    '#1e989b',
    '#1e94b6',
    '#1c8cd9',
    '#577af8',
    '#7371f8',
    '#8568f8',
    '#965df8',
  ],
}
const LIGHT_MENU = [
  '#d99522',
  '#da9822',
  '#da9b23',
  '#da9f24',
  '#d9a224',
  '#d9a525',
  '#d8a825',
  '#d7ab26',
  '#d6ad26',
] as const

/**
 * The near-white tint each light band stop sits on (`washOf`, OKLCH 0.955):
 * the hatching drawn on its own colour, so FORGE is knocked out of a soft
 * band rather than out of thin lines. Step for step with `LIGHT_BAND`.
 */
const LIGHT_WASH: Record<ShellMode, readonly string[]> = {
  convert: [
    '#d6f7fd',
    '#ddf5fe',
    '#e1f4fe',
    '#e4f2fe',
    '#e7f1fe',
    '#eaf0fe',
    '#eceffe',
    '#efeefe',
    '#f1edfe',
  ],
  compress: [
    '#e0f7e4',
    '#def8e7',
    '#dcf8ea',
    '#daf8ed',
    '#d8f8f1',
    '#d7f8f4',
    '#d6f8f7',
    '#d6f8fa',
    '#d6f7fd',
  ],
  pdf: [
    '#feece7',
    '#feece6',
    '#feece5',
    '#feece3',
    '#feece2',
    '#feede0',
    '#feedde',
    '#feeddc',
    '#feeed9',
  ],
  edit: [
    '#f2edfe',
    '#f1edfe',
    '#f1edfe',
    '#f1eefe',
    '#f0eefe',
    '#f0eefe',
    '#f0eefe',
    '#f0eefe',
    '#efeefe',
  ],
  transcribe: [
    '#feebea',
    '#feebec',
    '#feebee',
    '#feeaf0',
    '#feeaf2',
    '#feeaf5',
    '#fee9f9',
    '#fde9fd',
    '#f9eafe',
  ],
  colour: [
    '#feebe9',
    '#feece5',
    '#feede0',
    '#feeed7',
    '#f7f1d6',
    '#eff3d9',
    '#e5f6df',
    '#dbf8eb',
    '#d6f8f8',
    '#def5fe',
    '#e5f2fe',
    '#ebf0fe',
    '#edeffe',
    '#efeefe',
    '#f1edfe',
  ],
}
const LIGHT_MENU_WASH = [
  '#feeed9',
  '#feeed8',
  '#feeed7',
  '#fdeed6',
  '#fcefd6',
  '#fbefd6',
  '#fbefd6',
  '#faefd6',
  '#f9f0d6',
] as const

/**
 * Light's drop-zone dots (L1): dark's hues, each darkened until it reads
 * 4.5:1 on white, which keeps it above 3:1 on the grey the dots sit on.
 * Deeper than the band: a dot is a single small glyph.
 */
const LIGHT_DOTS: Record<ShellMode, readonly string[]> = {
  convert: ['#138291', '#8467bd'],
  compress: ['#2b8748', '#138291'],
  pdf: ['#d54322', '#a06c10'],
  edit: ['#8567bc', '#7b67cd'],
  transcribe: ['#df3140', '#9c5cb1'],
  colour: ['#cb4b49', '#a06c10', '#618110', '#138291', '#5869ec', '#8268bd'],
}

export function modeGradient(p: Palette, scheme: Scheme): readonly string[] {
  if (p.name === 'light') return scheme === 'menu' ? LIGHT_MENU : LIGHT_BAND[scheme]
  if (scheme === 'menu') return p.name === 'dark' ? MENU_DARK : [p.brand]
  if (scheme === 'compress') return [p.modeCompress, p.modeConvert]
  if (scheme === 'pdf') return [p.modePdf, p.brand]
  if (scheme === 'colour') return p.name === 'dark' ? SPECTRUM : [p.modeColour, p.violet]
  if (scheme === 'edit') return [p.modeEdit, p.name === 'dark' ? EDIT_END : p.violet]
  if (scheme === 'transcribe')
    return [p.modeTranscribe, p.name === 'dark' ? TRANSCRIBE_END : p.violet]
  return [p.modeConvert, p.violet]
}

/**
 * The fill under each of `modeGradient`'s stops on the logo's band, where
 * the hatching is washed (light, L6); undefined where it sits on the canvas.
 */
export function modeWash(p: Palette, scheme: Scheme): readonly string[] | undefined {
  if (p.name !== 'light') return undefined
  return scheme === 'menu' ? LIGHT_MENU_WASH : LIGHT_WASH[scheme]
}

/** The drop zone's dots: light's own (L1), the band's everywhere else. */
export function dotGradient(p: Palette, mode: ShellMode): readonly string[] {
  return p.name === 'light' ? LIGHT_DOTS[mode] : modeGradient(p, mode)
}

/**
 * The palette while the menu is open: the role colours become the
 * menu's gold, as `modePalette` hands them to a mode.
 */
export function menuPalette(p: Palette): Palette {
  return { ...p, accent: p.brand, tag: p.brand, label: p.brand }
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

/**
 * Whether the shell paints this palette's background itself: the App fills
 * the window with `canvas`, so text must name its colour too — see
 * `Text.tsx`. Light and dark both do (L6; dark since Ghostty's blue default
 * washed it out), so forge looks the same on any profile. Neutral, with no
 * canvas, leaves the terminal's colours alone.
 */
export function paintsCanvas(p: Palette): boolean {
  return p.canvas !== ''
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
