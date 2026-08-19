import stringWidth from 'string-width'

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
 *
 * Works in terminal *columns*, not UTF-16 code units: a code unit count
 * both splits surrogate pairs (turning an emoji into a stray low surrogate
 * that renders as a replacement glyph) and undercounts wide glyphs like CJK
 * ideographs (each occupies two columns), which would let the result
 * overflow the terminal width this function exists to bound. So it walks
 * whole code points and budgets by `stringWidth`, never slicing mid-pair.
 */
export function middleEllipsis(text: string, max: number): string {
  if (max <= 0) return ''
  if (stringWidth(text) <= max) return text
  if (max === 1) return '…'

  const codePoints = Array.from(text)
  const budget = max - 1 // one column reserved for the ellipsis itself
  const headBudget = Math.ceil(budget / 2)
  const tailBudget = budget - headBudget

  let head = ''
  let headWidth = 0
  let i = 0
  while (i < codePoints.length) {
    const cp = codePoints[i]
    if (cp === undefined) break
    const w = stringWidth(cp)
    if (headWidth + w > headBudget) break
    head += cp
    headWidth += w
    i++
  }

  let tail = ''
  let tailWidth = 0
  let j = codePoints.length - 1
  while (j >= i) {
    const cp = codePoints[j]
    if (cp === undefined) break
    const w = stringWidth(cp)
    if (tailWidth + w > tailBudget) break
    tail = cp + tail
    tailWidth += w
    j--
  }

  return `${head}…${tail}`
}
