import { Box } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { Hints } from './Hints.js'

/**
 * A step's keyboard hints, with a rule above them.
 *
 * The rule is Ink's own top border rather than a row of repeated `─`: Ink
 * sizes a border to the box it is drawn on, so it tracks the terminal without
 * anything computing a width — which is what "scalable" asks for, and one
 * fewer place for a width to be got wrong.
 */
export function HintBar({ pairs, width }: { pairs: Array<[string, string]>; width: number }) {
  const palette = useTheme()
  return (
    <Box
      width={width}
      borderStyle="single"
      borderColor={colourProp(palette.border)}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={0}
    >
      <Hints pairs={pairs} />
    </Box>
  )
}
