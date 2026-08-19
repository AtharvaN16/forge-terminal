import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { FORMATS } from '../../core/formats.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'

/** The card never grows past this, however wide the terminal is. */
const MAX_CARD = 52

/**
 * A dropped file, framed, with its format inlined into the top border as a
 * tag.
 *
 * Below the compact band (<60 columns) the frame is dropped entirely rather
 * than spending four of the columns the filename needs — spec §13 says
 * content is truncated rather than wrapped, and a border is not content.
 */
export function FileCard({ source, width }: { source: SourceInfo; width: number }) {
  const palette = useTheme()
  const band = bandFor(width)
  const name = source.path.split('/').pop() ?? source.path
  const label = FORMATS[source.format].label

  const facts = [
    `${source.width}×${source.height}`,
    formatBytes(source.bytes),
    // Only claimed when the source genuinely carries alpha — saying
    // "transparent" about an opaque JPEG would be a plain lie about the file.
    ...(source.hasAlpha ? ['transparent'] : []),
  ].join(' · ')

  // Spec §13: the compact band drops the frame *and* the format and
  // dimensions, keeping only what identifies the file and how big it is.
  // Two lines of metadata is exactly what there is no room for here.
  if (band === 'compact') {
    return (
      <Text>
        <Text color={colourProp(palette.fg)}>{middleEllipsis(name, Math.max(8, width - 12))}</Text>
        <Text color={colourProp(palette.dim)}>{` · ${formatBytes(source.bytes)}`}</Text>
      </Text>
    )
  }

  // Total drawn width, borders included. Capped so a wide terminal gets a
  // card rather than a rule stretching to the far edge.
  const outer = Math.min(width, MAX_CARD)
  const inner = outer - 2 // the two vertical border glyphs
  const textWidth = inner - 2 // one column of padding on each side

  // The top border's inner run is '─ ' + tag + ' ' + rule, so the rule takes
  // whatever those three columns and the tag leave. Getting this wrong by one
  // shears the frame — there is a test pinning every line to one width.
  const rule = '─'.repeat(Math.max(0, inner - stringWidth(label) - 3))

  const row = (text: string) => {
    const shown = middleEllipsis(text, textWidth)
    return `${shown}${' '.repeat(Math.max(0, textWidth - stringWidth(shown)))}`
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colourProp(palette.border)}>{'╭─ '}</Text>
        <Text color={colourProp(palette.tag)}>{label}</Text>
        <Text color={colourProp(palette.border)}>{` ${rule}╮`}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text color={colourProp(palette.fg)}>{row(name)}</Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'│ '}</Text>
        <Text color={colourProp(palette.dim)}>{row(facts)}</Text>
        <Text color={colourProp(palette.border)}>{' │'}</Text>
      </Text>
      <Text color={colourProp(palette.border)}>{`╰${'─'.repeat(inner)}╯`}</Text>
    </Box>
  )
}
