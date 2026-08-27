import { Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/**
 * Each key is paired with a word, so the line reads in monochrome — colour
 * is an accent here too, never the only thing telling `↵` from `send`.
 *
 * The key is bold and in the app's one accent colour, the same one that
 * marks "Open file" / "Show in Finder" as clickable elsewhere: a keyboard
 * shortcut and a clickable label are both "something you can act on," so
 * they share the one colour that means that rather than splitting it into a
 * second one. A rule in the border colour separates each pair rather than a
 * middle dot, wide enough to read as a row of distinct controls instead of
 * one run-on sentence with dots in it.
 */
export function Hints({ pairs }: { pairs: Array<[string, string]> }) {
  const palette = useTheme()
  return (
    <Text>
      {pairs.map(([key, what], i) => (
        <Text key={key}>
          {i > 0 ? <Text color={colourProp(palette.border)}>{'  │  '}</Text> : null}
          <Text color={colourProp(palette.accent)} bold>
            {key}
          </Text>
          <Text color={colourProp(palette.dim)}>{` ${what}`}</Text>
        </Text>
      ))}
    </Text>
  )
}
