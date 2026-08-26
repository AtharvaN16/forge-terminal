import { basename } from 'node:path'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { DEFAULT_PREFERENCES, type Preferences } from '../../config/preferences.js'
import type { Action, Choice, OptionSpec } from '../../core/actions/index.js'
import { ACTIONS, unavailableReason } from '../../core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../../core/actions/split.js'
import { isForgeError } from '../../core/errors.js'
import { formatRanges, parseRanges } from '../../core/pages.js'
import type { DocumentInfo, Job, SourceInfo } from '../../core/types.js'
import { HintBar } from '../components/HintBar.js'
import { MergeList } from '../components/MergeList.js'
import { ModeHeader } from '../components/ModeHeader.js'
import { gridLayout, PageGrid } from '../components/PageGrid.js'
import { PathInput } from '../components/PathInput.js'
import { Prompt } from '../components/Prompt.js'
import { Select } from '../components/Select.js'
import { Slider } from '../components/Slider.js'
import type { Stage } from '../stage.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { bandFor, middleEllipsis } from '../width.js'

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
export const HUB_ACTIONS = ACTIONS.filter((a) => a.id !== 'convert' && a.id !== 'compress')

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
 * only place the page order and the output name can be edited, and neither
 * lives in `values` the way every other action's answers do — `mergeOrder`
 * and `mergeOutputOverride` carry them instead. Reading `stage.sources`
 * straight through here for merge would silently discard the reorder and
 * plan the file in whatever order it happened to be staged — the exact bug
 * this component exists to prevent.
 */
function planJobs(
  action: Action | undefined,
  sources: SourceInfo[],
  values: Record<string, unknown>,
  mergeOrder: SourceInfo[] | undefined,
  mergeOutputOverride: string | undefined,
): Job[] {
  if (!action) return []
  const effectiveSources = action.id === 'merge' && mergeOrder ? mergeOrder : sources
  const planned = action.plan(effectiveSources, values)
  if (action.id === 'merge' && mergeOutputOverride !== undefined) {
    return planned.map((job) =>
      job.op === 'merge' ? { ...job, outputs: [mergeOutputOverride] as [string] } : job,
    )
  }
  return planned
}

export interface PdfFlowProps {
  stage: Stage
  width: number
  height: number
  onDone: (jobs: Job[]) => void
  onCancel: () => void
  prefs?: Preferences
}

