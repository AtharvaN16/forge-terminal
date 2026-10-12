/**
 * Real pictures in the terminal (enhance's Done, X5): which inline-image
 * protocol this terminal speaks, and the escape sequence that draws a PNG in
 * a box of cells with it.
 *
 * Two protocols cover the terminals that draw images on macOS:
 *
 *   - iTerm2's OSC 1337 `File=`, which iTerm2 and WezTerm both speak;
 *   - the Kitty graphics protocol (APC `G`), which Kitty and Ghostty speak.
 *
 * Everything else (Apple Terminal, VS Code's terminal, tmux, a pipe) gets
 * null, and Done draws its half-block close-up instead. Detection reads the
 * environment only, never asks the terminal: a query would need a reply
 * on stdin, which Ink owns.
 */

export type ImageProtocol = 'iterm' | 'kitty'

const ESC = '\u001b'
const BEL = '\u0007'
const ST = `${ESC}\\`

const set = (v: string | undefined): boolean => v !== undefined && v !== ''

/** The terminals that set TERM_PROGRAM and draw pictures, and their protocol. */
const BY_PROGRAM: Record<string, ImageProtocol> = {
  'iTerm.app': 'iterm',
  WezTerm: 'iterm',
  ghostty: 'kitty',
}

/**
 * Kitty's protocol is what this terminal speaks. A terminal that names
 * itself in TERM_PROGRAM is believed over KITTY_WINDOW_ID and
 * GHOSTTY_RESOURCES_DIR, which every child process inherits — VS Code opened
 * from Ghostty has both, and draws neither protocol. Kitty itself sets no
 * TERM_PROGRAM; tmux's own is no terminal.
 */
function speaksKitty(env: NodeJS.ProcessEnv): boolean {
  const program = env.TERM_PROGRAM ?? ''
  if (program !== '' && program !== 'tmux') return BY_PROGRAM[program] === 'kitty'
  const term = env.TERM ?? ''
  return (
    term === 'xterm-kitty' ||
    term === 'xterm-ghostty' ||
    set(env.KITTY_WINDOW_ID) ||
    set(env.GHOSTTY_RESOURCES_DIR)
  )
}

/**
 * The protocol to draw real pictures with, or null for the half-block
 * fallback.
 *
 * `FORGE_INLINE_IMAGES=0` turns pictures off and `=1` turns them on — in
 * Kitty's protocol where this looks like Kitty or Ghostty, else iTerm2's —
 * for a terminal not recognised here, or tmux with passthrough set up; both
 * beat everything else, as the most specific thing the user said. Then
 * NO_COLOR means no pictures — a monochrome terminal asked for no colour,
 * and a photo is nothing but colour. Inside tmux, screen or Zellij neither
 * protocol reaches the terminal unless passthrough is configured, so those
 * are null even when the outer terminal's variables leaked in.
 */
export function imageProtocol(env: NodeJS.ProcessEnv = process.env): ImageProtocol | null {
  const forced = env.FORGE_INLINE_IMAGES
  if (forced === '0') return null
  if (forced === '1') return speaksKitty(env) ? 'kitty' : 'iterm'
  if (set(env.NO_COLOR)) return null
  const term = env.TERM ?? ''
  const program = env.TERM_PROGRAM ?? ''
  if (
    set(env.TMUX) ||
    set(env.STY) ||
    set(env.ZELLIJ) ||
    program === 'tmux' ||
    term.startsWith('screen') ||
    term.startsWith('tmux')
  ) {
    return null
  }
  if (program !== '') return BY_PROGRAM[program] ?? null
  return speaksKitty(env) ? 'kitty' : null
}

/** Base64 bytes per Kitty chunk: the protocol's limit, a multiple of 4. */
export const KITTY_CHUNK = 4096

/**
 * The sequence that draws `png` in a box `cols` × `rows` cells wide, its
 * top-left corner at the cursor. iTerm2 keeps the picture's shape; Kitty
 * fills the box, so the picture is sent already the box's shape
 * (`padToBox` in core/closeup.ts).
 *
 * Neither form moves the cursor (`doNotMoveCursor=1`, `C=1`), and the caller
 * still wraps it in save and restore cursor, for a terminal that ignores the
 * flag.
 *
 * iTerm2: `ESC ] 1337 ; File=inline=1;size=N;width=C;height=R;
 * preserveAspectRatio=1;doNotMoveCursor=1 : <base64> BEL`.
 *
 * Kitty: `ESC _ G a=T,f=100,c=C,r=R,C=1,q=2[,i=ID],m=1 ; <chunk> ESC \`,
 * then `ESC _ G m=1 ; <chunk> ESC \` …, the last with `m=0`. `f=100` is PNG
 * (the terminal reads the size from it), `q=2` keeps the terminal from
 * answering on stdin, where the answer would arrive as keystrokes. `id`
 * names the image, so drawing it again replaces it rather than stacking a
 * second copy, and it can be deleted when the screen is left
 * (`kittyDelete`).
 */
export function inlineImageSequence(
  png: Buffer,
  cols: number,
  rows: number,
  protocol: ImageProtocol,
  id?: number,
): string {
  const data = png.toString('base64')
  if (protocol === 'iterm') {
    const args = [
      'inline=1',
      `size=${png.length}`,
      `width=${cols}`,
      `height=${rows}`,
      'preserveAspectRatio=1',
      'doNotMoveCursor=1',
    ].join(';')
    return `${ESC}]1337;File=${args}:${data}${BEL}`
  }
  const first = ['a=T', 'f=100', `c=${cols}`, `r=${rows}`, 'C=1', 'q=2']
  if (id !== undefined) first.push(`i=${id}`)
  let out = ''
  for (let at = 0; at < data.length || at === 0; at += KITTY_CHUNK) {
    const chunk = data.slice(at, at + KITTY_CHUNK)
    const more = at + KITTY_CHUNK < data.length ? 1 : 0
    const keys = at === 0 ? [...first, `m=${more}`] : [`m=${more}`]
    out += `${ESC}_G${keys.join(',')};${chunk}${ST}`
    if (data.length === 0) break
  }
  return out
}

/** Kitty: delete image `id` and its data, quietly. */
export function kittyDelete(id: number): string {
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`
}
