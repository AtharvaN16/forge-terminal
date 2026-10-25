/**
 * Remove banding in /edit: the levels the pill offers and what a name says.
 * Pure. Each level is one or two passes of the engine's deband
 * (`engines/deband.ts`); measured on stripes of a known size (2026-10-25):
 * Light mends shallow stripes and keeps about half of a picture's fine grain,
 * Medium and Strong mend tall, wide ones and keep about a quarter, Strong
 * reaching furthest.
 */

export type DebandLevelId = 'light' | 'medium' | 'strong'

export interface DebandPass {
  /** How close a pixel must be to its neighbours' average to be smoothed, in 8-bit steps. */
  threshold: number
  /** How far away those neighbours may be, in pixels. */
  range: number
}

export interface DebandLevel {
  id: DebandLevelId
  label: string
  passes: readonly DebandPass[]
}

export const DEBAND_LEVELS: readonly DebandLevel[] = [
  { id: 'light', label: 'Light', passes: [{ threshold: 12, range: 24 }] },
  {
    id: 'medium',
    label: 'Medium',
    passes: [
      { threshold: 20, range: 48 },
      { threshold: 20, range: 24 },
    ],
  },
  {
    id: 'strong',
    label: 'Strong',
    passes: [
      { threshold: 31, range: 64 },
      { threshold: 31, range: 32 },
    ],
  },
]

/** The level the pill opens on: Medium mends most banding and is the middle of the three. */
export const DEBAND_START = 1

export const isDebandLevel = (v: unknown): v is DebandLevelId =>
  DEBAND_LEVELS.some((l) => l.id === v)

export const debandLevel = (id: DebandLevelId): DebandLevel =>
  DEBAND_LEVELS.find((l) => l.id === id) as DebandLevel

export const debandSuffix = (id: DebandLevelId): string => `debanded-${id}`