/**
 * The `/pdf` conversation: which operation, its options, its confirmation.
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
}: PdfFlowProps) {
  const palette = useTheme()
  const band = bandFor(width)

  const [step, setStep] = useState<FlowStep>('hub')
  const [action, setAction] = useState<Action | undefined>(undefined)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [specIndex, setSpecIndex] = useState(0)
  const [text, setText] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const [pagesError, setPagesError] = useState<string | undefined>(undefined)
  const [pagesView, setPagesView] = useState<'grid' | 'range'>('grid')
  // Merge's two answers — the edited order and, if `n` was used, the
  // renamed output — live outside `values` because `MergeList` is the only
  // step that produces them and `mergeAction.plan` never reads `values` at
  // all (see `planJobs`).
  const [mergeOrder, setMergeOrder] = useState<SourceInfo[] | undefined>(undefined)
  const [mergeOutputOverride, setMergeOutputOverride] = useState<string | undefined>(undefined)
  /** Set when `x` in `MergeList` drops the file count below two — shown at the hub. */
  const [hubNote, setHubNote] = useState<string | undefined>(undefined)

  const doc: DocumentInfo | undefined =
    stage.sources.length === 1 && stage.sources[0]?.kind === 'document'
      ? stage.sources[0]
      : undefined

  const specs: OptionSpec[] = action ? action.options(stage.sources, values, prefs) : []
  const spec = specs[specIndex]

  const jobs = useMemo(
    () => planJobs(action, stage.sources, values, mergeOrder, mergeOutputOverride),
    [action, values, stage.sources, mergeOrder, mergeOutputOverride],
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
    setMergeOutputOverride(undefined)
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

  const confirmAndRun = () => {
    if (!action) return
    const planned = planJobs(action, stage.sources, values, mergeOrder, mergeOutputOverride)
    setStep('run')
    onDone(planned)
  }

  /** `MergeList`'s `onSubmit` — the edited order and output path land in state, then the shared confirm screen (same as every other action) takes over. */
  const submitMerge = (ordered: SourceInfo[], outputPath: string) => {
    setMergeOrder(ordered)
    setMergeOutputOverride(outputPath)
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

  useKeys(
    (_input, key) => {
      if (key.return) confirmAndRun()
      if (key.escape) backFromConfirm()
    },
    { isActive: step === 'confirm' },
  )

  // Prompt deliberately ignores escape — a typed value can contain one — so
  // the step owns it, the same way App.tsx's own text fields do.
  useKeys(
    (_input, key) => {
      if (key.escape) setStep('options')
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
      setFieldError(`${raw.trim() || 'that'} is not a whole number of pages.`)
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
      setPagesError('Select at least one page.')
      return
    }
    if (action.id === 'delete' && pages.length === doc.pages) {
      setPagesError('That would delete every page.')
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
      setPagesError(isForgeError(e) ? e.detail : 'That is not a page range.')
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
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>{spec.label}</Text>
          <Select
            width={width}
            items={spec.choices}
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
          <Box flexDirection="column" marginBottom={1}>
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
            {pagesError ? (
              <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${pagesError}`}</Text>
            ) : null}
            <HintBar
              width={width}
              pairs={[
                ['space', 'toggle'],
                ['a', 'all'],
                ['↵', 'confirm'],
                ['r', 'type ranges'],
              ]}
            />
          </Box>
        )
      }
      const placeholder = spec.kind === 'text' ? spec.placeholder : ''
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>{spec.label}</Text>
          <Prompt
            value={text}
            onChange={setText}
            onSubmit={submitPagesText}
            placeholder={placeholder}
            isActive
            variant={band === 'compact' ? 'plain' : 'field'}
            width={width}
          />
          {pagesError ? (
            <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${pagesError}`}</Text>
          ) : null}
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
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>{spec.label}</Text>
          <Select
            width={width}
            items={spec.choices}
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

    if (spec.kind === 'slider') {
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Slider
            label={spec.label}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={typeof values[spec.id] === 'number' ? (values[spec.id] as number) : spec.default}
            onChange={(v) => setValues((cur) => ({ ...cur, [spec.id]: v }))}
            onSubmit={answerSpec}
            onCancel={backFromOptions}
          />
          <HintBar
            width={width}
            pairs={[
              ['←→', 'adjust'],
              ['↵', 'confirm'],
              ['esc', 'back'],
            ]}
          />
        </Box>
      )
    }

    if (spec.kind === 'path') {
      return (
        <Box flexDirection="column" marginBottom={1}>
          <PathInput
            label={spec.label}
            presets={spec.presets}
            preview={(p) => p}
            onSubmit={answerSpec}
            onCancel={backFromOptions}
            width={width}
            showHints={band !== 'compact'}
            defaultPath={spec.default}
          />
        </Box>
      )
    }

    // kind === 'text', generic. None of this phase's five actions reach
    // this — `pages` is intercepted above — but a future action's plain
    // text spec has somewhere to render.
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colourProp(palette.label)}>{spec.label}</Text>
        <Prompt
          value={text}
          onChange={setText}
          onSubmit={answerSpec}
          placeholder={spec.placeholder}
          isActive
          variant={band === 'compact' ? 'plain' : 'field'}
          width={width}
        />
        {fieldError ? (
          <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${fieldError}`}</Text>
        ) : null}
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

  const job = jobs[0]
  const MAX_SHOWN_OUTPUTS = 8
  const allOutputs = job ? job.outputs : []
  // Keyed by the full path, not the array index or the truncated basename:
  // a stray-page extract can legitimately repeat a stem+suffix, and the
  // path is the one thing guaranteed unique across a job's outputs.
  const shownOutputs = allOutputs.slice(0, MAX_SHOWN_OUTPUTS).map((path) => ({
    path,
    label: middleEllipsis(basename(path), Math.max(8, width - 6)),
  }))
  const hiddenOutputs = Math.max(0, allOutputs.length - MAX_SHOWN_OUTPUTS)

  return (
    <Box flexDirection="column">
      {step === 'hub' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>PDF — choose an operation</Text>
          {hubNote ? (
            <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${hubNote}`}</Text>
          ) : null}
          <Select
            width={width}
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
              ['esc', 'cancel'],
            ]}
          />
        </Box>
      ) : null}

      {step === 'options' ? renderOptionsStep() : null}

      {step === 'merge' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>Merge — order the files</Text>
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
          />
        </Box>
      ) : null}

      {step === 'split-n' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>How many pages per file?</Text>
          <Prompt
            value={text}
            onChange={setText}
            onSubmit={submitSplitN}
            placeholder={doc ? String(Math.min(10, doc.pages)) : '10'}
            isActive
            variant={band === 'compact' ? 'plain' : 'field'}
            width={width}
          />
          {fieldError ? (
            <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${fieldError}`}</Text>
          ) : null}
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
        <Box flexDirection="column" marginBottom={1}>
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

      {step === 'confirm' && job ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colourProp(palette.label)}>{describeJob(job)}</Text>
          <Box flexDirection="column" marginTop={1}>
            {shownOutputs.map(({ path, label }) => (
              <Text
                key={path}
                color={colourProp(palette.dim)}
              >{`  ${SYMBOLS.arrow} ${label}`}</Text>
            ))}
            {hiddenOutputs > 0 ? (
              <Text color={colourProp(palette.dim)}>{`  … and ${hiddenOutputs} more`}</Text>
            ) : null}
          </Box>
          <HintBar
            width={width}
            pairs={[
              ['↵', 'run'],
              ['esc', 'back'],
            ]}
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
