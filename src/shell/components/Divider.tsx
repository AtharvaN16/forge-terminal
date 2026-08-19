import { Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/**
 * The rule separating a step's content from its keyboard hints. Full width:
 * it is a horizontal divider, and one that stops short of the edge reads as
 * an underline for whatever happens to sit above it instead.
 */
export function Divider({ width }: { width: number }) {
  const palette = useTheme()
  return <Text color={colourProp(palette.border)}>{'─'.repeat(Math.max(4, width))}</Text>
}
