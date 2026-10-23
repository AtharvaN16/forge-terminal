import type { Size } from './size.js'
import type { Turn } from './types.js'

export type { Turn } from './types.js'

/**
 * Rotate in /edit: the turns the pill offers, the size a turn leaves and what
 * a name says. Pure. The wording is the PDF page rotation's ("90° right").
 */

export interface TurnStep {
  degrees: Turn
  label: string
  /** What a name says: `rotated-right`. */
  suffix: string
}

export const TURNS: readonly TurnStep[] = [
  { degrees: 90, label: '90° right', suffix: 'rotated-right' },
  { degrees: 180, label: '180°', suffix: 'rotated-180' },
  { degrees: 270, label: '90° left', suffix: 'rotated-left' },
]

export const isTurn = (v: unknown): v is Turn => v === 90 || v === 180 || v === 270

/** The size after a turn: a quarter turn swaps the sides. */
export const turnedSize = (size: Size, degrees: Turn): Size =>
  degrees === 180 ? { ...size } : { width: size.height, height: size.width }

export const turnSuffix = (degrees: Turn): string =>
  (TURNS.find((t) => t.degrees === degrees) as TurnStep).suffix
