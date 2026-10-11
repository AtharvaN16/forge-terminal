import { Box } from 'ink'
import { bandFor } from '../width.js'
import { Hints } from './Hints.js'

/**
 * A step's keyboard hints, one blank row below the content they belong to.
 *
 * There used to be a rule above them. Keycaps are their own boundary — a
 * row of filled keys does not need a line to say where it starts — so the
 * rule went with the `│` dividers.
 */
export function HintBar({ pairs, width }: { pairs: Array<[string, string]>; width: number }) {
  return (
    <Box width={width} marginTop={1}>
      <Hints pairs={pairs} compact={bandFor(width) === 'compact'} />
    </Box>
  )
}
