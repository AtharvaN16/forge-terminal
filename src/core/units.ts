const KB = 1000
const MB = KB * 1000
const GB = MB * 1000

/**
 * Renders a byte count the way the CLI shows it: "940 B", "820 KB", "4.2 MB".
 * One decimal below 100, none above, because "820.0 KB" reads as noise.
 */
export function formatBytes(bytes: number): string {
  const [value, unit] =
    bytes >= GB
      ? [bytes / GB, 'GB']
      : bytes >= MB
        ? [bytes / MB, 'MB']
        : bytes >= KB
          ? [bytes / KB, 'KB']
          : [bytes, 'B']

  if (unit === 'B') return `${Math.round(value)} B`
  const rendered =
    value >= 100 ? Math.round(value).toString() : (Math.round(value * 10) / 10).toString()
  return `${rendered} ${unit}`
}

export interface SizeChange {
  /** Absolute magnitude of the change, one decimal place. */
  pct: number
  direction: 'smaller' | 'larger' | 'same'
}

export function percentChange(from: number, to: number): SizeChange {
  if (from === to) return { pct: 0, direction: 'same' }
  if (from === 0) return { pct: 0, direction: 'larger' }
  const ratio = ((from - to) / from) * 100
  return {
    pct: Math.round(Math.abs(ratio) * 10) / 10,
    direction: ratio > 0 ? 'smaller' : 'larger',
  }
}
