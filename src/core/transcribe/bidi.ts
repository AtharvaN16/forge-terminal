/**
 * Right-to-left text on a left-to-right page: which way a paragraph runs, and
 * a line's characters in the order they are drawn, left to right. A trimmed
 * form of the Unicode bidirectional algorithm (UAX #9): runs of Hebrew and
 * Arabic are reversed, numbers inside them keep their order, and neutrals
 * (spaces, punctuation) go with the text around them. It leaves out explicit
 * embeddings and isolates, which transcripts do not have. Pure.
 */

type Type = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'NSM' | 'WS' | 'ON'

const MARKS = /\p{M}/u
const LETTER = /\p{L}/u
const DIGIT = /\p{Nd}/u

function typeOf(cp: number): Type {
  const ch = String.fromCodePoint(cp)
  if (MARKS.test(ch)) return 'NSM'
  if (cp >= 0x0660 && cp <= 0x0669) return 'AN'
  if (cp === 0x066b || cp === 0x066c) return 'AN'
  if (DIGIT.test(ch)) return 'EN'
  const hebrew = (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f)
  if (hebrew) return LETTER.test(ch) ? 'R' : 'ON'
  const arabic =
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0700 && cp <= 0x07bf) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  if (arabic) return LETTER.test(ch) ? 'AL' : 'ON'
  if (LETTER.test(ch)) return 'L'
  if (cp === 0x2b || cp === 0x2d) return 'ES'
  if (cp === 0x23 || cp === 0x24 || cp === 0x25 || cp === 0xa2 || cp === 0xa3 || cp === 0xb0)
    return 'ET'
  if (cp === 0x2c || cp === 0x2e || cp === 0x3a || cp === 0x2f || cp === 0xa0) return 'CS'
  if (ch === ' ' || ch === '\t' || cp === 0x3000) return 'WS'
  return 'ON'
}

const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
}

/** Whether a paragraph runs right to left: its first strong letter is Hebrew or Arabic. */
export function isRtl(text: string): boolean {
  for (const ch of text) {
    const t = typeOf(ch.codePointAt(0) ?? 0)
    if (t === 'R' || t === 'AL') return true
    if (t === 'L') return false
  }
  return false
}

/** Whether a text has any right-to-left letter in it. */
export function hasRtl(text: string): boolean {
  for (const ch of text) {
    const t = typeOf(ch.codePointAt(0) ?? 0)
    if (t === 'R' || t === 'AL' || t === 'AN') return true
  }
  return false
}

/**
 * A line in the order its characters are drawn, left to right. `rtl` is the
 * paragraph's direction (`isRtl` of the whole paragraph, so each of its lines
 * agrees). Brackets inside right-to-left text are mirrored.
 */
export function visualOrder(line: string, rtl: boolean): string {
  const chars = [...line]
  if (!rtl && !hasRtl(line)) return line
  const n = chars.length
  const types = chars.map((c) => typeOf(c.codePointAt(0) ?? 0))
  const base = rtl ? 1 : 0

  // W1: a mark takes the type of what it sits on. W2: a number after an Arabic letter is an Arabic number.
  let prevStrong: Type = base ? 'R' : 'L'
  for (let i = 0; i < n; i++) {
    if (types[i] === 'NSM') types[i] = i > 0 ? (types[i - 1] ?? 'ON') : base ? 'R' : 'L'
    const t = types[i] as Type
    if (t === 'L' || t === 'R' || t === 'AL') prevStrong = t
    else if (t === 'EN' && prevStrong === 'AL') types[i] = 'AN'
  }
  // W3: Arabic letters are right-to-left letters. W4: one separator between two numbers of a kind joins them.
  for (let i = 0; i < n; i++) if (types[i] === 'AL') types[i] = 'R'
  for (let i = 1; i < n - 1; i++) {
    const t = types[i]
    const a = types[i - 1]
    const b = types[i + 1]
    if ((t === 'ES' || t === 'CS') && a === 'EN' && b === 'EN') types[i] = 'EN'
    else if (t === 'CS' && a === 'AN' && b === 'AN') types[i] = 'AN'
  }
  // W5: terminators beside a European number belong to it. W6: other separators are neutral.
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'ET') continue
    let j = i
    while (j < n && types[j] === 'ET') j++
    if (types[i - 1] === 'EN' || types[j] === 'EN') for (let k = i; k < j; k++) types[k] = 'EN'
    i = j - 1
  }
  for (let i = 0; i < n; i++)
    if (types[i] === 'ES' || types[i] === 'ET' || types[i] === 'CS') types[i] = 'ON'
  // W7: a European number after left-to-right text is left-to-right text.
  let last: Type = base ? 'R' : 'L'
  for (let i = 0; i < n; i++) {
    if (types[i] === 'L' || types[i] === 'R') last = types[i] as Type
    else if (types[i] === 'EN' && last === 'L') types[i] = 'L'
  }
  // N1, N2: a run of neutrals between two of one direction takes it (numbers count as right-to-left); else the paragraph's.
  const strong = (t: Type | undefined): 'L' | 'R' | undefined =>
    t === 'L' ? 'L' : t === 'R' || t === 'EN' || t === 'AN' ? 'R' : undefined
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'WS' && types[i] !== 'ON') continue
    let j = i
    while (j < n && (types[j] === 'WS' || types[j] === 'ON')) j++
    const before = i > 0 ? strong(types[i - 1]) : base ? 'R' : 'L'
    const after = j < n ? strong(types[j]) : base ? 'R' : 'L'
    const dir = before !== undefined && before === after ? before : base ? 'R' : 'L'
    for (let k = i; k < j; k++) types[k] = dir
    i = j - 1
  }
  // I1, I2: the level of each character.
  const levels = types.map((t) => {
    if (base === 0) return t === 'R' ? 1 : t === 'EN' || t === 'AN' ? 2 : 0
    return t === 'L' || t === 'EN' || t === 'AN' ? 2 : 1
  })
  // L2: from the deepest level up to the lowest odd one, reverse each run at or above it.
  const order = chars.map((_, i) => i)
  const max = Math.max(...levels)
  const minOdd = Math.min(...levels.filter((l) => l % 2 === 1), Number.POSITIVE_INFINITY)
  for (let level = max; level >= minOdd && level > 0; level--) {
    for (let i = 0; i < n; i++) {
      if ((levels[order[i] as number] ?? 0) < level) continue
      let j = i
      while (j < n && (levels[order[j] as number] ?? 0) >= level) j++
      const seg = order.slice(i, j).reverse()
      order.splice(i, j - i, ...seg)
      i = j - 1
    }
  }
  return order
    .map((i) => {
      const c = chars[i] as string
      return (levels[i] ?? 0) % 2 === 1 ? (MIRROR[c] ?? c) : c
    })
    .join('')
}
