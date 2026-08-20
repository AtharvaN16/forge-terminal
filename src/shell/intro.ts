import { WORDMARK } from './components/Banner.js'
import {
  composeMark,
  glyphColour,
  HEAT,
  MARK_AT_REST,
  MARK_HEIGHT,
  MARK_WIDTH,
  REST_STEP,
  SWING,
  type SwingStep,
} from './mark.js'
import type { Palette } from './theme.js'
import { bandFor } from './width.js'

/**
 * The banner, played once, *before* Ink starts.
 *
 * This is the only way to have both a moving mark and a mark that stays at the
 * top of the session. Ink's `<Static>` is written once and never redrawn,
 * which is what pins content above the live region — so an animation cannot
 * live there. Running it in the live region instead and then committing to
 * `<Static>` was tried: the live region shrinks on that transition and the
 * terminal is left holding lines Ink can no longer erase.
 *
 * So the loop is drawn here, by hand, with a cursor-up between frames to
 * redraw in place. When it finishes, the last frame is simply left where it
 * is. It becomes ordinary scrollback — exactly like the output of any other
 * command — and Ink then mounts underneath it, never knowing it happened.
 */

const ESC = String.fromCharCode(27)
const FRAME_MS = 130
const GAP = '  '

function sgr(colour: string | undefined): string {
  if (colour === undefined) return ''
  const n = Number.parseInt(colour.slice(1), 16)
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}

const RESET = `${ESC}[39m`

/**
 * One rendered line of the banner: the mark's row, a gap, then the wordmark's.
 * The wordmark is shorter than the mark, so it is bottom-aligned against it —
 * the letters sit level with the anvil rather than floating above it.
 */
function bannerLines(
  mark: readonly string[],
  step: SwingStep,
  heat: string,
  palette: Palette,
  colour: boolean,
): string[] {
  const lead = MARK_HEIGHT - WORDMARK.length
  return mark.map((row, y) => {
    const word = y >= lead ? (WORDMARK[y - lead] ?? '') : ' '.repeat(WORDMARK[0]?.length ?? 0)

    if (!colour) return `${row}${GAP}${word}`

    const drawnMark = Array.from(row)
      .map((ch) => {
        const c = glyphColour(ch, y, step, heat, palette.dim)
        return c === undefined ? ch : `${sgr(c)}${ch}${RESET}`
      })
      .join('')

    const drawnWord = Array.from(word)
      .map((ch) => {
        if (ch === ' ') return ch
        // Face in the theme's foreground, edge in the accent — the outline is
        // what makes the letters legible, so it carries the colour.
        return `${sgr(ch === '█' ? palette.fg : palette.accent)}${ch}${RESET}`
      })
      .join('')

    return `${drawnMark}${GAP}${drawnWord}`
  })
}

export interface IntroOptions {
  width: number
  palette: Palette
  version: string
  defaultOutput: string
  /** False under NO_COLOR or a non-colour terminal: the loop is skipped. */
  colour: boolean
  write?: (text: string) => void
  /** Overridable so tests do not wait a second. */
  frameMs?: number
}

/**
 * Plays the loop and leaves the final frame on screen. Resolves once it has.
 *
 * Skipped entirely when the terminal is too narrow for the art, and reduced to
 * a single still frame when colour is off — an animation whose whole subject
 * is metal changing temperature has nothing to say in monochrome, and would
 * only cost the user a second.
 */
export async function playIntro(opts: IntroOptions): Promise<void> {
  const write = opts.write ?? ((t: string) => process.stdout.write(t))
  const full = MARK_WIDTH + GAP.length + (WORDMARK[0]?.length ?? 0)

  if (bandFor(opts.width) === 'compact' || opts.width < full) {
    write(`\n ⚒ Forge ${opts.version}\n\n`)
    return
  }

  const status = ` Convert ${opts.version}  · image`
  const pad = ' '.repeat(
    Math.max(2, Math.min(opts.width, 100) - status.length - opts.defaultOutput.length - 1),
  )
  const statusLine = opts.colour
    ? `${sgr(opts.palette.dim)}${status}${pad}${opts.defaultOutput}${RESET}`
    : `${status}${pad}${opts.defaultOutput}`

  const finish = (mark: readonly string[], step: SwingStep, heat: string) => {
    write(
      `${bannerLines(mark, step, heat, opts.palette, opts.colour).join('\n')}\n\n${statusLine}\n\n`,
    )
  }

  if (!opts.colour) {
    finish(MARK_AT_REST, REST_STEP, '')
    return
  }

  const frameMs = opts.frameMs ?? FRAME_MS
  write('\n')

  for (let i = 0; i < SWING.length; i++) {
    const step = SWING[i] as SwingStep
    const heat = HEAT[i % HEAT.length] ?? HEAT[0]
    const lines = bannerLines(composeMark(step), step, heat, opts.palette, true)
    write(`${lines.join('\n')}\n`)

    if (i === SWING.length - 1) break
    await new Promise((r) => setTimeout(r, frameMs))
    // Back up over the block just written, so the next frame lands on top of
    // it rather than below it.
    write(`${ESC}[${MARK_HEIGHT}A`)
  }

  write(`\n${statusLine}\n\n`)
}
