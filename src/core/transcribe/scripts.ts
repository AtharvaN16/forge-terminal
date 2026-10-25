/**
 * Which writing system a character belongs to, for choosing a font for it (a
 * PDF has none of its own that reach past Western Europe) and a language
 * hint for it (Word picks the right Chinese or Japanese forms of a Han
 * character from the run's language). Pure data and functions.
 */

export type Script =
  | 'latin'
  | 'greek'
  | 'cyrillic'
  | 'han'
  | 'kana'
  | 'hangul'
  | 'arabic'
  | 'hebrew'
  | 'thai'
  | 'lao'
  | 'armenian'
  | 'georgian'
  | 'devanagari'
  | 'bengali'
  | 'gurmukhi'
  | 'gujarati'
  | 'oriya'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam'
  | 'sinhala'
  | 'tibetan'
  | 'myanmar'
  | 'khmer'
  | 'ethiopic'
  | 'mongolian'
  | 'syriac'
  | 'thaana'
  | 'emoji'
  | 'symbols'

const RANGES: ReadonlyArray<readonly [number, number, Script]> = [
  [0x0041, 0x005a, 'latin'],
  [0x0061, 0x007a, 'latin'],
  [0x00aa, 0x00aa, 'latin'],
  [0x00ba, 0x00ba, 'latin'],
  [0x00c0, 0x024f, 'latin'],
  [0x1e00, 0x1eff, 'latin'],
  [0x2c60, 0x2c7f, 'latin'],
  [0xa720, 0xa7ff, 'latin'],
  [0xff21, 0xff3a, 'latin'],
  [0xff41, 0xff5a, 'latin'],
  [0x0370, 0x03ff, 'greek'],
  [0x1f00, 0x1fff, 'greek'],
  [0x0400, 0x052f, 'cyrillic'],
  [0x1c80, 0x1c8f, 'cyrillic'],
  [0x2de0, 0x2dff, 'cyrillic'],
  [0xa640, 0xa69f, 'cyrillic'],
  [0x0530, 0x058f, 'armenian'],
  [0x0590, 0x05ff, 'hebrew'],
  [0xfb1d, 0xfb4f, 'hebrew'],
  [0x0600, 0x06ff, 'arabic'],
  [0x0750, 0x077f, 'arabic'],
  [0x08a0, 0x08ff, 'arabic'],
  [0xfb50, 0xfdff, 'arabic'],
  [0xfe70, 0xfeff, 'arabic'],
  [0x0700, 0x074f, 'syriac'],
  [0x0780, 0x07bf, 'thaana'],
  [0x0900, 0x097f, 'devanagari'],
  [0x0980, 0x09ff, 'bengali'],
  [0x0a00, 0x0a7f, 'gurmukhi'],
  [0x0a80, 0x0aff, 'gujarati'],
  [0x0b00, 0x0b7f, 'oriya'],
  [0x0b80, 0x0bff, 'tamil'],
  [0x0c00, 0x0c7f, 'telugu'],
  [0x0c80, 0x0cff, 'kannada'],
  [0x0d00, 0x0d7f, 'malayalam'],
  [0x0d80, 0x0dff, 'sinhala'],
  [0x0e00, 0x0e7f, 'thai'],
  [0x0e80, 0x0eff, 'lao'],
  [0x0f00, 0x0fff, 'tibetan'],
  [0x1000, 0x109f, 'myanmar'],
  [0x10a0, 0x10ff, 'georgian'],
  [0x1100, 0x11ff, 'hangul'],
  [0x1200, 0x139f, 'ethiopic'],
  [0x1780, 0x17ff, 'khmer'],
  [0x1800, 0x18af, 'mongolian'],
  [0x3040, 0x309f, 'kana'],
  [0x30a0, 0x30ff, 'kana'],
  [0x31f0, 0x31ff, 'kana'],
  [0xff66, 0xff9f, 'kana'],
  [0x1b000, 0x1b16f, 'kana'],
  [0x3130, 0x318f, 'hangul'],
  [0xa960, 0xa97f, 'hangul'],
  [0xac00, 0xd7ff, 'hangul'],
  [0xffa0, 0xffdc, 'hangul'],
  // Han: the ideographs, their marks and brackets, Bopomofo, and the full-width forms.
  [0x2e80, 0x2fdf, 'han'],
  [0x3000, 0x303f, 'han'],
  [0x3100, 0x312f, 'han'],
  [0x31a0, 0x31bf, 'han'],
  [0x3200, 0x33ff, 'han'],
  [0x3400, 0x4dbf, 'han'],
  [0x4e00, 0x9fff, 'han'],
  [0xf900, 0xfaff, 'han'],
  [0xfe30, 0xfe4f, 'han'],
  [0xff01, 0xff20, 'han'],
  [0xff5b, 0xff65, 'han'],
  [0xffe0, 0xffe6, 'han'],
  [0x20000, 0x323af, 'han'],
  [0x1f300, 0x1faff, 'emoji'],
  [0x2600, 0x27bf, 'symbols'],
]

