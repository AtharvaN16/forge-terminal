import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { BAR, colourProp } from '../theme.js'
import { middleEllipsis } from '../width.js'

interface ProgressProps {
  label: string
  done: number
  total: number
  detail?: string
  width: number
}

/**
 * A determinate bar.
 *
 * Determinate is honest here and nowhere else so far: the page total is known
 * before the first page renders. Invariant 7 forbids inventing progress, not
 * showing it — an operation whose length is unknown must report phases only
 * and must not mount this component.
 *
 * `BAR.filled` and `BAR.empty` are the same glyph, so the fill reads by
 * colour, not shape — like `Slider`. In a monochrome terminal the bar itself
 * conveys nothing, which is why the counter is plain text rather than part of
 * the bar: it carries the meaning the colour cannot.
 */
export function Progress({ label, done, total, detail, width }: ProgressProps) {
  const palette = useTheme()
  const counter = `page ${done} of ${total}`
  const track = Math.max(4, Math.min(24, width - counter.length - 6))
  const filled = total === 0 ? 0 : Math.round((done / total) * (track - 1))

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.label)}>{label}</Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'├'}</Text>
        <Text color={colourProp(palette.accent)}>{BAR.filled.repeat(filled)}</Text>
        <Text color={colourProp(palette.accent)}>{BAR.knob}</Text>
        <Text color={colourProp(palette.border)}>
          {BAR.empty.repeat(Math.max(0, track - 1 - filled))}
          {'┤'}
        </Text>
        <Text color={colourProp(palette.dim)}>{`  ${counter}`}</Text>
      </Text>
      {detail ? (
        <Text color={colourProp(palette.dim)}>{middleEllipsis(detail, width - 2)}</Text>
      ) : null}
    </Box>
  )
}
