/**
 * Terminals that draw Powerline's slants (U+E0BA, U+E0BC) themselves, as
 * they draw box-drawing characters, whatever the font. Anywhere else the
 * glyphs come from the font, which a program cannot see, and the common
 * macOS fonts do not have them: Apple Terminal shows two empty boxes.
 */
const NATIVE_PROGRAMS = new Set(['iTerm.app', 'WezTerm', 'ghostty', 'vscode'])
const NATIVE_TERMS = new Set(['xterm-kitty', 'xterm-ghostty'])

/**
 * Windows Terminal sets `WT_SESSION` and says nothing in `TERM_PROGRAM`. It
 * draws the slants itself and does 24-bit colour.
 */
const windowsTerminal = (env: Record<string, string | undefined>): boolean =>
  env.WT_SESSION !== undefined && env.WT_SESSION !== ''

/**
 * Whether the header bar's mode chip may have slanted ends. Only where they
 * are sure to draw; the plain filled chip everywhere else, and under
 * NO_COLOR, where the chip's fill — the slants' whole point — is gone.
 * `FORGE_POWERLINE=1` or `0` settles it either way, for a font that has the
 * glyphs or a terminal that only claims to.
 */
export function slantedChips(env: Record<string, string | undefined> = process.env): boolean {
  if (env.FORGE_POWERLINE === '1') return true
  if (env.FORGE_POWERLINE === '0') return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  if (windowsTerminal(env)) return true
  return NATIVE_PROGRAMS.has(env.TERM_PROGRAM ?? '') || NATIVE_TERMS.has(env.TERM ?? '')
}

/**
 * Whether the terminal draws 24-bit colour, so a swatch shows the colour it
 * names (colour spec §6.8). Some terminals say so in `COLORTERM`; the ones
 * above draw it whether or not they say. `FORGE_TRUECOLOR=1` or `0` settles
 * it either way. Off under NO_COLOR, where there are no swatches at all.
 */
export function trueColour(env: Record<string, string | undefined> = process.env): boolean {
  if (env.FORGE_TRUECOLOR === '1') return true
  if (env.FORGE_TRUECOLOR === '0') return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return true
  if (windowsTerminal(env)) return true
  return NATIVE_PROGRAMS.has(env.TERM_PROGRAM ?? '') || NATIVE_TERMS.has(env.TERM ?? '')
}
