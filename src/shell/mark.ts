/**
 * The anvil mark, as data.
 *
 * Deliberately React-free: this is drawn twice, once by the intro that runs
 * before Ink exists (`intro.ts`) and once by the `Banner` component for the
 * cases the intro skips. Keeping the geometry in one module is what stops the
 * two drifting apart.
 */

/**
 * The hammer, defined once as a sprite and animated by moving it down a row.
 * Handle rows first, head last, and adjacent by construction — an earlier
 * version transcribed every frame by hand and let the handle come away from
 * the head.
 *
 * The head spans columns 3-7, whose centre is column 5, so the handle is one
 * column wide and sits at 5. A two-column handle straddles 4.5 and reads as
 * offset, which is exactly what it did.
 */
export const HAMMER = ['     ║     ', '     ║     ', '     ║     ', '   █████   '] as const

/** The anvil never moves. Row 0 is its face — the row drawn at temperature. */
export const ANVIL = [' ▄▄▄▄▄▄▄▄▄ ', '▐█████████▌', ' ▀▀▀▐█▌▀▀▀ ', ' ▄▄██████▄ '] as const

/**
 * Rows of clear space above the anvil that the hammer swings through.
 *
 * The hammer sprite is four rows and its head is the last of them, so an
 * offset of 0 puts the head on the bottom row of the sky — resting directly
 * on the anvil's face. Offsets above that raise it, clipping the top of the
 * handle off the frame, which is what a hammer lifted out of shot looks like.
 * A positive offset would push the head onto the anvil's own row, where the
 * anvil overwrites it and the hammer loses its head entirely.
 */
export const AIR = 4
export const MARK_WIDTH = ANVIL[0].length
export const MARK_HEIGHT = AIR + ANVIL.length

/**
 * Sparks, keyed by how long ago the strike was. Each spark keeps its column
 * and only climbs a row — that difference is the whole reason these read as
 * radiating rather than sliding sideways, which is what an earlier version
 * did by moving them along a row instead.
 *
 * `row` counts upward from the anvil face.
 */
const SPARKS: readonly (readonly { row: number; cells: readonly [number, string][] }[])[] = [
  [{ row: 0, cells: [[2, '\\'] as const, [5, '|'] as const, [8, '/'] as const] }],
  [
    { row: 0, cells: [[1, '\\'] as const, [9, '/'] as const] },
    { row: 1, cells: [[3, '.'] as const, [7, '.'] as const] },
  ],
  [
    { row: 1, cells: [[1, '*'] as const, [9, '*'] as const] },
    { row: 2, cells: [[3, "'"] as const, [7, "'"] as const] },
  ],
  [{ row: 2, cells: [[1, '.'] as const, [9, '.'] as const] }],
  [],
]

export interface SwingStep {
  /** How far down the hammer sprite sits in the air above the anvil. */
  offset: number
  /** Which spark stage to overlay, or -1 for none. */
  spark: number
  /** Whether the head is against the metal on this step, and so glowing. */
  hot: boolean
}

/**
 * Raised, falling, strike, then held while the sparks climb.
 *
 * It ends on the strike rather than on the lift, because the loop plays once
 * and stops — whatever the last frame is becomes the mark that sits in the
 * scrollback for the rest of the session. A hammer caught mid-lift is a
 * strange thing to leave there; a hammer on the metal with sparks in the air
 * is the moment worth holding.
 */
export const SWING: readonly SwingStep[] = [
  { offset: -2, spark: -1, hot: false },
  { offset: -1, spark: -1, hot: false },
  { offset: 0, spark: 0, hot: true },
  { offset: 0, spark: 1, hot: true },
  // The head cools on the frame the loop stops on. Only the work is hot —
  // a hammer that stays glowing in the scrollback reads as the thing being
  // forged rather than the thing doing the forging.
  { offset: 0, spark: 2, hot: false },
]

/**
 * Composes one frame: empty sky, the hammer dropped in at its offset, sparks
 * laid over the top. Composition rather than transcription, so a frame cannot
 * be drawn with the pieces in the wrong places.
 */
export function composeMark(step: SwingStep): string[] {
  const sky: string[][] = Array.from({ length: AIR }, () => Array(MARK_WIDTH).fill(' '))

  HAMMER.forEach((row, i) => {
    const y = step.offset + i
    if (y < 0 || y >= AIR) return
    Array.from(row).forEach((ch, x) => {
      if (ch !== ' ') {
        const line = sky[y]
        if (line) line[x] = ch
      }
    })
  })

  for (const band of SPARKS[step.spark] ?? []) {
    const y = AIR - 1 - band.row
    if (y < 0 || y >= AIR) continue
    for (const [x, ch] of band.cells) {
      const line = sky[y]
      if (line && line[x] === ' ') line[x] = ch
    }
  }

  return [...sky.map((r) => r.join('')), ...ANVIL]
}

/** The row of a composed frame that is the anvil's face. */
export const FACE_ROW = AIR

/** The frame the loop stops on, and the still mark everywhere else. */
export const REST_STEP = SWING[SWING.length - 1] as SwingStep
export const MARK_AT_REST = composeMark(REST_STEP)

/**
 * Heat colours are fixed rather than taken from the palette: metal at forging
 * temperature is orange whatever theme the terminal is set to, and a face that
 * turned grey in light mode would stop being hot metal and become a line.
 */
export const HEAT = ['#a34a17', '#b4531a', '#c9631d', '#e0701c', '#ff8c1a', '#e0701c'] as const
export const SPARK_COLOUR = '#ffc247'
export const HANDLE_COLOUR = '#8a5a2b'

/** Which colour a glyph takes, given how far down the frame it sits. */
export function glyphColour(
  ch: string,
  row: number,
  step: SwingStep,
  heat: string,
  steel: string,
): string | undefined {
  if (ch === ' ') return undefined
  if (row === FACE_ROW) return heat
  if (ch === '║') return HANDLE_COLOUR
  if ("\\|/*.'".includes(ch)) return SPARK_COLOUR
  // The head is the only block glyph above the anvil, and it glows on impact.
  if (ch === '█' && row < FACE_ROW) return step.hot ? heat : steel
  return steel
}
