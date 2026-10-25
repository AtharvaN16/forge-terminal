import { describe, expect, it } from 'vitest'
import type { PageText } from '../../src/core/transcribe/page-text.js'
import { pagesPdf } from '../../src/engines/pages-pdf.js'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { candidates } from '../../src/engines/system-fonts.js'
import { fakeSystem } from '../helpers/fake-fonts.js'
import { content, fontNames, ink, words } from '../helpers/pdf-inspect.js'

const para = (...texts: string[]): PageText => [texts.map((text) => ({ kind: 'paragraph', text }))]
const WIN = 'C:\\Windows\\Fonts\\'
const windows = (files: Record<string, string>) =>
  fakeSystem({
    platform: 'win32',
    env: { WINDIR: 'C:\\Windows' },
    files: Object.fromEntries(Object.entries(files).map(([n, f]) => [WIN + n, f])),
  })

/** Whether anything is drawn in `region` of the first page (points from the top left). */
async function drawn(bytes: Uint8Array) {
  const box = await ink(bytes)
  return box.right > box.left && box.bottom > box.top
}

describe('where each OS keeps the fonts, and which are asked of it', () => {
  it('Windows: the fonts of its own folder for a language, best first, only those that are there', async () => {
    const win = windows({
      'simsun.ttc': 'cjk-glyf.ttf',
      'msyh.ttc': 'cjk-glyf.ttf',
      'unrelated.ttf': 'thai.ttf',
    })
    const found = await candidates({ script: 'han', lang: 'zh' }, win)
    expect(found.map((f) => f.path)).toEqual([`${WIN}msyh.ttc`, `${WIN}simsun.ttc`])
    expect(found.map((f) => f.index)).toEqual([0, 0])
  })

  it('Windows: a language takes its own fonts: kana the Japanese ones, Hangul the Korean', async () => {
    const win = windows({
      'YuGothR.ttc': 'cjk-glyf.ttf',
      'malgun.ttf': 'cjk-glyf.ttf',
      'msyh.ttc': 'cjk-glyf.ttf',
    })
    expect((await candidates({ script: 'kana' }, win)).map((f) => f.path)).toEqual([
      `${WIN}YuGothR.ttc`,
    ])
    expect((await candidates({ script: 'hangul' }, win)).map((f) => f.path)).toEqual([
      `${WIN}malgun.ttf`,
    ])
    expect((await candidates({ script: 'han', lang: 'ja' }, win)).map((f) => f.path)).toEqual([
      `${WIN}YuGothR.ttc`,
    ])
  })

  it("Windows: also looks in the user's own fonts folder", async () => {
    const user = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\Windows\\Fonts\\malgun.ttf'
    const win = fakeSystem({
      platform: 'win32',
      env: { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      files: { [user]: 'cjk-glyf.ttf' },
    })
    expect((await candidates({ script: 'hangul' }, win)).map((f) => f.path)).toEqual([user])
  })

  it("Linux: fontconfig's answer for the language, its fonts in the order it gave them, and the font of a collection", async () => {
    const noto = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
    const linux = fakeSystem({
      platform: 'linux',
      fc: { ':lang=ja': [`${noto}\t0`, '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf\t0'] },
    })
    const found = await candidates({ script: 'kana' }, linux)
    expect(found).toEqual([
      { path: noto, index: 0 },
      { path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', index: 0 },
    ])
    expect(linux.asked).toEqual([':lang=ja'])
  })

  it('Linux: Chinese is asked for as simplified, and the named instance a variable font packs in the index is dropped', async () => {
    const linux = fakeSystem({
      platform: 'linux',
      fc: { ':lang=zh-cn': ['/usr/share/fonts/NotoSansCJK-Regular.ttc\t2', '/x/Var.ttf\t65536'] },
    })
    const found = await candidates({ script: 'han', lang: 'zh' }, linux)
    expect(found.map((f) => f.index)).toEqual([2, 0])
  })

  it('Linux: asks fontconfig for a character when it is none of the languages (symbols)', async () => {
    const linux = fakeSystem({
      platform: 'linux',
      fc: { ':charset=2192': ['/usr/share/fonts/a.ttf\t0'] },
    })
    const found = await candidates({ script: 'symbols', codePoint: 0x2192 }, linux)
    expect(found.map((f) => f.path)).toEqual(['/usr/share/fonts/a.ttf'])
  })

  it('Linux without fontconfig: the well-known files, found under the usual folders', async () => {
    const path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
    const linux = fakeSystem({ platform: 'linux', noFc: true, files: { [path]: 'cjk-cff.otf' } })
    expect(await candidates({ script: 'kana' }, linux)).toEqual([{ path, index: 0 }])
    // Hangul is the third font of that collection.
    expect(await candidates({ script: 'hangul' }, linux)).toEqual([{ path, index: 1 }])
  })

  it("macOS: the system folders' fonts", async () => {
    const mac = fakeSystem({
      platform: 'darwin',
      files: {
        '/System/Library/Fonts/AppleSDGothicNeo.ttc': 'cjk-cff.otf',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf': 'cjk-glyf.ttf',
      },
    })
    expect((await candidates({ script: 'hangul' }, mac)).map((f) => f.path)).toEqual([
      '/System/Library/Fonts/AppleSDGothicNeo.ttc',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    ])
  })
})

describe("Chinese, Japanese and Korean in the computer's own font", () => {
  it('Windows, TrueType: Chinese is drawn in what the computer has, and reads back', async () => {
    const bytes = await pagesPdf(para('中文漢字'), {
      title: 'zh',
      fonts: windows({ 'msyh.ttc': 'cjk-glyf.ttf' }),
    })
    expect(words(await extractPdfText(bytes))).toBe('中文漢字')
    expect(await drawn(bytes)).toBe(true)
  })

  it('Linux, CFF (Noto Sans CJK): Japanese is drawn, and the PDF carries the glyphs, not the whole font', async () => {
    const noto = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
    const linux = fakeSystem({
      platform: 'linux',
      files: { [noto]: 'cjk-cff.otf' },
      fc: { ':lang=ja': [`${noto}\t0`] },
    })
    const bytes = await pagesPdf(para('日本語のテストです。'), { title: 'ja', fonts: linux })
    expect(words(await extractPdfText(bytes))).toBe('日本語のテストです。')
    expect(await drawn(bytes)).toBe(true)
    expect(bytes.length).toBeLessThan(40_000)
  })

  it('a collection: the font of the number fontconfig gave', async () => {
    const ttc = '/usr/share/fonts/wqy.ttc'
    // Font 0 of the collection is Hebrew, font 1 the CJK one.
    const linux = fakeSystem({
      platform: 'linux',
      files: { [ttc]: 'collection.ttc' },
      fc: { ':lang=zh-cn': [`${ttc}\t1`] },
    })
    const bytes = await pagesPdf(para('中文'), { title: 'zh', fonts: linux })
    expect(words(await extractPdfText(bytes))).toBe('中文')
    expect(await drawn(bytes)).toBe(true)
  })

  it('Korean from a font that has Hangul, when the Chinese one has none', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf', 'malgun.ttf': 'cjk-cff.otf' })
    const bytes = await pagesPdf(para('한국어 中文'), { title: 'ko', fonts: win })
    expect(words(await extractPdfText(bytes))).toBe('한국어 中文')
  })

  it('lines break anywhere in text with no spaces, and a closing 。 never starts a line', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf' })
    const long = '中文漢字'.repeat(25)
    const bytes = await pagesPdf(para(`${long}。`), { title: 'wrap', fonts: win })
    const box = await ink(bytes)
    expect(box.right).toBeLessThanOrEqual(595.28 - 71)
    const pageText = (await extractPdfText(bytes)).join('\n')
    expect(pageText.replace(/\s/g, '')).toBe(`${long}。`)
    for (const line of pageText.split(/\r?\n/)) expect(line.startsWith('。')).toBe(false)
  })

  it('a heading in a font with no bold is drawn filled and stroked', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf' })
    const bytes = await pagesPdf([[{ kind: 'heading', level: 1, text: '中文漢字' }]], {
      title: 'h',
      fonts: win,
    })
    const ops = await content(bytes)
    expect(ops).toContain('2 Tr')
    expect(ops).toContain('0 Tr')
  })

  it('a table of Chinese keeps every cell', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf' })
    const bytes = await pagesPdf(
      [
        [
          {
            kind: 'table',
            rows: [
              ['日本', '中文'],
              ['漢字', '字'],
            ],
          },
        ],
      ],
      { title: 't', fonts: win },
    )
    expect(words(await extractPdfText(bytes))).toBe('日本 中文 漢字 字')
  })
})

