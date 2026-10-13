import { mix, motionEnabled, useTicker } from '../motion.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** One pass of the light band takes this long. */
const PASS_MS = 1500
const TICK_MS = 66

/**
 * Text with a band of light moving along it — the sign that work is really
 * running right now (a measurement, an encode). Mount it only while that is
 * true: it is never decoration. With motion off it is the plain text.
 */
export function Shimmer({
  text,
  base,
  highlight,
}: {
  text: string
  base: string
  highlight: string
}) {
  const palette = useTheme()
  const on = motionEnabled(palette.name)
  const n = useTicker(on, TICK_MS)
  if (!on) return <Text color={colourProp(base)}>{text}</Text>

  const chars = [...text]
  const steps = Math.round(PASS_MS / TICK_MS)
  // The band starts a few cells before the text and ends a few after, so it
  // enters and leaves rather than appearing on the first letter.
  const at = ((n % steps) / steps) * (chars.length + 10) - 5
  return (
    <Text>
      {chars.map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the characters never reorder
        <Text key={i} color={colourProp(mix(base, highlight, 1 - Math.abs(i - at) / 3.2))}>
          {ch}
        </Text>
      ))}
    </Text>
  )
}
