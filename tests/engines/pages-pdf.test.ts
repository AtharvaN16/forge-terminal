import { describe, expect, it } from 'vitest'
import type { PageText } from '../../src/core/transcribe/page-text.js'
import { loadPdfLib } from '../../src/engines/libs.js'
import { type PdfOptions, pagesPdf as writePdf } from '../../src/engines/pages-pdf.js'
import { extractPdfText, openPdf } from '../../src/engines/pdfium.js'
import { noFonts } from '../helpers/fake-fonts.js'
import { content, ink, words } from '../helpers/pdf-inspect.js'

/** These tests are about Forge's own font: the computer's are not asked, so any machine says the same. */
const pagesPdf = (doc: PageText, opts: PdfOptions) => writePdf(doc, { fonts: noFonts, ...opts })

const A4 = [595.28, 841.89]

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await openPdf(bytes)
  try {
    return doc.getPageCount()
  } finally {
    doc.destroy()
  }
}

const sentence = 'The kettle was already boiling when the first guests arrived at the cottage.'

describe('pagesPdf', () => {
  it('writes one A4 page for a short page of text, which reads back', async () => {
    const doc: PageText = [
      [
        { kind: 'heading', level: 1, text: 'Tea talk' },
        { kind: 'paragraph', text: 'About tea.' },
      ],
    ]
    const bytes = await pagesPdf(doc, { title: 'Tea talk' })
    expect(Buffer.from(bytes).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const { PDFDocument } = await loadPdfLib()
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    const { width, height } = pdf.getPage(0).getSize()
    expect([width, height]).toEqual(A4)
    expect(words(await extractPdfText(bytes))).toBe('Tea talk About tea.')
    expect(pdf.getTitle()).toBe('Tea talk')
  })

  it('wraps a long paragraph inside the margins and runs on to more pages', async () => {
    const long = Array<string>(120).fill(sentence).join(' ')
    const bytes = await pagesPdf([[{ kind: 'paragraph', text: long }]], { title: 'Long' })
    expect(await pageCount(bytes)).toBeGreaterThan(1)
    expect(words(await extractPdfText(bytes))).toBe(long)
  })

  it("keeps Word's one-inch margins: ink stays 72 pt from every edge", async () => {
    const bytes = await pagesPdf(
      [[{ kind: 'paragraph', text: Array<string>(150).fill(sentence).join(' ') }]],
      { title: 'Margins' },
    )
    const box = await ink(bytes)
    expect(box.left).toBeGreaterThanOrEqual(71)
    expect(box.right).toBeLessThanOrEqual(595.28 - 71)
    expect(box.top).toBeGreaterThanOrEqual(71)
    // A full page runs down to the bottom margin.
    expect(box.bottom).toBeLessThanOrEqual(841.89 - 71)
    expect(box.bottom).toBeGreaterThan(841.89 - 100)
  })

  it('starts a new PDF page for each page of a read document, and skips an empty one', async () => {
    const doc: PageText = [
      [{ kind: 'paragraph', text: 'First page.' }],
      [],
      [{ kind: 'paragraph', text: 'Second page.' }],
      [{ kind: 'paragraph', text: 'Third page.' }],
    ]
    const bytes = await pagesPdf(doc, { title: 'Pages' })
    expect(await pageCount(bytes)).toBe(3)
    const pages = await extractPdfText(bytes)
    expect(pages.map((p) => p.trim())).toEqual(['First page.', 'Second page.', 'Third page.'])
  })

  it('sets headings larger than the body, in bold', async () => {
    const doc: PageText = [
      [
        { kind: 'heading', level: 1, text: 'Big' },
        { kind: 'heading', level: 2, text: 'Medium' },
        { kind: 'paragraph', text: 'Body' },
      ],
    ]
    const ops = await content(await pagesPdf(doc, { title: 'Sizes' }))
    // The title 20 pt and a heading 15 pt, both in Bold (F2); the body 11 pt in Regular (F1).
    expect(ops).toContain('/F2 20 Tf')
    expect(ops).toContain('/F2 15 Tf')
    expect(ops).toContain('/F1 11 Tf')
  })

  it('bullets and numbers its lists', async () => {
    const doc: PageText = [
      [
        { kind: 'list', ordered: false, items: ['apples', 'pears'] },
        { kind: 'list', ordered: true, items: ['wash', 'peel'] },
      ],
    ]
    const bytes = await pagesPdf(doc, { title: 'Lists' })
    expect(words(await extractPdfText(bytes))).toBe('• apples • pears 1. wash 2. peel')
  })

  it('wraps a list item under its own text, not under its bullet', async () => {
    const item = Array<string>(40).fill('steeping').join(' ')
    const ops = await content(
      await pagesPdf([[{ kind: 'list', ordered: false, items: [item] }]], { title: 'List' }),
    )
    const xs = [...ops.matchAll(/Tf ([\d.]+) [\d.]+ Td/g)].map((m) => Number(m[1]))
    // The bullet hangs left of the text (72 + 24); every line of the item starts there.
    expect(xs.filter((x) => x < 96)).toHaveLength(1)
    expect(xs.filter((x) => x === 96).length).toBeGreaterThanOrEqual(3)
  })

  describe('any language', () => {
    it('reads back Cyrillic, Greek and accented Latin as written', async () => {
      const lines = [
        'Привет, мир! Это проверка.',
        'Καλημέρα κόσμε, μια δοκιμή.',
        'Zażółć gęślą jaźń — Çağrı, Dvořák, Şişli, Ångström, façade.',
        'Tiếng Việt: Chào buổi sáng',
      ]
      const bytes = await pagesPdf(
        [[{ kind: 'heading', level: 1, text: 'Ünïcödé' }, ...lines.map(textPiece)]],
        { title: 'Languages' },
      )
      expect(words(await extractPdfText(bytes))).toBe(['Ünïcödé', ...lines].join(' '))
    })

    it('writes bold headings in the same alphabets', async () => {
      const bytes = await pagesPdf(
        [[{ kind: 'heading', level: 2, text: 'Заголовок Επικεφαλίδα' }]],
        { title: 'Bold' },
      )
      expect(words(await extractPdfText(bytes))).toBe('Заголовок Επικεφαλίδα')
    })

    it('draws a box, not a question mark, for what no font has, says which, and keeps going', async () => {
      // Forge's font covers Latin, Greek and Cyrillic; this computer gave no other.
      let missing: string[] = []
      const bytes = await pagesPdf([[textPiece('a 你好 b 🎉 c'), textPiece('Still here')]], {
        title: 'Missing',
        onMissing: (s) => {
          missing = s
        },
      })
      // Each missing character is Noto Sans's own .notdef box, which copies out as U+FFFD.
      expect(words(await extractPdfText(bytes))).toBe('a \ufffd\ufffd b \ufffd c Still here')
      expect(missing.sort()).toEqual(['Chinese', 'emoji'])
    })

    it('drops marks that take no room and folds odd spaces', async () => {
      const bytes = await pagesPdf([[textPiece('zero​width thin nbsp\ttab')]], { title: 'Spaces' })
      expect(words(await extractPdfText(bytes))).toBe('zerowidth thin nbsp tab')
    })

    it('sets a letter and its separate accent as the one letter', async () => {
      const bytes = await pagesPdf([[textPiece('Café')]], { title: 'NFC' })
      expect(words(await extractPdfText(bytes))).toBe('Café')
    })
  })

  describe('a table', () => {
    const table: PageText = [
      [
        { kind: 'paragraph', text: 'Prices' },
        {
          kind: 'table',
          rows: [
            ['Item', 'Price'],
            ['Tea', '3.50'],
            ['Скидка', '10%'],
          ],
        },
        { kind: 'paragraph', text: 'After the table.' },
      ],
    ]

    it('keeps every cell, in order', async () => {
      const bytes = await pagesPdf(table, { title: 'Prices' })
      expect(words(await extractPdfText(bytes))).toBe(
        'Prices Item Price Tea 3.50 Скидка 10% After the table.',
      )
    })

    it('rules every cell', async () => {
      const ops = await content(await pagesPdf(table, { title: 'Prices' }))
      // Three rows of two cells, each outlined in the rule grey.
      expect(ops.match(/ re S/g)).toHaveLength(6)
      expect(ops).toContain('0.78 G')
      // And the header row's cells filled.
      expect(ops.match(/ re f/g)).toHaveLength(2)
    })

    it('puts the table inside the margins even when its cells are wide', async () => {
      const wide = Array<string>(30).fill('cinnamon').join(' ')
      const bytes = await pagesPdf(
        [
          [
            {
              kind: 'table',
              rows: [
                ['A', wide, 'C'],
                ['d', 'e', 'f'],
              ],
            },
          ],
        ],
        { title: 'Wide' },
      )
      const box = await ink(bytes)
      expect(box.left).toBeGreaterThanOrEqual(71)
      expect(box.right).toBeLessThanOrEqual(595.28 - 71)
      expect(words(await extractPdfText(bytes))).toContain('cinnamon')
    })

    it('carries a table taller than a page over, repeating its header row', async () => {
      const rows = [
        ['Name', 'Number'],
        ...Array.from({ length: 120 }, (_, i) => [`row${i}`, `${i}`]),
      ]
      const bytes = await pagesPdf([[{ kind: 'table', rows }]], { title: 'Tall' })
      const pages = await extractPdfText(bytes)
      expect(pages.length).toBeGreaterThan(1)
      for (const page of pages) expect(page).toContain('Name')
      const all = words(pages)
      expect(all).toContain('row0 0')
      expect(all).toContain('row119 119')
    })

    it('splits one row that is taller than a page, losing nothing', async () => {
      const huge = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ')
      const bytes = await pagesPdf(
        [
          [
            {
              kind: 'table',
              rows: [
                ['H1', 'H2'],
                ['x', huge],
              ],
            },
          ],
        ],
        {
          title: 'Huge',
        },
      )
      expect(await pageCount(bytes)).toBeGreaterThan(1)
      const all = words(await extractPdfText(bytes))
      for (const w of ['w0', 'w1499', 'w2999']) expect(all).toContain(w)
    })
  })

  it('breaks a word longer than a line (a web address) rather than running off the page', async () => {
    const url = `https://example.com/${'a'.repeat(200)}`
    const bytes = await pagesPdf([[{ kind: 'paragraph', text: url }]], { title: 'URL' })
    expect(words(await extractPdfText(bytes)).replace(/ /g, '')).toBe(url)
  })

  it('does not leave a heading alone at the foot of a page', async () => {
    // 27 one-line paragraphs leave room for the heading but not for a line after it.
    const filler = Array.from({ length: 27 }, () => ({
      kind: 'paragraph' as const,
      text: 'x',
    }))
    const bytes = await pagesPdf(
      [[...filler, { kind: 'heading', level: 2, text: 'Orphan' }, textPiece('Follows it.')]],
      { title: 'Orphan' },
    )
    const pages = await extractPdfText(bytes)
    expect(pages.length).toBe(2)
    expect(pages[0]).not.toContain('Orphan')
    expect(pages[1]).toContain('Orphan')
  })

  it('still writes a valid one-page file for a document with no text', async () => {
    const bytes = await pagesPdf([], { title: 'Empty' })
    expect(await pageCount(bytes)).toBe(1)
  })

  it('stays small: the font is cut down to the letters used', async () => {
    const bytes = await pagesPdf(
      [[{ kind: 'heading', level: 1, text: 'Tea' }, textPiece('About tea.')]],
      { title: 'Small' },
    )
    expect(bytes.length).toBeLessThan(20_000)
  })
})

function textPiece(text: string) {
  return { kind: 'paragraph' as const, text }
}
