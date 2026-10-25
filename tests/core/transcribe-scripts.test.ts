import { describe, expect, it } from 'vitest'
import { baseOf, hasArabic, joinArabic } from '../../src/core/transcribe/arabic.js'
import { hasRtl, isRtl, visualOrder } from '../../src/core/transcribe/bidi.js'
import {
  eastAsianLanguage,
  SET_HERE,
  scriptLabel,
  scriptOf,
  scriptsIn,
} from '../../src/core/transcribe/scripts.js'

const cps = (s: string) => [...s].map((c) => (c.codePointAt(0) ?? 0).toString(16).toUpperCase())

describe('scriptOf', () => {
  it('names the writing system of a character, and none for what is common to all', () => {
    expect(scriptOf('a'.codePointAt(0) ?? 0)).toBe('latin')
    expect(scriptOf('é'.codePointAt(0) ?? 0)).toBe('latin')
    expect(scriptOf('Ж'.codePointAt(0) ?? 0)).toBe('cyrillic')
    expect(scriptOf('λ'.codePointAt(0) ?? 0)).toBe('greek')
    expect(scriptOf('日'.codePointAt(0) ?? 0)).toBe('han')
    expect(scriptOf('あ'.codePointAt(0) ?? 0)).toBe('kana')
    expect(scriptOf('ア'.codePointAt(0) ?? 0)).toBe('kana')
    expect(scriptOf('한'.codePointAt(0) ?? 0)).toBe('hangul')
    expect(scriptOf('ب'.codePointAt(0) ?? 0)).toBe('arabic')
    expect(scriptOf(0xfe91)).toBe('arabic')
    expect(scriptOf('ש'.codePointAt(0) ?? 0)).toBe('hebrew')
    expect(scriptOf('ก'.codePointAt(0) ?? 0)).toBe('thai')
    expect(scriptOf('क'.codePointAt(0) ?? 0)).toBe('devanagari')
    expect(scriptOf('😀'.codePointAt(0) ?? 0)).toBe('emoji')
    expect(scriptOf('。'.codePointAt(0) ?? 0)).toBe('han')
    for (const c of [' ', '5', '.', ',', '-', '—', '€'])
      expect(scriptOf(c.codePointAt(0) ?? 0), c).toBeUndefined()
  })

  it('lists the scripts of a text in the order they first appear', () => {
    expect(scriptsIn('Hello мир 日本語 !')).toEqual(['latin', 'cyrillic', 'han'])
  })

  it('says which scripts this writer sets itself: not the ones that rearrange (Indic)', () => {
    for (const s of ['latin', 'han', 'kana', 'hangul', 'arabic', 'hebrew', 'thai'] as const)
      expect(SET_HERE.has(s), s).toBe(true)
    for (const s of ['devanagari', 'bengali', 'tamil', 'khmer', 'myanmar'] as const)
      expect(SET_HERE.has(s), s).toBe(false)
    expect(scriptLabel('devanagari')).toBe('Devanagari')
  })
})

describe('eastAsianLanguage', () => {
  it('reads kana as Japanese, Hangul as Korean, and Han alone as Chinese', () => {
    expect(eastAsianLanguage('日本語のテスト')).toBe('ja')
    expect(eastAsianLanguage('한국어 漢字')).toBe('ko')
    expect(eastAsianLanguage('中文测试')).toBe('zh')
  })

  it('takes the language the speech was in, when it is known', () => {
    expect(eastAsianLanguage('漢字', 'ja_JP')).toBe('ja')
    expect(eastAsianLanguage('漢字', 'zh-TW')).toBe('zh-TW')
    expect(eastAsianLanguage('漢字', 'zh_CN')).toBe('zh')
    expect(eastAsianLanguage('漢字', 'ko')).toBe('ko')
  })
})

