import { Text } from 'ink'
import { formatBytes } from '../../core/units.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import type { MeasuredSize } from '../useMeasuredSize.js'
import { Shimmer } from './Shimmer.js'

/** Below this the sentence would be cut mid-number, so it is not said at all. */
const NEEDS = 22

/**
 * What the highlighted format says about itself: its measured size and how
 * that compares with the file as it is now — "74.6 KB  39% smaller". Every
 * number here came from an encode that actually ran.
 */
export function SizeAside({
  size,
  sourceBytes,
  budget,
}: {
  size: MeasuredSize
  sourceBytes: number
  budget: number
}) {
  const palette = useTheme()
  if (size.status === 'idle' || budget < NEEDS) return null
  if (size.status === 'measuring') {
    return <Shimmer text="measuring…" base={palette.dim} highlight={palette.fg} />
  }

  const ratio = sourceBytes > 0 ? size.bytes / sourceBytes : 1
  const pct = Math.round(Math.abs(1 - ratio) * 100)
  const [phrase, colour] =
    pct === 0
      ? ['about the same', palette.dim]
      : ratio < 1
        ? [`${pct}% smaller`, palette.ok]
        : [`${pct}% larger`, palette.larger]
  return (
    <Text>
      <Text bold color={colourProp(palette.fg)}>
        {formatBytes(size.bytes)}
      </Text>
      <Text color={colourProp(colour)}>{`  ${phrase}`}</Text>
    </Text>
  )
}
