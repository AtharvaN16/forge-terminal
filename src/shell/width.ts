export type WidthBand = 'compact' | 'normal' | 'wide'

/** Spec §13: <60 compact, 60-100 normal, >100 wide. */
export function bandFor(columns: number): WidthBand {
  if (columns < 60) return 'compact'
  if (columns <= 100) return 'normal'
  return 'wide'
}

/**
 * Truncates from the middle, because for a path both ends carry meaning —
 * the start says where it lives, the end says what it is.
 */
export function middleEllipsis(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max === 1) return '…'

  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return text.slice(0, head) + '…' + (tail > 0 ? text.slice(text.length - tail) : '')
}
