import type { Action, OptionSpec } from '../core/actions/index.js'
import { formatRanges } from '../core/pages.js'
import type { Trail } from './bar-art.js'
import type { ShellMode } from './theme.js'

/** The questions convert and compress ask, in the order they ask them. */
export type Question =
  | 'mode'
  | 'target'
  | 'pages'
  | 'dpi'
  | 'size'
  | 'quality'
  | 'destination'
  | 'name'

/**
 * Where each screen sits in the walk, and what the bar calls it. A running
 * job is named by its operation's verb (`Action.verb`), so these have none.
 */
const SCREENS: Record<string, { at: number; name?: string }> = {
  mode: { at: 0, name: 'Method' },
  target: { at: 1, name: 'Format' },
  pages: { at: 2, name: 'Pages' },
  'page-picker': { at: 2, name: 'Pages' },
  dpi: { at: 3, name: 'Resolution' },
  size: { at: 4, name: 'Size' },
  quality: { at: 5, name: 'Quality' },
  // The folder and the name, asked as one question (P1).
  'save-as': { at: 6, name: 'Save as' },
  // The question, not one of its answers (L1).
  overwrite: { at: 8, name: 'Name taken' },
  'pdf-blocked': { at: 8, name: 'Name taken' },
  converting: { at: 9 },
  'pdf-running': { at: 9 },
  // Back on the size question: what came after it (the folder, the name) is not behind it.
  'size-unreachable': { at: 5, name: 'Size' },
  result: { at: 11, name: 'Done' },
}
/** Where each question is asked, in the walk above; also the order answers are listed in. */
const ASKED_AT: Record<Question, number> = {
  mode: 0,
  target: 1,
  pages: 2,
  dpi: 3,
  size: 4,
  quality: 5,
  destination: 6,
  name: 7,
}

/**
 * The header bar's trail for a convert or compress screen: every question
 * answered before this one, as the user would say the answer, then this
 * screen's own name. Only questions behind the screen count — going back
 * leaves later answers held (the quality slider's, say), and the bar must
 * not show an answer to a question still ahead.
 *
 * At the field with a file waiting there is no question, only the file.
 */
export function trailFor({
  step,
  answers,
  waiting,
  verb,
}: {
  mode: ShellMode
  step: string
  answers: Partial<Record<Question, string>>
  /** At the field: what is waiting there, as its name or a count. */
  waiting?: string | undefined
  /** While a job runs: what it is doing ("Converting"), from its action. */
  verb?: string | undefined
}): Trail {
  const screen = SCREENS[step]
  if (!screen) return { answers: waiting ? [waiting] : [], current: undefined }
  const given = (Object.keys(ASKED_AT) as Question[])
    .filter((q) => ASKED_AT[q] < screen.at)
    .map((q) => answers[q])
    .filter((a): a is string => a !== undefined && a !== '')
  return { answers: given, current: screen.name ?? verb }
}

/**
 * An answer as the user would say it: a choice by its label, pages as the
 * ranges they would type. `undefined` for a question not yet answered.
 */
export function answerFor(spec: OptionSpec, value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (spec.kind === 'select') return spec.choices.find((c) => c.value === value)?.label
  if (Array.isArray(value)) return formatRanges(value as number[])
  return String(value)
}

/** The pdf screens that are not one of the action's options. */
const PDF_SCREENS: Record<string, string> = {
  hub: 'Action',
  merge: 'Order',
  'split-n': 'Pages each',
  'split-grid': 'Cuts',
  confirm: 'Confirm',
}

/**
 * The trail inside `/pdf`: the operation, then each of its options
 * answered so far, then the screen on now — an option by its own label.
 */
export function pdfTrail({
  step,
  action,
  specs,
  specIndex,
  values,
}: {
  step: string
  action?: Action | undefined
  specs: OptionSpec[]
  specIndex: number
  values: Record<string, unknown>
}): Trail {
  if (step === 'hub' || !action) return { answers: [], current: PDF_SCREENS.hub }
  const asked = step === 'options' ? specs.slice(0, specIndex) : specs
  const answers = [
    action.label,
    ...asked
      .map((spec) => answerFor(spec, values[spec.id]))
      .filter((a): a is string => a !== undefined),
  ]
  const current = step === 'options' ? specs[specIndex]?.label : PDF_SCREENS[step]
  return { answers, current }
}
