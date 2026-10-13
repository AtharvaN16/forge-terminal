import { Box } from 'ink'
import stringWidth from 'string-width'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { KeyRow } from './Home.js'

/**
 * Keys that belong in the footnote, in the order the footnote says them: the
 * mode keys ("1–4", however many modes there are), esc, then quit.
 */
const FOOT_ORDER = ['mode', 'esc', 'ctrl-c'] as const
const footSlot = (key: string): (typeof FOOT_ORDER)[number] | undefined =>
  /^1–\d$/.test(key) ? 'mode' : key === 'esc' || key === 'ctrl-c' ? key : undefined

/**
 * A step's keys, the decided way (F1): what this screen is for as caps at the
 * left, and mode, esc and quit as a quiet footnote at the right edge — under
 * a rule the width of the terminal, on the window's last rows.
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
  aside,
}: {
  pairs: Array<[string, string]>
  /**
   * The footnote, when the screen decides it (Working's "esc stop" is a main
   * key there, by design). Left out, it is made from `pairs`: mode, esc and
   * quit move to it, in that order.
   */
  foot?: Array<[string, string]> | undefined
  width: number
  /**
   * A key said just above the rule, at its far end, rather than in the row:
   * one that belongs to what is highlighted ("/ new folder" on a folder).
   */
  aside?: Array<[string, string]> | undefined
}) {
  const palette = useTheme()
  const given = foot !== undefined
  const main = given ? pairs : pairs.filter(([key]) => footSlot(key) === undefined)
  const from = foot ?? pairs
  const extra = (foot ?? []).filter(([key]) => footSlot(key) === undefined)
  const footed = FOOT_ORDER.flatMap((slot) => {
    if (slot === 'ctrl-c') return [['ctrl-c', 'quit'] as [string, string]]
    const found = from.find(([key]) => footSlot(key) === slot)
    return found ? [found] : []
  })
  // The spacer takes whatever height the screen has left, so the keys sit on
  // the window's last row on every screen, as home's do — when the boxes
  // above stretch to the frame (each screen's outer Box grows).
  return (
    <>
      <Box flexGrow={1} />
      <Box width={width} marginTop={aside ? 0 : 1} flexDirection="column" flexShrink={0}>
        {aside ? <AsideKeys pairs={aside} width={width} /> : null}
        <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
        <KeyRow main={main} foot={[...extra, ...footed]} width={width} lead={1} />
      </Box>
    </>
  )
}

/** Keys at the far end of the row above the rule, a cell short of it, capped as the key row caps them. */
function AsideKeys({ pairs, width }: { pairs: Array<[string, string]>; width: number }) {
  const palette = useTheme()
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const capped = palette.keycapBg !== '' && !noColour
  const cap = (key: string) => (capped ? ` ${key} ` : `[${key}]`)
  const used = pairs.reduce(
    (n, [key, word], i) => n + (i ? 2 : 0) + stringWidth(cap(key)) + 1 + stringWidth(word),
    0,
  )
  return (
    <Text wrap="truncate">
      {' '.repeat(Math.max(0, width - 1 - used))}
      {pairs.map(([key, word], i) => (
        <Text key={key}>
          {i ? '  ' : ''}
          <Text
            backgroundColor={capped ? colourProp(palette.keycapBg) : undefined}
            color={colourProp(palette.fg)}
            bold
          >
            {cap(key)}
          </Text>
          <Text color={colourProp(palette.dim)}>{` ${word}`}</Text>
        </Text>
      ))}
    </Text>
  )
}
