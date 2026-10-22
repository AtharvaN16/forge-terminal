import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { convertAction } from '../../core/actions/convert.js'
import { destinationOption } from '../../core/actions/destination.js'
import type { OptionSpec } from '../../core/actions/index.js'
import {
  type BatchRow,
  batchRows,
  type EditRecipe,
  type Existing,
  planBatch,
  type Recipe,
} from '../../core/batch.js'
import type { PlanEvent } from '../../core/execute-jobs.js'
import {
  answerFor,
  defaultAnswer,
  type FolderKind,
  type FolderScan,
  type KindAnswer,
  type KindId,
  kindTargets,
} from '../../core/folder.js'
import { FORMATS } from '../../core/formats.js'
import type { FormatId, Job, Result } from '../../core/types.js'
import { describeSize, formatBytes, parseSize } from '../../core/units.js'
import {
  convertFolder,
  type KindAnswers,
  startWatch,
  type WatchSession,
} from '../../core/watch-session.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { DoneActions, doneKeys } from '../components/Done.js'
import { ErrorLine } from '../components/ErrorLine.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { NameTaken } from '../components/NameTaken.js'
import { QualityStep } from '../components/QualityStep.js'
import { SaveAs } from '../components/SaveAs.js'
import { Select } from '../components/Select.js'
import { SIZE_UNIT_IDS, SizeField, type SizeUnit } from '../components/SizeField.js'
import { StepTitle } from '../components/StepTitle.js'
import { Working } from '../components/Working.js'
import { NEW_FOLDER } from '../destinations.js'
import { type DoneAction, doneActionRows, doneBody } from '../done-art.js'
import { blank, HOME_MARGIN, type Row } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { titleRow } from '../quality-art.js'
import { openPath, revealLabel, revealPath } from '../reveal.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import {
  countOf,
  folderCardLines,
  folderFacts,
  hairlineRow,
  kindRow,
  kindTitle,
  kindWindowLines,
  sweepAt,
  type WatchedFile,
  type WindowSetting,
  watchedRow,
  watchListRows,
} from '../watch-art.js'
import { phaseLabel } from '../working-art.js'

/*
 * forge watch in the shell (mockups/watch-2026-10.html, decided round 9):
 * a folder dropped on home in convert mode, then ↵. One kind of file asks
 * as a file does — Convert to, then Quality or Resolution — and a folder of
 * several kinds asks once per kind on Each kind, each kind's answer changed
 * in its own window. Then today's Save as, the folder converted with a real
 * count, and the watching screen: Done's bar for everything so far, the
 * hairline with its light, and each file that lands, newest at the bottom.
 *
 * Several files at once (mockups/batch-2026-10.html, 2026-10-22) are the same
 * flow: a folder or a drop of several files, in convert or compress. Compress
 * asks Method, then Quality or Target size, for every file at once. The list
 * holds every file of the batch, and only a folder is watched after.
 */

type Step =
  | 'kinds'
  | 'target'
  | 'setting'
  | 'method'
  | 'quality'
  | 'size'
  | 'save-as'
  | 'taken'
  | 'converting'
  | 'watching'

export interface WatchFlowProps {
  scan: FolderScan
  /** Convert (each kind to its format) or compress (every file at one quality or size). */
  mode?: 'convert' | 'compress' | 'edit'
  /**
   * Edit: the tool, chosen on the picker for every image, with what the
   * trail says of it ("Boost resolution", "2×") and Working's verb. The flow
   * starts at Save as.
   */
  edit?: { recipe: EditRecipe; label: string; answer?: string; verb: string } | undefined
  /**
   * A folder is watched once what it holds is done; several files dropped
   * together are not, and the list is the batch's Done.
   */
  watch?: boolean
  /** Several files, not a folder: what the card's edge says ("PNG ×12"). */
  tag?: string | undefined
  width: number
  height: number
  prefs: Preferences
  onTrail: (trail: Trail) => void
  /** esc from the first question: back home, the folder still there. */
  onCancel: () => void
  /** ↵ while watching, or on a batch's Done: stop, and home with nothing staged. */
  onClose: () => void
  onMakeDefault?: (path: string) => void
  /** Where the outputs went, as Save as remembers a save. */
  onSaved?: (folder: string) => void
  /** Test seams: how long a landed file must sit still, and how often the folder is looked at. */
  settleMs?: number
  pollMs?: number
}

/** The kinds Forge converts, in the scan's order. */
const convertible = (scan: FolderScan) => scan.kinds.filter((k) => k.why === undefined)

/** A kind's answer as its row says it, as the bar's trail would: "WebP · 80", "PNG · 150 dpi". */
export function answerText(answer: KindAnswer | undefined): string {
  if (!answer) return ''
  return [
    FORMATS[answer.target].label,
    ...(answer.quality === undefined ? [] : [String(answer.quality)]),
    ...(answer.dpi === undefined ? [] : [`${answer.dpi} dpi`]),
  ].join(' · ')
}

