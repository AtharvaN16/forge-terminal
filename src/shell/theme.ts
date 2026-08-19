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
} as const

export const COLOURS = {
  ok: 'green',
  fail: 'red',
  warn: 'yellow',
  muted: 'gray',
  accent: 'cyan',
} as const

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
