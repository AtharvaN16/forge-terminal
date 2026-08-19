import { Box, Static, Text, useStdout } from 'ink'
import { useCallback, useMemo, useState } from 'react'
import type { OptionSpec } from '../core/actions.js'
import { convertAction } from '../core/actions.js'
import { isForgeError } from '../core/errors.js'
import { primaryExtension } from '../core/formats.js'
import type { FormatId, SourceInfo } from '../core/types.js'
import { probe } from '../engines/registry.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { Hints } from './components/Hints.js'
import { PathInput } from './components/PathInput.js'
import { Prompt } from './components/Prompt.js'
import { Select } from './components/Select.js'
import { Slider } from './components/Slider.js'
import { bandFor } from './width.js'

/**
 * Everything below `App` is dumb and takes props; this is the only file
 * that knows the flow. It walks: drop a file -> pick a target format ->
 * (quality, for a lossy target only) -> pick a destination -> convert.
 * Conversion itself and the result screen belong to a later stage of the
 * shell — here the flow ends at 'destination'.
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

  const submitPath = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      setText('')
      try {
        const info = await probe(trimmed)
        setSource(info)
        setValues({})
        push({ kind: 'file', id: nextId(), source: info })
        setStage('target')
      } catch (e) {
        if (!isForgeError(e)) throw e
        push({ kind: 'error', id: nextId(), error: e })
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

  const chooseDestination = (destination: string) => {
    setValues((v) => ({ ...v, destination }))
    setStage('converting')
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
            onSubmit={chooseDestination}
            onCancel={() => setStage('target')}
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
