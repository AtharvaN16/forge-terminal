/**
 * A PDF's own text, used to mend what OCR read off its drawn page (spec
 * 2026-10-23-extract-text-design §6). OCR keeps the layout — paragraphs,
 * lists, tables — and the text layer the spelling: PP-OCR breaks words at
 * ligatures ("waff e" for "waffle", "fl ight" for "flight"), which a PDF set
 * in a font with ligatures is full of. A run of up to three read pieces that
 * is one or two letters from a word of the page's own takes that word.
 * Nothing that is not on the page is ever written. Pure.
 */
import type { ReadBlock, ReadPage } from './page-text.js'

/** Levenshtein distance, stopping once it is over `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length] as number
}

/** The page's words, ligatures unfolded (NFKC: "ﬁ" is "fi"), punctuation kept off. */
export function layerWords(layer: string): Set<string> {
  const words = layer.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  return new Set(words)
}

/** The edits a word of `n` letters may be off by and still be that word. */
const allowed = (n: number) => (n >= 8 ? 2 : n >= 4 ? 1 : 0)

/** One line's words mended against the page's own: see the file's comment. */
export function mendLine(text: string, words: ReadonlySet<string>): string {
  if (words.size === 0) return text
  const tokens = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    let taken = 0
    let replacement = ''
    for (let span = 3; span >= 1 && taken === 0; span--) {
      if (i + span > tokens.length) continue
      const piece = tokens.slice(i, i + span)
      // Punctuation stays as it was read, around the word.
      const joined = piece.join('')
      const lead = /^[^\p{L}\p{N}]*/u.exec(joined)?.[0] ?? ''
      const trail = /[^\p{L}\p{N}]*$/u.exec(joined.slice(lead.length))?.[0] ?? ''
      const core = joined.slice(lead.length, joined.length - trail.length)
      if (core.length < 3) continue
      // A single piece that is already one of the page's words stands.
      if (span === 1 && words.has(core)) break
      let best: string | undefined
      let bestD = Infinity
      for (const w of words) {
        const d = distance(core, w, allowed(w.length))
        if (d <= allowed(w.length) && d < bestD) {
          best = w
          bestD = d
        }
      }
      // A run of pieces mends only when the pieces were not words of the page in their own right.
      if (best !== undefined && (span === 1 || !piece.every((p) => words.has(p)))) {
        taken = span
        replacement = lead + best + trail
      }
    }
    if (taken > 0) {
      out.push(replacement)
      i += taken
    } else {
      out.push(tokens[i] as string)
      i++
    }
  }
  return out.join(' ')
}

/** A page OCR read, its words mended against the PDF's own text for that page. */
export function mendPage(page: ReadPage, layer: string): ReadPage {
  const words = layerWords(layer)
  if (words.size === 0) return page
  const mend = (t: string) => mendLine(t, words)
  const blocks = page.blocks.map((b): ReadBlock => {
    if (b.kind === 'text') return { ...b, text: mend(b.text) }
    if (b.kind === 'list')
      return { ...b, items: b.items.map((it) => ({ ...it, text: mend(it.text) })) }
    return { ...b, rows: b.rows.map((r) => r.map(mend)) }
  })
  return { ...page, blocks }
}
