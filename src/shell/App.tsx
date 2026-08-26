import { basename } from 'node:path'
import { Box, Static, Text, useApp, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PREFERENCES,
  expandTilde,
  type Preferences,
  savePreferences,
} from '../config/preferences.js'
import type { OptionSpec } from '../core/actions/index.js'
import { compressAction, convertAction } from '../core/actions/index.js'
import { describeResult } from '../core/describe.js'
import { isForgeError, unexpectedError, unsupportedCompress } from '../core/errors.js'
import { runPlan } from '../core/execute-jobs.js'
import { FORMATS, primaryExtension } from '../core/formats.js'
import { uniqueOutputPath } from '../core/output-path.js'
import type { InputFailure } from '../core/resolve.js'
import { type Suggestion, suggestFormat } from '../core/suggest.js'
import type { FormatId, Job, Result, SourceInfo } from '../core/types.js'
import { formatBytes, parseSize } from '../core/units.js'
import { checkWriteSafety } from '../core/write-safety.js'
import { encodeToBuffer } from '../engines/image.js'
import { pdfiumEngine } from '../engines/pdfium.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { COMMANDS, type Command, isCommandBuffer, matchCommands, parseCommand } from './commands.js'
import { CommandPalette } from './components/CommandPalette.js'
import { HintBar } from './components/HintBar.js'
import { PageGrid } from './components/PageGrid.js'
import { PathInput } from './components/PathInput.js'
import { Progress } from './components/Progress.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { StagedFiles } from './components/StagedFiles.js'
import { ThemePicker } from './components/ThemePicker.js'
import { HUB_ACTIONS, PdfFlow } from './flows/pdf.js'
import { fileLink, hyperlinksSupported } from './hyperlink.js'
import { openPath, revealLabel, revealPath } from './reveal.js'
import { addToStage, clearStage, emptyStage, type Stage } from './stage.js'
import { ThemeProvider } from './ThemeContext.js'
import { colourProp, paletteFor, SYMBOLS } from './theme.js'
import { useKeys } from './useKeys.js'
import { bandFor, middleEllipsis } from './width.js'

/**
 * Everything below `App` is dumb and takes props; this is the only file
 * that knows the flow. It walks: drop a file -> pick a target format ->
 * (quality, for a lossy target only) -> pick a destination -> convert ->
 * show the result.
 */
export type Step =
  | 'theme'
  | 'idle'
  /** Compress: by quality, or to a target size. */
  | 'mode'
  /** Compress: the target-size field. */
  | 'size'
  | 'target'
  /** A document target only: which pages to rasterise (all/first/choose). */
  | 'pages'
  /** 'Choose pages' from the `pages` step opens `PageGrid` here. */
  | 'page-picker'
  /** A document target only: the rasterisation resolution. */
  | 'dpi'
  | 'quality'
  | 'destination'
  | 'rename'
  | 'overwrite'
  | 'converting'
  /** A target size searched down to the lowest quality and still missed it — see `sizeUnreachable`. */
  | 'size-unreachable'
  | 'result'
  /** `/pdf`: `PdfFlow` owns the conversation; this just mounts it. */
  | 'pdf'
  /** Between `PdfFlow` handing off its jobs and `runJobs` finishing. */
  | 'pdf-running'
  /** `checkWriteSafety` refused the job `PdfFlow` handed off — see `pdfBlocked`. */
  | 'pdf-blocked'

/**
 * What the overwrite question needs to remember while it is being asked:
 * where the user chose to save, what that resolved to, and the name "keep
 * both" would use — resolved once, when the question is raised, rather than
 * on every render of it.
 */
interface PendingRename {
  destination: string
  /** The name without its extension, which is what the user edits. */
  stem: string
  /** Fixed: decided by the target format, not by what is typed. */
  ext: string
}

interface PendingOverwrite {
  destination: string
  output: string
  keepBoth: string
}

/**
 * What the "can't get that small" question needs to remember while it is
 * being asked: the plan a target-size search already fell short of, plus the
 * smallest quality/size that search actually found, so "use the lowest
 * quality" can finish the same conversion rather than re-planning or
 * re-searching from scratch.
 */
interface PendingSizeUnreachable {
  planned: Extract<Job, { op: 'convert' }>
  destination: string
  output: string
  opts: ConversionOpts
  targetBytes: number
  smallest: number
  quality: number
  /**
   * The rung the smallest size came from. Only a document has one — an image
   * search has a single lever — so it names the resolution the "use it anyway"
   * answer would write at.
   */
  dpi?: number
}

/**
 * How a conversion was asked for. `targetBytes` travels with it so the search
 * happens inside `runPlan` rather than in the shell — which is what makes a
 * document reach the resolution ladder at all.
 */
interface ConversionOpts {
  force?: boolean
  output?: string
  targetBytes?: number
}

/**
 * What the `/pdf` write-safety refusal needs to remember while it is being
 * asked: the exact jobs `PdfFlow` handed off (so "Replace" can re-check them
 * with `force: true` rather than needing to re-derive them) and the refusal
 * itself. `checkWriteSafety` is per-job all-or-nothing, and every page
 * action this phase built plans exactly one job, so `failures` is one entry
 * in practice — kept as a list because `checkWriteSafety`'s own return type
 * is, and nothing here should assume more than that type promises.
 */
interface PendingPdfRefusal {
  jobs: Job[]
  failures: InputFailure[]
  /**
   * Where "Cancel" lands. `/pdf`'s five page operations hand off through
   * `onDone` with nowhere else of their own to go back to but the hub —
   * `'pdf'` reopens `PdfFlow` there, same as it always has. An ordinary
   * document conversion run through the wizard (`confirmDocumentConversion`)
   * has a real step to return to instead: `'destination'`, where "pick a
   * different folder" is the actual fix, exactly what `answerOverwrite`'s
   * own cancel already offers every other format that hits this same
   * question. Defaulting a caller-less refusal to the hub would silently
   * drop a wizard conversion into `/pdf` instead of back into its own flow.
   */
  cancelTo: 'pdf' | 'destination'
}

let blockSeq = 0
const nextId = () => `b${++blockSeq}`

/**
 * One line for the history, once a page-operation job has actually run.
 * `HistoryEntry`'s `result` block is built around a `convert` job's
 * one-source-to-one-target shape (spec: "A page operation's result gets its
 * own rendering once one exists") — until it does, a `note` block says what
 * happened in plain words rather than the shell crashing trying to draw a
 * before/after pair for a job that has neither.
 */