describe("which of the computer's fonts", () => {
  it('prefers an ordinary font to a variable one, whose default master is often the thinnest weight', async () => {
    const win = windows({ 'segoeui.ttf': 'hebrew-variable.ttf', 'arial.ttf': 'hebrew.ttf' })
    const bytes = await pagesPdf(para('שלום'), { title: 'he', fonts: win })
    const names = await fontNames(bytes)
    expect(names).toContain('arial')
    expect(names).not.toContain('segoeui')
  })

  it('takes the variable font all the same when it is the only one that has the letters', async () => {
    const bytes = await pagesPdf(para('שלום'), {
      title: 'he',
      fonts: windows({ 'segoeui.ttf': 'hebrew-variable.ttf' }),
    })
    expect(await fontNames(bytes)).toContain('segoeui')
    expect(await drawn(bytes)).toBe(true)
  })

  it('fills the rest of a line with Chinese that would fit a line of its own, rather than leaving a gap', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf' })
    const text = `English words that nearly fill the line of text here ${'中文漢字'.repeat(7)}`
    const bytes = await pagesPdf(para(text), { title: 'wrap', fonts: win })
    const first = (await extractPdfText(bytes)).join('').split(/\r?\n/)[0] ?? ''
    expect(first).toContain('here')
    expect(first).toContain('中')
  })

  it('keeps a run of Chinese on the line the words before it began', async () => {
    const win = windows({ 'msyh.ttc': 'cjk-glyf.ttf' })
    const bytes = await pagesPdf(para(`Hello world ${'中文漢字'.repeat(30)}`), {
      title: 'wrap',
      fonts: win,
    })
    const first = (await extractPdfText(bytes)).join('').split(/\r?\n/)[0] ?? ''
    expect(first).toContain('Hello world')
    expect(first).toContain('中')
  })
})