/** The setting a target asks for after the format, from the action's own options (invariant 2). */
function settingFor(
  kind: FolderKind,
  target: FormatId,
  prefs: Preferences,
): Extract<OptionSpec, { kind: 'select' | 'slider' }> | undefined {
  const source = kind.sources[0]
  if (!source) return undefined
  const specs = convertAction.options([source], { target }, prefs)
  const spec = specs.find((s) => s.id === 'dpi' || s.id === 'quality')
  return spec?.kind === 'select' || spec?.kind === 'slider' ? spec : undefined
}

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * Rows drawn with the home margin in front (the folder's card, the kinds'
 * rows) give it back here: on the steps, a card and a picker's rows start
 * at the content's edge, as `FileCard` and `Select` do.
 */
function inset(row: Row, n = HOME_MARGIN): Row {
  const out = [...row]
  let left = n
  while (left > 0 && out.length > 0) {
    const first = out[0] as Row[number]
    const lead = first.text.length - first.text.trimStart().length
    if (lead === 0 || first.bg !== undefined) break
    const take = Math.min(lead, left)
    left -= take
    const rest = first.text.slice(take)
    if (rest === '') out.shift()
    else out[0] = { ...first, text: rest }
  }
  return out
}

/** Rows, each on its own line; an empty row keeps its line. */
function Lines({ rows, shift = true }: { rows: Row[]; shift?: boolean }) {
  return (
    <>
      {rows.map((row, i) => {
        const r = shift ? inset(row) : row
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions on the screen.
        return <Runs key={i} row={r.length > 0 ? r : [blank(1)]} />
      })}
    </>
  )
}

/** The light's pace: one sweep there and back, frames of `FRAME_MS`. */
const SWEEP = 32
const FRAME_MS = 70
/** How long a finished row keeps its band, fading. */
const FLASH_MS = 1700

/** A compress's method, as its row and the trail say it. */
const METHODS = [
  { value: 'quality', label: 'By quality', hint: 'pick a level' },
  { value: 'size', label: 'To a target size', hint: 'smallest quality that fits' },
] as const

/** The quality slider for every file: a PNG's or GIF's three points when that is all there is. */
function qualitySpec(scan: FolderScan, quality: number) {
  const points = scan.sources.every(
    (s) => s.kind === 'image' && FORMATS[s.format].quantisable === true,
  )
  if (points) {
    const steps = Math.ceil((quality - 30) / 35)
    return {
      min: 30,
      max: 100,
      step: 35,
      points: true,
      start: Math.min(100, 30 + Math.max(0, steps) * 35),
    }
  }
  return { min: 1, max: 100, step: 5, points: false, start: quality }
}

/** A file of the batch as the list's row says it, from what became of it. */
type BatchMode = 'convert' | 'compress' | 'edit'

function rowOf(row: BatchRow, mode: BatchMode, at: string): ListedFile {
  const r = row.result
  if (row.state === 'done' && r) return { ...doneRow(r, mode), path: row.path, at, startedAt: 0 }
  return {
    path: row.path,
    at,
    startedAt: 0,
    state: row.state === 'failed' ? 'failed' : 'left',
    ...(row.reason === undefined ? {} : { reason: row.reason }),
  }
}

/** A finished file's row: from → to for a convert, was → now for a compress. */
function doneRow(r: Result, mode: BatchMode) {
  const job: Job = r.job
  return {
    state: 'done' as const,
    from: FORMATS[job.sources[0].format].label,
    to: job.op === 'convert' ? FORMATS[job.target].label : '',
    bytes: r.outputBytes,
    ...(mode === 'compress' ? { was: job.sources[0].bytes } : {}),
  }
}

type ListedFile = WatchedFile & { startedAt: number; doneAt?: number }

