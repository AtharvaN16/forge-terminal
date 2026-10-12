import type { Preferences } from '../../config/preferences.js'
import type { Job, SourceInfo } from '../types.js'
import { compressAction } from './compress.js'
import { convertAction } from './convert.js'
import { deleteAction, extractAction } from './extract.js'
import { mergeAction } from './merge.js'
import { rotateAction } from './rotate.js'
import { splitAction } from './split.js'

export interface Choice {
  value: string
  label: string
  hint?: string
  /** A short tag rendered in the accent colour, set apart from the hint. */
  badge?: string
  /**
   * Colours `hint`. Absent means the ordinary dim, which is what every hint
   * that is merely descriptive should stay — a tone is for a hint that is
   * telling the user something they may not want, or want to hear.
   */
  tone?: 'ok' | 'warn'
  /**
   * Rendered dim, skipped by the cursor, and never submittable — the `/pdf`
   * hub's way of saying "Merge exists, but not for what's staged" without
   * making the row vanish. `hint` is where the reason goes.
   */
  disabled?: boolean
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
  /**
   * What the action is doing while it runs, as one word: "Splitting". The
   * header bar ends in it on the Working screen, where the question was.
   */
  verb: string
  hint: string
  /**
   * Whether this action can run against the staged list.
   *
   * Takes the list rather than one source because merge is defined by having
   * several, and because the hub dims what does not apply rather than hiding
   * it — which needs an answer for every action on every stage.
   */
  appliesTo(sources: SourceInfo[]): boolean
  /** Why `appliesTo` said no, in three words for the hub's right margin. */
  unavailable?(sources: SourceInfo[]): string | undefined
  /**
   * Takes the answers so far, because some options depend on earlier ones —
   * the quality slider only makes sense once a lossy target is chosen.
   * (Spec §6 declared this without the second parameter; see the plan.)
   */
  options(sources: SourceInfo[], values: Record<string, unknown>, prefs: Preferences): OptionSpec[]
  plan(sources: SourceInfo[], values: Record<string, unknown>): Job[]
}

export {
  compressAction,
  convertAction,
  deleteAction,
  extractAction,
  mergeAction,
  rotateAction,
  splitAction,
}

export const ACTIONS: Action[] = [
  convertAction,
  compressAction,
  mergeAction,
  splitAction,
  extractAction,
  deleteAction,
  rotateAction,
]

export function actionsFor(sources: SourceInfo[]): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(sources))
}

export function unavailableReason(action: Action, sources: SourceInfo[]): string | undefined {
  return action.appliesTo(sources) ? undefined : action.unavailable?.(sources)
}
