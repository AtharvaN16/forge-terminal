import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { FORMATS } from '../../core/formats.js'
import type { SourceInfo } from '../../core/types.js'
import type { Stage } from '../stage.js'
import { stageSummary } from '../stage.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'
import { FileCard } from './FileCard.js'

/** The card never grows past this, however wide the terminal is — same cap
 * as `FileCard`, so a one-file and a many-file stage read as the same kind
 * of object. */
const MAX_CARD = 52
/** Beyond this many staged files, the rest are counted rather than listed —
 * spec §13: content is truncated, not wrapped. */
const MAX_ROWS = 3

function factFor(source: SourceInfo): string {
  if (source.kind === 'document') {
    return `${source.pages} ${source.pages === 1 ? 'page' : 'pages'}`
  }
  return `${source.width}×${source.height}`
}

/**
 * The staged list, framed like `FileCard` when there is more than one file
 * to show at once.
 *
 * A single file delegates outright — there is nothing this card would say
 * that `FileCard` does not already say better with the room a whole card
 * gives it. More than one collapses each file to a name and a fact so the
 * whole batch still fits in the same footprint.
 *
 * Skipped files are drawn after the frame, never inside it: a skipped file
 * failed to become a staged source, so the card — which lists what *is*
 * staged — has nothing true to say about it.
 */
export function StagedFiles({ stage, width }: { stage: Stage; width: number }) {
  const palette = useTheme()
  const { sources, failures } = stage

  const skipped =
    failures.length > 0 ? (
      <Box flexDirection="column" marginTop={sources.length > 0 ? 1 : 0}>
        <Text color={colourProp(palette.warn)}>
          {SYMBOLS.warn} {failures.length} skipped
        </Text>
        {failures.map(({ path, error }) => (
          <Text key={path} color={colourProp(palette.dim)}>
            {`  ${middleEllipsis(`${path.split('/').pop() ?? path} — ${error.title}`, Math.max(8, width - 2))}`}
          </Text>
        ))}
      </Box>
    ) : null

  if (sources.length === 0) return skipped

  const [first] = sources
  if (sources.length === 1 && first) {
    return (
      <Box flexDirection="column">
        <FileCard source={first} width={width} />
        {skipped}
      </Box>
    )
  }

  // More than one file: every source sharing a format gets the format's own
  // label in the tag ("PDF ×4"); a batch that mixes kinds or formats is
  // "MIXED" instead, and each row then carries its own format so the mix is
  // still legible file by file.
  const sameFormat = sources.every((s) => s.format === first?.format)
  const formatLabel = first ? FORMATS[first.format].label : ''
  const tag = sameFormat ? `${formatLabel} ×${sources.length}` : `MIXED ×${sources.length}`

  // Below the compact band (<60 columns) the frame is dropped entirely,
  // exactly as `FileCard` drops it — spec §13: content is truncated, not
  // wrapped, and a border is not content. This also sidesteps the frame
  // arithmetic below at widths it was never built to survive: the top
  // border's rule width only stays non-negative because `FileCard` never
  // reaches it under 60 columns either, and this returns before that
  // arithmetic runs, the same way.
  const band = bandFor(width)
  if (band === 'compact') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={colourProp(palette.tag)}>{tag}</Text>
          <Text color={colourProp(palette.dim)}>
            {` · ${middleEllipsis(stageSummary(stage), Math.max(8, width - stringWidth(tag) - 3))}`}
          </Text>
        </Text>
        {skipped}
      </Box>
    )
  }

  // Total drawn width, borders included — identical arithmetic to
  // `FileCard`: `inner` is the two vertical border glyphs removed, `textWidth`
  // is one column of padding on each side removed from that. Getting this
  // wrong by one column shears the frame.
  const outer = Math.min(width, MAX_CARD)
  const inner = outer - 2
  const textWidth = inner - 2
  const rule = '─'.repeat(Math.max(0, inner - stringWidth(tag) - 3))

  const padded = (text: string) =>
    `${text}${' '.repeat(Math.max(0, textWidth - stringWidth(text)))}`

  // A row is a name on the left and a fact right-aligned against the border
  // — the name is ellipsised first so the fact, which is short and fixed,
  // never gets pushed off the edge.
  const row = (left: string, fact: string) => {
    const leftBudget = Math.max(1, textWidth - stringWidth(fact) - 1)
    const shownLeft = middleEllipsis(left, leftBudget)
    const gap = Math.max(1, textWidth - stringWidth(shownLeft) - stringWidth(fact))
    return `${shownLeft}${' '.repeat(gap)}${fact}`
  }

  const shown = sources.slice(0, MAX_ROWS)
  const rest = sources.length - shown.length

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colourProp(palette.border)}>{'╭─ '}</Text>
        <Text color={colourProp(palette.tag)}>{tag}</Text>
        <Text color={colourProp(palette.border)}>{` ${rule}╮`}</Text>
      </Text>
      {shown.map((source) => {
        const name = source.path.split('/').pop() ?? source.path
        const left = sameFormat ? name : `${FORMATS[source.format].label} ${name}`
        return (
          <Text key={source.path}>
            <Text color={colourProp(palette.border)}>{'│ '}</Text>
            <Text color={colourProp(palette.fg)}>{row(left, factFor(source))}</Text>
            <Text color={colourProp(palette.border)}>{' │'}</Text>
          </Text>
        )
      })}
      {rest > 0 ? (
        <Text>
          <Text color={colourProp(palette.border)}>{'│ '}</Text>
          <Text color={colourProp(palette.dim)}>{padded(`… ${rest} more`)}</Text>
          <Text color={colourProp(palette.border)}>{' │'}</Text>
        </Text>
      ) : null}
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text>{padded('')}</Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text color={colourProp(palette.dim)}>
          {padded(middleEllipsis(stageSummary(stage), textWidth))}
        </Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text color={colourProp(palette.border)}>{`╰${'─'.repeat(inner)}╯`}</Text>
      {skipped}
    </Box>
  )
}