export function WatchFlow({
  scan,
  mode = 'convert',
  edit,
  watch = true,
  tag,
  width,
  height,
  prefs,
  onTrail,
  onCancel,
  onClose,
  onMakeDefault,
  onSaved,
  settleMs,
  pollMs,
}: WatchFlowProps) {
  const palette = useTheme()
  const compress = mode === 'compress'
  const editing = mode === 'edit' && edit !== undefined
  const kinds = convertible(scan)
  const mixed = mode === 'convert' && scan.kinds.length > 1
  const only = kinds[0]
  const name = watch ? displayName(scan.dir) : ''
  /** Every file of the batch: "12 images", "3 PDFs", "8 files". */
  const count =
    scan.kinds.length === 1 && only ? countOf(only.id, only.count) : `${scan.paths.length} files`

  const [answers, setAnswers] = useState<KindAnswers>(() => {
    const out: KindAnswers = {}
    for (const k of kinds) {
      const a = defaultAnswer(k.sources, prefs.quality)
      if (a) out[k.id] = a
    }
    return out
  })
  const [step, setStep] = useState<Step>(
    editing ? 'save-as' : compress ? 'method' : mixed ? 'kinds' : 'target',
  )
  // Compress: one method and one answer for every file.
  const [method, setMethod] = useState<'quality' | 'size'>('quality')
  const slider = qualitySpec(scan, prefs.quality)
  const [quality, setQuality] = useState(slider.start)
  const [targetBytes, setTargetBytes] = useState<number | undefined>()
  const [sizeText, setSizeText] = useState('')
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('kb')
  const [unitFocused, setUnitFocused] = useState(false)
  const [sizeError, setSizeError] = useState<string | undefined>()
  // Name taken, for several files: how many, and where they were to go.
  const [taken, setTaken] = useState<{ n: number; to: string; keepBoth: string } | undefined>()
  const [kindAt, setKindAt] = useState(0)
  const [win, setWin] = useState<{ kind: KindId; focus: number; draft: KindAnswer } | undefined>()

  // Save as, as today: the configured default first, the folder's own place as Same location.
  const first = scan.sources[0]
  const destination = useMemo(
    () => (first ? destinationOption(first, prefs, { subfolder: NEW_FOLDER[mode] }) : undefined),
    [first, prefs, mode],
  )
  const [folder, setFolder] = useState(() => expandTilde(prefs.defaultOutput))
  const placeName = (path: string) =>
    destination?.presets.find((p) => p.path === path)?.label ?? displayName(displayPath(path))

  // Converting what is there: a real count, the phase the engine reports.
  const [work, setWork] = useState<{ done: number; total: number; label: string; at: number }>({
    done: 0,
    total: 0,
    label: 'Reading',
    at: Date.now(),
  })
  // Watching: everything converted so far, and each file that has landed.
  const [totals, setTotals] = useState({
    n: 0,
    before: 0,
    after: 0,
    from: new Set<string>(),
    to: new Set<string>(),
  })
  const [files, setFiles] = useState<ListedFile[]>([])
  const [back, setBack] = useState(0)
  const [fresh, setFresh] = useState(0)
  const backRef = useRef(0)
  backRef.current = back
  const session = useRef<WatchSession | undefined>(undefined)
  /** esc while the batch runs: the files already started finish, the rest do not. */
  const stop = useRef<AbortController | undefined>(undefined)
  const [stopping, setStopping] = useState(false)
  /** A folder, once what it held is done and the run was not stopped. */
  const [watching, setWatching] = useState(false)

  // Stopped however the flow goes: ↵, ctrl-n, quitting.
  useEffect(
    () => () => {
      void session.current?.stop()
    },
    [],
  )

  /** The answers the bar's trail says: one kind's format and setting, or how many kinds. */
  const answered = (): string[] => {
    if (editing) return [edit.label, ...(edit.answer ? [edit.answer] : [])]
    if (compress) return [methodLabel, ...(valueSaid ? [valueSaid] : [])]
    if (mixed) return [`${Object.keys(answers).length} kinds`]
    const a = only ? answers[only.id] : undefined
    if (!a) return []
    return answerText(a).split(' · ')
  }
  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? ''
  const valueSaid =
    method === 'size'
      ? targetBytes === undefined
        ? undefined
        : formatBytes(targetBytes)
      : String(quality)
  const trail: Trail = (() => {
    switch (step) {
      case 'method':
        return { answers: [], current: 'Method' }
      case 'quality':
        return { answers: [methodLabel], current: 'Quality' }
      case 'size':
        return { answers: [methodLabel], current: 'Size' }
      case 'taken':
        return { answers: [...answered(), placeName(folder)], current: 'Name taken' }
      case 'kinds':
        return { answers: [], current: 'Each kind' }
      case 'target':
        return { answers: [], current: 'Format' }
      case 'setting': {
        const a = only ? answers[only.id] : undefined
        return {
          answers: a ? [FORMATS[a.target].label] : [],
          current: a?.dpi !== undefined ? 'Resolution' : 'Quality',
        }
      }
      case 'save-as':
        return { answers: answered(), current: 'Save as' }
      case 'converting':
        return {
          answers: [...answered(), placeName(folder)],
          current: editing ? edit.verb : compress ? 'Compressing' : 'Converting',
        }
      case 'watching':
        return {
          answers: [...answered(), placeName(folder)],
          current: watching ? 'Watching' : 'Done',
        }
    }
  })()
  const trailKey = JSON.stringify(trail)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trail is compared by value.
  useEffect(() => {
    onTrail(trail)
  }, [trailKey])

  /** What is done to every file: each kind's answer, or one compress. */
  const recipe: Recipe = editing
    ? edit.recipe
    : compress
      ? method === 'size' && targetBytes !== undefined
        ? { op: 'compress', targetBytes }
        : { op: 'compress', quality }
      : { op: 'convert', answers }
  /** What a finished file adds to the bar's totals. */
  const add = (r: Result) =>
    setTotals((t) => ({
      n: t.n + 1,
      before: t.before + r.job.sources[0].bytes,
      after: t.after + r.outputBytes,
      from: new Set([...t.from, FORMATS[r.job.sources[0].format].label]),
      to: new Set([...t.to, r.job.op === 'convert' ? FORMATS[r.job.target].label : '']),
    }))

  /**
   * Several files, not a folder: names already on disk are asked about once
   * for all of them, as /pdf asks (keep both, replace, cancel). A folder
   * leaves them alone instead — it was done before, and is watched.
   */
  const save = (to: string) => {
    if (!watch) {
      const plan = planBatch(scan.sources, recipe, new Set(), { destination: to, existing: 'ask' })
      const [one] = plan.taken
      if (one) {
        const keep = planBatch(scan.sources, recipe, new Set(), {
          destination: to,
          existing: 'number',
        })
        const kept = keep.jobs.find((j) => j.sources[0].path === one.sources[0].path)?.outputs[0]
        setTaken({
          n: plan.taken.length,
          to,
          keepBoth: `${kept ? displayName(kept) : ''}${plan.taken.length > 1 ? ' …' : ''}`,
        })
        setStep('taken')
        return
      }
    }
    void run(to, 'leave')
  }

  /** Converts (or compresses) every file, lists what became of each, then watches a folder. */
  const run = async (to: string, existing: Existing) => {
    onSaved?.(to)
    setStep('converting')
    setWork({ done: 0, total: 0, label: 'Reading', at: Date.now() })
    const onEvent = (event: PlanEvent) => {
      if (event.type === 'search:attempt') {
        const label = `Finding the right quality · ${displayName(event.job.sources[0].path)}`
        setWork((w) => ({ ...w, label }))
      } else if (event.type === 'search:settled') {
        setWork((w) => ({ ...w, done: event.completed, total: event.total }))
      } else if (event.type === 'job:start') {
        setWork((w) => (w.total === event.total ? w : { ...w, done: 0, total: event.total }))
      } else if (
        event.type === 'job:phase' &&
        'phase' in event.progress &&
        event.progress.phase !== 'page' &&
        event.progress.phase !== 'time'
      ) {
        const label = `${phaseLabel(event.job, event.progress.phase)} · ${displayName(event.job.sources[0].path)}`
        setWork((w) => ({ ...w, label }))
      } else if (event.type === 'job:done' || event.type === 'job:error') {
        setWork((w) => ({ ...w, done: event.completed, total: event.total }))
      }
    }
    const controller = new AbortController()
    stop.current = controller
    setStopping(false)
    const done = await convertFolder(scan, recipe, {
      destination: to,
      existing,
      onEvent,
      signal: controller.signal,
    })
    stop.current = undefined
    const results = done.outcome.results
    setTotals({
      n: results.length,
      before: results.reduce((t, r) => t + r.job.sources[0].bytes, 0),
      after: results.reduce((t, r) => t + r.outputBytes, 0),
      from: new Set(results.map((r) => FORMATS[r.job.sources[0].format].label)),
      to: new Set(results.map((r) => (r.job.op === 'convert' ? FORMATS[r.job.target].label : ''))),
    })
    // Every file of the batch in the list, in the order given; the ones that
    // could not be read at all first.
    const at = clock(new Date())
    setFiles([
      ...scan.failures.map(
        (f): ListedFile => ({
          path: f.path,
          at,
          startedAt: 0,
          state: 'failed',
          reason: f.error.title.toLowerCase(),
        }),
      ),
      ...batchRows(scan.sources, done).map((row) => rowOf(row, mode, at)),
    ])
    setWatching(watch && !done.outcome.cancelled)
    // A batch's Done reads from the top, failures and all; a watched list
    // follows the newest at the bottom, where the eye is when a file lands.
    if (!watch || done.outcome.cancelled) {
      const listed = scan.failures.length + scan.sources.length
      setBack(Math.max(0, listed - listRoom(avail)))
    }
    setStep('watching')
    // Stopped: nothing more is done, so a folder is not watched either.
    if (!watch || done.outcome.cancelled) return
    session.current = startWatch({
      dir: scan.dir,
      answers: recipe,
      known: scan.paths,
      claimed: done.claimed,
      destination: to,
      ...(settleMs === undefined ? {} : { settleMs }),
      ...(pollMs === undefined ? {} : { pollMs }),
      onEvent: (event) => {
        if (event.type === 'arrived') {
          setFiles((f) => [
            ...f,
            {
              path: event.path,
              at: clock(new Date()),
              state: 'running',
              phase: 'Reading',
              startedAt: Date.now(),
            },
          ])
          // Scrolled up, the view stays put and counts what landed below it.
          if (backRef.current > 0) {
            setBack((b) => b + 1)
            setFresh((n) => n + 1)
          }
          return
        }
        const update = (f: ListedFile): ListedFile => {
          if (event.type === 'phase') {
            return { ...f, phase: event.job ? phaseLabel(event.job, event.phase) : 'Reading' }
          }
          if (event.type === 'converted') {
            return { ...f, ...doneRow(event.result, mode), doneAt: Date.now() }
          }
          if (event.type === 'failed') {
            return { ...f, state: 'failed' as const, reason: event.error.title.toLowerCase() }
          }
          return { ...f, state: 'left' as const, reason: event.reason }
        }
        setFiles((list) => {
          const i = list.findLastIndex((f) => f.path === event.path && f.state === 'running')
          if (i < 0) return list
          return list.map((f, k) => (k === i ? update(f) : f))
        })
        if (event.type === 'converted') add(event.result)
      },
    })
  }

  /** What Save as says the files will be called: the first, and how many. */
  const fixedName = (to: string) => {
    const { jobs } = planBatch(scan.sources, recipe, new Set(), { destination: to })
    const outputs = jobs.flatMap((j) => j.outputs)
    const [one] = outputs
    if (!one) return `${scan.sources.length} files`
    return outputs.length > 1 ? `${displayName(one)} … ${outputs.length} files` : displayName(one)
  }

  // The rows the screen has under the bar (a blank row, the bar, a blank
  // row), above the keys (the rule, the keys).
  const avail = Math.max(8, height - 5)
  const card = folderCardLines({
    palette,
    mode,
    name,
    lines: folderFacts({ kinds: scan.kinds, bytes: scan.bytes, files: scan.paths.length }),
    width,
    tag,
  }).map((r): Row => [blank(HOME_MARGIN), ...r])
  /** One kind: its own name counts it ("images"); several kinds count files. */
  const oneKind = scan.kinds.length === 1 ? only?.id : undefined

  // ---------------------------------------------------------------- Each kind

  useKeys(
    (input, key) => {
      if (step !== 'kinds' || win) return
      const n = scan.kinds.length
      if (key.upArrow) setKindAt((i) => (i - 1 + n) % n)
      else if (key.downArrow) setKindAt((i) => (i + 1) % n)
      else if (key.escape) onCancel()
      else if (input === 's') setStep('save-as')
      else if (key.return) {
        const k = scan.kinds[kindAt]
        const a = k ? answers[k.id] : undefined
        if (k && a) setWin({ kind: k.id, focus: 0, draft: a })
      }
    },
    { isActive: step === 'kinds' && !win },
  )

  const winKind = win ? scan.kinds.find((k) => k.id === win.kind) : undefined
  const winTargets = winKind ? kindTargets(winKind.sources) : []
  const winSetting = win && winKind ? settingFor(winKind, win.draft.target, prefs) : undefined
  useKeys(
    (_input, key) => {
      if (!win || !winKind) return
      const rows = winSetting ? 2 : 1
      if (key.escape) setWin(undefined)
      else if (key.return) {
        setAnswers((a) => ({ ...a, [win.kind]: win.draft }))
        setWin(undefined)
      } else if (key.upArrow || key.downArrow) {
        setWin({ ...win, focus: (win.focus + 1) % rows })
      } else if (key.leftArrow || key.rightArrow) {
        const d = key.rightArrow ? 1 : -1
        if (win.focus === 0) {
          const i = winTargets.indexOf(win.draft.target)
          const target = winTargets[Math.max(0, Math.min(winTargets.length - 1, i + d))]
          if (!target) return
          // A new format keeps the quality it had, where it takes one.
          const next = answerFor(winKind.sources, target, win.draft.quality ?? prefs.quality)
          setWin({ ...win, draft: next })
        } else if (winSetting?.kind === 'slider') {
          const q = win.draft.quality ?? winSetting.default
          const value = Math.max(winSetting.min, Math.min(winSetting.max, q + d * winSetting.step))
          setWin({ ...win, draft: { ...win.draft, quality: value } })
        } else if (winSetting?.kind === 'select') {
          const values = winSetting.choices.map((c) => c.value)
          const i = values.indexOf(String(win.draft.dpi ?? winSetting.default))
          const v = values[Math.max(0, Math.min(values.length - 1, i + d))]
          if (v !== undefined) setWin({ ...win, draft: { ...win.draft, dpi: Number(v) } })
        }
      }
    },
    { isActive: step === 'kinds' && win !== undefined },
  )

  useKeys(
    (_input, key) => {
      if (!key.escape || !stop.current || stopping) return
      setStopping(true)
      stop.current.abort()
    },
    { isActive: step === 'converting' },
  )

  // Target size: tab moves between the amount and its unit, ←→ changes the
  // unit, ↵ on the unit confirms both (as compress for one file does).
  useKeys(
    (_input, key) => {
      if (key.escape) {
        setSizeError(undefined)
        setUnitFocused(false)
        setStep('method')
        return
      }
      if (key.tab) {
        setUnitFocused((f) => !f)
        return
      }
      if (!unitFocused) return
      if (key.return) {
        const raw = /[a-z]/i.test(sizeText) ? sizeText.trim() : `${sizeText.trim()}${sizeUnit}`
        const bytes = parseSize(raw)
        if (bytes === undefined) {
          setSizeError(`${raw.trim() || 'that'} is not a size. Try 500kb or 2mb.`)
          return
        }
        setTargetBytes(bytes)
        setUnitFocused(false)
        setStep('save-as')
        return
      }
      const d = key.rightArrow ? 1 : key.leftArrow ? -1 : 0
      if (d === 0) return
      setSizeUnit((u) => {
        const i = SIZE_UNIT_IDS.indexOf(u) + d
        return SIZE_UNIT_IDS[Math.min(SIZE_UNIT_IDS.length - 1, Math.max(0, i))] ?? u
      })
    },
    { isActive: step === 'size' },
  )

  if (step === 'kinds') {
    const title: Row[] = [
      [],
      [blank(HOME_MARGIN), ...titleRow({ palette, mode, title: 'Each kind', width })],
      [],
    ]
    const rows = scan.kinds.map((k, i) =>
      kindRow({
        palette,
        mode,
        kind: k,
        answer: answerText(answers[k.id]),
        selected: i === kindAt,
      }),
    )
    // The card and the kinds' band on the margin, as a file's card and a
    // picker's rows are; the title starts at the content's edge.
    const placed = [...card, ...title.map((r) => inset(r)), ...rows]
    while (placed.length < avail) placed.push([])
    let shown = placed
    if (win && winKind) {
      const settings: WindowSetting[] = [
        {
          label: 'Format',
          kind: 'pill',
          value: FORMATS[win.draft.target].label,
          at: winTargets.indexOf(win.draft.target),
          of: winTargets.length,
        },
      ]
      if (winSetting?.kind === 'slider') {
        settings.push({
          label: 'Quality',
          kind: 'slider',
          value: win.draft.quality ?? winSetting.default,
          min: winSetting.min,
          max: winSetting.max,
        })
      } else if (winSetting?.kind === 'select') {
        const values = winSetting.choices.map((c) => c.value)
        const v = String(win.draft.dpi ?? winSetting.default)
        settings.push({
          label: winSetting.label,
          kind: 'pill',
          value: winSetting.choices.find((c) => c.value === v)?.label ?? v,
          at: values.indexOf(v),
          of: values.length,
        })
      }
      const W = 56
      const lines = kindWindowLines({ palette, mode, inner: W - 2, focus: win.focus, settings })
      shown = windowOver(palette, placed, {
        title: kindTitle(winKind.id, winKind.count),
        lines,
        width: W,
        columns: width,
        // In the middle of the screen, above the key row.
        top: Math.max(0, Math.floor((avail - lines.length - 2) / 2)),
      })
    }
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Lines rows={shown} shift={false} />
        {win ? (
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['←→', 'change'],
              ['↵', 'done'],
            ]}
            foot={[
              ['esc', 'cancel'],
              ['ctrl-c', 'quit'],
            ]}
          />
        ) : (
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'kind'],
              ['↵', 'change'],
              ['s', 'start'],
            ]}
            foot={[
              ['esc', 'back'],
              ['ctrl-c', 'quit'],
            ]}
          />
        )}
      </Box>
    )
  }

  const cardBox = (
    <Box flexDirection="column" marginBottom={1}>
      <Lines rows={card} shift={false} />
    </Box>
  )

  // ------------------------------------------------- one kind: Convert to, then its setting

  if (step === 'target' && only) {
    const targets = kindTargets(only.sources)
    const a = answers[only.id]
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Box marginBottom={1}>
          <StepTitle
            mode={mode}
            title="Convert to"
            aside={countOf(only.id, only.count)}
            width={width}
          />
        </Box>
        <Select
          width={Math.min(width - 4, 60)}
          items={targets.map((t) => ({ value: t, label: FORMATS[t].label, hint: FORMATS[t].hint }))}
          {...(a ? { initialValue: a.target } : {})}
          onSubmit={(value) => {
            const target = value as FormatId
            const next = answerFor(only.sources, target, a?.quality ?? prefs.quality)
            setAnswers((all) => ({ ...all, [only.id]: next }))
            setStep(settingFor(only, target, prefs) ? 'setting' : 'save-as')
          }}
          onCancel={onCancel}
          showHints={width >= 60}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ]}
          foot={[
            ['esc', 'back'],
            ['ctrl-c', 'quit'],
          ]}
        />
      </Box>
    )
  }

  if (step === 'setting' && only) {
    const a = answers[only.id]
    const spec = a ? settingFor(only, a.target, prefs) : undefined
    if (a && spec?.kind === 'slider') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          {cardBox}
          <QualityStep
            mode={mode}
            aside={FORMATS[a.target].label}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={a.quality ?? spec.default}
            onChange={(quality) => setAnswers((all) => ({ ...all, [only.id]: { ...a, quality } }))}
            onSubmit={(quality) => {
              setAnswers((all) => ({ ...all, [only.id]: { ...a, quality } }))
              setStep('save-as')
            }}
            onCancel={() => setStep('target')}
            size={{ status: 'idle' }}
            sourceBytes={only.bytes}
            width={width}
          />
        </Box>
      )
    }
    if (a && spec?.kind === 'select') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          {cardBox}
          <Box marginBottom={1}>
            <StepTitle
              mode={mode}
              title={spec.label}
              aside={countOf(only.id, only.count)}
              width={width}
            />
          </Box>
          <Select
            width={Math.min(width - 4, 60)}
            items={spec.choices}
            initialValue={String(a.dpi ?? spec.default)}
            onSubmit={(dpi) => {
              setAnswers((all) => ({ ...all, [only.id]: { ...a, dpi: Number(dpi) } }))
              setStep('save-as')
            }}
            onCancel={() => setStep('target')}
            showHints={width >= 60}
          />
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
            ]}
            foot={[
              ['esc', 'back'],
              ['ctrl-c', 'quit'],
            ]}
          />
        </Box>
      )
    }
  }

  // ---------------------------------------------------------------- Save as

  if (step === 'method') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Box marginBottom={1}>
          <StepTitle mode={mode} title="Method" aside={count} width={width} />
        </Box>
        <Select
          width={Math.min(width - 4, 60)}
          items={METHODS.map((m) => ({ ...m }))}
          initialValue={method}
          onSubmit={(chosen) => {
            const m = chosen === 'size' ? 'size' : 'quality'
            setMethod(m)
            if (m === 'size') setSizeUnit('mb')
            setStep(m)
          }}
          onCancel={onCancel}
          showHints={width >= 60}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ]}
          foot={[
            ['esc', 'back'],
            ['ctrl-c', 'quit'],
          ]}
        />
      </Box>
    )
  }

  if (step === 'quality') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <QualityStep
          mode={mode}
          aside={count}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          points={slider.points}
          value={quality}
          onChange={setQuality}
          onSubmit={(q) => {
            setQuality(q)
            setStep('save-as')
          }}
          onCancel={() => setStep('method')}
          // Several files have no one size to show.
          size={{ status: 'idle' }}
          sourceBytes={scan.bytes}
          width={width}
        />
      </Box>
    )
  }

  if (step === 'size') {
    const withUnit = (raw: string) => (/[a-z]/i.test(raw) ? raw.trim() : `${raw.trim()}${sizeUnit}`)
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <StepTitle
          mode={mode}
          title="Target size"
          aside={`${count} · ${formatBytes(scan.bytes)}`}
          width={width}
        />
        <Box marginTop={1} flexDirection="column">
          <SizeField
            value={sizeText}
            onChange={(v) => {
              setSizeText(v)
              setSizeError(undefined)
            }}
            onSubmit={(typed) => {
              const raw = withUnit(typed)
              const bytes = parseSize(raw)
              if (bytes === undefined) {
                setSizeError(`${raw.trim() || 'that'} is not a size. Try 500kb or 2mb.`)
                return
              }
              setTargetBytes(bytes)
              setUnitFocused(false)
              setStep('save-as')
            }}
            placeholder="e.g. 500kb or 2mb"
            unit={sizeUnit}
            units={SIZE_UNIT_IDS}
            unitFocused={unitFocused}
            width={width}
          />
          {sizeText.trim() !== '' && describeSize(withUnit(sizeText)) === undefined ? (
            <Text
              color={colourProp(palette.dim)}
            >{`  ${SYMBOLS.warn} not a size — try 500kb or 2mb`}</Text>
          ) : null}
          {sizeError ? (
            <Box flexDirection="column">
              <Text> </Text>
              <ErrorLine
                title="Not a size"
                reason={sizeError}
                width={Math.max(8, width - 2 * HOME_MARGIN)}
              />
            </Box>
          ) : null}
        </Box>
        <HintBar
          width={width}
          pairs={[
            ['↵', 'confirm'],
            ['tab', unitFocused ? 'amount' : 'unit'],
            ...(unitFocused ? ([['←→', 'change unit']] as Array<[string, string]>) : []),
          ]}
          foot={[
            ['esc', 'back'],
            ['ctrl-c', 'quit'],
          ]}
        />
      </Box>
    )
  }

  if (step === 'taken' && taken) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <NameTaken
          mode={mode}
          width={width}
          name={taken.n === 1 ? '1 file' : `${taken.n} files`}
          keepBoth={taken.keepBoth}
          onSubmit={(choice) => {
            if (choice === 'cancel') setStep('save-as')
            else void run(taken.to, choice === 'keep' ? 'number' : 'replace')
          }}
          onCancel={() => setStep('save-as')}
        />
      </Box>
    )
  }

  if (step === 'save-as' && destination) {
    const back = () => {
      if (editing) onCancel()
      else if (compress) setStep(method)
      else if (mixed) setStep('kinds')
      else if (
        only &&
        answers[only.id] &&
        settingFor(only, (answers[only.id] as KindAnswer).target, prefs)
      ) {
        setStep('setting')
      } else setStep('target')
    }
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <SaveAs
          mode={mode}
          width={width}
          name=""
          onNameChange={() => {}}
          proposed=""
          ext=""
          fixedName={fixedName(folder)}
          folder={folder}
          onFolder={setFolder}
          presets={destination.presets}
          defaultPath={expandTilde(prefs.defaultOutput)}
          lastPath={destination.last}
          display={displayPath}
          onMakeDefault={(path) => onMakeDefault?.(path)}
          onSubmit={(to) => {
            setFolder(to)
            save(to)
          }}
          onBack={back}
        />
      </Box>
    )
  }

  // ---------------------------------------------------------------- converting

  if (step === 'converting') {
    const unit = oneKind ? countOf(oneKind, 2).split(' ')[1] : 'files'
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Working
          mode={mode}
          label={stopping ? 'Stopping' : work.label}
          startedAt={work.at}
          pages={work.total > 0 ? { done: work.done, total: work.total } : undefined}
          unit={unit}
          stoppable={!stopping}
          width={width}
        />
      </Box>
    )
  }

  return (
    <Watching
      mode={mode}
      watching={watching}
      name={name}
      folder={folder}
      totals={totals}
      files={files}
      back={back}
      fresh={fresh}
      avail={avail}
      width={width}
      onScroll={(d) => {
        const room = listRoom(avail)
        // Watched, one row is kept for "↓ 1 new"; a batch's Done keeps none.
        const most = Math.max(0, files.length - (watching ? room - 1 : room))
        setBack((b) => {
          const next = Math.max(0, Math.min(most, b + d))
          if (next === 0) setFresh(0)
          return next
        })
      }}
      onClose={() => {
        void session.current?.stop()
        session.current = undefined
        onClose()
      }}
      kind={oneKind}
    />
  )
}

