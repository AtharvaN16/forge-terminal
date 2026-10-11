import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor } from '../width.js'
import { Hints } from './Hints.js'

/**
 * A step's keyboard hints, under a rule the width of the terminal, one blank
 * row below the content they belong to.
 *
 * The rule is back: with a picker's band stopping at the file card's width,
 * the hints needed something that spans the whole frame to say they belong
 * to the screen rather than to the list above.
 */
export function HintBar({ pairs, width }: { pairs: Array<[string, string]>; width: number }) {
  const palette = useTheme()
  return (
    <Box width={width} marginTop={1} flexDirection="column">
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
      <Hints pairs={pairs} compact={bandFor(width) === 'compact'} />
    </Box>
  )
}
