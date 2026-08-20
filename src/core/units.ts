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

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
}

/**
 * Reads a size the way a person writes one: `500kb`, `2 MB`, `1.5mb`.
 *
 * Powers of 1024 rather than 1000, because the number this is compared
 * against is `stat().size` and every other size Forge prints comes from
 * `formatBytes`, which is also binary. Mixing the two would make a file
 * "1 MB" in one line and over the limit in the next.
 *
 * Returns undefined rather than throwing or guessing: the caller is a text
 * field that has to tell the user their input was not understood, and
 * `undefined` is the only answer that cannot be mistaken for a size.
 */
export function parseSize(input: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(input)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined

  const unit = SIZE_UNITS[(match[2] ?? 'b').toLowerCase()]
  if (unit === undefined) return undefined

  return Math.round(amount * unit)
}