/** The list's room: what is left under the bar, the hairline, and a folder's words or a Done's way on. */
const listRoom = (avail: number) => Math.max(3, avail - 12)

/**
 * The watching screen (T1, R1): Done's bar, the words, the hairline, the
 * list. Several files dropped together get the same screen as their Done,
 * without the words: nothing is watched.
 */
function Watching({
  mode,
  watching,
  name,
  folder,
  totals,
  files,
  back,
  fresh,
  avail,
  width,
  onScroll,
  onClose,
  kind,
}: {
  mode: BatchMode
  watching: boolean
  name: string
  folder: string
  totals: { n: number; before: number; after: number; from: Set<string>; to: Set<string> }
  files: (WatchedFile & { startedAt: number; doneAt?: number })[]
  back: number
  fresh: number
  avail: number
  width: number
  onScroll: (by: number) => void
  onClose: () => void
  /** The one kind a folder holds, to count it by its own name; a mixed folder counts files. */
  kind?: KindId | undefined
}) {
  const palette = useTheme()
  const moving = motionEnabled(palette.name)
  const running = files.some((f) => f.state === 'running')
  const flashing = files.some((f) => f.doneAt !== undefined && Date.now() - f.doneAt < FLASH_MS)
  // The hairline's light says the folder is watched; a batch's Done holds still.
  const tick = useTicker((moving && watching) || running || flashing, FRAME_MS)
  const room = listRoom(avail)
  const scrolls = files.length > room

  /**
   * A batch's Done ends in every Done's way on (mockups/done-next-2026-10-
   * round9.html): Open and Finder for the folder the files went to, then
   * Home, selected as Done opens. ←→ chooses, ↵ confirms, each keeps its key
   * (s still reveals), esc goes home. Watching keeps its one key: ↵ stops.
   */
  const doneList: DoneAction[] = [
    { key: 'o', label: 'Open' },
    { key: 'f', label: revealLabel().replace(/^Show in /, '') },
  ]
  const [sel, setSel] = useState<number | undefined>()
  useKeys((input, key) => {
    if (key.upArrow && scrolls) onScroll(1)
    else if (key.downArrow && scrolls) onScroll(-1)
    else if (watching) {
      if (key.return) onClose()
      else if (input === 'o') void openPath(folder).catch(() => {})
    } else {
      const home = doneList.length
      if (key.leftArrow || key.rightArrow) {
        setSel((at) => Math.max(0, Math.min(home, (at ?? home) + (key.rightArrow ? 1 : -1))))
        return
      }
      const chosen = key.return ? doneList[sel ?? home]?.key : input
      if (key.escape || (key.return && chosen === undefined)) onClose()
      else if (chosen === 'o') void openPath(folder).catch(() => {})
      else if (chosen === 'f' || chosen === 's') void revealPath(folder).catch(() => {})
    }
  })
  const framed =
    doneActionRows({ palette, mode, actions: doneList, selected: 0, width }) !== undefined

  const noun = kind ? countOf(kind, totals.n) : `${totals.n} ${totals.n === 1 ? 'file' : 'files'}`
  const formats = (s: Set<string>) => [...s].filter(Boolean).join(' · ') || '—'
  const bar =
    totals.n > 0
      ? doneBody({
          palette,
          width,
          // The compact picture: six rows, which the list's room below counts on.
          compact: true,
          facts: {
            mode,
            before: {
              format: formats(totals.from),
              name: noun,
              bytes: totals.before,
            },
            after: {
              format: formats(totals.to),
              name: noun,
              bytes: totals.after,
            },
          },
        })
      : []
  const now = Date.now()
  const end = scrolls ? width - HOME_MARGIN - 3 : width - 2
  const spinner = moving ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length] : undefined
  const rows = files.map((f) =>
    watchedRow({
      palette,
      mode,
      width,
      end,
      spinner,
      file: {
        ...f,
        ...(f.state === 'running' ? { clock: `${((now - f.startedAt) / 1000).toFixed(1)}s` } : {}),
        ...(f.doneAt !== undefined ? { flash: Math.max(0, 1 - (now - f.doneAt) / FLASH_MS) } : {}),
      },
    }),
  )
  const failedAt = files.flatMap((f, i) => (f.state === 'failed' ? [i] : []))
  const light =
    moving && watching ? sweepAt(tick % SWEEP, SWEEP, Math.max(1, width - 6)) : undefined
  const accent = modeColours(palette, mode).fg

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Lines rows={bar} shift={false} />
      {watching ? (
        <Box marginTop={bar.length > 0 ? 1 : 0} flexDirection="column">
          <Lines
            rows={[
              [
                blank(3),
                { text: 'Watching ', fg: palette.fg },
                { text: name, fg: accent, bold: true },
              ],
              [
                blank(3),
                {
                  text: `Any new files you add will be ${mode === 'compress' ? 'compressed' : 'converted'}.`,
                  fg: palette.dim,
                },
              ],
            ]}
            shift={false}
          />
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Lines
          rows={[
            hairlineRow({ palette, mode, width, at: light }),
            ...watchListRows({
              palette,
              rows,
              room,
              width,
              failedAt,
              back,
              fresh,
              still: !watching,
            }),
          ]}
          shift={false}
        />
      </Box>
      {watching ? (
        <HintBar
          width={width}
          pairs={[
            ['↵', 'stop and go home'],
            ['o', 'open folder'],
            ...(scrolls ? ([['↑↓', 'scroll']] as Array<[string, string]>) : []),
          ]}
          foot={[['ctrl-c', 'quit']]}
        />
      ) : (
        <HintBar
          width={width}
          above={<DoneActions mode={mode} actions={doneList} selected={sel} width={width} />}
          pairs={[
            ...doneKeys({ actions: doneList, framed }),
            ...(scrolls ? ([['↑↓', 'scroll']] as Array<[string, string]>) : []),
          ]}
          foot={[['ctrl-c', 'quit']]}
        />
      )}
    </Box>
  )
}
