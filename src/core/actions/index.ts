import type { Preferences } from '../../config/preferences.js'
import type { Job, SourceInfo } from '../types.js'
import { compressAction } from './compress.js'
import { convertAction } from './convert.js'

export interface Choice {
  value: string
  label: string
  hint?: string
  /** A short tag rendered in the accent colour, set apart from the hint. */
  badge?: string
}

export interface PathPreset {
  label: string
  path: string
}

export type OptionSpec =
  | { kind: 'select'; id: string; label: string; choices: Choice[]; default: string }
  | {
      kind: 'slider'
      id: string
      label: string
      min: number
      max: number
      step: number
      default: number
    }
  | { kind: 'path'; id: string; label: string; default: string; presets: PathPreset[] }
  /** A free-text answer, such as a target size. */
  | { kind: 'text'; id: string; label: string; placeholder: string }

export interface Action {
  id: string
  label: string
  hint: string
  appliesTo(source: SourceInfo): boolean
  /**
   * Takes the answers so far, because some options depend on earlier ones —
   * the quality slider only makes sense once a lossy target is chosen.
   * (Spec §6 declared this without the second parameter; see the plan.)
   */
  options(source: SourceInfo, values: Record<string, unknown>, prefs: Preferences): OptionSpec[]
  plan(source: SourceInfo, values: Record<string, unknown>): Job[]
}

export { compressAction } from './compress.js'
export { convertAction } from './convert.js'

export const ACTIONS: Action[] = [convertAction, compressAction]

export function actionsFor(source: SourceInfo): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(source))
}
