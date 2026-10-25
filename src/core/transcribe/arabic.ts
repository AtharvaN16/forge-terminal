/**
 * Arabic's joining: a letter is written in one of four shapes (alone, ending a
 * word, starting one, or in the middle) by whether its neighbours reach out to
 * it. Unicode has the shapes as characters of their own (the Presentation
 * Forms, U+FB50 to U+FEFC), so a font that has them needs no shaping engine:
 * this turns the letters of a text into the forms they take. Their tables are
 * derived from the compatibility decompositions Unicode already gives each
 * form, not copied. Pure.
 */

/** A letter's four shapes: the character for each, or 0 where it has none. */
interface Forms {
  isolated: number
  final: number
  initial: number
  medial: number
}

const forms = new Map<string, Forms>()

/** The presentation forms of each letter (or letter pair, for lam-alef), found by what they decompose to. */
function derive(): void {
  const groups = new Map<string, number[]>()
  const ranges: Array<[number, number]> = [
    [0xfb50, 0xfbff],
    [0xfe80, 0xfefc],
  ]
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp++) {
      const base = String.fromCodePoint(cp).normalize('NFKD')
      if (base === String.fromCodePoint(cp)) continue
      const list = groups.get(base)
      if (list) list.push(cp)
      else groups.set(base, [cp])
    }
  }
  // Unicode lays each letter's forms out as isolated, final, initial, medial,
  // with the last two left out for a letter that does not join forwards.
  for (const [base, list] of groups) {
    if (list.length === 4)
      forms.set(base, {
        isolated: list[0] ?? 0,
        final: list[1] ?? 0,
        initial: list[2] ?? 0,
        medial: list[3] ?? 0,
      })
    else if (list.length === 2)
      forms.set(base, { isolated: list[0] ?? 0, final: list[1] ?? 0, initial: 0, medial: 0 })
  }
}
derive()

/** Marks that sit on a letter and do not interrupt its joining. */
const isTransparent = (cp: number) =>
  (cp >= 0x064b && cp <= 0x065f) ||
  cp === 0x0670 ||
  (cp >= 0x06d6 && cp <= 0x06dc) ||
  (cp >= 0x06df && cp <= 0x06e4) ||
  cp === 0x06e7 ||
  cp === 0x06e8 ||
  (cp >= 0x06ea && cp <= 0x06ed)

const LAM = 0x0644
/** The alefs a lam joins into one character with. */
const ALEFS = new Set([0x0622, 0x0623, 0x0625, 0x0627])

const isArabicLetter = (cp: number) => forms.has(String.fromCodePoint(cp))
/** Whether a letter reaches forward to the next one: it has an initial form. */
const joinsForward = (cp: number) => (forms.get(String.fromCodePoint(cp))?.initial ?? 0) !== 0

/** Whether the text has any Arabic letter that joins. */
export function hasArabic(text: string): boolean {
  for (const ch of text) if (isArabicLetter(ch.codePointAt(0) ?? 0)) return true
  return false
}

/**
 * The text with each Arabic letter replaced by the form it takes, and a lam
 * followed by an alef by their one ligature character. `has` says whether the
 * font can draw a form: a letter whose form it lacks stays as it was. A
 * zero-width non-joiner (U+200C) ends a join.
 */
export function joinArabic(text: string, has: (cp: number) => boolean = () => true): string {
  const cps = [...text].map((c) => c.codePointAt(0) ?? 0)
  const out: number[] = []
  // The letter before, as far as joining goes: whether it reaches forward.
  let prevReaches = false
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i] ?? 0
    if (cp === 0x200c || cp === 0x200d) {
      prevReaches = cp === 0x200d ? prevReaches : false
      out.push(cp)
      continue
    }
    if (isTransparent(cp)) {
      out.push(cp)
      continue
    }
    const f = forms.get(String.fromCodePoint(cp))
    if (!f) {
      prevReaches = false
      out.push(cp)
      continue
    }
    // Lam and alef: one character, drawn as the lam joined to what is before it.
    const nextCp = cps[i + 1] ?? 0
    if (cp === LAM && ALEFS.has(nextCp)) {
      const lig = forms.get(String.fromCodePoint(LAM, nextCp))
      const form = lig ? (prevReaches ? lig.final : lig.isolated) : 0
      if (form !== 0 && has(form)) {
        out.push(form)
        prevReaches = false
        i++
        continue
      }
    }
    // Whether a letter follows that this one can reach.
    let j = i + 1
    while (j < cps.length && isTransparent(cps[j] ?? 0)) j++
    const next = cps[j] ?? 0
    const nextJoins =
      joinsForward(cp) && next !== 0x200c && (isArabicLetter(next) || next === 0x200d)
    const form = prevReaches ? (nextJoins ? f.medial : f.final) : nextJoins ? f.initial : f.isolated
    out.push(form !== 0 && has(form) ? form : cp)
    prevReaches = joinsForward(cp)
  }
  return String.fromCodePoint(...out)
}

/** The letters a presentation form stands for, for text copied out of the PDF. */
export function baseOf(cp: number): string {
  return String.fromCodePoint(cp).normalize('NFKD')
}