describe('right to left', () => {
  const win = windows({ 'segoeui.ttf': 'arabic.ttf', 'arial.ttf': 'hebrew.ttf' })

  it('Hebrew is drawn, from the font that has it, and right-aligned', async () => {
    const bytes = await pagesPdf(para('שלום עולם'), { title: 'he', fonts: win })
    const box = await ink(bytes)
    expect(box.right).toBeGreaterThan(595.28 - 72 - 4)
    expect(box.left).toBeGreaterThan(300)
    // The letters are all there; a PDF reader may give them in either order.
    const letters = [...words(await extractPdfText(bytes))]
      .filter((c) => c !== ' ')
      .sort()
      .join('')
    expect(letters).toBe([...'שלוםעולם'].sort().join(''))
  })

  it('a left-to-right paragraph with Hebrew in it stays on the left', async () => {
    const bytes = await pagesPdf(para('hello שלום world'), { title: 'mixed', fonts: win })
    const box = await ink(bytes)
    expect(box.left).toBeLessThan(76)
  })

  it('Arabic is joined: the letters go in as their joined forms, and copy out as the letters', async () => {
    const bytes = await pagesPdf(para('سلام'), { title: 'ar', fonts: win })
    const text = words(await extractPdfText(bytes))
    // Whatever order a reader gives, NFKC folds the forms back to the plain letters (lam-alef is two).
    expect([...text.normalize('NFKC')].sort().join('')).toBe([...'سلام'].sort().join(''))
    expect(await drawn(bytes)).toBe(true)
  })

  it('Arabic with no font that has the joined forms is still the letters, not boxes', async () => {
    // The Hebrew font has no Arabic; the Arabic fixture has the forms. Take them away: only letters of its own.
    const bytes = await pagesPdf(para('سلام'), {
      title: 'ar',
      fonts: windows({ 'segoeui.ttf': 'arabic.ttf' }),
    })
    expect((await extractPdfText(bytes)).join('')).not.toContain('\ufffd')
  })

  it('the bullet of a right-to-left list item is at the right', async () => {
    const bytes = await pagesPdf([[{ kind: 'list', ordered: false, items: ['שלום עולם'] }]], {
      title: 'l',
      fonts: win,
    })
    const box = await ink(bytes)
    expect(box.right).toBeGreaterThan(595.28 - 72 - 4)
    expect(box.left).toBeGreaterThan(300)
  })
})

describe('Thai, and what is not set', () => {
  it('Thai is drawn in the font the computer has', async () => {
    const bytes = await pagesPdf(para('สวัสดี'), {
      title: 'th',
      fonts: windows({ 'LeelawUI.ttf': 'thai.ttf' }),
    })
    expect(words(await extractPdfText(bytes))).toBe('สวัสดี')
  })

  it('Hindi is not set (its letters have to be rearranged): boxes, and it says so', async () => {
    let missing: string[] = []
    const bytes = await pagesPdf(para('नमस्ते'), {
      title: 'hi',
      fonts: windows({ 'Nirmala.ttf': 'thai.ttf', 'arial.ttf': 'hebrew.ttf' }),
      onMissing: (s) => {
        missing = s
      },
    })
    expect(missing).toEqual(['Devanagari'])
    const text = words(await extractPdfText(bytes))
    expect(text).toBe('\ufffd'.repeat([...'नमस्ते'].length))
    expect(text).not.toContain('?')
  })

  it('a computer with no font for Korean: boxes, and it says Korean', async () => {
    let missing: string[] = []
    const bytes = await pagesPdf(para('한국어'), {
      title: 'ko',
      fonts: fakeSystem({ platform: 'linux', noFc: true }),
      onMissing: (s) => {
        missing = s
      },
    })
    expect(missing).toEqual(['Korean'])
    expect(words(await extractPdfText(bytes))).toBe('\ufffd\ufffd\ufffd')
  })

  it('says nothing when everything was set', async () => {
    let called = false
    await pagesPdf(para('Plain text ñ Ж'), {
      title: 'ok',
      fonts: fakeSystem({ platform: 'linux', noFc: true }),
      onMissing: () => {
        called = true
      },
    })
    expect(called).toBe(false)
  })
})
