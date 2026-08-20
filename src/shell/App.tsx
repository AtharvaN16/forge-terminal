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
import { runJobs } from '../core/run.js'
import { type Suggestion, suggestFormat } from '../core/suggest.js'
import type { FormatId, Result, SourceInfo } from '../core/types.js'
import { formatBytes, parseSize } from '../core/units.js'
import { encodeToBuffer } from '../engines/image.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { COMMANDS, type Command, isCommandBuffer, parseCommand } from './commands.js'
import { CommandPalette } from './components/CommandPalette.js'
import { FileCard } from './components/FileCard.js'
import { HintBar } from './components/HintBar.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { ThemePicker } from './components/ThemePicker.js'
import { fileLink, hyperlinksSupported } from './hyperlink.js'
import { openPath, revealLabel, revealPath } from './reveal.js'
import { ThemeProvider, useTheme } from './ThemeContext.js'
import { colourProp, paletteFor, SYMBOLS } from './theme.js'
import { bandFor, middleEllipsis } from './width.js'

/**
 * Everything below `App` is dumb and takes props; this is the only file
 * that knows the flow. It walks: drop a file -> pick a target format ->
 * (quality, for a lossy target only) -> pick a destination -> convert ->
 * show the result.
 */
export type Stage =
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

let blockSeq = 0
const nextId = () => `b${++blockSeq}`

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
  prefs = APP_DEFAULT_PREFS,
  configWarning,
}: {
  initialWidth?: number
  prefs?: Preferences
  configWarning?: string
}) {
  const palette = useTheme()
  const { stdout } = useStdout()
  const [measured, setMeasured] = useState(initialWidth ?? stdout?.columns ?? 80)

  useEffect(() => {
    if (initialWidth !== undefined || !stdout) return
    const onResize = () => setMeasured(stdout.columns ?? 80)
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [initialWidth, stdout])

  const width = measured
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
  const [stage, setStage] = useState<Stage>(prefs.theme === undefined ? 'theme' : 'idle')
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
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [lastResult, setLastResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<PendingOverwrite | null>(null)
  /** Destination and proposed stem while the rename field is open. */
  const [renaming, setRenaming] = useState<PendingRename | null>(null)

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

  // Gated on `stage === 'result'`: Ink delivers input to every mounted
  // `useInput` hook regardless of what else is on screen, so an ungated
  // handler here would steal `f`/`o`/`q` from the target/quality/destination
  // stages the moment they happen to share a letter.
  // esc on the name step returns to the location step. Prompt deliberately
  // ignores escape (a path can contain one), so the stage owns this.
  useInput(
    (_input, key) => {
      if (key.escape) cancelRename()
    },
    { isActive: stage === 'rename' },
  )

  // esc on the size field goes back to the mode choice. Prompt ignores
  // escape by design — a path can contain one — so the stage owns this.
  useInput(
    (_input, key) => {
      if (!key.escape) return
      setSizeError(undefined)
      setText('')
      setStage('mode')
    },
    { isActive: stage === 'size' },
  )

  useInput(
    (input, key) => {
      if (!lastResult) return
      if (key.return) {
        // A dashed rule and a blank line either side, so a long session reads
        // as a sequence of separate operations rather than one wall of text.
        push({ kind: 'separator', id: nextId(), width })
        setSource(null)
        setValues({})
        setLastResult(null)
        setStage('idle')
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
      if (input === 'o') openPath(lastResult.job.output).catch(showError)
      if (input === 's') revealPath(lastResult.job.output).catch(showError)
      if (input === 'q') exit()
      // Acts on the measured suggestion: re-enters convert with that target
      // already chosen, so the offer is one keystroke from being taken.
      if (input === 'c' && suggestion && lastResult) {
        setSuggestion(undefined)
        setMode('convert')
        setValues({ target: suggestion.target })
        setSource(lastResult.job.source)
        setStage('destination')
      }
    },
    { isActive: stage === 'result' },
  )

  // The picker never hardcodes a format list: it renders whatever
  // convertAction.options() returns for the probed source and the answers
  // collected so far (e.g. the quality step only appears once a lossy
  // target is chosen).
  const specs: OptionSpec[] = useMemo(
    () => (source ? action.options(source, values, livePrefs) : []),
    [source, values, livePrefs, action],
  )

  const specFor = useCallback((id: string) => specs.find((s) => s.id === id), [specs])

  /**
   * `probe()` is genuinely I/O-bound (`stat`, `access`, then sharp reading
   * the file's header), and nothing moves `stage` off `'idle'` until it
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
        setStage('theme')
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
        setMode('convert')
        setValues({})
        setStage(source ? 'target' : 'idle')
        return
      }

      if (command.name === 'compress') {
        if (source && !compressAction.appliesTo(source)) {
          push({ kind: 'error', id: nextId(), error: unsupportedCompress(source) })
          return
        }
        setMode('compress')
        setValues({})
        setStage(source ? 'mode' : 'idle')
      }
    },
    [push, source],
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
        setSource(info)
        setValues({})
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
          if (!compressAction.appliesTo(info)) {
            push({ kind: 'error', id: nextId(), error: unsupportedCompress(info) })
            setMode('convert')
            setStage('target')
            return
          }
          setStage('mode')
          return
        }
        setStage('target')
      } catch (e) {
        if (requestId.current !== id) return // superseded by a later submission
        // A rethrow here would become an unhandled rejection: submitPath is
        // fired from Prompt's synchronous useInput handler, and nothing
        // awaits or catches the promise it returns. Whatever this is —
        // a ForgeError, or anything else probe() didn't anticipate — the
        // shell must render it, not silently do nothing forever.
        showError(e)
        setStage('idle')
      }
    },
    // `mode` matters: without it this closure keeps the value it had when the
    // callback was created, and a file dropped after /compress would be
    // routed to the convert flow anyway.
    [showError, push, runCommand, mode],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  /** Takes the dropped file back off the bench and returns to the prompt. */
  const clearSource = () => {
    setSource(null)
    setValues({})
    setStage('idle')
  }

  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = action.options(currentSource, { target }, livePrefs)
    setStage(next.some((s) => s.id === 'quality') ? 'quality' : 'destination')
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
    setStage('idle')
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
    const planned = action.plan(source, { ...values, destination })[0]
    const proposed = (planned?.output ?? source.path).split('/').pop() ?? 'file'
    const dot = proposed.lastIndexOf('.')
    const stem = dot > 0 ? proposed.slice(0, dot) : proposed
    const ext = dot > 0 ? proposed.slice(dot) : ''
    setRenaming({ destination, stem, ext })
    setText(stem)
    setStage('rename')
  }

  const cancelRename = () => {
    setRenaming(null)
    setText('')
    setStage('destination')
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
    setStage('destination')
  }

  const chooseQuality = (quality: number) => {
    setValues((v) => ({ ...v, quality }))
    setStage('destination')
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
   * step's synchronous `useInput` handler. Moving `stage` to `'converting'`
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
   */
  const convert = async (destination: string, opts: { force?: boolean; output?: string } = {}) => {
    if (!source) return
    if (converting.current) return
    converting.current = true
    setStage('converting')
    try {
      const planned = action.plan(source, { ...values, destination })[0]
      if (!planned) {
        setStage('idle')
        return
      }
      const output = opts.output ?? planned.output

      /**
       * A target size means the quality is the search's answer, not the
       * user's. Run it before planning the write, so a target nothing can
       * reach fails before any file is created.
       */
      if (typeof values.targetBytes === 'number') {
        setStage('converting')
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
          setStage('idle')
          return
        }
        planned.options.quality = found.quality
      }

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
          setStage('overwrite')
          return
        }
        push({ kind: 'error', id: nextId(), error: refusal.error })
        // Writing over the source has no "replace" worth offering — there is
        // no outcome there that keeps the original. Back to the destination
        // step, where choosing a different folder is the actual fix.
        setStage(refusal.error.code === 'output-is-input' ? 'destination' : 'idle')
        return
      }

      const summary = await runJobs(plan.jobs, {})
      const result = summary.results[0]
      if (result) {
        setLastResult(result)
        push({ kind: 'result', id: nextId(), result })
        setStage('result')

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
        setStage('idle')
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
      setStage('idle')
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
    else setStage('destination')
  }

  const modeSpec = specFor('mode')
  const sizeSpec = specFor('size')
  const targetSpec = specFor('target')
  const qualitySpec = specFor('quality')
  const destinationSpec = specFor('destination')

  return (
    <ThemeProvider palette={paletteFor(theme)}>
      <Box flexDirection="column">
        {stage === 'theme' ? <ThemePicker onChoose={chooseTheme} /> : null}

        {/* The staged file, shown live rather than committed to scrollback,
            for as long as it is still something the user can take back. */}
        {source && stage !== 'idle' && stage !== 'theme' && stage !== 'result' ? (
          <Box marginBottom={1}>
            <FileCard source={source} width={width} />
          </Box>
        ) : null}
        <Static items={history}>
          {(block) => <HistoryEntry key={block.id} block={block} width={width} />}
        </Static>

        {stage === 'mode' && source && modeSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colourProp(palette.label)}>{modeSpec.label}</Text>
            <Select
              width={width}
              items={modeSpec.choices}
              onSubmit={(chosen) => {
                setValues((v) => ({ ...v, mode: chosen }))
                setStage(chosen === 'size' ? 'size' : 'quality')
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

        {stage === 'size' && sizeSpec?.kind === 'text' ? (
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

        {stage === 'target' && source && targetSpec?.kind === 'select' ? (
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

        {stage === 'quality' && qualitySpec?.kind === 'slider' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Slider
              label={qualitySpec.label}
              min={qualitySpec.min}
              max={qualitySpec.max}
              step={qualitySpec.step}
              value={typeof values.quality === 'number' ? values.quality : qualitySpec.default}
              onChange={(q) => setValues((v) => ({ ...v, quality: q }))}
              onSubmit={chooseQuality}
              onCancel={() => setStage('target')}
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

        {stage === 'destination' && destinationSpec?.kind === 'path' ? (
          <Box flexDirection="column" marginBottom={1}>
            <PathInput
              label={destinationSpec.label}
              presets={destinationSpec.presets}
              preview={previewDestination}
              onSubmit={startRename}
              onCancel={() => setStage('target')}
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

        {stage === 'rename' && renaming ? (
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

        {stage === 'overwrite' && pending ? (
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
                setStage('destination')
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

        {stage === 'converting' ? (
          <Box marginBottom={1}>
            <Text color={colourProp(palette.dim)}>
              {attempt
                ? `Finding the right quality — attempt ${attempt.n} of ${attempt.of}…`
                : 'Converting…'}
            </Text>
          </Box>
        ) : null}

        {stage === 'result' && lastResult ? (
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
                {fileLink('Open file', lastResult.job.output)}
                {'  ·  '}
                {fileLink(revealLabel(), lastResult.job.output.replace(/\/[^/]+$/, ''))}
              </Text>
            ) : null}
            <HintBar
              width={width}
              pairs={[
                ['↵', 'convert another'],
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

        {stage === 'idle' ? (
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
                      ['ctrl-c', 'quit'],
                    ]
                  : [
                      ['↵', 'send'],
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
