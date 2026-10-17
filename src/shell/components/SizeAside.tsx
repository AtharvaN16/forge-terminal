import { formatBytes } from '../../core/units.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import type { MeasuredSize } from '../useMeasuredSize.js'
import { Shimmer } from './Shimmer.js'

/**
 * The longest sentence this says ("1023.9 KB  about the same") is 25
 * columns. With less room it would wrap, so it is not said at all.
 */
const NEEDS = 25
/** "1023.9 KB  cannot compress more", for `/compress`. */
const NEEDS_REFUSAL = 31

/**
 * What the highlighted format says about itself: its measured size and how
 * that compares with the file as it is now — "74.6 KB  39% smaller". Every
 * number here came from an encode that actually ran.
 */
export function SizeAside({
  size,
  sourceBytes,
  budget,
  noBigger = false,
}: {
  size: MeasuredSize
  sourceBytes: number
  budget: number
  /**
   * `/compress`, which never writes a file that is not smaller (E3): such a
   * size says "cannot compress more" instead of how much larger it is.
   */
  noBigger?: boolean
}) {
  const palette = useTheme()
  if (size.status === 'idle' || budget < (noBigger ? NEEDS_REFUSAL : NEEDS)) return null
  if (size.status === 'measuring') {
    return <Shimmer text="measuring…" base={palette.dim} highlight={palette.fg} />
  }

  const ratio = sourceBytes > 0 ? size.bytes / sourceBytes : 1
  const pct = Math.round(Math.abs(1 - ratio) * 100)
  const [phrase, colour] =
    noBigger && size.bytes >= sourceBytes
      ? ['cannot compress more', palette.larger]
      : pct === 0
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
