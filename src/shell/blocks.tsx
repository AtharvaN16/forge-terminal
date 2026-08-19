import { basename } from 'node:path'
import { Box, Text } from 'ink'
import type { ForgeError } from '../core/errors.js'
import type { Result, SourceInfo } from '../core/types.js'
import { formatBytes, percentChange } from '../core/units.js'
import { FileCard } from './components/FileCard.js'
import { SYMBOLS } from './theme.js'

/**
 * What scrolls past above the live prompt: a dropped file, a finished
 * conversion, an error, or a plain status note. Dumb by design — this
 * module renders a `Result` or a `ForgeError`; it never converts anything
 * or decides what went wrong.
 */
export type HistoryBlock =
  | { kind: 'file'; id: string; source: SourceInfo }
  | { kind: 'result'; id: string; result: Result }
  | { kind: 'error'; id: string; error: ForgeError }
  | { kind: 'note'; id: string; text: string }

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

export function HistoryEntry({ block, width }: { block: HistoryBlock; width: number }) {
  if (block.kind === 'file') {
    return (
      <Box marginBottom={1}>
        <FileCard source={block.source} width={width} />
      </Box>
    )
  }

  if (block.kind === 'note') {
    return (
      <Box marginBottom={1}>
        <Text>{block.text}</Text>
      </Box>
    )
  }

  if (block.kind === 'error') {
    const e = block.error
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red">
          {SYMBOLS.fail} {e.title}
        </Text>
        <Text>{`  ${e.detail}`}</Text>
        {e.hint ? <Text dimColor>{`  ${e.hint}`}</Text> : null}
      </Box>
    )
  }

  const { job, outputBytes, warnings } = block.result
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="green">
        {SYMBOLS.ok} {basename(job.source.path)} {SYMBOLS.arrow} {basename(job.output)}
      </Text>
      <Text dimColor>
        {'  '}
        {formatBytes(job.source.bytes)} {SYMBOLS.arrow} {formatBytes(outputBytes)} ·{' '}
        {changePhrase(job.source.bytes, outputBytes)}
      </Text>
      {warnings.map((w) => (
        <Text key={w.message} color="yellow">
          {SYMBOLS.warn} {w.message}
        </Text>
      ))}
    </Box>
  )
}
