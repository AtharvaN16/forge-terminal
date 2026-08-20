import { basename } from 'node:path'
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PREFERENCES,
  expandTilde,
  type Preferences,
  savePreferences,
} from '../config/preferences.js'
import type { OptionSpec } from '../core/actions/index.js'
import { compressAction, convertAction } from '../core/actions/index.js'
import { findQuality } from '../core/compress.js'
import {
  isForgeError,
  targetUnreachable,
  unexpectedError,
  unsupportedCompress,
} from '../core/errors.js'
import { FORMATS, primaryExtension } from '../core/formats.js'
import { uniqueOutputPath } from '../core/output-path.js'
import { buildPlan } from '../core/plan.js'
import type { InputFailure } from '../core/resolve.js'
import { runJobs } from '../core/run.js'
import { type Suggestion, suggestFormat } from '../core/suggest.js'
import type { FormatId, Job, Result, SourceInfo } from '../core/types.js'
import { formatBytes, parseSize } from '../core/units.js'
import { checkWriteSafety } from '../core/write-safety.js'
import { encodeToBuffer } from '../engines/image.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { COMMANDS, type Command, isCommandBuffer, matchCommands, parseCommand } from './commands.js'
import { CommandPalette } from './components/CommandPalette.js'
import { HintBar } from './components/HintBar.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { StagedFiles } from './components/StagedFiles.js'
import { ThemePicker } from './components/ThemePicker.js'
import { PdfFlow } from './flows/pdf.js'
import { fileLink, hyperlinksSupported } from './hyperlink.js'
import { openPath, revealLabel, revealPath } from './reveal.js'
import { addToStage, clearStage, emptyStage, type Stage } from './stage.js'
import { ThemeProvider, useTheme } from './ThemeContext.js'
import { colourProp, paletteFor, SYMBOLS } from './theme.js'
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
  | 'quality'
  | 'destination'
  | 'rename'
  | 'overwrite'
  | 'converting'
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
    default:
      return `done — ${first}`
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
  const palette = useTheme()
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
  const [attempt, setAttempt] = useState<{ n: number; of: number } | undefined>(undefined)
  /** Why a typed size was rejected, shown against the field rather than later. */
  const [sizeError, setSizeError] = useState<string | undefined>(undefined)
  /** A measured alternative worth offering after a compression. */
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>(undefined)
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
   * `convertAction.appliesTo` only checks `sources.length >= 1` — true for
   * every source there has ever been until the PDF engine arrived, since
   * every image format could always become some *other* image format. A
   * PDF's only writable format is PDF itself, which `targetSelect` (in
   * `core/actions/convert.ts`) deliberately filters out as a no-op
   * conversion, so its target list is genuinely empty.
   *
   * Without this check, dropping a PDF (or typing `/convert` on one) would
   * open the `target` step with a `Select` that has nothing to move a
   * cursor onto — and critically, `Select` no-ops on *every* key, including
   * escape, when its item list is empty (see `Select.tsx`). That is a dead
   * end a person cannot back out of short of quitting the process.
   */
  const hasConvertTarget = useCallback(
    (candidate: SourceInfo): boolean =>
      convertAction
        .options([candidate], {}, livePrefs)
        .some((s) => s.kind === 'select' && s.id === 'target' && s.choices.length > 0),
    [livePrefs],
  )

  // Gated on `step === 'result'`: Ink delivers input to every mounted
  // `useInput` hook regardless of what else is on screen, so an ungated
  // handler here would steal `f`/`o`/`q` from the target/quality/destination
  // stages the moment they happen to share a letter.
  // esc on the name step returns to the location step. Prompt deliberately
  // ignores escape (a path can contain one), so the step owns this.
  useInput(
    (_input, key) => {
      if (key.escape) cancelRename()
    },
    { isActive: step === 'rename' },
  )

  // esc on the size field goes back to the mode choice. Prompt ignores
  // escape by design — a path can contain one — so the step owns this.
  useInput(
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
  useInput(
    (_input, key) => {
      if (!key.escape) return
      if (stage.sources.length === 0 && stage.failures.length === 0) return
      setStage(clearStage())
    },
    { isActive: step === 'idle' && !paletteOwnsEscape },
  )

  useInput(
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
        // A source with nowhere to convert to (a staged PDF, today) stays
        // at idle rather than opening a target picker with nothing in it —
        // see `hasConvertTarget`.
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
       */
      if (command.name === 'pdf') {
        setStep(source ? 'pdf' : 'idle')
      }
    },
    [push, source, stagedBatch, refuseBatch, hasConvertTarget],
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
          refuseBatch()
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
            // See `hasConvertTarget`: a PDF can't compress *or* convert, so
            // falling back to the target step here would trade one dead
            // end for another.
            setStep(hasConvertTarget(info) ? 'target' : 'idle')
            return
          }
          setStep('mode')
          return
        }
        // A source with no convert target (a PDF, today) stays at idle,
        // staged and ready for `/pdf` or another command, rather than
        // opening a target picker with nothing in it — see
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
    [showError, push, runCommand, mode, stage, refuseBatch, hasConvertTarget],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  /** Takes the whole staged batch back off the bench and returns to the prompt. */
  const clearSource = () => {
    setStage(clearStage())
    setValues({})
    setStep('idle')
  }

  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = action.options([currentSource], { target }, livePrefs)
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
   * Spec §8's write-safety rules live in `buildPlan()` and nowhere else:
   * never write over the input, and never replace an existing output without
   * consent. The shell has to route through it for exactly the reason the
   * CLI does — `targetIdsFor` legitimately offers jpeg for a JPEG, and "Same
   * folder" is legitimately the first destination preset, so the
   * all-defaults keypath resolves the output straight onto the user's
   * original unless something refuses.
   *
   * `convertAction.plan()` is still what derives the job (it validates the
   * target and assembles the `ConvertOptions`); `buildPlan()` is what decides
   * whether that job is allowed to happen.
   *
   * `resolved.sources` below is still `[source]`, not `stage.sources`, even
   * though the run path is generally meant to take the whole batch now.
   * `output` here is always one exact filename — the rename step always
   * builds `${destination}/${stem}${ext}` for the single representative
   * `source` — and `buildPlan()` treats a non-directory `output` as the
   * literal target for *every* source it is given (§ `resolveOutputPath` /
   * `looksLikeDirectory`). Passing `stage.sources` with that output would
   * make every source past the first collide on the same path, which
   * `buildPlan()` correctly reports as `output-collision` failures — but the
   * refusal branch right below treats *any* failure as the whole run being
   * refused and returns before calling `runJobs` at all, so a two-file stage
   * would silently convert nothing instead of batch-converting. Making that
   * actually work needs the wizard to know it is planning for a batch
   * (skip or reinterpret the single-file rename step, run the jobs that
   * did resolve, show more than one result) — real UX decisions Task 12's
   * brief does not make, so this function still only ever acts on the first
   * staged file. See the task report for the full trace.
   */
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
       * user's. Run it before planning the write, so a target nothing can
       * reach fails before any file is created.
       */
      if (typeof values.targetBytes === 'number') {
        setStep('converting')
        const found = await findQuality({
          encode: async (quality) =>
            (await encodeToBuffer(source, planned.target, { ...planned.options, quality })).length,
          targetBytes: values.targetBytes,
          onAttempt: (n, of) => setAttempt({ n, of }),
        })
        setAttempt(undefined)
        if (found.missed) {
          push({
            kind: 'error',
            id: nextId(),
            error: targetUnreachable(source, values.targetBytes, found.bytes),
          })
          setStep('idle')
          return
        }
        planned.options.quality = found.quality
      }

      // Deliberately still `[source]`, not `stage.sources` — see the note on
      // `convert()` above this function for why passing the whole batch here
      // is not a safe mechanical change.
      const plan = await buildPlan({
        resolved: { sources: [source], failures: [], roots: new Map<string, string>() },
        target: planned.target,
        output,
        options: planned.options,
        force: opts.force ?? false,
      })

      const refusal = plan.failures[0]
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

      const summary = await runJobs(plan.jobs, {})
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
        } else {
          setSuggestion(undefined)
        }
      } else {
        const failure = summary.failures[0]
        if (failure) push({ kind: 'error', id: nextId(), error: failure.error })
        setStep('idle')
      }
    } catch (e) {
      // convertAction.plan() throws synchronously on a bad target, and
      // nothing guarantees buildPlan() or runJobs() can never reject for some
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
  /** Actually runs jobs already cleared by `checkWriteSafety`. */
  const runPdfJobs = async (jobs: Job[]) => {
    setStep('pdf-running')
    try {
      const summary = await runJobs(jobs, {})
      for (const result of summary.results) {
        push({ kind: 'note', id: nextId(), text: `${SYMBOLS.ok} ${describePdfResult(result)}` })
      }
      for (const failure of summary.failures) {
        push({ kind: 'error', id: nextId(), error: failure.error })
      }
    } catch (e) {
      // Mirrors `convert()`'s own catch: this runs from a handler PdfFlow's
      // synchronous `useInput` fired, and nothing else awaits this promise.
      showError(e)
    } finally {
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
  const handlePdfDone = async (jobs: Job[]) => {
    const safe = checkWriteSafety(jobs, { force: false })
    if (safe.failures.length > 0) {
      setPdfBlocked({ jobs, failures: safe.failures })
      setStep('pdf-blocked')
      return
    }
    await runPdfJobs(safe.jobs)
  }

  /** `replace` retries `pdfBlocked.jobs` with `force: true`; anything else cancels. */
  const answerPdfBlocked = (choice: string) => {
    if (!pdfBlocked) return
    if (choice !== 'replace') {
      setPdfBlocked(null)
      setStep('pdf')
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
    void runPdfJobs(forced.jobs)
  }

  // `Select` owns arrow/enter for the output-exists choice; a plain refusal
  // (no bypass offered) has nothing mounted to answer escape or enter, so
  // this step owns both directly — same reasoning as the 'rename' and
  // 'size' steps above, which own escape for the same reason.
  useInput(
    (_input, key) => {
      if (key.escape || key.return) answerPdfBlocked('cancel')
    },
    { isActive: step === 'pdf-blocked' && pdfBlocked?.failures[0]?.error.code !== 'output-exists' },
  )

  const modeSpec = specFor('mode')
  const sizeSpec = specFor('size')
  const targetSpec = specFor('target')
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
          <Box marginBottom={1}>
            <Text color={colourProp(palette.accent)} bold>
              {mode === 'compress' ? '  COMPRESS  ' : '  CONVERT  '}
            </Text>
            <Text color={colourProp(palette.dim)}>
              {mode === 'compress' ? '  /convert to switch back' : '  /compress to switch'}
            </Text>
          </Box>
        ) : null}

        {/* The staged list, shown live rather than committed to scrollback,
            for as long as it is still something the user can take back. */}
        {stage.sources.length > 0 && step !== 'idle' && step !== 'theme' && step !== 'result' ? (
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
              onCancel={clearSource}
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
              onCancel={() => setStep('target')}
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
              onSubmit={startRename}
              onCancel={() => setStep('target')}
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
            <Text color={colourProp(palette.dim)}>Running…</Text>
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
                  { value: 'cancel', label: 'Cancel', hint: 'back to /pdf, nothing written' },
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
            {/* A staged PDF has nowhere to go in the default convert flow
                (see `hasConvertTarget`) and lands right back here — so this
                is the one moment someone who does not already know `/pdf`
                exists needs to be told it does. Commands are only worth
                having if they can be found (the same reasoning behind the
                palette itself); a document sitting on the bench with no
                visible next step fails that test. Suppressed once a command
                is being typed — the palette is already doing this job then. */}
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
