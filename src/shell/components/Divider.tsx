import { Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** The rule that separates a step's content from its keyboard hints. */
export function Divider({ width }: { width: number }) {
  const palette = useTheme()
  return (
    <Text color={colourProp(palette.border)}>{'─'.repeat(Math.max(4, Math.min(width, 52)))}</Text>
  )
}
