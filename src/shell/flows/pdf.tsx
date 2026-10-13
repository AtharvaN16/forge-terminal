import { Box } from 'ink'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PREFERENCES, expandTilde, type Preferences } from '../../config/preferences.js'
import { destinationOption } from '../../core/actions/destination.js'
import type { Action, Choice, OptionSpec } from '../../core/actions/index.js'
import { PAGE_ACTIONS, unavailableReason } from '../../core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../../core/actions/split.js'
import { isForgeError } from '../../core/errors.js'
import { formatRanges, parseRanges } from '../../core/pages.js'
import type { DocumentInfo, Job, SourceInfo } from '../../core/types.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { ErrorLine } from '../components/ErrorLine.js'
import { FilledField } from '../components/FilledField.js'
import { HintBar } from '../components/HintBar.js'
import { MergeList } from '../components/MergeList.js'
import { gridLayout, PageGrid } from '../components/PageGrid.js'
import { SaveAs } from '../components/SaveAs.js'
import { Select } from '../components/Select.js'
import { StepTitle } from '../components/StepTitle.js'
import { HOME_MARGIN } from '../home-art.js'
import type { Stage } from '../stage.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { pdfTrail } from '../trail.js'
import { useKeys } from '../useKeys.js'
import { bandFor, CARD_WIDTH } from '../width.js'

/**
 * The five page operations this phase built, in the order the hub lists
 * them. Compress and Convert reach the hub in phase 4, as shortcuts to
 * `/compress` and `/convert` — listing them here now would say "not built
 * yet", which is noise, not information.
 *
 * Exported so `App.tsx` can ask the same question the hub itself answers
 * per-row (`appliesTo`) before ever mounting this component — one list,
 * asked twice, rather than two lists that could drift.
 */
export const HUB_ACTIONS = PAGE_ACTIONS

/**
 * `hub` — pick an operation. `options` — walk that action's `options()`,
 * generically for most specs, specially for split's mode and for
 * extract/delete's page selection (see `renderOptionsStep`). `split-n` and
 * `split-grid` are the two sub-answers "every N pages" and "at points I
 * choose" open, neither of which is a spec `splitAction.options()` itself
 * returns. `merge` is `MergeList` — merge's one "option" is the file order
 * itself, decided interactively rather than through an `options()` spec.
 * `confirm` shows the planned outputs; `run` is the brief instant between
 * handing the jobs to `onDone` and the caller unmounting this flow.
 */
type FlowStep = 'hub' | 'options' | 'split-n' | 'split-grid' | 'merge' | 'confirm' | 'run'

function pagesFit(pageCount: number, width: number, height: number): boolean {
  const { perRow, rowsPerPage } = gridLayout(pageCount, width, height)
  return rowsPerPage * perRow >= pageCount
}

const numberArray = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : [])

/** What the confirm step says it is about to do, one line, no jargon. */
function describeJob(job: Job): string {
  switch (job.op) {
    case 'merge':
      return `Merge ${job.sources.length} files`
    case 'split':
      return `Split into ${job.outputs.length} ${job.outputs.length === 1 ? 'file' : 'files'}`
    case 'extract':
      return job.separate
        ? `Extract ${job.pages.length} ${job.pages.length === 1 ? 'page' : 'pages'} into ${job.outputs.length} files`
        : `Extract ${job.pages.length} ${job.pages.length === 1 ? 'page' : 'pages'}`
    case 'delete':
      return `Delete ${job.pages.length} ${job.pages.length === 1 ? 'page' : 'pages'}`
    case 'rotate':
      return `Rotate ${job.turns * 90}°`
    default:
      return 'Ready'
  }
}

/**
 * `action.plan(stage.sources, values)`, except for merge: `MergeList` is the
 * only place the page order can be edited, and the order does not live in
 * `values` the way every other action's answers do — `mergeOrder` carries
 * it. Reading `stage.sources` straight through here for merge would silently
 * discard the reorder and plan the file in whatever order it happened to be
 * staged.
 */
function planJobs(
  action: Action | undefined,
  sources: SourceInfo[],
  values: Record<string, unknown>,
  mergeOrder: SourceInfo[] | undefined,
): Job[] {
  if (!action) return []
  return action.plan(action.id === 'merge' && mergeOrder ? mergeOrder : sources, values)
}

/**
 * What a /pdf run was asked with, handed out beside its jobs: enough to open
 * this flow again on Save as, as it was, when the save is refused.
 */
