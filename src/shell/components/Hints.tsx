import { Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** Each key is paired with a word, so the line reads in monochrome. */
export function Hints({ pairs }: { pairs: Array<[string, string]> }) {
  const palette = useTheme()
  return (
    <Text color={colourProp(palette.dim)}>
      {pairs.map(([key, what]) => `${key} ${what}`).join(' · ')}
    </Text>
  )
}
