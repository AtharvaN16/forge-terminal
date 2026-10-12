import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { KeyRow } from './Home.js'

/** Keys that belong in the footnote, in the order the footnote says them. */
const FOOT_KEYS = ['1–3', 'esc', 'ctrl-c']

/**
 * A step's keys, the decided way (F1): what this screen is for as caps at the
 * left, and mode, esc and quit as a quiet footnote at the right edge — under
 * a rule the width of the terminal, one blank row below what they belong to.
 * The rule is the user's own and stays on every key row.
 *
 * Every screen draws its keys through here, so the row is the same
 * everywhere: without a footnote of its own, a footnote key passed among
 * `pairs` moves there; and every row ends `ctrl-c quit`.
 */
export function HintBar({
  pairs,
  foot,
  width,
}: {
  pairs: Array<[string, string]>
  /**
   * The footnote, when the screen decides it (Working's "esc stop" is a main
   * key there, by design). Left out, it is made from `pairs`: mode, esc and
   * quit move to it, in that order.
   */
  foot?: Array<[string, string]> | undefined
  width: number
}) {
  const palette = useTheme()
  const given = foot !== undefined
  const main = given ? pairs : pairs.filter(([key]) => !FOOT_KEYS.includes(key))
  const from = foot ?? pairs
  const extra = (foot ?? []).filter(([key]) => !FOOT_KEYS.includes(key))
  const footed = FOOT_KEYS.flatMap((k) => {
    if (k === 'ctrl-c') return [['ctrl-c', 'quit'] as [string, string]]
    const found = from.find(([key]) => key === k)
    return found ? [found] : []
  })
  return (
    <Box width={width} marginTop={1} flexDirection="column">
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
      <KeyRow main={main} foot={[...extra, ...footed]} width={width} lead={1} />
    </Box>
  )
}
