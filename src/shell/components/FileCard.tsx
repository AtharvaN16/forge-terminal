import { Text } from 'ink'
import { FORMATS } from '../../core/formats.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { bandFor, middleEllipsis } from '../width.js'

/**
 * A compact summary of a dropped file: name, size, and — space permitting —
 * format and dimensions. Spec §13: below the compact band (<60 columns) the
 * format/dimensions are dropped rather than overflowing or wrapping.
 */
export function FileCard({ source, width }: { source: SourceInfo; width: number }) {
  const band = bandFor(width)
  const name = source.path.split('/').pop() ?? source.path
  const parts = [middleEllipsis(name, Math.max(12, width - 30)), formatBytes(source.bytes)]

  if (band !== 'compact') {
    parts.push(`${FORMATS[source.format].label} ${source.width}×${source.height}`)
  }

  return <Text>{parts.join(' · ')}</Text>
}
