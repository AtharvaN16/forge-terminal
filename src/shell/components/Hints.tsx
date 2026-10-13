import { Box } from 'ink'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/**
 * Each key is drawn as a keycap — ` ↵ ` on a fill — with its word beside it,
 * so the line reads as a row of keys rather than one run-on sentence. The
 * cap's shape is what says "this is a key", which is why there are no `│`
 * dividers and no rule above: the caps separate themselves.
 *
 * The key is not drawn in `accent` any more. `accent` follows the mode now
 * (see `modePalette`), and a key is the same key in every mode. Where there
 * is no fill to draw on — the first-run palette, `NO_COLOR` — the key is
 * bracketed instead, so it still reads as a key in monochrome.
 */
export function Hints({
  pairs,
  compact = false,
}: {
  pairs: Array<[string, string]>
  compact?: boolean
}) {
  const palette = useTheme()
  // Read at render time, as `Prompt` reads it: NO_COLOR strips the fill, and
  // a cap with no fill is just a key with spaces round it.
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const capped = palette.keycapBg !== '' && !noColour
  // A wrapping row of unbreakable pairs: a narrow terminal breaks the row
  // between keys, never between a key and its word.
  return (
    <Box flexWrap="wrap" columnGap={compact ? 3 : 5}>
      {pairs.map(([key, what]) => (
        <Box key={key} flexShrink={0}>
          <Text>
            {capped ? (
              <Text backgroundColor={palette.keycapBg} color={colourProp(palette.fg)} bold>
                {` ${key} `}
              </Text>
            ) : (
              <Text bold>{`[${key}]`}</Text>
            )}
            <Text color={colourProp(palette.dim)}>{` ${what}`}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  )
}
