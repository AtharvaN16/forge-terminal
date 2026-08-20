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

  // The track needs at least 4 columns to show real movement — fewer than
  // that and the knob barely shifts, so the bar would read as decoration
  // claiming a precision it doesn't have. `width - counter.length - 6` is
  // the track this width affords, with 2 columns of margin against the
  // frame edge. When that budget doesn't reach 4, there is no room left for
  // an honest bar next to this counter at this width. The counter is what
  // carries the meaning in a monochrome terminal (see the doc comment
  // above), so it is the bar that gives way, not the count: `showBar` false
  // falls back to the counter alone rather than forcing a floor that would
  // push the line past `width`.
  const trackBudget = width - counter.length - 6
  const showBar = trackBudget >= 4
  const track = Math.min(24, trackBudget)
  const rawFilled = total === 0 ? 0 : Math.round((done / total) * (track - 1))
  // Clamped the way Slider.tsx:69-70 clamps its own `filled`: `done` can
  // arrive greater than `total` — a stale event, an off-by-one upstream —
  // and an unclamped `filled` would repeat past the track with nothing to
  // catch it, overflowing the line well past `width`.
  const filled = Math.max(0, Math.min(track - 1, rawFilled))

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.label)}>{label}</Text>
      {showBar ? (
        <Text>
          <Text color={colourProp(palette.border)}>{'├'}</Text>
          <Text color={colourProp(palette.accent)}>{BAR.filled.repeat(filled)}</Text>
          <Text bold color={colourProp(palette.accent)}>
            {BAR.knob}
          </Text>
          <Text color={colourProp(palette.border)}>
            {BAR.empty.repeat(Math.max(0, track - 1 - filled))}
            {'┤'}
          </Text>
          {/* Two spaces (Slider uses one): this follows the '┤' border glyph
          rather than the bar fill itself, and reads better with a clearer
          gap between the frame and the counter. */}
          <Text color={colourProp(palette.dim)}>{`  ${counter}`}</Text>
        </Text>
      ) : (
        <Text color={colourProp(palette.dim)}>{counter}</Text>
      )}
      {detail ? (
        <Text color={colourProp(palette.dim)}>{middleEllipsis(detail, width - 2)}</Text>
      ) : null}
    </Box>
  )
}
