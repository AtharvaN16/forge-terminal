import { invalidPageRange } from './errors.js'

/** A span of pages, 0-based and inclusive at both ends. */
export interface PageRange {
  from: number
  to: number
}

/**
 * Parse a user-typed page selection into 0-based page indices.
 *
 * The grammar is comma-separated terms, each `N`, `N-M`, or `N-` meaning "to
 * the end". Input is 1-based because that is what page numbers are to
 * everyone who is not a programmer; the output is 0-based because that is
 * what pdf-lib wants. That conversion happens here and nowhere else.
 *
 * Out-of-range pages are an error rather than a silent clamp: someone who
 * types `1-100` on a 10-page document has misunderstood something, and
 * quietly giving them 10 pages hides it.
 */
export function parseRanges(input: string, pageCount: number): number[] {
  const terms = input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')

  if (terms.length === 0) {
    throw invalidPageRange(input, 'That selects no pages.', pageCount)
  }

  const pages = new Set<number>()
  const inBounds = (n: number, term: string) => {
    if (!Number.isInteger(n) || n < 1 || n > pageCount) {
      throw invalidPageRange(term, `"${term}" is outside 1 and ${pageCount}.`, pageCount)
    }
    return n
  }

  for (const term of terms) {
    const span = term.match(/^(\d+)\s*-\s*(\d*)$/)
    if (span?.[1] !== undefined) {
      const from = inBounds(Number(span[1]), term)
      const to = span[2] === '' ? pageCount : inBounds(Number(span[2]), term)
      if (to < from) {
        throw invalidPageRange(term, `"${term}" ends before it starts.`, pageCount)
      }
      for (let p = from; p <= to; p++) pages.add(p - 1)
      continue
    }

    if (!/^\d+$/.test(term)) {
      throw invalidPageRange(term, `"${term}" is not a page number.`, pageCount)
    }
    pages.add(inBounds(Number(term), term) - 1)
  }

  return [...pages].sort((a, b) => a - b)
}

/** The inverse of `parseRanges`, for showing a selection back to the user. */
export function formatRanges(pages: number[]): string {
  if (pages.length === 0) return ''
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []

  let start = sorted[0] as number
  let prev = start
  for (const page of sorted.slice(1)) {
    if (page === prev + 1) {
      prev = page
      continue
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
    start = page
    prev = page
  }
  parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
  return parts.join(', ')
}

/**
 * Cut points and contiguous ranges are the same data seen two ways, which is
 * what lets the grid and the typed range editor edit one selection.
 *
 * `cuts` holds the 0-based index of each page *after which* the document is
 * cut. The result always partitions the document: every page lands in exactly
 * one range, which is what makes split a partition rather than a selection.
 */
export function cutsToRanges(cuts: number[], pageCount: number): PageRange[] {
  const sorted = [...new Set(cuts)].sort((a, b) => a - b).filter((c) => c >= 0 && c < pageCount - 1)
  const ranges: PageRange[] = []
  let from = 0
  for (const cut of sorted) {
    ranges.push({ from, to: cut })
    from = cut + 1
  }
  ranges.push({ from, to: pageCount - 1 })
  return ranges
}

/** The cut points implied by a list of contiguous ranges. */
export function rangesToCuts(ranges: PageRange[]): number[] {
  return ranges.slice(0, -1).map((r) => r.to)
}