/**
 * The script of a character, or undefined when it belongs to none in
 * particular (spaces, digits, punctuation, most symbols): those go in the
 * font of the text beside them.
 */
export function scriptOf(cp: number): Script | undefined {
  // Plain ASCII and Latin-1 letters are nearly all of any transcript.
  if (cp < 0x80)
    return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? 'latin' : undefined
  for (const [from, to, script] of RANGES) if (cp >= from && cp <= to) return script
  return undefined
}

/** Scripts a PDF here sets without help from a shaping engine. */
export const SET_PLAIN: ReadonlySet<Script> = new Set<Script>([
  'latin',
  'greek',
  'cyrillic',
  'han',
  'kana',
  'hangul',
  'armenian',
  'georgian',
  'ethiopic',
  'emoji',
  'symbols',
])

/**
 * Scripts whose letters change shape or move by their neighbours, and which
 * Forge sets itself: Arabic joins (`arabic.ts`) and, with Hebrew, runs right
 * to left (`bidi.ts`). Thai and Lao are set letter by letter, with their marks
 * where the font draws them rather than where its positioning tables put them.
 */
export const SET_HERE: ReadonlySet<Script> = new Set<Script>([
  ...SET_PLAIN,
  'arabic',
  'hebrew',
  'thai',
  'lao',
])

const LABEL: Record<Script, string> = {
  latin: 'Latin',
  greek: 'Greek',
  cyrillic: 'Cyrillic',
  han: 'Chinese',
  kana: 'Japanese',
  hangul: 'Korean',
  arabic: 'Arabic',
  hebrew: 'Hebrew',
  thai: 'Thai',
  lao: 'Lao',
  armenian: 'Armenian',
  georgian: 'Georgian',
  devanagari: 'Devanagari',
  bengali: 'Bengali',
  gurmukhi: 'Gurmukhi',
  gujarati: 'Gujarati',
  oriya: 'Odia',
  tamil: 'Tamil',
  telugu: 'Telugu',
  kannada: 'Kannada',
  malayalam: 'Malayalam',
  sinhala: 'Sinhala',
  tibetan: 'Tibetan',
  myanmar: 'Burmese',
  khmer: 'Khmer',
  ethiopic: 'Ethiopic',
  mongolian: 'Mongolian',
  syriac: 'Syriac',
  thaana: 'Thaana',
  emoji: 'emoji',
  symbols: 'symbols',
}

/** A script's name, as a sentence would say it. */
export function scriptLabel(script: Script): string {
  return LABEL[script]
}

/** The scripts in a text, in the order they first appear. */
export function scriptsIn(text: string): Script[] {
  const seen = new Set<Script>()
  for (const ch of text) {
    const s = scriptOf(ch.codePointAt(0) ?? 0)
    if (s !== undefined) seen.add(s)
  }
  return [...seen]
}

/**
 * Which East Asian language a text's Han characters are in: Japanese when
 * kana are mixed in, Korean when Hangul is, else Chinese. The same character
 * is drawn a little differently in each, and a font or Word asked for the
 * wrong one draws it in the wrong forms. `hint` is the language the speech
 * was in, when known (`ja`, `ko`, `zh-TW`...), and settles it first.
 */
