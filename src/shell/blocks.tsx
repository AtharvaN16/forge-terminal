import { basename } from 'node:path'
import { Box, Text } from 'ink'
import type { ForgeError } from '../core/errors.js'
import type { Result, SourceInfo } from '../core/types.js'
import { formatBytes, percentChange } from '../core/units.js'
import { Banner } from './components/Banner.js'
import { FileCard } from './components/FileCard.js'
import { useTheme } from './ThemeContext.js'
import { colourProp, SYMBOLS, VERSION } from './theme.js'

/**
 * What scrolls past above the live prompt: a dropped file, a finished
 * conversion, an error, or a plain status note. Dumb by design — this
 * module renders a `Result` or a `ForgeError`; it never converts anything
 * or decides what went wrong.
 */
export type HistoryBlock =
  /**
   * The banner. It lives in history rather than in the live tree because
   * Ink flushes `<Static>` output above everything that re-renders — a
   * banner in the dynamic tree is redrawn *below* the scrollback on every
   * update, which is how it ended up in the middle of the session.
   */
  | { kind: 'banner'; id: string; width: number; defaultOutput: string }
  | { kind: 'file'; id: string; source: SourceInfo }
  | { kind: 'result'; id: string; result: Result }
  | { kind: 'error'; id: string; error: ForgeError }
  | { kind: 'note'; id: string; text: string }

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

export function HistoryEntry({ block, width }: { block: HistoryBlock; width: number }) {
  const palette = useTheme()

  if (block.kind === 'banner') {
    return <Banner width={block.width} version={VERSION} defaultOutput={block.defaultOutput} />
  }

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
        <Text color={colourProp(palette.dim)}>{block.text}</Text>
      </Box>
    )
  }

  if (block.kind === 'error') {
    const e = block.error
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colourProp(palette.fail)}>
          {SYMBOLS.fail} {e.title}
        </Text>
        <Text color={colourProp(palette.fg)}>{`  ${e.detail}`}</Text>
        {e.hint ? <Text color={colourProp(palette.dim)}>{`  ${e.hint}`}</Text> : null}
      </Box>
    )
  }

  const { job, outputBytes, warnings } = block.result
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} done`}</Text>
        <Text>{'  '}</Text>
        <Text color={colourProp(palette.fg)}>{basename(job.source.path)}</Text>
        <Text color={colourProp(palette.dim)}>{` ${SYMBOLS.arrow} `}</Text>
        <Text color={colourProp(palette.fg)}>{basename(job.output)}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.dim)}>
          {`        ${formatBytes(job.source.bytes)} ${SYMBOLS.arrow} ${formatBytes(outputBytes)} · `}
        </Text>
        <Text color={colourProp(palette.ok)}>{changePhrase(job.source.bytes, outputBytes)}</Text>
      </Text>
      {warnings.map((w) => (
        <Text key={w.message} color={colourProp(palette.warn)}>
          {SYMBOLS.warn} {w.message}
        </Text>
      ))}
    </Box>
  )
}
