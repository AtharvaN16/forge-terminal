import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import {
  forceLibreOfficeForTests,
  probe as probeWordDocument,
  stopForcingLibreOfficeForTests,
  wordEngine,
} from '../../src/engines/word.js'
import { makeCorruptFile, makeDoc, makeDocx, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'

describe('wordEngine.run — npm fallback', () => {
  // Forced for every test in this file, so it always exercises the fallback
  // — never the real LibreOffice path, whatever this machine has installed.
  beforeEach(() => {
    forceLibreOfficeForTests(undefined)
  })
  afterEach(() => {
    stopForcingLibreOfficeForTests()
  })

  it('converts docx to pdf', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Hello from a docx.'])
    const source = await probeWordDocument(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings.map((w) => w.code)).toContain('word-basic-fidelity')
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from a docx.')
  })

  it('converts doc to pdf', async (ctx) => {
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy doc.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probeWordDocument(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from a legacy doc.')
  })

  it('converts pdf to docx', async () => {
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'report.pdf', ['Hello from a pdf.'])
    const source = await probe(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('Hello from a pdf.')
  })

  it("converts docx to docx (the CLI's own-format recompress path)", async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'a.docx', ['Round trip text.'])
    const source = await probeWordDocument(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('Round trip text.')
  })

  it('reports conversion-failed for a corrupt docx rather than a raw throw', async () => {
    const dir = await makeTempDir()
    const path = await makeCorruptFile(dir, 'bad.docx')
    const source = {
      kind: 'document' as const,
      path,
      format: 'docx' as const,
      bytes: 10,
      pages: 0,
      encrypted: false,
    }
    const output = join(dir, 'out.pdf')
    await expect(
      wordEngine.run(
        { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conversion-failed' })
  })
})