export function eastAsianLanguage(text: string, hint?: string): 'ja' | 'ko' | 'zh' | 'zh-TW' {
  const h = hint?.toLowerCase().replace('_', '-')
  if (h?.startsWith('ja')) return 'ja'
  if (h?.startsWith('ko')) return 'ko'
  if (h === 'zh-tw' || h === 'zh-hant' || h === 'zh-hk') return 'zh-TW'
  if (h?.startsWith('zh')) return 'zh'
  const scripts = scriptsIn(text)
  if (scripts.includes('kana')) return 'ja'
  if (scripts.includes('hangul')) return 'ko'
  return 'zh'
}

/** How a run of text is marked for Word: which of a run's three font slots it uses, and its language. */
export interface LangRun {
  text: string
  /** `eastAsia`: Chinese, Japanese, Korean; `complex`: Arabic, Hebrew, Thai, Indic and the like; else `latin`. */
  kind: 'latin' | 'eastAsia' | 'complex'
  /** Runs right to left. */
  rtl: boolean
  /** An RFC 1766 language (`ja-JP`) for an `eastAsia` or `complex` run, where one can be told. */
  lang?: string
}

const EAST_ASIAN = { ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', 'zh-TW': 'zh-TW' } as const

/** The language of a complex-script run, where its script has only one in common use. */
const COMPLEX_LANG: Partial<Record<Script, string>> = {
  arabic: 'ar-SA',
  hebrew: 'he-IL',
  thai: 'th-TH',
  lao: 'lo-LA',
  devanagari: 'hi-IN',
  bengali: 'bn-IN',
  gurmukhi: 'pa-IN',
  gujarati: 'gu-IN',
  oriya: 'or-IN',
  tamil: 'ta-IN',
  telugu: 'te-IN',
  kannada: 'kn-IN',
  malayalam: 'ml-IN',
  sinhala: 'si-LK',
  khmer: 'km-KH',
  myanmar: 'my-MM',
  tibetan: 'bo-CN',
  armenian: 'hy-AM',
  georgian: 'ka-GE',
  ethiopic: 'am-ET',
  syriac: 'syr-SY',
  thaana: 'dv-MV',
}

/** Scripts Word keeps in the ordinary font slot: no shaping, no direction of their own. */
const ORDINARY: ReadonlySet<Script> = new Set<Script>([
  'latin',
  'greek',
  'cyrillic',
  'armenian',
  'georgian',
  'ethiopic',
  'mongolian',
  'emoji',
  'symbols',
])

function kindOf(script: Script | undefined): LangRun['kind'] | 'neutral' {
  if (script === undefined) return 'neutral'
  if (script === 'han' || script === 'kana' || script === 'hangul') return 'eastAsia'
  return ORDINARY.has(script) ? 'latin' : 'complex'
}

const RTL_SCRIPTS: ReadonlySet<Script> = new Set<Script>(['arabic', 'hebrew', 'syriac', 'thaana'])

/**
 * A text cut into runs by writing system, for Word. Word picks a font and a
 * direction by what a run is marked as (an East Asian run, a complex-script
 * run, a right-to-left one) and draws a Han character in the forms of the
 * run's language; text left unmarked can come out as boxes or the wrong way
 * round. Spaces, digits and punctuation go with the run before them. `hint`
 * is the language the speech was in, when known.
 */
export function langRuns(text: string, hint?: string): LangRun[] {
  const asia = EAST_ASIAN[eastAsianLanguage(text, hint)]
  const out: LangRun[] = []
  let pending = ''
  for (const ch of text) {
    const script = scriptOf(ch.codePointAt(0) ?? 0)
    const kind = kindOf(script)
    if (kind === 'neutral') {
      const last = out.at(-1)
      if (last) last.text += ch
      else pending += ch
      continue
    }
    const rtl = script !== undefined && RTL_SCRIPTS.has(script)
    const lang =
      kind === 'eastAsia' ? asia : kind === 'complex' && script ? COMPLEX_LANG[script] : undefined
    const last = out.at(-1)
    if (last && last.kind === kind && last.rtl === rtl && last.lang === lang) last.text += ch
    else out.push({ text: pending + ch, kind, rtl, ...(lang ? { lang } : {}) })
    pending = ''
  }
  if (pending) out.push({ text: pending, kind: 'latin', rtl: false })
  return out
}
