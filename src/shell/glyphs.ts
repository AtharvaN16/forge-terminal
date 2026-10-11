/**
 * Terminals that draw Powerline's slants (U+E0BA, U+E0BC) themselves, as
 * they draw box-drawing characters, whatever the font. Anywhere else the
 * glyphs come from the font, which a program cannot see, and the common
 * macOS fonts do not have them: Apple Terminal shows two empty boxes.
 */
const NATIVE_PROGRAMS = new Set(['iTerm.app', 'WezTerm', 'ghostty', 'vscode'])
const NATIVE_TERMS = new Set(['xterm-kitty', 'xterm-ghostty'])

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
  return NATIVE_PROGRAMS.has(env.TERM_PROGRAM ?? '') || NATIVE_TERMS.has(env.TERM ?? '')
}
