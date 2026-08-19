import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { OptionSpec } from '../core/actions.js'
import { convertAction } from '../core/actions.js'
import { isForgeError, unexpectedError } from '../core/errors.js'
import { primaryExtension } from '../core/formats.js'
import { runJobs } from '../core/run.js'
import type { FormatId, Result, SourceInfo } from '../core/types.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { Hints } from './components/Hints.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { fileLink } from './hyperlink.js'
import { openPath, revealPath } from './reveal.js'
import { bandFor } from './width.js'

/**
 * Everything below `App` is dumb and takes props; this is the only file
 * that knows the flow. It walks: drop a file -> pick a target format ->
 * (quality, for a lossy target only) -> pick a destination -> convert ->
 * show the result.
 */
export type Stage = 'idle' | 'target' | 'quality' | 'destination' | 'converting' | 'result'

let blockSeq = 0
const nextId = () => `b${++blockSeq}`

export function App({ initialWidth }: { initialWidth?: number }) {
  const { stdout } = useStdout()
  const width = initialWidth ?? stdout?.columns ?? 80
  const band = bandFor(width)

  const [history, setHistory] = useState<HistoryBlock[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [text, setText] = useState('')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [lastResult, setLastResult] = useState<Result | null>(null)

  const { exit } = useApp()

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
      if (input === 'f') void openPath(lastResult.job.output)
      if (input === 'o') void revealPath(lastResult.job.output)
      if (input === 'q') exit()
    },
    { isActive: stage === 'result' },
  )

  const push = useCallback((block: HistoryBlock) => {
    setHistory((h) => [...h, block])
  }, [])

  // The picker never hardcodes a format list: it renders whatever
  // convertAction.options() returns for the probed source and the answers
  // collected so far (e.g. the quality step only appears once a lossy
  // target is chosen).
  const specs: OptionSpec[] = useMemo(
    () => (source ? convertAction.options(source, values) : []),
    [source, values],
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
        push({ kind: 'error', id: nextId(), error: isForgeError(e) ? e : unexpectedError(e) })
        setStage('idle')
      }
    },
    [push],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    setValues((v) => ({ ...v, target }))
    const next = convertAction.options(currentSource, { target })
    setStage(next.some((s) => s.id === 'quality') ? 'quality' : 'destination')
  }

  const chooseQuality = (quality: number) => {
    setValues((v) => ({ ...v, quality }))
    setStage('destination')
  }

  // Unlike `submitPath`/`probe`, there is no race to guard against here:
  // once `stage` moves to 'converting' every earlier stage's input handler
  // is unmounted (each lives inside its own `stage === '...'` branch below),
  // and the result-stage handler is gated on `stage === 'result'`, so
  // nothing can start a second conversion while this one is in flight.
  const convert = async (destination: string) => {
    if (!source) return
    setStage('converting')
    try {
      const jobs = convertAction.plan(source, { ...values, destination })
      const summary = await runJobs(jobs, {})
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
      // nothing guarantees runJobs() can never reject for some cause it
      // doesn't itself catch. Either way, this runs inside an async handler
      // nothing awaits — PathInput fires onSubmit from a synchronous
      // useInput handler — so a rethrow here would become an unhandled
      // rejection instead of something the user ever sees. Render it
      // instead, exactly like submitPath does for probe().
      push({ kind: 'error', id: nextId(), error: isForgeError(e) ? e : unexpectedError(e) })
      setStage('idle')
    }
  }

  const targetSpec = specFor('target')
  const qualitySpec = specFor('quality')
  const destinationSpec = specFor('destination')

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(block) => <HistoryEntry key={block.id} block={block} width={width} />}
      </Static>

      {stage === 'target' && source && targetSpec?.kind === 'select' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{targetSpec.label}</Text>
          <Select
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
            preview={(p) => {
              if (!(source && typeof values.target === 'string')) return p
              const stem = (source.path.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '')
              return `${p}/${stem}${primaryExtension(values.target as FormatId)}`
            }}
            onSubmit={convert}
            onCancel={() => setStage('target')}
          />
        </Box>
      ) : null}

      {stage === 'converting' ? (
        <Box marginBottom={1}>
          <Text dimColor>Converting…</Text>
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
  )
}
