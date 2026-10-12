import { Box } from 'ink'
import { errorLine } from '../error-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { Runs } from './Home.js'

/**
 * E5·b: a refusal of what was just typed or dropped, as one tinted row (see
 * `error-art.ts`). `width` is the row's, without the margin.
 */
export function ErrorLine({
  title,
  reason,
  width,
}: {
  title: string
  reason: string
  width: number
}) {
  const palette = useTheme()
  // Read at render time, as `KeyRow` reads it: NO_COLOR strips every fill.
  const plain = (process.env.NO_COLOR ?? '') !== ''
  return (
    <Box marginLeft={HOME_MARGIN}>
      <Runs row={errorLine({ palette, title, reason, width, plain })} />
    </Box>
  )
}
