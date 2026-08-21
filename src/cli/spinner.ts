/**
 * A one-line, redraw-in-place progress indicator for work that takes long
 * enough to look like a hang.
 *
 * The case it exists for: compressing a PDF to a target size runs a
 * two-dimensional search — a quality bisection at each of up to four
 * resolutions — which takes four to six seconds on a large scan. Silence for
 * that long reads as a crash.
 *
 * **The spinner supplies motion, never information.** Invariant 7 forbids
 * inventing progress, and a percentage here would be invented: the search
 * cannot know which resolution rung will succeed until it tries. What it does
 * know is its position inside the current rung — `attempt 3 of 8` is a real
 * index in a bounded sequence — so the caller passes that text in and this
 * only animates beside it. Nothing here computes a number.
 *
 * Writes to the stream it is handed, and only when that stream is a terminal:
 * a piped or CI run must stay byte-clean, since frames in captured output
 * would corrupt whatever is reading it.
 */

/** Braille dots: one column wide in every terminal font that has them. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Writable {
  write(chunk: string): unknown
  isTTY?: boolean
}

export interface Spinner {
  /** Replace the text shown beside the spinner. */
  update(text: string): void
  /** Advance the animation without changing the text. */
  tick(): void
  /** Erase the line. Safe to call more than once. */
  stop(): void
}

export function startSpinner(stream: Writable, label: string): Spinner {
  // A non-terminal gets a spinner that does nothing at all, rather than a
  // conditional at every call site.
  if (stream.isTTY !== true) {
    return { update: () => {}, tick: () => {}, stop: () => {} }
  }

  let frame = 0
  let text = ''
  let stopped = false
  // Long enough to erase the previous line whatever it was; the frame, the
  // label and the longest status together stay well inside this.
  const WIDTH = 60

  const draw = () => {
    if (stopped) return
    stream.write(`\r${' '.repeat(WIDTH)}\r${FRAMES[frame % FRAMES.length]} ${label}${text}`)
  }

  return {
    update(next: string) {
      text = next === '' ? '' : ` · ${next}`
      frame++
      draw()
    },
    tick() {
      frame++
      draw()
    },
    stop() {
      if (stopped) return
      stopped = true
      // Blank the line and return the cursor, so whatever prints next starts
      // at column zero with nothing in front of it.
      stream.write(`\r${' '.repeat(WIDTH)}\r`)
    },
  }
}
