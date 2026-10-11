import { Text } from 'ink'
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
  const gap = ' '.repeat(compact ? 3 : 5)
  const capped = palette.keycapBg !== ''
  return (
    <Text>
      {pairs.map(([key, what], i) => (
        <Text key={key}>
          {i > 0 ? <Text>{gap}</Text> : null}
          {capped ? (
            <Text backgroundColor={palette.keycapBg} color={colourProp(palette.fg)} bold>
              {` ${key} `}
            </Text>
          ) : (
            <Text bold>{`[${key}]`}</Text>
          )}
          <Text color={colourProp(palette.dim)}>{` ${what}`}</Text>
        </Text>
      ))}
    </Text>
  )
}