function describePdfResult(result: Result): string {
  const { job } = result
  const outputs = job.outputs.map((o) => basename(o))
  const first = outputs[0] ?? ''
  switch (job.op) {
    /**
     * The case this switch used to lack.
     *
     * A rasterisation writes one file per page, and falling through to the old
     * `done — ${first}` default reported one filename for however many were
     * written. The count comes from `describeResult` rather than being worked
     * out again here — that is the module which owns what a result means.
     */
    case 'convert': {
      const view = describeResult(result)
      return view.outputs.length === 1
        ? `${view.verb} — ${first}`
        : `${view.verb} into ${view.outputs.length} files`
    }
    case 'merge':
      return `merged ${job.sources.length} files into ${first}`
    case 'split':
      return `split into ${outputs.length} files`
    case 'extract':
      return job.separate
        ? `extracted ${job.pages.length} pages into ${outputs.length} files`
        : `extracted ${job.pages.length} pages into ${first}`
    case 'delete':
      return `removed ${job.pages.length} pages — ${first}`
    case 'rotate':
      return `rotated ${job.turns * 90}° — ${first}`
    default: {
      /**
       * No silent default. The old one swallowed `convert` and reported a
       * wrong-but-plausible sentence; a new op must fail to compile instead.
       */
      const unhandled: never = job
      throw new Error(`describePdfResult has no wording for ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The verb painted beside `pageProgress`'s running count, derived from
 * whichever job actually reported it — never a flag threaded down by hand,
 * so it can never say something is rendering when it is really copying
 * pages. `merge`, `delete` and `rotate` report phases only (see
 * `engines/pdf.ts`), so `pageProgress` never carries their `op` and this
 * never runs for them; `default` exists only as a defensive fallback if a
 * future op starts reporting page progress without a label of its own.
 */
function pageProgressLabel(op: Job['op']): string {
  switch (op) {
    case 'convert':
      return 'RENDERING'
    case 'split':
      return 'SPLITTING'
    case 'extract':
      return 'EXTRACTING'
    default:
      return 'PROCESSING'
  }
}

/**
 * The fallback for callers that do not supply preferences — tests, and any
 * direct render. It carries a theme on purpose: an absent theme is the
 * first-run signal, and defaulting to it would put the theme picker in front
 * of every test that only wanted to convert a file.
 *
 * The production path never uses this. `launchShell` always passes what
 * `loadPreferences` returned, where a genuinely absent theme does raise the
 * picker — which is what `theme-picker.test.tsx` exercises by passing
 * `DEFAULT_PREFERENCES` explicitly.
 */
const APP_DEFAULT_PREFS: Preferences = { ...DEFAULT_PREFERENCES, theme: 'dark' }

export function App({
  initialWidth,
  initialHeight,
  prefs = APP_DEFAULT_PREFS,
  configWarning,
}: {
  initialWidth?: number
  initialHeight?: number
  prefs?: Preferences
  configWarning?: string
}) {
  const { stdout } = useStdout()
  const [measured, setMeasured] = useState(initialWidth ?? stdout?.columns ?? 80)
  /** Only `PdfFlow`'s page grid needs this — see `gridLayout`. */
  const [measuredHeight, setMeasuredHeight] = useState(initialHeight ?? stdout?.rows ?? 24)

  useEffect(() => {
    if (initialWidth !== undefined || !stdout) return
    const onResize = () => setMeasured(stdout.columns ?? 80)
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [initialWidth, stdout])

  useEffect(() => {
    if (initialHeight !== undefined || !stdout) return
    const onResize = () => setMeasuredHeight(stdout.rows ?? 24)
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [initialHeight, stdout])

  const width = measured
  const height = measuredHeight
  const band = bandFor(width)

  /**
   * Seeded with the banner rather than having an effect push it, so it is
   * `<Static>` item zero from the very first frame. Ink flushes static output
   * above everything that re-renders, so this is what pins the banner to the
   * top of the session — it scrolls up as history grows, exactly as Claude
   * Code's does, instead of being redrawn below the scrollback on every
   * update, which is how it ended up in the middle of the screen.
   *
   * Skipped when no theme has been chosen: the first-run picker owns the
   * screen until it is answered, and the banner is pushed once it is.
   */
  /**
   * Seeded with the banner so it is `<Static>` item zero from the first
   * frame, which is what pins it to the top: Ink flushes static output above
   * everything that re-renders.
   *
   * An animated version of this existed briefly and was removed. Animation
   * cannot live in `<Static>` — static output is written once and never
   * redrawn — so it had to run in the live region and then settle into
   * history. That height change left earlier lines on screen: the rendered
   * frame was correct, and the terminal showed a stack of stale rules
   * underneath it. A still mark costs nothing and cannot do that.
   */
  /**
   * Empty. The banner is drawn by `playIntro` before Ink mounts, so by the
   * time this renders it is already on screen as ordinary scrollback — see
   * intro.ts. The one exception is first run, where the theme picker owned
   * the screen and there was no palette to draw it in; `chooseTheme` pushes
   * one then.
   */
  const [history, setHistory] = useState<HistoryBlock[]>([])
  /**
   * Held in state, not read straight from `prefs`, so `/theme` re-themes the
   * running session rather than only the next launch.
   */
  const [theme, setTheme] = useState<'dark' | 'light' | undefined>(prefs.theme)
  /**
   * Derived straight from `theme`, not read from context: this component is
   * the one that renders `<ThemeProvider palette={paletteFor(theme)}>` a few
   * hundred lines down, and a component can never consume a context value
   * from a provider it renders as its own descendant — that provider's value
   * only reaches components further down the tree. Reading `useTheme()` here
   * instead resolved against whatever wraps `<App>` from the outside
   * (launch.tsx's provider, frozen at the palette computed once at launch),
   * so this file's own top-level elements — the mode header background among
   * them — never picked up a theme chosen or changed mid-session.
   */
  const palette = paletteFor(theme)
  /**
   * Preferences as they stand *now*, seeded from what was loaded at launch.
   * `d` changes the default output mid-session, and the banner, the preset
   * list and the `default` tag must all follow it without waiting for a
   * relaunch — so they all read this, never the `prefs` prop.
   */
  const [livePrefs, setLivePrefs] = useState<Preferences>(prefs)
  const [step, setStep] = useState<Step>(prefs.theme === undefined ? 'theme' : 'idle')
  /**
   * Which action the staged file is being put through. Dropping a file means
   * convert; `/compress` switches it. The action layer already supports more
   * than one action — `actionsFor` has existed since 0.1 and never been
   * called, because until now there was nothing to choose between.
   */
  const [mode, setMode] = useState<'convert' | 'compress'>('convert')
  const action = mode === 'compress' ? compressAction : convertAction

  /** Where the target-size search has got to, for an honest counter. */
  /**
   * `dpi` names the rung a document search is on. Without it, a search
   * dropping from 150 to 120 dpi looks like the counter restarting for no
   * reason — the CLI learned this the same way.
   */
  const [attempt, setAttempt] = useState<{ n: number; of: number; dpi?: number } | undefined>(
    undefined,
  )
  /**
   * The latest `{ phase: 'page' }` event `runJobs` reported, or `null` until
   * one actually arrives. `null` is the whole point, not just an initial
   * value: invariant 7 forbids a fabricated percentage, and an operation
   * that only ever reports the phases-only variant (`reading`/`decoding`/
   * `encoding`/`writing`) must never mount `<Progress>` — gating on "a page
   * event has been seen" rather than "a job is running" is what keeps a
   * single-file, single-phase conversion from growing a bar it has no real
   * position to show on.
   */
  const [pageProgress, setPageProgress] = useState<{
    done: number
    total: number
    detail?: string
    /** Which job this count belongs to — what `pageProgressLabel` reads. */
    op: Job['op']
  } | null>(null)
  /** Why a typed size was rejected, shown against the field rather than later. */
  const [sizeError, setSizeError] = useState<string | undefined>(undefined)
  /** A measured alternative worth offering after a compression. */
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>(undefined)
  /**
   * How many `target: 'pdf'` conversions have written a file this session.
   * Unlike `suggestion` (recomputed fresh from one result), the merge offer
   * below only makes sense once a *second* single-image PDF exists to
   * combine the first one with — so this has to survive across separate
   * conversions rather than being derived from the latest result alone. A
   * ref, not state: the count itself is never rendered, only whether it has
   * crossed one, which `mergeOffer` below tracks.
   */
  const pdfOutputsThisSession = useRef(0)
  /**
   * Set once a `target: 'pdf'` conversion brings `pdfOutputsThisSession`
   * above one. Several single-image PDFs are exactly what phase 3's
   * `mergeAction` combines, and once they exist as separate files nothing
   * else in the wizard points at that — so this offers it, the same way the
   * compress flow offers a stronger format. See the render below for why
   * acting on it is left to `/pdf` rather than a dedicated key.
   */
  const [mergeOffer, setMergeOffer] = useState<number | undefined>(undefined)
  const [text, setText] = useState('')
  /**
   * The staged list. What was one file (`SourceInfo | null`) is now a list
   * with two drops accumulating into it — merge needs several files at once,
   * and `resolve.ts`/`run.ts` already speak in lists; the shell was the only
   * place still narrowed to one.
   *
   * The wizard below (target, quality, destination) still walks a single
   * representative file — `source`, derived just below — because picking a
   * target format is one choice for the whole batch, not a per-file one.
   * Only the run itself, and what is drawn on screen, need the full list.
   */
  const [stage, setStage] = useState<Stage>(emptyStage())
  /**
   * The first staged file, standing in for "the" file everywhere the wizard
   * only ever needed one — computing option specs, planning a filename
   * preview, and so on. `?? null` keeps the exact `SourceInfo | null` shape
   * this used to be, so none of that logic has to change.
   */
  const source: SourceInfo | null = stage.sources[0] ?? null
  /**
   * Whether converting or compressing right now would silently act on only
   * the first of several staged files. Batch convert/compress is deferred —
   * see the note above `convert()` — so this is what keeps that deferral
   * from being a silent one: `/convert` and `/compress`, and a drop that
   * would otherwise advance straight into the wizard, all check this first
   * and refuse instead of quietly picking `stage.sources[0]` for the user.
   */
  const stagedBatch = stage.sources.length > 1
  /**
   * Whether `CommandPalette`'s `<Select>` currently owns escape — that is,
   * whether the typed fragment has at least one match. `isCommandBuffer`
   * alone is not enough: it is true the instant text starts with `/` and
   * has no further `/` or space, which includes fragments like `/U` that
   * match nothing. `CommandPalette` renders a plain, non-interactive
   * "no command matches" `<Text>` in that state — no `<Select>`, no
   * `useInput` — so nothing would be left to consume escape if the stage
   * hook below were gated on `isCommandBuffer` alone. Calling the same
   * `matchCommands` that `CommandPalette` itself calls to choose between
   * `<Select>` and that message is what keeps this from drifting out of
   * sync with what actually mounts, the way `isCommandBuffer` did.
   */
  const paletteOwnsEscape = isCommandBuffer(text) && matchCommands(text.slice(1)).length > 0
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [lastResult, setLastResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<PendingOverwrite | null>(null)
  /** Destination and proposed stem while the rename field is open. */
  const [renaming, setRenaming] = useState<PendingRename | null>(null)
  /** Set only while `step === 'pdf-blocked'` — what a refused `/pdf` run can still do. */
  const [pdfBlocked, setPdfBlocked] = useState<PendingPdfRefusal | null>(null)
  /** Set only while `step === 'size-unreachable'` — see `PendingSizeUnreachable`. */
  const [sizeUnreachable, setSizeUnreachable] = useState<PendingSizeUnreachable | null>(null)

  /**
   * Mirrors `text` for the completion callback, for the same reason
   * `Prompt` mirrors its own buffer: reading a directory is async, and by the
   * time it resolves the user may have typed on. Comparing against the ref
   * is what lets a superseded completion be dropped instead of overwriting
   * what they typed — the same rule `requestId` applies to probes.
   */
  const textRef = useRef('')
  textRef.current = text

  const { exit } = useApp()

  const push = useCallback((block: HistoryBlock) => {
    setHistory((h) => [...h, block])
  }, [])

  /**
   * Rules a dashed line under whatever is already on screen, so a change of
   * flow reads as a new operation rather than a continuation of the last one.
   *
   * A compress refusal used to sit directly above `/pdf`'s operation list,
   * close enough to read as part of that menu — the user took a message about
   * compression as an explanation of the PDF screen they were now looking at.
   * The same rule already separates finished results (see the `lastResult`
   * handler); entering a different flow earns it for the same reason.
   *
   * Functional update rather than reading `history`: this runs from input
   * callbacks whose closures would otherwise capture a stale array. No rule
   * on an empty session, and never two in a row.
   */
  const fenceOff = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      if (h[h.length - 1]?.kind === 'separator') return h
      return [...h, { kind: 'separator' as const, id: nextId(), width }]
    })
  }, [width])

  /**
   * A config that could not be read is told to the user once, as history,
   * and never again. The ref — not state — is what makes "once" true: this
   * effect reruns on every render that changes its deps, and a state flag
   * would not be visible to the run that scheduled it.
   */
  /**
   * Pushed once, before anything else can reach history, so the banner is the
   * first thing `<Static>` flushes and stays at the top of the session.
   */
  const warned = useRef(false)
  useEffect(() => {
    if (warned.current || configWarning === undefined) return
    warned.current = true
    push({ kind: 'note', id: nextId(), text: `${SYMBOLS.warn} ${configWarning}` })
  }, [configWarning, push])

  /**
   * The one way anything in this file reports a failure. Whatever was thrown
   * — a `ForgeError`, or something nothing anticipated — becomes a history
   * block the user can actually read, never a raw stack trace (spec §11).
   */
  const showError = useCallback(
    (e: unknown) => {
      push({ kind: 'error', id: nextId(), error: isForgeError(e) ? e : unexpectedError(e) })
    },
    [push],
  )

  /**
   * Refuses to convert or compress a staged batch rather than silently
   * acting on the first file in it. Refusing beats converting-the-first-
   * loudly: a partial action on an ambiguous request is worse than no
   * action, because the user can clear the stage and drop one file in a
   * second, but they cannot un-convert a file they never meant to touch —
   * the same "a change nobody asked for is a surprise" reasoning the phase-2
   * compress design doc uses for why compress never changes the format.
   *
   * A `note` block, not a new one: this is a plain history line, the same
   * shape `/help` and the config-warning banner already use, with the warn
   * symbol paired with words so the reason survives a monochrome terminal.
   */
  const refuseBatch = useCallback(() => {
    push({
      kind: 'note',
      id: nextId(),
      text: `${SYMBOLS.warn} Converting several files at once isn't supported yet. Drop a single file, or esc to clear the list.`,
    })
  }, [push])

  /**
   * Whether `convertAction` actually has somewhere to send this source.
   * `convertAction.appliesTo` only checks `sources.length >= 1` — that was
   * never enough on its own to guarantee a real choice: before a
   * rasterisation engine arrived, a PDF's only writable format was PDF
   * itself, which
   * `targetSelect` (in `core/actions/convert.ts`) deliberately filters out
   * as a no-op conversion, leaving its target list genuinely empty. A PDF
   * now has real targets (jpeg, png — see `engines/pdfium.ts`), so this
   * returns `true` for one; the check stays because nothing guarantees
   * every future source kind will have somewhere to go.
   *
   * Without this check, a source with no real target would open the
   * `target` step with a `Select` that has nothing to move a cursor onto —
   * and critically, `Select` no-ops on *every* key, including escape, when
   * its item list is empty (see `Select.tsx`). That was a dead end a
   * person could not back out of short of quitting the process; it is why
   * this exists at all, even though no source reaches that empty case
   * today.
   */
  const hasConvertTarget = useCallback(
    (candidate: SourceInfo): boolean =>
      convertAction
        .options([candidate], {}, livePrefs)
        .some((s) => s.kind === 'select' && s.id === 'target' && s.choices.length > 0),
    [livePrefs],
  )

  /**
   * Whether *any* of the five page operations `PdfFlow`'s hub lists applies
   * to what is staged — the same question `/convert` asks via
   * `hasConvertTarget` and `/compress` asks via `compressAction.appliesTo`,
   * asked here so `/pdf` agrees with its two siblings in this file about
   * checking applicability before opening anything.
   *
   * Without this, staging a non-PDF (or a mix that satisfies none of the
   * five actions — see each action's own `appliesTo`) and running `/pdf`
   * mounted the hub anyway: every row came back `disabled`, `Select`'s
   * `firstEnabled` fell back to index 0 regardless, and `selected` was
   * false for every row — no visible cursor, arrows doing nothing, Enter
   * submitting nothing. Not the same unrecoverable lock the empty-list case
   * was (`items.length` is 5, so Escape still works), but a confusing,
   * silent screen all the same.
   */
  const pdfActionsApply = useCallback(
    (sources: SourceInfo[]): boolean => HUB_ACTIONS.some((a) => a.appliesTo(sources)),
    [],
  )

  // Gated on `step === 'result'`: Ink delivers input to every mounted
  // `useInput` hook regardless of what else is on screen, so an ungated
  // handler here would steal `f`/`o`/`q` from the target/quality/destination
  // stages the moment they happen to share a letter.
  // esc on the name step returns to the location step. Prompt deliberately
  // ignores escape (a path can contain one), so the step owns this.
  useKeys(
    (_input, key) => {
      if (key.escape) cancelRename()
    },
    { isActive: step === 'rename' },
  )

  // esc on the size field goes back to the mode choice. Prompt ignores
  // escape by design — a path can contain one — so the step owns this.
  useKeys(
    (_input, key) => {
      if (!key.escape) return
      setSizeError(undefined)
      setText('')
      setStep('mode')
    },
    { isActive: step === 'size' },
  )

  // esc at the prompt clears a leftover stage — reachable when a run
  // reported a failure and returned here without clearing what was staged
  // (a partial batch is still there to retry, or to abandon). Empty stages
  // are the common case and cost nothing extra to check.
  //
  // Gated on the command buffer being closed, for the same reason the
  // `step === 'result'` hook above is gated on `step`: Ink delivers input
  // to every mounted `useInput` regardless of what else is on screen.
  // `CommandPalette`'s `Select` (`isActive` default `true`) already owns
  // escape while `/convert` or similar is being typed — its `onCancel`
  // clears the text buffer — so an ungated hook here would fire on the very
  // same keystroke and silently discard the stage as a side effect of
  // someone backing out of a half-typed command, not asking to clear
  // anything.
  useKeys(
    (_input, key) => {
      if (!key.escape) return
      if (stage.sources.length === 0 && stage.failures.length === 0) return
      setStage(clearStage())
    },
    { isActive: step === 'idle' && !paletteOwnsEscape },
  )

  useKeys(
    (input, key) => {
      if (!lastResult) return
      if (key.return) {
        // A dashed rule and a blank line either side, so a long session reads
        // as a sequence of separate operations rather than one wall of text.
        push({ kind: 'separator', id: nextId(), width })
        setStage(clearStage())
        setValues({})
        setLastResult(null)
        setStep('idle')
        return
      }
      /**
       * `.catch`, not `void`: `reveal.ts` promisifies `execFile`, so `open`
       * exiting non-zero — which is exactly what it does when the file has
       * since been moved, renamed, or its volume unmounted — rejects. A
       * `void`ed rejection is an unhandled rejection, and Node terminates
       * the process and prints the stack. Result blocks live in `<Static>`
       * scrollback for the rest of the session, so `f` and `o` stay
       * pressable long after the file they point at has gone.
       */
      if (input === 'o') openPath(lastResult.job.outputs[0]).catch(showError)
      if (input === 's') revealPath(lastResult.job.outputs[0]).catch(showError)
      if (input === 'q') exit()
      // Acts on the measured suggestion: re-enters convert with that target
      // already chosen, so the offer is one keystroke from being taken.
      if (input === 'c' && suggestion && lastResult) {
        setSuggestion(undefined)
        setMode('convert')
        setValues({ target: suggestion.target })
        setStage(addToStage(emptyStage(), [lastResult.job.sources[0]], []))
        setStep('destination')
      }
    },
    { isActive: step === 'result' },
  )

  // The picker never hardcodes a format list: it renders whatever
  // convertAction.options() returns for the probed source and the answers
  // collected so far (e.g. the quality step only appears once a lossy
  // target is chosen).
  const specs: OptionSpec[] = useMemo(
    () => (source ? action.options([source], values, livePrefs) : []),
    [source, values, livePrefs, action],
  )

  const specFor = useCallback((id: string) => specs.find((s) => s.id === id), [specs])

  /**
   * `probe()` is genuinely I/O-bound (`stat`, `access`, then sharp reading
   * the file's header), and nothing moves `step` off `'idle'` until it
   * resolves — the Prompt stays mounted and interactive for the whole
   * `await` by design (disabling it mid-probe, e.g. via `isActive`, is a UX
   * decision this file doesn't get to make on its own). So a user can submit
   * a second, different path before the first probe settles, and the two
   * probes genuinely race.
   *
   * `requestId` is a ref, not state, for the same reason `Select.tsx` and
   * `Prompt.tsx` use one: `useInput` handlers are synchronous but `setState`
   * is not, so a second submission arriving before React re-renders must
   * still see the true current id, not a stale closed-over value. Each call
   * claims the next id the instant it starts, so the *latest* submission
   * always wins ownership — and a probe's result, success or failure, is
   * only applied if its id is still the current one by the time it settles.
   * A superseded (stale) result — an earlier submission that is still
   * finishing after a newer one has already started — is dropped on the
   * floor rather than clobbering whatever the newer submission produced.
   */
  const requestId = useRef(0)

  /**
   * Runs a command chosen from the palette or typed in full.
   *
   * `needsSource` decides what a command does with a file already on the
   * bench: `/compress` switches it into the compress flow, `/theme` ignores
   * it entirely.
   */
  const runCommand = useCallback(
    (command: Command) => {
      setText('')

      if (command.name === 'theme') {
        setStep('theme')
        return
      }

      if (command.name === 'help') {
        push({
          kind: 'note',
          id: nextId(),
          text: COMMANDS.map((c) => `  /${c.name.padEnd(10)} ${c.description}`).join('\n'),
        })
        return
      }

      if (command.name === 'convert') {
        if (stagedBatch) {
          refuseBatch()
          return
        }
        setMode('convert')
        setValues({})
        // A source with nowhere to convert to would stay at idle rather
        // than opening a target picker with nothing in it — see
        // `hasConvertTarget`. No source reaches that today; a staged PDF
        // now opens the real picker like anything else, with a way back to
        // `/pdf` from there — see the `target` step's own signpost.
        setStep(source && hasConvertTarget(source) ? 'target' : 'idle')
        return
      }

      if (command.name === 'compress') {
        if (stagedBatch) {
          refuseBatch()
          return
        }
        if (source && !compressAction.appliesTo([source])) {
          push({ kind: 'error', id: nextId(), error: unsupportedCompress(source) })
          return
        }
        fenceOff()
        setMode('compress')
        setValues({})
        setStep(source ? 'mode' : 'idle')
        return
      }

      /**
       * Deliberately does not consult `stagedBatch`/`refuseBatch` — those
       * exist to stop convert/compress from silently acting on only the
       * first of several staged files (see the note above `convert()`),
       * and `/pdf`'s whole point is the opposite: merge is defined by
       * having several files staged, and the hub itself dims whatever the
       * current stage can't do, with a reason, rather than the shell
       * refusing to even open it.
       *
       * But "dims what doesn't apply" only works once the hub is open — it
       * is not a substitute for checking whether *anything* applies before
       * opening it at all. `/convert` has `hasConvertTarget` and
       * `/compress` has `compressAction.appliesTo` for exactly this, a few
       * lines above; `pdfActionsApply` is `/pdf`'s version of the same
       * check, so all three commands in this file agree on the rule.
       */
      if (command.name === 'pdf') {
        if (source && !pdfActionsApply(stage.sources)) {
          push({
            kind: 'note',
            id: nextId(),
            text: `${SYMBOLS.warn} /pdf needs the staged files to be PDFs.`,
          })
          return
        }
        if (source) fenceOff()
        setStep(source ? 'pdf' : 'idle')
      }
    },
    [
      push,
      fenceOff,
      source,
      stage.sources,
      stagedBatch,
      refuseBatch,
      hasConvertTarget,
      pdfActionsApply,
    ],
  )

  const submitPath = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      /**
       * A command, not a path. Checked before probing, because otherwise
       * `/compress` is looked up as a file and reported missing — which is
       * exactly what happened before this branch existed.
       */
      if (isCommandBuffer(trimmed)) {
        const command = parseCommand(trimmed)
        setText('')
        if (command) {
          runCommand(command)
        } else {
          push({
            kind: 'note',
            id: nextId(),
            text: `no command matches ${trimmed} — try /help`,
          })
        }
        return
      }
      const id = ++requestId.current
      setText('')
      try {
        const info = await probe(trimmed)
        if (requestId.current !== id) return // superseded by a later submission
        // Drops accumulate rather than replace — dropping a second file onto
        // a prompt that already has one staged (e.g. after a failed run
        // returned here without clearing it) builds a batch instead of
        // losing the first file. `addToStage` also drops an exact repeat of
        // a path already staged. Computed once, synchronously, rather than
        // via the `setStage(s => ...)` updater form this used before: the
        // guard just below needs to know the resulting length *now*, to
        // decide whether to advance into the wizard at all.
        const next = addToStage(stage, [info], [])
        setStage(next)
        setValues({})
        if (next.sources.length > 1) {
          // `refuseBatch` was written when nothing consumed several files at
          // once, so a multi-file stage could only mean an unsupported batch
          // convert. Merge ordering made staging several files the *point*,
          // and left the message contradicting the `/pdf` signpost two lines
          // below it — "drop a single file, or esc to clear the list" about a
          // list the user was deliberately building. `pdfActionsApply` is
          // already this file's single answer to "do the page operations
          // apply here", so it decides. What replaces the refusal is not
          // another line of prose: the staged card (rendered at idle from
          // two files up — see the gate in the JSX below) says what is
          // staged, and the existing signpost says where to take it.
          if (!pdfActionsApply(next.sources)) {
            refuseBatch()
            return
          }
          setStep('idle')
          return
        }
        // Deliberately *not* pushed to history here. A block committed to
        // <Static> can never be taken back, and until a conversion actually
        // happens the dropped file is a choice the user is still making —
        // esc has to be able to undo it. The result block records the file
        // once there is something worth recording.
        //
        // Which step comes next depends on the mode: `/compress` before
        // dropping a file means the file lands in the compress flow, and
        // compressing something lossless is refused here rather than after
        // the user has answered three more questions about it.
        if (mode === 'compress') {
          if (!compressAction.appliesTo([info])) {
            push({ kind: 'error', id: nextId(), error: unsupportedCompress(info) })
            setMode('convert')
            // `compressAction.appliesTo` only accepts a lossy image, so
            // nothing reaches this branch without a real convert target
            // either — but check anyway, via `hasConvertTarget`, rather
            // than assume: falling back to the target step for a source
            // that turned out to have nothing to convert to would trade
            // one dead end for another.
            setStep(hasConvertTarget(info) ? 'target' : 'idle')
            return
          }
          setStep('mode')
          return
        }
        // A source with a real convert target — every image, and now a PDF
        // too — goes straight to the target picker. One without a target
        // would stay at idle, staged and ready for `/pdf` or another
        // command, rather than opening a picker with nothing in it — see
        // `hasConvertTarget`.
        setStep(hasConvertTarget(info) ? 'target' : 'idle')
      } catch (e) {
        if (requestId.current !== id) return // superseded by a later submission
        // A rethrow here would become an unhandled rejection: submitPath is
        // fired from Prompt's synchronous useInput handler, and nothing
        // awaits or catches the promise it returns. Whatever this is —
        // a ForgeError, or anything else probe() didn't anticipate — the
        // shell must render it, not silently do nothing forever.
        showError(e)
        setStep('idle')
      }
    },
    // `mode` matters: without it this closure keeps the value it had when the
    // callback was created, and a file dropped after /compress would be
    // routed to the convert flow anyway. `stage` matters for the same
    // reason: reading it straight (rather than through the `setStage`
    // updater form) is what lets the batch guard above decide off the
    // current list, not a stale one.
    [showError, push, runCommand, mode, stage, refuseBatch, hasConvertTarget, pdfActionsApply],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  /**
   * Takes the whole staged batch back off the bench and returns to the
   * prompt. Right for a source whose only path forward *was* the target
   * picker — an image has nothing else to do with a staged file, so
   * backing out means abandoning it. See `backToPromptKeepingStage` for the
   * other case.
   */
  const clearSource = () => {
    setStage(clearStage())
    setValues({})
    setStep('idle')
  }

  /**
   * Backs out of the target picker without discarding what is staged.
   *
   * A staged PDF has somewhere else to go besides conversion: `/pdf`'s five
   * page operations, and — by dropping a second PDF once back at the
   * prompt — a merge stage. `clearSource` would cost the user both just for
   * escaping the question "convert it to what", so a document keeps its
   * place on the bench; only the in-progress target choice is dropped.
   * Wired up only where the staged source is a document (see the `target`
   * step below) — an image still uses `clearSource`, unchanged.
   */
  const backToPromptKeepingStage = () => {
    setValues({})
    setStep('idle')
  }

  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = action.options([currentSource], { target }, livePrefs)
    // A document target always means rasterisation (`targetSelect` filters
    // 'pdf' — its only other target — out as a no-op), which needs to know
    // which pages and at what resolution before quality or destination.
    if (next.some((s) => s.id === 'pages')) {
      setStep('pages')
      return
    }
    setStep(next.some((s) => s.id === 'quality') ? 'quality' : 'destination')
  }

  /**
   * `'all'`/`'first'` advance straight to resolution; `'choose'` hands off to
   * `PageGrid` (`page-picker`) rather than storing itself as the answer —
   * `convertAction.plan()` only knows how to turn `'all'`, `'first'`, a typed
   * range, or an explicit array into pages, not the literal string `'choose'`.
   */
  const choosePages = (value: string) => {
    setValues((v) => ({ ...v, pages: value }))
    setStep(value === 'choose' ? 'page-picker' : 'dpi')
  }

  /** `PageGrid`'s own selection, already 0-based — `convertAction.plan()` still runs it through `normalisePages`. */
  const submitPagePicker = (pages: number[]) => {
    setValues((v) => ({ ...v, pages }))
    setStep('dpi')
  }

  const chooseDpi = (currentSource: SourceInfo, dpi: string) => {
    setValues((v) => ({ ...v, dpi }))
    const next = action.options(
      [currentSource],
      { ...values, target: values.target, dpi },
      livePrefs,
    )
    setStep(next.some((s) => s.id === 'quality') ? 'quality' : 'destination')
  }

  /**
   * `.catch`, not `void`: this runs from Select's synchronous useInput
   * handler and nothing awaits the promise, so a rejected write would be an
   * unhandled rejection and Node would take the process down. A theme that
   * fails to persist is worth telling the user about; it must never cost
   * them the session.
   */
  const chooseTheme = (next: 'dark' | 'light') => {
    setTheme(next)
    setStep('idle')
    // The picker owned the screen until now.
    push({ kind: 'banner', id: nextId(), width, defaultOutput: livePrefs.defaultOutput })
    savePreferences({ theme: next }).catch(showError)
  }

  /**
   * Writes the folder to config and says so, without advancing the flow —
   * the user is still choosing where *this* conversion goes. `.catch` for
   * the same reason as chooseTheme: nothing awaits this promise.
   */
  const makeDefault = (path: string) => {
    setLivePrefs((p) => ({ ...p, defaultOutput: path }))
    push({ kind: 'note', id: nextId(), text: `${SYMBOLS.ok} default output is now ${path}` })
    savePreferences({ defaultOutput: path }).catch(showError)
  }

  /**
   * Opens the rename field for the highlighted destination. The extension is
   * not editable and not shown here — it is decided by the target format, and
   * letting someone type `.png` onto a WebP would produce a file that lies
   * about itself.
   */
  /**
   * Opens the name field, pre-filled from the name the action would have
   * chosen.
   *
   * The proposal comes from `plan()` rather than being rebuilt here: the
   * action knows the extension (compress keeps the source's, convert uses the
   * target's) and any suffix it needs to avoid landing on the input. Deriving
   * it a second time in the shell is how the field ended up offering a name
   * with no extension at all for compression.
   */
  const startRename = (destination: string) => {
    if (!source) return
    const planned = action.plan([source], { ...values, destination })[0]
    const proposed = (planned?.outputs[0] ?? source.path).split('/').pop() ?? 'file'
    const dot = proposed.lastIndexOf('.')
    const stem = dot > 0 ? proposed.slice(0, dot) : proposed
    const ext = dot > 0 ? proposed.slice(dot) : ''
    setRenaming({ destination, stem, ext })
    setText(stem)
    setStep('rename')
  }

  const cancelRename = () => {
    setRenaming(null)
    setText('')
    setStep('destination')
  }

  /**
   * A document rasterisation plans one output per page — there is no single
   * stem for a rename field to edit, and `resolveOutputPath`'s single-output
   * shape is exactly what `rasterOutputPaths` (inside `convertAction.plan()`)
   * exists to bypass. So this skips `startRename`/`buildPlan` entirely and
   * routes through the same `checkWriteSafety` + `runJobs` pipeline `/pdf`'s
   * five page operations already use — `handlePdfDone` is generic over any
   * `Job[]`, not `/pdf`-specific, and a multi-output convert job fits it
   * exactly (self-collision, existing-file and input-collision checks all
   * apply the same way here as they do to a separated extract).
   */
  const confirmDocumentConversion = (destination: string) => {
    if (!source) return
    void handlePdfDone(action.plan([source], { ...values, destination }), {
      cancelTo: 'destination',
    })
  }

  /**
   * Routes on how the outputs get their names, not on source kind.
   *
   * A rasterisation names one output per page (`doc-1.jpg`) — at one page as
   * much as at twenty — so there is no single stem for a rename field to
   * edit, and it takes the multi-output path. A compression keeps the
   * source's own format and plans one ordinarily-named output, so it takes
   * the ordinary path, where `finishConversion` runs the target-size search.
   *
   * Read from the engine's declared `writes` rather than a hardcoded list of
   * raster formats (invariant 2), the same way the CLI's `rasterises` does.
   *
   * Branching on `kind` alone sent every document down the rasterisation
   * route, a compression included — which is how the shell came to offer "to
   * a target size" for a scan, collect the number, and ignore it.
   */
  const confirmDestination = (destination: string) => {
    if (!source) return

    if (source.kind === 'document') {
      const [planned] = action.plan([source], { ...values, destination })
      if (planned?.op === 'convert' && pdfiumEngine.writes.has(planned.target)) {
        confirmDocumentConversion(destination)
        return
      }
    }
    startRename(destination)
  }

  /** Back from `destination`: to whichever step actually precedes it for this source. */
  const destinationBack = () => {
    if (specFor('quality')) {
      setStep('quality')
      return
    }
    setStep(specFor('dpi') ? 'dpi' : 'target')
  }

  const submitRename = (raw: string) => {
    if (!renaming) return
    const stem = raw.trim().replace(/\//g, '-') || renaming.stem
    setText('')
    setRenaming(null)
    void convert(renaming.destination, {
      output: `${renaming.destination}/${stem}${renaming.ext}`,
    })
  }

  /**
   * Validates in the field rather than at conversion time — the difference
   * between catching a typo and failing a run that already chose a folder.
   */
  const submitSize = (raw: string) => {
    const bytes = parseSize(raw)
    if (bytes === undefined) {
      setSizeError(`${raw.trim() || 'that'} is not a size. Try 500kb or 2mb.`)
      return
    }
    setSizeError(undefined)
    setValues((v) => ({ ...v, size: raw, targetBytes: bytes }))
    setText('')
    setStep('destination')
  }

  const chooseQuality = (quality: number) => {
    setValues((v) => ({ ...v, quality }))
    setStep('destination')
  }

  // The destination preview shows the resolved output path as the user
  // highlights each preset. Truncated with `middleEllipsis`, budgeted off the
  // live terminal width, so a deep preset path can't push the line past the
  // edge of a narrow terminal.
  const previewDestination = (candidate: string): string => {
    const stem = source ? (source.path.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '') : ''
    const full =
      source && typeof values.target === 'string'
        ? `${candidate}/${stem}${primaryExtension(values.target as FormatId)}`
        : candidate
    return middleEllipsis(full, Math.max(12, width - 4))
  }

  /**
   * Two Enters delivered in the same tick — a held key repeating, or a paste
   * carrying two line endings — both reach `convert` from the destination
   * step's synchronous `useInput` handler. Moving `step` to `'converting'`
   * does not stop the second: React unmounts that handler on the next
   * render, and both calls have already run by then. Measured before this
   * ref existed: two `runJobs` calls, two encodes, two renames onto the same
   * path, two result blocks. So this is claimed synchronously, before the
   * first `await`, for the same reason `requestId` above is.
   */
  const converting = useRef(false)

  /**
   * Spec §8's write-safety rules live in `core/write-safety.ts` and reach this
   * path through `runPlan`: never write over the input, never replace an
   * existing output without consent. The shell needs them for exactly the
   * reason the CLI does — `targetIdsFor` legitimately offers jpeg for a JPEG,
   * and "Same folder" is legitimately the first destination preset, so the
   * all-defaults keypath resolves the output straight onto the user's
   * original unless something refuses.
   *
   * `action.plan()` derives the job; `runPlan` decides whether it may happen,
   * resolves any target size, and runs it. `buildPlan` used to sit in between
   * re-deriving a job that already existed, which is why the output path had
   * two authorities and the rename field once offered a name with no
   * extension.
   *
   * Still one source, not `stage.sources`: `output` here is one exact
   * filename, since the rename step builds `${destination}/${stem}${ext}` for
   * a single representative source. Handing the whole stage the same output
   * would make every source past the first collide on that path — correctly
   * refused, but the branch below treats any refusal as the whole run being
   * refused, so a two-file stage would convert nothing instead of batching.
   * Making that work needs the wizard to know it is planning for a batch
   * (skip or reinterpret the rename step, run what did resolve, show more
   * than one result) — UX decisions this change does not make.
   */
  /**
   * The part of a conversion that runs once quality is settled — a plan
   * already carrying the quality it will encode at, never one still waiting
   * on a target-size search. Split out of `convert()` so the "use the lowest
   * quality anyway" answer to `sizeUnreachable` can finish the same
   * conversion the search already ran most of, instead of re-planning or
   * re-searching from scratch.
   */
  const finishConversion = async (
    planned: Extract<Job, { op: 'convert' }>,
    destination: string,
    output: string,
    opts: ConversionOpts,
  ) => {
    if (!source) return

    // The rename step can redirect where this lands, so the job carries the
    // final path rather than a second module re-deriving it.
    planned.outputs[0] = output

    /**
     * One call for write safety, the target-size search and the run.
     *
     * This used to be `buildPlan` (which re-planned a job `action.plan()` had
     * already produced) followed by `runJobs`, with the search living in
     * `convert()` — where a document source never reached it. Routing both
     * kinds through here is what makes a PDF target size take effect.
     */
    const outcome = await runPlan([planned], {
      force: opts.force ?? false,
      ...(opts.targetBytes === undefined ? {} : { targetBytes: opts.targetBytes }),
      onEvent: (event) => {
        if (event.type === 'search:attempt') {
          setAttempt({ n: event.attempt, of: event.of, dpi: event.rung.dpi })
        }
      },
    })
    setAttempt(undefined)

    /**
     * Nothing gets small enough — but the search measured the smallest it
     * *can* get, so this asks rather than refuses: take that size, or go pick
     * a format with more room to shrink.
     */
    const missed = outcome.unreachable[0]
    if (missed && opts.targetBytes !== undefined) {
      setSizeUnreachable({
        planned,
        destination,
        output,
        opts,
        targetBytes: opts.targetBytes,
        smallest: missed.smallest,
        quality: missed.settings.quality,
        ...(missed.settings.dpi === undefined ? {} : { dpi: missed.settings.dpi }),
      })
      setStep('size-unreachable')
      return
    }

    const refusal = outcome.refusals[0]
    if (refusal) {
      // An output that already exists is a question, not a refusal: spec §8
      // says the shell asks — keep both, replace, or cancel.
      if (refusal.error.code === 'output-exists') {
        setPending({ destination, output, keepBoth: uniqueOutputPath(output) })
        setStep('overwrite')
        return
      }
      push({ kind: 'error', id: nextId(), error: refusal.error })
      // Writing over the source has no "replace" worth offering — there is
      // no outcome there that keeps the original. Back to the destination
      // step, where choosing a different folder is the actual fix.
      setStep(refusal.error.code === 'output-is-input' ? 'destination' : 'idle')
      return
    }

    const summary = outcome
    const result = summary.results[0]
    if (result) {
      setLastResult(result)
      push({ kind: 'result', id: nextId(), result })
      setStep('result')

      /**
       * Only after a compression, and only once the file is safely written:
       * this is an extra encode purely to find out whether a sentence is
       * worth saying, and it must not be able to cost the user the
       * conversion they actually asked for.
       */
      if (mode === 'compress') {
        const found = await suggestFormat({
          source,
          resultBytes: result.outputBytes,
          quality: planned.options.quality ?? livePrefs.quality,
          encode: async (target, quality) =>
            (await encodeToBuffer(source, target, { ...planned.options, quality })).length,
        })
        setSuggestion(found)
        setMergeOffer(undefined)
      } else {
        setSuggestion(undefined)
        // Compress never reaches here with `target === 'pdf'` — it keeps
        // the source's own format (see `compressAction.appliesTo`) — so
        // this only ever counts conversions the user actually chose 'PDF'
        // for.
        if (planned.target === 'pdf') {
          pdfOutputsThisSession.current += 1
          setMergeOffer(
            pdfOutputsThisSession.current > 1 ? pdfOutputsThisSession.current : undefined,
          )
        } else {
          setMergeOffer(undefined)
        }
      }
    } else {
      const failure = summary.failures[0]
      if (failure) push({ kind: 'error', id: nextId(), error: failure.error })
      setStep('idle')
    }
  }

  const convert = async (destination: string, opts: { force?: boolean; output?: string } = {}) => {
    if (!source) return
    if (converting.current) return
    converting.current = true
    setStep('converting')
    try {
      const planned = action.plan([source], { ...values, destination })[0]
      // `action` here is always convertAction or compressAction — both plan
      // only ever produce a `convert` job — but `plan()`'s return type is now
      // the full `Job` union (widened for the page actions), so the `target`/
      // `options` reads below need this narrowed explicitly rather than
      // assumed.
      if (planned?.op !== 'convert') {
        setStep('idle')
        return
      }
      const output = opts.output ?? planned.outputs[0]

      /**
       * A target size means the quality is the search's answer, not the
       * user's — but the search itself belongs to `runPlan`, which picks the
       * right ladder from the engine. The shell used to run a one-dimensional
       * image search here, which a document source never reached at all.
       */
      await finishConversion(planned, destination, output, {
        ...opts,
        ...(typeof values.targetBytes === 'number' ? { targetBytes: values.targetBytes } : {}),
      })
    } catch (e) {
      // convertAction.plan() throws synchronously on a bad target, and
      // nothing guarantees runPlan() can never reject for some
      // cause they don't themselves catch. Either way, this runs inside an
      // async handler nothing awaits — PathInput fires onSubmit from a
      // synchronous useInput handler — so a rethrow here would become an
      // unhandled rejection instead of something the user ever sees. Render
      // it instead, exactly like submitPath does for probe().
      showError(e)
      setStep('idle')
    } finally {
      converting.current = false
    }
  }

  /** Answers `sizeUnreachable`: take the smallest size the search found, or back off to pick a format instead. */
  const answerSizeUnreachable = (choice: string) => {
    if (!sizeUnreachable) return
    const { planned, destination, output, opts, quality, dpi } = sizeUnreachable
    setSizeUnreachable(null)
    if (choice === 'lowest') {
      if (converting.current) return
      converting.current = true
      planned.options.quality = quality
      // A document's smallest came off a resolution rung as well as a quality,
      // so taking that size means taking both.
      if (dpi !== undefined) planned.options.dpi = dpi
      setStep('converting')
      // Deliberately without `targetBytes`: the search already ran and this is
      // the answer to it. Passing it again would search a second time and miss
      // a second time.
      const { targetBytes: _alreadySearched, ...settled } = opts
      void finishConversion(planned, destination, output, settled)
        .catch((e) => {
          showError(e)
          setStep('idle')
        })
        .finally(() => {
          converting.current = false
        })
      return
    }
    setMode('convert')
    setValues({})
    setStep(source && hasConvertTarget(source) ? 'target' : 'idle')
  }

  const answerOverwrite = (choice: string) => {
    if (!pending) return
    const { destination, keepBoth } = pending
    setPending(null)
    if (choice === 'replace') void convert(destination, { force: true })
    else if (choice === 'keep') void convert(destination, { output: keepBoth })
    else if (choice === 'rename') startRename(destination)
    else setStep('destination')
  }

  /**
   * `PdfFlow` only ever decides *what* to run — `onDone` is where that
   * handoff happens, through the same `runJobs` the convert/compress wizard
   * uses. Page-op outputs are named by the action's own `plan()` (suffixed,
   * numbered, or merged beside the source) rather than a destination the
   * user picks, so there is no `buildPlan`/overwrite step here the way
   * `convert()` has one — see the note on `convert()` for why that function
   * still only ever plans for `[source]`, not `stage.sources`; `/pdf` is the
   * one place in this file that deliberately does act on the whole staged
   * list, because merge is defined by having several files staged.
   */
  /**
   * Actually runs jobs already cleared by `checkWriteSafety`.
   *
   * A rasterisation job's `total` is `job.options.pages.length` — the
   * *selected* page count, not the document's — because that is exactly
   * what `engines/pdfium.ts` reports (see its own doc comment); this only
   * relays it, never recomputes one of its own. `detail` is the basename of
   * whichever output the just-finished page wrote, read back off the job's
   * own `outputs[done - 1]` rather than threaded through separately, so it
   * can never name a different file than the one `Progress` is counting.
   */
  const runPdfJobs = async (jobs: Job[], opts: { force?: boolean } = {}) => {
    setStep('pdf-running')
    setPageProgress(null)
    try {
      /**
       * `force` is threaded rather than defaulted because these jobs have
       * already cleared `handlePdfDone`'s check — including, after "Replace",
       * a deliberate overwrite. Running them through `runPlan` at `force:
       * false` would refuse exactly the outputs the user just chose to
       * replace.
       *
       * No `targetBytes`: a page operation has no quality dial, so there is
       * nothing here for a search to settle.
       */
      const summary = await runPlan(jobs, {
        force: opts.force ?? false,
        onEvent: (event) => {
          if (event.type !== 'job:phase' || event.progress.phase !== 'page') return
          const { done, total } = event.progress
          const output = event.job.op === 'convert' ? event.job.outputs[done - 1] : undefined
          setPageProgress({
            done,
            total,
            detail: output ? basename(output) : undefined,
            op: event.job.op,
          })
        },
      })
      for (const result of summary.results) {
        push({ kind: 'note', id: nextId(), text: `${SYMBOLS.ok} ${describePdfResult(result)}` })
        // Warnings used to stop here: only the note was pushed, and
        // `result.warnings` was never read. No page operation emits one today,
        // so this is a guard against the next one that does rather than a live
        // fix — but it costs a loop and the alternative was a silent drop.
        for (const warning of result.warnings) {
          push({ kind: 'note', id: nextId(), text: `${SYMBOLS.warn} ${warning.message}` })
        }
      }
      for (const failure of [...summary.refusals, ...summary.failures]) {
        push({ kind: 'error', id: nextId(), error: failure.error })
      }
    } catch (e) {
      // Mirrors `convert()`'s own catch: this runs from a handler PdfFlow's
      // synchronous `useInput` fired, and nothing else awaits this promise.
      showError(e)
    } finally {
      setPageProgress(null)
      setStage(clearStage())
      setValues({})
      setStep('idle')
    }
  }

  /**
   * `PdfFlow`'s `plan()` output bypasses `buildPlan` (see the note above) and
   * so bypasses its write-safety checks too — merge, split, extract, delete
   * and rotate can each collide with an existing file, and merge and rotate
   * can even target a path that is one of their own inputs (rotate twice,
   * or merge a folder a second time after its own merged output already
   * landed there). `checkWriteSafety` is the same check the CLI's page-op
   * path applies before its own `runJobs` call — this is the shell applying
   * it too, in the one spot both paths share: right before the actual run.
   *
   * The shell has no `--force` flag, so a refusal has to be answered
   * in-flow rather than by re-typing the command with a flag. Only
   * `output-exists` gets an in-flow bypass ("Replace"): it is the ordinary,
   * expected case (rerunning an operation regenerates a file that is
   * already there) and `checkWriteSafety` supports overriding it safely.
   * `output-is-input` is deliberately given no bypass here even though
   * `checkWriteSafety` could technically allow one with `force: true` — an
   * operation reading and overwriting its own input in place, with no
   * `--output` to redirect to, is confusing enough that "go back and choose
   * something else" is the honest answer, not a one-keystroke override.
   * `output-collision` has no bypass at all, in the shell or the CLI: it is
   * the job's own plan asking to write two things to one path, which is not
   * a preference `force` can express (see `checkWriteSafety`'s doc).
   */
  const handlePdfDone = async (jobs: Job[], opts: { cancelTo?: 'pdf' | 'destination' } = {}) => {
    const safe = checkWriteSafety(jobs, { force: false })
    if (safe.failures.length > 0) {
      setPdfBlocked({ jobs, failures: safe.failures, cancelTo: opts.cancelTo ?? 'pdf' })
      setStep('pdf-blocked')
      return
    }
    await runPdfJobs(safe.jobs)
  }

  /** `replace` retries `pdfBlocked.jobs` with `force: true`; anything else cancels. */
  const answerPdfBlocked = (choice: string) => {
    if (!pdfBlocked) return
    if (choice !== 'replace') {
      const cancelTo = pdfBlocked.cancelTo
      setPdfBlocked(null)
      setStep(cancelTo)
      return
    }
    const forced = checkWriteSafety(pdfBlocked.jobs, { force: true })
    setPdfBlocked(null)
    if (forced.failures.length > 0) {
      // A collision: `force` never bypasses it (see `checkWriteSafety`), so
      // this is the rare remainder "Replace" cannot fix.
      for (const failure of forced.failures) {
        push({ kind: 'error', id: nextId(), error: failure.error })
      }
      setStep('pdf')
      return
    }
    void runPdfJobs(forced.jobs, { force: true })
  }

  // `Select` owns arrow/enter for the output-exists choice; a plain refusal
  // (no bypass offered) has nothing mounted to answer escape or enter, so
  // this step owns both directly — same reasoning as the 'rename' and
  // 'size' steps above, which own escape for the same reason.
  useKeys(
    (_input, key) => {
      if (key.escape || key.return) answerPdfBlocked('cancel')
    },
    { isActive: step === 'pdf-blocked' && pdfBlocked?.failures[0]?.error.code !== 'output-exists' },
  )

  const modeSpec = specFor('mode')
  const sizeSpec = specFor('size')
  const targetSpec = specFor('target')
  const pagesSpec = specFor('pages')
  const dpiSpec = specFor('dpi')
  const qualitySpec = specFor('quality')
  const destinationSpec = specFor('destination')

  return (
    <ThemeProvider palette={paletteFor(theme)}>
      <Box flexDirection="column">
        {step === 'theme' ? <ThemePicker onChoose={chooseTheme} /> : null}

        {/* Which action the next file goes through, always — including the
            default. An earlier version showed this only for compress, on the
            reasoning that convert is what dropping a file already does; but
            a mode you cannot see is one you can be in by accident, and the
            cost of saying so is one line. Skipped for `/pdf`: that flow is
            neither convert nor compress, and `mode` does not change while
            it runs — showing it would be actively wrong, not just unhelpful. */}
        {step !== 'theme' && step !== 'pdf' && step !== 'pdf-running' ? (
          <Box
            marginBottom={1}
            paddingY={1}
            paddingX={1}
            backgroundColor={colourProp(
              mode === 'compress' ? palette.modeCompressBg : palette.modeConvertBg,
            )}
          >
            <Text
              color={colourProp(mode === 'compress' ? palette.modeCompress : palette.modeConvert)}
              bold
            >
              {band === 'compact' ? `${mode}` : `current mode: ${mode}`}
            </Text>
            {step === 'idle' && source && !stagedBatch ? (
              <Text color={colourProp(palette.fg)} bold>{`  ${basename(source.path)}`}</Text>
            ) : null}
            <Text color={colourProp(palette.dim)}>
              {band === 'compact' ? '  / to change' : '  use / to change mode'}
            </Text>
          </Box>
        ) : null}

        {/* The staged list, shown live rather than committed to scrollback,
            for as long as it is still something the user can take back.

            Idle is included once more than one file is staged: that is
            exactly where a merge list is assembled — each drop lands back at
            the prompt — so hiding the card there meant building a merge with
            no confirmation that anything had been staged at all. One file at
            idle stays hidden: a lone drop either advances into the wizard,
            which shows the card, or is a PDF waiting on `/pdf`, and a card
            for it would sit under the prompt through every command. */}
        {stage.sources.length > 0 &&
        step !== 'theme' &&
        step !== 'result' &&
        (step !== 'idle' || stage.sources.length > 1) ? (
          <Box marginBottom={1}>
            <StagedFiles stage={stage} width={width} />
          </Box>
        ) : null}
        <Static items={history}>
          {(block) => <HistoryEntry key={block.id} block={block} width={width} />}
        </Static>

        {step === 'mode' && source && modeSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>{modeSpec.label}</Text>
            <Select
              width={width}
              items={modeSpec.choices}
              onSubmit={(chosen) => {
                setValues((v) => ({ ...v, mode: chosen }))
                setStep(chosen === 'size' ? 'size' : 'quality')
              }}
              onCancel={clearSource}
              showHints={band !== 'compact'}
            />
            <HintBar
              width={width}
              pairs={[
                ['↑↓', 'choose'],
                ['↵', 'confirm'],
                ['esc', 'remove file'],
              ]}
            />
          </Box>
        ) : null}

        {step === 'size' && sizeSpec?.kind === 'text' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>{sizeSpec.label}</Text>
            <Prompt
              value={text}
              onChange={setText}
              onSubmit={submitSize}
              placeholder={sizeSpec.placeholder}
              isActive
              variant={band === 'compact' ? 'plain' : 'field'}
              width={width}
            />
            {sizeError ? (
              <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${sizeError}`}</Text>
            ) : null}
            <HintBar
              width={width}
              pairs={[
                ['↵', 'confirm'],
                ['ctrl-u', 'clear'],
                ['esc', 'back'],
              ]}
            />
          </Box>
        ) : null}

        {step === 'target' && source && targetSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>{targetSpec.label}</Text>
            <Select
              width={width}
              items={targetSpec.choices}
              onSubmit={(target) => chooseTarget(source, target)}
              onCancel={source.kind === 'document' ? backToPromptKeepingStage : clearSource}
              showHints={band !== 'compact'}
            />
            {/* A PDF reaching this screen still has page operations on the
                table too — see `backToPromptKeepingStage`. Without this, the
                one moment someone lands here straight off a drop, `/pdf`
                would be invisible: the idle-step signpost a few hundred
                lines down never gets a chance to render, because a PDF no
                longer stops at idle on the way in. */}
            {source.kind === 'document' ? (
              <Text
                color={colourProp(palette.dim)}
              >{`${SYMBOLS.arrow} /pdf for page operations`}</Text>
            ) : null}
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

        {step === 'pages' && source && pagesSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>{pagesSpec.label}</Text>
            <Select
              width={width}
              items={pagesSpec.choices}
              onSubmit={choosePages}
              onCancel={() => setStep('target')}
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

        {step === 'page-picker' && source && source.kind === 'document' ? (
          <Box flexDirection="column" marginBottom={1}>
            <PageGrid
              mode="cell"
              pageCount={source.pages}
              selected={Array.isArray(values.pages) ? (values.pages as number[]) : []}
              cuts={[]}
              onSubmit={submitPagePicker}
              onCancel={() => setStep('pages')}
              width={width}
              height={height}
            />
            <HintBar
              width={width}
              pairs={[
                ['space', 'toggle'],
                ['a', 'all'],
                ['↵', 'confirm'],
                ['esc', 'back'],
              ]}
            />
          </Box>
        ) : null}

        {step === 'dpi' && source && dpiSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>{dpiSpec.label}</Text>
            <Select
              width={width}
              items={dpiSpec.choices}
              onSubmit={(dpi) => chooseDpi(source, dpi)}
              onCancel={() => setStep(Array.isArray(values.pages) ? 'page-picker' : 'pages')}
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

        {step === 'quality' && qualitySpec?.kind === 'slider' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Slider
              label={qualitySpec.label}
              min={qualitySpec.min}
              max={qualitySpec.max}
              step={qualitySpec.step}
              value={typeof values.quality === 'number' ? values.quality : qualitySpec.default}
              onChange={(q) => setValues((v) => ({ ...v, quality: q }))}
              onSubmit={chooseQuality}
              onCancel={() => setStep(dpiSpec ? 'dpi' : 'target')}
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
        ) : null}

        {step === 'destination' && destinationSpec?.kind === 'path' ? (
          <Box flexDirection="column" marginBottom={1}>
            <PathInput
              label={destinationSpec.label}
              presets={destinationSpec.presets}
              preview={previewDestination}
              onSubmit={confirmDestination}
              onCancel={destinationBack}
              width={width}
              showHints={band !== 'compact'}
              defaultPath={expandTilde(livePrefs.defaultOutput)}
              onMakeDefault={makeDefault}
            />
            {/* Four pairs is 45 columns — wider than a compact terminal.
                Spec §13 drops hints there rather than overflowing, and the
                shorter pair still names the key that is unique to this step. */}
            <HintBar
              width={width}
              pairs={
                band === 'compact'
                  ? [['d', 'make default']]
                  : [
                      ['↑↓', 'choose'],
                      ['↵', 'next'],
                      ['d', 'make default'],
                    ]
              }
            />
          </Box>
        ) : null}

        {step === 'rename' && renaming ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>Name the file</Text>
            <Prompt
              value={text}
              onChange={setText}
              onSubmit={submitRename}
              placeholder="file name"
              isActive
              variant={band === 'compact' ? 'plain' : 'field'}
              width={width}
            />
            <Text color={colourProp(palette.dim)}>
              {`  ${SYMBOLS.arrow} ${middleEllipsis(
                `${renaming.destination}/${text || renaming.stem}${renaming.ext}`,
                Math.max(12, width - 4),
              )}`}
            </Text>
            <HintBar
              width={width}
              pairs={[
                ['↵', 'save'],
                ['ctrl-u', 'clear'],
                ['esc', 'back'],
              ]}
            />
          </Box>
        ) : null}

        {step === 'overwrite' && pending ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>{`${middleEllipsis(basename(pending.output), Math.max(12, width - 16))} already exists`}</Text>
            <Select
              width={width}
              items={[
                { value: 'keep', label: 'Keep both', hint: basename(pending.keepBoth) },
                { value: 'replace', label: 'Replace', hint: 'the existing file is lost' },
                { value: 'cancel', label: 'Cancel', hint: 'pick a different folder' },
              ]}
              onSubmit={answerOverwrite}
              onCancel={() => {
                setPending(null)
                setStep('destination')
              }}
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

        {step === 'size-unreachable' && sizeUnreachable ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              {`${source ? basename(source.path) : 'This file'} can't get below ${formatBytes(
                sizeUnreachable.smallest,
              )} — you asked for ${formatBytes(sizeUnreachable.targetBytes)}.`}
            </Text>
            <Select
              width={width}
              items={[
                {
                  value: 'lowest',
                  label: 'Use the lowest quality',
                  hint: `${formatBytes(sizeUnreachable.smallest)} — as small as it gets`,
                },
                {
                  value: 'format',
                  label: 'Pick a smaller format instead',
                  hint: '/convert',
                },
              ]}
              onSubmit={answerSizeUnreachable}
              onCancel={() => {
                setSizeUnreachable(null)
                setStep('idle')
              }}
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

        {step === 'converting' ? (
          <Box marginBottom={1}>
            <Text color={colourProp(palette.dim)}>
              {attempt
                ? `Finding the right quality — attempt ${attempt.n} of ${attempt.of}…`
                : 'Converting…'}
            </Text>
          </Box>
        ) : null}

        {step === 'result' && lastResult ? (
          <Box flexDirection="column" marginBottom={1}>
            {/* Measured, not estimated: this number came from actually
                encoding a candidate. Offered rather than applied — the file
                the user asked for is already written. */}
            {suggestion ? (
              <Box marginBottom={1}>
                <Text color={colourProp(palette.warn)}>
                  {`${SYMBOLS.warn} ${FORMATS[suggestion.target].label} would be ${formatBytes(
                    suggestion.bytes,
                  )} — ${Math.round(suggestion.saving * 100)}% smaller again.`}
                </Text>
              </Box>
            ) : null}
            {/* Reuses the block above rather than inventing a second visual
                pattern for a second kind of offer. Deliberately informational
                only, with no key of its own that stages and acts on it the
                way `c` does for `suggestion`: doing that honestly needs the
                written PDFs re-probed into real `SourceInfo`s first (`probe`
                is async, and nothing here currently tracks more than their
                paths), and `/pdf` — already one command away, and already
                signposted elsewhere in this file — is that path already
                built. A second, keystroke-driven way to reach the same
                screen is not worth the complexity for what this offer is:
                a nudge that several single-image PDFs now sitting on disk
                are exactly what `mergeAction` combines. */}
            {mergeOffer ? (
              <Box marginBottom={1}>
                <Text color={colourProp(palette.warn)}>
                  {`${SYMBOLS.warn} ${mergeOffer} PDFs from this session could become one — /pdf, then Merge.`}
                </Text>
              </Box>
            ) : null}
            {/* Only where the terminal makes OSC 8 clickable. Otherwise
                fileLink falls back to a bare file:// URL — a long, unreadable
                line that says nothing the hints below it do not already say,
                which is why it read as a duplicate. */}
            {hyperlinksSupported() ? (
              <Text>
                {fileLink('Open file', lastResult.job.outputs[0])}
                {'  ·  '}
                {fileLink(revealLabel(), lastResult.job.outputs[0].replace(/\/[^/]+$/, ''))}
              </Text>
            ) : null}
            <HintBar
              width={width}
              pairs={[
                ['↵', mode === 'compress' ? 'compress again' : 'convert another'],
                ...(suggestion
                  ? ([['c', `convert to ${FORMATS[suggestion.target].label}`]] as [
                      string,
                      string,
                    ][])
                  : []),
                ['o', 'open'],
                ['s', revealLabel().toLowerCase()],
                ['q', 'quit'],
              ]}
            />
          </Box>
        ) : null}

        {step === 'pdf' ? (
          <PdfFlow
            stage={stage}
            width={width}
            height={height}
            prefs={livePrefs}
            onDone={(jobs) => {
              void handlePdfDone(jobs)
            }}
            onCancel={clearSource}
          />
        ) : null}

        {step === 'pdf-running' ? (
          <Box marginBottom={1}>
            {/* Determinate only once a real `page` event has arrived — see
                `pageProgress`'s own doc comment. Split, extract (separate
                mode) and rasterising a document each report real per-page
                progress; merge, delete and rotate report phases only and
                never reach this branch, so they stay the plain "Running…"
                line below, exactly as invariant 7 requires. The label comes
                from `pageProgress.op` via `pageProgressLabel`, not a
                hardcoded word, so it can never claim an operation that
                isn't the one actually running (a split copying pages is not
                "RENDERING" anything). */}
            {pageProgress ? (
              <Progress
                label={pageProgressLabel(pageProgress.op)}
                done={pageProgress.done}
                total={pageProgress.total}
                detail={pageProgress.detail}
                width={width}
              />
            ) : (
              <Text color={colourProp(palette.dim)}>Running…</Text>
            )}
          </Box>
        ) : null}

        {step === 'pdf-blocked' && pdfBlocked?.failures[0] ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.fail)}>
              {SYMBOLS.fail} {pdfBlocked.failures[0].error.title}
            </Text>
            {/* `.detail`, never `.hint` — the hint text is CLI wording
                ("Pass --force to replace it"), and the shell has no
                --force flag. The choice below is the shell's own answer
                to the same situation. */}
            <Text color={colourProp(palette.fg)}>{`  ${pdfBlocked.failures[0].error.detail}`}</Text>
            {pdfBlocked.failures[0].error.code === 'output-exists' ? (
              <Select
                width={width}
                items={[
                  {
                    value: 'cancel',
                    label: 'Cancel',
                    // Says where it actually goes: a page operation run from
                    // `/pdf` has only the hub to return to, but an ordinary
                    // document conversion has its own destination step —
                    // see `PendingPdfRefusal.cancelTo`'s doc comment.
                    hint:
                      pdfBlocked.cancelTo === 'destination'
                        ? 'pick a different folder, nothing written'
                        : 'back to /pdf, nothing written',
                  },
                  { value: 'replace', label: 'Replace', hint: 'overwrite the existing file' },
                ]}
                onSubmit={answerPdfBlocked}
                onCancel={() => answerPdfBlocked('cancel')}
                showHints={band !== 'compact'}
              />
            ) : (
              <Text color={colourProp(palette.dim)}>{'  esc or enter to go back'}</Text>
            )}
            <HintBar
              width={width}
              pairs={
                pdfBlocked.failures[0].error.code === 'output-exists'
                  ? [
                      ['↑↓', 'choose'],
                      ['↵', 'confirm'],
                      ['esc', 'cancel'],
                    ]
                  : [['esc', 'back']]
              }
            />
          </Box>
        ) : null}

        {step === 'idle' ? (
          <Box flexDirection="column">
            {/* Ink delivers input to every mounted useInput, so Prompt and
                the palette's Select are both live while this is open — which
                is what makes typing narrow the list and the arrows move the
                selection at the same time. */}
            {isCommandBuffer(text) ? (
              <CommandPalette
                fragment={text.slice(1)}
                width={width}
                onRun={runCommand}
                onCancel={() => setText('')}
              />
            ) : null}
            {/* A PDF sitting here — via a refused mixed batch, a multi-PDF
                merge stage, or backing out of the target picker with
                `backToPromptKeepingStage` — has a command that is not
                otherwise visible. Commands are only worth having if they
                can be found (the same reasoning behind the palette itself);
                a document on the bench with no visible next step fails that
                test. Suppressed once a command is being typed — the palette
                is already doing this job then. The target picker has its
                own copy of this same line for the moment a solo drop goes
                straight there instead of stopping here. */}
            {!isCommandBuffer(text) && stage.sources.some((s) => s.kind === 'document') ? (
              <Box marginBottom={1}>
                <Text color={colourProp(palette.dim)}>
                  {`${SYMBOLS.arrow} /pdf for page operations`}
                </Text>
              </Box>
            ) : null}
            <Prompt
              value={text}
              onChange={setText}
              onSubmit={submitPath}
              placeholder="drop a file or type a path"
              isActive
              variant={band === 'compact' ? 'plain' : 'drop'}
              width={width}
            />
            <HintBar
              width={width}
              pairs={
                band === 'compact'
                  ? [
                      ['↵', 'send'],
                      ['/', 'commands'],
                    ]
                  : [
                      ['↵', 'send'],
                      ['/', 'commands'],
                      ['ctrl-u', 'clear'],
                      ['ctrl-c', 'quit'],
                    ]
              }
            />
          </Box>
        ) : null}
      </Box>
    </ThemeProvider>
  )
}
