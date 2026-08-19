import { basename } from 'node:path'
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PREFERENCES, type Preferences, savePreferences } from '../config/preferences.js'
import type { OptionSpec } from '../core/actions.js'
import { convertAction } from '../core/actions.js'
import { isForgeError, unexpectedError } from '../core/errors.js'
import { primaryExtension } from '../core/formats.js'
import { uniqueOutputPath } from '../core/output-path.js'
import { buildPlan } from '../core/plan.js'
import { runJobs } from '../core/run.js'
import type { FormatId, Result, SourceInfo } from '../core/types.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { Banner } from './components/Banner.js'
import { Hints } from './components/Hints.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { ThemePicker } from './components/ThemePicker.js'
import { fileLink } from './hyperlink.js'
import { openPath, revealPath } from './reveal.js'
import { ThemeProvider, useTheme } from './ThemeContext.js'
import { colourProp, paletteFor, SYMBOLS, VERSION } from './theme.js'
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
  | 'target'
  | 'quality'
  | 'destination'
  | 'overwrite'
  | 'converting'
  | 'result'

/**
 * What the overwrite question needs to remember while it is being asked:
 * where the user chose to save, what that resolved to, and the name "keep
 * both" would use — resolved once, when the question is raised, rather than
 * on every render of it.
 */
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

  const [history, setHistory] = useState<HistoryBlock[]>([])
  /**
   * Held in state, not read straight from `prefs`, so `/theme` re-themes the
   * running session rather than only the next launch.
   */
  const [theme, setTheme] = useState<'dark' | 'light' | undefined>(prefs.theme)
  const [stage, setStage] = useState<Stage>(prefs.theme === undefined ? 'theme' : 'idle')
  const [text, setText] = useState('')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [lastResult, setLastResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<PendingOverwrite | null>(null)

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
  useInput(
    (input, key) => {
      if (!lastResult) return
      if (key.return) {
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
      if (input === 'f') openPath(lastResult.job.output).catch(showError)
      if (input === 'o') revealPath(lastResult.job.output).catch(showError)
      if (input === 'q') exit()
    },
    { isActive: stage === 'result' },
  )

  // The picker never hardcodes a format list: it renders whatever
  // convertAction.options() returns for the probed source and the answers
  // collected so far (e.g. the quality step only appears once a lossy
  // target is chosen).
  const specs: OptionSpec[] = useMemo(
    () => (source ? convertAction.options(source, values, prefs) : []),
    [source, values, prefs],
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

  const submitPath = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      if (trimmed === '/theme') {
        setText('')
        setStage('theme')
        return
      }
      const id = ++requestId.current
      setText('')
      try {
        const info = await probe(trimmed)
        if (requestId.current !== id) return // superseded by a later submission
        setSource(info)
        setValues({})
        push({ kind: 'file', id: nextId(), source: info })
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
    [push, showError],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = convertAction.options(currentSource, { target }, prefs)
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
    savePreferences({ theme: next }).catch(showError)
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
      const planned = convertAction.plan(source, { ...values, destination })[0]
      if (!planned) {
        setStage('idle')
        return
      }
      const output = opts.output ?? planned.output

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
    else setStage('destination')
  }

  const targetSpec = specFor('target')
  const qualitySpec = specFor('quality')
  const destinationSpec = specFor('destination')

  return (
    <ThemeProvider palette={paletteFor(theme)}>
      <Box flexDirection="column">
        {stage === 'theme' ? (
          <ThemePicker onChoose={chooseTheme} />
        ) : (
          <Banner width={width} version={VERSION} defaultOutput={prefs.defaultOutput} />
        )}
        <Static items={history}>
          {(block) => <HistoryEntry key={block.id} block={block} width={width} />}
        </Static>

        {stage === 'target' && source && targetSpec?.kind === 'select' ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>{targetSpec.label}</Text>
            <Select
              width={width}
              items={targetSpec.choices}
              onSubmit={(target) => chooseTarget(source, target)}
              onCancel={() => setStage('idle')}
              showHints={band !== 'compact'}
            />
            <Hints
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
            <Hints
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
              onSubmit={(destination) => void convert(destination)}
              onCancel={() => setStage('target')}
              width={width}
              showHints={band !== 'compact'}
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
            <Hints
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
            <Text color={colourProp(palette.dim)}>Converting…</Text>
          </Box>
        ) : null}

        {stage === 'result' && lastResult ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              {fileLink('Open file', lastResult.job.output)}
              {'  ·  '}
              {fileLink('Reveal in Finder', lastResult.job.output.replace(/\/[^/]+$/, ''))}
            </Text>
            <Hints
              pairs={[
                ['↵', 'convert another'],
                ['f', 'open'],
                ['o', 'reveal'],
                ['q', 'quit'],
              ]}
            />
          </Box>
        ) : null}

        {stage === 'idle' ? (
          <Box flexDirection="column">
            <Prompt
              value={text}
              onChange={setText}
              onSubmit={submitPath}
              placeholder="drop a file or type a path"
              isActive
              bordered={band !== 'compact'}
              width={width}
            />
            <Hints
              pairs={[
                ['↵', 'send'],
                ['ctrl-c', 'quit'],
              ]}
            />
          </Box>
        ) : null}
      </Box>
    </ThemeProvider>
  )
}