export interface PdfResume {
  actionId: string
  /** Every answer, `destination` and `name` included. */
  values: Record<string, unknown>
  mergeOrder?: SourceInfo[] | undefined
}

/** A typed name as it will be saved: trimmed, a `/` (which would name a folder) made `-`. */
const cleanName = (typed: string) => typed.trim().replace(/\//g, '-')

export interface PdfFlowProps {
  stage: Stage
  width: number
  height: number
  onDone: (jobs: Job[], resume: PdfResume) => void
  onCancel: () => void
  prefs?: Preferences
  /** Save as's tab: make the highlighted folder the default (App writes the config). */
  onMakeDefault?: ((path: string) => void) | undefined
  /**
   * Open on Save as, on the folder, as a run was asked — after its save was
   * refused (the name is taken) and the user chose Cancel, where choosing a
   * different folder or name is the fix.
   */
  resume?: PdfResume | undefined
  /** Where the conversation is, for the header bar above it, whenever that changes. */
  onTrail?: ((trail: Trail) => void) | undefined
}

/**
 * The `/pdf` conversation: which operation, its options, and where the result
 * goes and what it is called — Save as, as every save ends.
 * `App.tsx` mounts this with the staged list and does the actual run —
 * everything in here is choosing *what* to run, never running it.
 */
export function PdfFlow({
  stage,
  width,
  height,
  onDone,
  onCancel,
  prefs = DEFAULT_PREFERENCES,
  onTrail,
  onMakeDefault,
  resume,
}: PdfFlowProps) {
  const palette = useTheme()
  const band = bandFor(width)

  // A resumed run's answers, less Save as's own two, which have state of their own.
  const { destination: resumedFolder, name: resumedName, ...resumedValues } = resume?.values ?? {}
  const [step, setStep] = useState<FlowStep>(resume ? 'confirm' : 'hub')
  const [action, setAction] = useState<Action | undefined>(() =>
    resume ? HUB_ACTIONS.find((a) => a.id === resume.actionId) : undefined,
  )
  const [values, setValues] = useState<Record<string, unknown>>(resumedValues)
  const [specIndex, setSpecIndex] = useState(0)
  const [text, setText] = useState('')
  /**
   * A refusal of what was just typed or chosen (E5·b): a short title and the
   * reason, shown as one row under the field or grid it concerns. Cleared as
   * soon as anything is typed again.
   */
  const [fieldError, setFieldError] = useState<Refusal | undefined>(undefined)
  const [pagesError, setPagesError] = useState<Refusal | undefined>(undefined)
  /**
   * The field's text changes. The submit that raised a refusal empties the
   * field, so the row outlives that and goes with the next change: typing
   * makes it stale (as the size field's row does).
   */
  const typeText = (next: string) => {
    setText(next)
    if (next === '') return
    setFieldError(undefined)
    setPagesError(undefined)
  }
  const [pagesView, setPagesView] = useState<'grid' | 'range'>('grid')
  // Merge's order lives outside `values` because `MergeList` is the only step
  // that produces it (see `planJobs`).
  const [mergeOrder, setMergeOrder] = useState<SourceInfo[] | undefined>(resume?.mergeOrder)
  /** The order list as it stands right now, for the title's count — `mergeOrder` is only its submitted answer. */
  const [mergeShown, setMergeShown] = useState<SourceInfo[] | undefined>(undefined)
  /**
   * Save as's answers: the folder (the configured default until another is
   * chosen) and the name as typed — `undefined` until something is typed, so
   * the name keeps following what `plan()` proposes for the folder.
   */
  const destinationSpec = useMemo(
    () => (stage.sources[0] ? destinationOption(stage.sources[0], prefs) : undefined),
    [stage.sources, prefs],
  )
  const [saveFolder, setSaveFolder] = useState(() =>
    typeof resumedFolder === 'string' ? resumedFolder : expandTilde(prefs.defaultOutput),
  )
  const [saveName, setSaveName] = useState<string | undefined>(
    typeof resumedName === 'string' ? resumedName : undefined,
  )
  /** Set when `x` in `MergeList` drops the file count below two — shown at the hub. */
  const [hubNote, setHubNote] = useState<string | undefined>(undefined)

  const doc: DocumentInfo | undefined =
    stage.sources.length === 1 && stage.sources[0]?.kind === 'document'
      ? stage.sources[0]
      : undefined

  const specs: OptionSpec[] = action ? action.options(stage.sources, values, prefs) : []
  const spec = specs[specIndex]

  const trail = pdfTrail({ step, action, specs, specIndex, values })
  // Keyed on what the trail says, not on the object, which is new every render.
  const trailKey = JSON.stringify(trail)
  // biome-ignore lint/correctness/useExhaustiveDependencies: trailKey stands for trail
  useEffect(() => {
    onTrail?.(trail)
  }, [trailKey, onTrail])

  /** The jobs as Save as stands now: in its folder, under the name typed if any. */
  const saveValues = (folder: string, typed: string | undefined) => {
    const name = typed === undefined ? '' : cleanName(typed)
    return { ...values, destination: folder, ...(name ? { name } : {}) }
  }
  const jobs = useMemo(
    () => planJobs(action, stage.sources, { ...values, destination: saveFolder }, mergeOrder),
    [action, values, stage.sources, mergeOrder, saveFolder],
  )

  const hubItems: Choice[] = HUB_ACTIONS.map((a) => {
    const applies = a.appliesTo(stage.sources)
    return {
      value: a.id,
      label: a.label,
      hint: applies ? a.hint : unavailableReason(a, stage.sources),
      disabled: !applies,
    }
  })

  const resetForAction = () => {
    setValues({})
    setSpecIndex(0)
    setText('')
    setFieldError(undefined)
    setPagesError(undefined)
    setMergeOrder(undefined)
    setSaveName(undefined)
    setHubNote(undefined)
  }

  const chooseAction = (id: string) => {
    const chosen = HUB_ACTIONS.find((a) => a.id === id)
    if (!chosen) return
    resetForAction()
    setAction(chosen)

    if ((chosen.id === 'extract' || chosen.id === 'delete') && doc) {
      setPagesView(pagesFit(doc.pages, width, height) ? 'grid' : 'range')
    }

    // Merge has no option-spec list to walk — its one "option" is the file
    // order, decided interactively in MergeList rather than through
    // options()/plan() the way the other four actions' specs are answered.
    if (chosen.id === 'merge') {
      setStep('merge')
      return
    }

    const nextSpecs = chosen.options(stage.sources, {}, prefs)
    setStep(nextSpecs.length === 0 ? 'confirm' : 'options')
  }

  const backFromOptions = () => {
    if (specIndex > 0) {
      setSpecIndex(specIndex - 1)
    } else {
      setStep('hub')
    }
  }

  const backFromConfirm = () => {
    if (!action) {
      setStep('hub')
      return
    }
    // Split's `cuts` came from split-n or split-grid, neither of which is a
    // spec `options()` returns — there is nothing in `specs` to rewind to,
    // so "back" from confirm re-opens the mode picker itself.
    if (action.id === 'split') {
      setSpecIndex(0)
      setStep('options')
      return
    }
    // Merge's order and name came from MergeList, not from a spec
    // options() returns either — "back" from confirm re-opens that screen,
    // the same shape as split just above.
    if (action.id === 'merge') {
      setStep('merge')
      return
    }
    const currentSpecs = action.options(stage.sources, values, prefs)
    if (currentSpecs.length === 0) {
      setStep('hub')
      return
    }
    setSpecIndex(currentSpecs.length - 1)
    setStep('options')
  }

  /**
   * Save as's ↵: the jobs planned into the chosen folder, under the name as
   * typed (an empty one means the proposal). A typed `~/…` is expanded first,
   * or the file would land in a folder literally called `~`.
   */
  const saveAndRun = (folder: string, typed: string) => {
    if (!action) return
    const destination = expandTilde(folder)
    const answers = saveValues(destination, typed)
    const planned = planJobs(action, stage.sources, answers, mergeOrder)
    setStep('run')
    onDone(planned, { actionId: action.id, values: answers, mergeOrder })
  }

  /** `MergeList`'s `onSubmit`: the edited order lands in state, then Save as (as every action) takes over. */
  const submitMerge = (ordered: SourceInfo[]) => {
    setMergeOrder(ordered)
    setStep('confirm')
  }

  const cancelMerge = () => {
    setStep('hub')
  }

  const tooFewToMerge = (remaining: number) => {
    setHubNote(
      `Merge needs at least two files — ${remaining} ${remaining === 1 ? 'file' : 'files'} left.`,
    )
    setStep('hub')
  }

  // `Prompt` claims escape itself first and clears whatever was typed (see
  // Prompt.tsx); this is what the keystroke falls through to once the field
  // is already empty — the same "clear first, then back" split App.tsx's
  // own text fields use.
  useKeys(
    (_input, key) => {
      if (key.escape && text === '') setStep('options')
    },
    { isActive: step === 'split-n' },
  )

  /** Advances past the current spec, or to confirm once none are left. */
  const advanceAfter = (nextValues: Record<string, unknown>) => {
    setValues(nextValues)
    if (!action) return
    const nextSpecs = action.options(stage.sources, nextValues, prefs)
    if (specIndex + 1 < nextSpecs.length) {
      setSpecIndex(specIndex + 1)
    } else {
      setStep('confirm')
    }
  }

  const answerSpec = (value: unknown) => {
    if (!spec) return
    advanceAfter({ ...values, [spec.id]: value })
  }

  const chooseSplitMode = (mode: string) => {
    if (!doc) return
    if (mode === 'every-page') {
      setValues((v) => ({ ...v, mode, cuts: everyPageCuts(doc.pages) }))
      setStep('confirm')
      return
    }
    setValues((v) => ({ ...v, mode }))
    if (mode === 'every-n') {
      setText('')
      setFieldError(undefined)
      setStep('split-n')
    } else {
      setStep('split-grid')
    }
  }

  const submitSplitN = (raw: string) => {
    if (!doc) return
    const n = Number(raw.trim())
    if (!Number.isInteger(n) || n < 1) {
      setFieldError({
        title: 'Not a number',
        reason: `${raw.trim() || 'that'} is not a whole number of pages.`,
      })
      return
    }
    setFieldError(undefined)
    setValues((v) => ({ ...v, n, cuts: everyNCuts(doc.pages, n) }))
    setStep('confirm')
  }

  const submitSplitCuts = (cuts: number[]) => {
    setValues((v) => ({ ...v, cuts }))
    setStep('confirm')
  }

  /** Shared by the grid and the typed field — both write `values.pages`. */
  const submitPages = (pages: number[]) => {
    if (!doc || !action) return
    if (pages.length === 0) {
      setPagesError({ title: 'No pages', reason: 'Select at least one page.' })
      return
    }
    if (action.id === 'delete' && pages.length === doc.pages) {
      setPagesError({ title: 'Too many pages', reason: 'That would delete every page.' })
      return
    }
    setPagesError(undefined)
    advanceAfter({ ...values, pages })
  }

  const submitPagesText = (raw: string) => {
    if (!doc) return
    try {
      submitPages(parseRanges(raw, doc.pages))
    } catch (e) {
      setPagesError({
        title: 'Not a page range',
        reason: isForgeError(e) ? e.detail : 'That is not a page range.',
      })
    }
  }

  /**
   * `PageGrid` is uncontrolled and only ever reports its selection via
   * `onSubmit` on Enter — `r`/`g` deliberately don't fire that, so without
   * carrying the in-progress selection through here, toggling to the typed
   * field would silently drop whatever was picked before the toggle.
   */
  const openRangeView = (current: number[]) => {
    setValues((v) => ({ ...v, pages: current }))
    setText(formatRanges(current))
    setPagesError(undefined)
    setPagesView('range')
  }

  // In the typed field, `r` or `g` opens the grid — the same pair PageGrid
  // itself treats identically for the reverse direction. Page-range syntax
  // never contains either letter, so intercepting them here costs nothing a
  // real selection would ever type. Best-effort parses whatever is typed so
  // far so the grid opens with it already selected; an incomplete or invalid
  // in-progress range falls back to what was last committed rather than
  // blocking the toggle or losing it.
  useKeys(
    (input) => {
      if (input !== 'r' && input !== 'g') return
      if (!doc) return
      let pages = numberArray(values.pages)
      try {
        pages = parseRanges(text, doc.pages)
      } catch {
        // keep the previously committed selection
      }
      setValues((v) => ({ ...v, pages }))
      setPagesError(undefined)
      setPagesView('grid')
    },
    {
      isActive:
        step === 'options' &&
        pagesView === 'range' &&
        spec?.id === 'pages' &&
        (action?.id === 'extract' || action?.id === 'delete'),
    },
  )

  function renderOptionsStep(): ReactNode {
    if (!action || !spec) return null

    if (action.id === 'split' && spec.id === 'mode' && spec.kind === 'select') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <StepTitle mode="pdf" title="How to split" aside={pagesAside} width={width} />
          </Box>
          <Select
            width={listWidth}
            items={spec.choices}
            initialValue={spec.default}
            onSubmit={chooseSplitMode}
            onCancel={backFromOptions}
            showHints={band !== 'compact'}
          />
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      )
    }

    if (
      spec.id === 'pages' &&
      (action.id === 'extract' || action.id === 'delete') &&
      doc !== undefined
    ) {
      if (pagesView === 'grid') {
        return (
          <Box flexDirection="column" flexGrow={1}>
            <Box marginBottom={1}>
              <StepTitle mode="pdf" title={spec.label} aside={docAside} width={width} />
            </Box>
            <PageGrid
              mode="cell"
              pageCount={doc.pages}
              selected={numberArray(values.pages)}
              cuts={[]}
              onSubmit={submitPages}
              onCancel={backFromOptions}
              onToggleView={openRangeView}
              width={width}
              height={height}
            />
            {pagesError ? <Refused refusal={pagesError} width={width} /> : null}
            <HintBar
              width={width}
              pairs={[
                ['space', 'toggle'],
                ['a', 'all'],
                ['↵', 'confirm'],
              ]}
              foot={[
                ['r', 'type ranges'],
                ['esc', 'back'],
              ]}
            />
          </Box>
        )
      }
      const placeholder = spec.kind === 'text' ? spec.placeholder : ''
      return (
        <Box flexDirection="column" flexGrow={1}>
          <StepTitle mode="pdf" title={spec.label} aside={docAside} width={width} />
          <FilledField
            value={text}
            onChange={typeText}
            onSubmit={submitPagesText}
            placeholder={placeholder}
            isActive
            width={width}
          />
          {pagesError ? <Refused refusal={pagesError} width={width} /> : null}
          <HintBar
            width={width}
            pairs={[
              ['↵', 'confirm'],
              ['g', 'grid'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      )
    }

    if (spec.kind === 'select') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <StepTitle mode="pdf" title={spec.label} aside={pagesAside} width={width} />
          </Box>
          <Select
            // Keyed by spec so two select specs in a row each mount fresh and
            // open on their own default, not on the previous one's cursor.
            key={spec.id}
            width={listWidth}
            items={spec.choices}
            initialValue={spec.default}
            onSubmit={answerSpec}
            onCancel={backFromOptions}
            showHints={band !== 'compact'}
          />
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      )
    }

    // No page operation asks a slider or a folder among its options: where
    // the result goes is Save as, after them.
    if (spec.kind !== 'text') return null

    // kind === 'text', generic. None of this phase's five actions reach
    // this — `pages` is intercepted above — but a future action's plain
    // text spec has somewhere to render.
    return (
      <Box flexDirection="column" flexGrow={1}>
        <StepTitle mode="pdf" title={spec.label} aside={pagesAside} width={width} />
        <FilledField
          value={text}
          onChange={typeText}
          onSubmit={answerSpec}
          placeholder={spec.placeholder}
          isActive
          width={width}
        />
        {fieldError ? <Refused refusal={fieldError} width={width} /> : null}
        <HintBar
          width={width}
          pairs={[
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  }

  /** What a question is about, at its title's right: the file, and its pages. */
  const docAside = doc
    ? `${displayName(doc.path)} · ${doc.pages} pages`
    : `${stage.sources.length} files`
  const pagesAside = doc ? `${doc.pages} pages` : undefined
  const mergeSources = mergeShown ?? mergeOrder ?? stage.sources
  const mergeAside = `${mergeSources.length} files · ${mergeSources.reduce(
    (n, s) => n + (s.kind === 'document' ? s.pages : 0),
    0,
  )} pages`
  /** Lists stop where the file card does, as every other picker's band. */
  const listWidth = Math.min(width, CARD_WIDTH)
  /** What "every N pages" makes, once N is a whole number: the field says it. */
  const splitParts = (() => {
    const n = Number(text.trim())
    if (!doc || text.trim() === '' || !Number.isInteger(n) || n < 1) return undefined
    return Math.ceil(doc.pages / n)
  })()

  const job = jobs[0]
  /**
   * What Save as proposes: the one file `plan()` names, split where it is
   * edited — or, for a run that writes many (a split, a separate-files
   * extract), what they will be called, which is shown and not edited.
   */
  const outputs = job?.outputs ?? []
  const first = displayName(outputs[0] ?? '')
  const dot = first.lastIndexOf('.')
  const proposal =
    outputs.length > 1
      ? { stem: '', ext: '', fixedName: `${first} … ${outputs.length} files` }
      : dot > 0
        ? { stem: first.slice(0, dot), ext: first.slice(dot), fixedName: undefined }
        : { stem: first, ext: '', fixedName: undefined }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {step === 'hub' ? (
        <Box flexDirection="column" flexGrow={1}>
          <Box marginBottom={hubNote ? 0 : 1}>
            <StepTitle mode="pdf" title="Choose an operation" aside={docAside} width={width} />
          </Box>
          {hubNote ? (
            <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${hubNote}`}</Text>
          ) : null}
          <Select
            width={listWidth}
            items={hubItems}
            onSubmit={chooseAction}
            onCancel={onCancel}
            showHints={band !== 'compact'}
          />
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      ) : null}

      {step === 'options' ? renderOptionsStep() : null}

      {step === 'merge' ? (
        <Box flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <StepTitle mode="pdf" title="Order the files" aside={mergeAside} width={width} />
          </Box>
          <MergeList
            // `mergeOrder` first: escaping back from confirm re-mounts this
            // component (it is uncontrolled — see its own doc comment), and
            // seeding it from the raw stage every time would silently
            // discard whatever the user had already arranged.
            sources={mergeOrder ?? stage.sources}
            width={width}
            onSubmit={submitMerge}
            onCancel={cancelMerge}
            onTooFew={tooFewToMerge}
            onOrderChange={setMergeShown}
          />
        </Box>
      ) : null}

      {step === 'split-n' ? (
        <Box flexDirection="column" flexGrow={1}>
          <StepTitle mode="pdf" title="Pages per file" aside={pagesAside} width={width} />
          <FilledField
            value={text}
            onChange={typeText}
            onSubmit={submitSplitN}
            placeholder={doc ? String(Math.min(10, doc.pages)) : '10'}
            isActive
            width={width}
            after={
              splitParts !== undefined ? (
                <Text color={colourProp(palette.border)}>
                  {`   pages each ${SYMBOLS.arrow} ${splitParts} ${splitParts === 1 ? 'file' : 'files'}`}
                </Text>
              ) : null
            }
          />
          {fieldError ? <Refused refusal={fieldError} width={width} /> : null}
          <HintBar
            width={width}
            pairs={[
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      ) : null}

      {step === 'split-grid' && doc ? (
        <Box flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <StepTitle mode="pdf" title="Where to split" aside={pagesAside} width={width} />
          </Box>
          <PageGrid
            mode="gap"
            pageCount={doc.pages}
            selected={[]}
            cuts={numberArray(values.cuts)}
            onSubmit={submitSplitCuts}
            onCancel={() => setStep('options')}
            width={width}
            height={height}
          />
          <HintBar
            width={width}
            pairs={[
              ['space', 'cut'],
              ['a', 'all'],
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      ) : null}

      {step === 'confirm' && job && destinationSpec ? (
        <Box flexDirection="column" flexGrow={1}>
          <SaveAs
            mode="pdf"
            width={width}
            name={saveName ?? proposal.stem}
            onNameChange={setSaveName}
            proposed={proposal.stem}
            ext={proposal.ext}
            fixedName={proposal.fixedName}
            folder={saveFolder}
            onFolder={setSaveFolder}
            presets={destinationSpec.presets}
            defaultPath={expandTilde(prefs.defaultOutput)}
            display={displayPath}
            onMakeDefault={(path) => onMakeDefault?.(path)}
            onSubmit={saveAndRun}
            onBack={backFromConfirm}
            aside={describeJob(job)}
          />
        </Box>
      ) : null}

      {step === 'run' ? (
        <Box marginBottom={1}>
          <Text color={colourProp(palette.dim)}>Running…</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** What a refusal says: a short title, and why. */
interface Refusal {
  title: string
  reason: string
}

/** E5·b, as the size field shows it: a blank row, then the tinted row. */
function Refused({ refusal, width }: { refusal: Refusal; width: number }) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ErrorLine
        title={refusal.title}
        reason={refusal.reason}
        width={Math.max(8, width - 2 * HOME_MARGIN)}
      />
    </Box>
  )
}
