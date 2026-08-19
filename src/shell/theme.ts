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

/** Honours NO_COLOR (https://no-color.org) and non-TTY output. */
export function colourEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  return process.stdout.isTTY === true
}
