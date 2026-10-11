import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { displayPath } from '../../utils/display-path.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_MARKERS, modeColours, type ShellMode } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'

/**
 * Whether the shell is "working": anything other than an empty idle prompt
 * (or the first-run theme picker). The full logo belongs to the empty
 * prompt; once there is work on screen, `HeaderBar` takes over from it.
 */
export function isWorking(step: string, staged: number): boolean {
  if (step === 'theme') return false
  return !(step === 'idle' && staged === 0)
}

/**
 * One row, the width of the terminal, on the mode's own fill: the product
 * and mode on the left, the folder the next file will be saved to on the
 * right. It replaces the `current mode:` bar once the user is working
 * (spec 2026-10-11 §4). The mode name is always paired with its marker, so
 * the bar still says where you are under NO_COLOR.
 */
export function HeaderBar({
  mode,
  detail,
  defaultOutput,
  width,
}: {
  mode: ShellMode
  /** A staged file's name, shown after the mode while waiting at the prompt. */
  detail?: string | undefined
  defaultOutput: string
  width: number
}) {
  const palette = useTheme()
  const { fg, bg } = modeColours(palette, mode)
  const marker = MODE_MARKERS[mode]

  if (bandFor(width) === 'compact') {
    const text = ` ${marker} ${mode}`
    return (
      <Box width={width} backgroundColor={colourProp(bg)}>
        <Text color={colourProp(fg)} bold>
          {text}
        </Text>
        <Text>{' '.repeat(Math.max(0, width - stringWidth(text)))}</Text>
      </Box>
    )
  }

  const brand = ` ${marker} FORGE `
  const middle = `  ${mode}${detail ? ` · ${detail}` : ''}`
  const room = width - stringWidth(brand) - stringWidth(middle) - 3
  const right = middleEllipsis(displayPath(defaultOutput), Math.max(4, room))
  const gap = Math.max(1, width - stringWidth(brand) - stringWidth(middle) - stringWidth(right) - 1)
  return (
    <Box width={width} backgroundColor={colourProp(bg)}>
      <Text color={colourProp(fg)} bold>
        {brand}
      </Text>
      <Text color={colourProp(palette.dim)}>{middle}</Text>
      <Text>{' '.repeat(gap)}</Text>
      <Text color={colourProp(palette.dim)}>{right}</Text>
      <Text> </Text>
    </Box>
  )
}
