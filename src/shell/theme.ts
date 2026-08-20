/** Single source of truth for the version the shell displays. */
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
  arrow: '→',
  /**
   * The arrow drawn between two things rather than inside a sentence — the
   * before and after of a conversion. Long enough to read as a connector at
   * a glance; the short one still serves inline text like "4 MB → 1 MB".
   */
  longArrow: '──→',
  longArrowDown: '│\n▼',
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
  /** The one accent: cursor, selected marker, wordmark edge. */
  accent: string
  ok: string
  warn: string
  fail: string
  /** Format tag inlined into the file card's border. */
  tag: string
  /** Section labels such as CONVERT TO. */
  label: string
  /** Resting frame colour. */
  border: string
  /** Fill behind the selected row. Empty means "draw no band". */
  selectionBg: string
}

export const DARK: Palette = {
  name: 'dark',
  fg: '#e4e8f0',
  // 5.4:1 on a #1e1e1e terminal. The previous #6b7385 measured 3.51:1, which
  // is below AA for body text — and secondary text here is real content
  // (sizes, paths), not decoration.
  dim: '#8b93a6',
  accent: '#e5a23c',
  ok: '#6fcf7f',
  warn: '#e5c07b',
  fail: '#e8796d',
  tag: '#63c1d8',
  label: '#a68ce0',
  // 2.97:1 — just under the 3:1 wanted for a meaningful boundary, and as far
  // as a frame can go before it starts competing with the text inside it.
  // The old #39404f measured 1.60:1 and was effectively invisible.
  border: '#5f6879',
  selectionBg: '#252c3a',
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
  tag: '#0a6b86',
  label: '#6141ad',
  // 3.11:1, meeting the boundary threshold. #c3bdb2 measured 1.87:1.
  border: '#9a9184',
  selectionBg: '#eae4d8',
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
  tag: 'cyan',
  label: 'magenta',
  border: 'gray',
  selectionBg: '',
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