describe('joinArabic', () => {
  it('writes a word in its joined forms: initial, medial and final', () => {
    // beh beh beh: initial, medial, final.
    expect(cps(joinArabic('ببب'))).toEqual(['FE91', 'FE92', 'FE90'])
  })

  it('writes a letter that joins nothing in its isolated form', () => {
    expect(cps(joinArabic('ا'))).toEqual(['FE8D'])
    expect(cps(joinArabic('د'))).toEqual(['FEA9'])
  })

  it('does not join forward from a letter that only joins back (alef, dal, waw), so the next one starts again', () => {
    // dal then beh: dal isolated, beh isolated.
    expect(cps(joinArabic('دب'))).toEqual(['FEA9', 'FE8F'])
  })

  it('joins lam and alef into the one ligature character', () => {
    // lam alef: the isolated ligature; after a beh the final one.
    expect(cps(joinArabic('لا'))).toEqual(['FEFB'])
    expect(cps(joinArabic('بلا'))).toEqual(['FE91', 'FEFC'])
  })

  it('reads "salam" as sin, the lam-alef ligature, then an isolated meem', () => {
    expect(cps(joinArabic('سلام'))).toEqual(['FEB3', 'FEFC', 'FEE1'])
  })

  it('leaves a mark on a letter without breaking the join', () => {
    // beh, fatha, beh: the fatha does not interrupt.
    expect(cps(joinArabic('بَب'))).toEqual(['FE91', '64E', 'FE90'])
  })

  it('ends a join at a zero-width non-joiner (Persian) and passes other text through', () => {
    expect(cps(joinArabic('ب‌ب'))).toEqual(['FE8F', '200C', 'FE8F'])
    expect(joinArabic('abc 123')).toBe('abc 123')
    expect(cps(joinArabic('ب ب'))).toEqual(['FE8F', '20', 'FE8F'])
  })

  it('keeps the letters of a form the font cannot draw', () => {
    expect(joinArabic('ببب', () => false)).toBe('ببب')
  })

  it('knows the base letters of a form, for text copied out of the PDF', () => {
    expect(baseOf(0xfeb3)).toBe('س')
    expect(baseOf(0xfefc)).toBe('لا')
    expect(hasArabic('abc')).toBe(false)
    expect(hasArabic('a ب')).toBe(true)
  })
})

describe('bidi', () => {
  it('leaves left-to-right text as it is', () => {
    expect(visualOrder('hello world', false)).toBe('hello world')
  })

  it('reverses a run of Hebrew', () => {
    expect(visualOrder('שלום', true)).toBe('םולש')
  })

  it('reverses a Hebrew run inside a left-to-right line', () => {
    expect(visualOrder('hello שלום world', false)).toBe('hello םולש world')
  })

  it('keeps a number in order inside right-to-left text, and puts it on the left', () => {
    expect(visualOrder('שלום 123', true)).toBe('123 םולש')
  })

  it('mirrors brackets inside right-to-left text', () => {
    expect(visualOrder('(שלום)', true)).toBe('(םולש)')
  })

  it('puts the words of a right-to-left sentence in right-to-left order', () => {
    // two words: the second is drawn to the left of the first
    expect(visualOrder('שלום עולם', true)).toBe('םלוע םולש')
  })

  it('orders Arabic the same way, and a Latin word inside it', () => {
    expect(visualOrder('مرحبا abc', true)).toBe('abc ابحرم')
  })

  it("reads a paragraph's direction from its first strong letter", () => {
    expect(isRtl('hello שלום')).toBe(false)
    expect(isRtl('שלום hello')).toBe(true)
    expect(isRtl('123 שלום')).toBe(true)
    expect(isRtl('123')).toBe(false)
    expect(hasRtl('a שלום')).toBe(true)
    expect(hasRtl('abc')).toBe(false)
  })
})

describe('langRuns (what Word is told about each run)', () => {
  it('leaves Latin text as the one plain run it was', async () => {
    const { langRuns } = await import('../../src/core/transcribe/scripts.js')
    expect(langRuns('Hello, world 123.')).toEqual([
      { text: 'Hello, world 123.', kind: 'latin', rtl: false },
    ])
  })

  it('marks East Asian text with its language, and keeps the spaces and digits beside it', async () => {
    const { langRuns } = await import('../../src/core/transcribe/scripts.js')
    expect(langRuns('Hello 日本語です 2026')).toEqual([
      { text: 'Hello ', kind: 'latin', rtl: false },
      { text: '日本語です 2026', kind: 'eastAsia', rtl: false, lang: 'ja-JP' },
    ])
    expect(langRuns('你好')[0]).toMatchObject({ kind: 'eastAsia', lang: 'zh-CN' })
    expect(langRuns('안녕')[0]).toMatchObject({ kind: 'eastAsia', lang: 'ko-KR' })
    expect(langRuns('漢字', 'zh_TW')[0]).toMatchObject({ lang: 'zh-TW' })
  })

  it('marks Arabic and Hebrew complex and right to left, and Thai and Hindi complex only', async () => {
    const { langRuns } = await import('../../src/core/transcribe/scripts.js')
    expect(langRuns('مرحبا')[0]).toMatchObject({ kind: 'complex', rtl: true, lang: 'ar-SA' })
    expect(langRuns('שלום')[0]).toMatchObject({ kind: 'complex', rtl: true, lang: 'he-IL' })
    expect(langRuns('สวัสดี')[0]).toMatchObject({ kind: 'complex', rtl: false, lang: 'th-TH' })
    expect(langRuns('नमस्ते')[0]).toMatchObject({ kind: 'complex', rtl: false, lang: 'hi-IN' })
  })

  it('starts a new run where the writing system changes', async () => {
    const { langRuns } = await import('../../src/core/transcribe/scripts.js')
    expect(langRuns('a שלום b').map((r) => [r.text, r.kind])).toEqual([
      ['a ', 'latin'],
      ['שלום ', 'complex'],
      ['b', 'latin'],
    ])
  })
})
