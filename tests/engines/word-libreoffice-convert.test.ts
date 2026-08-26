import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFParse } from 'pdf-parse'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import {
  libreOfficeAvailable,
  probe as probeWordDocument,
  wordEngine,
} from '../../src/engines/word.js'
import {
  makeCorruptFile,
  makeDoc,
  makeDocx,
  makeTempDir,
  makeTextPdf,
} from '../helpers/fixtures.js'

async function requireLibreOffice(ctx: { skip: (reason: string) => void }) {
  const soffice = await libreOfficeAvailable()
  if (soffice === undefined) {
    ctx.skip('LibreOffice unavailable on this machine')
    return undefined
  }
  return soffice
}

describe('wordEngine.run — LibreOffice path', () => {
  it('converts docx to pdf with no basic-fidelity warning', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Hello from LibreOffice.'])
    const source = await probeWordDocument(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'pdf',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from LibreOffice.')
  }, 30_000)

  it('converts doc to pdf', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy doc, via LibreOffice.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probeWordDocument(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'pdf',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  }, 30_000)

  it('converts pdf to docx', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'report.pdf', ['Hello from a pdf, via LibreOffice.'])
    const source = await probe(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'docx',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  }, 30_000)

  it('reports conversion-failed for a corrupt docx rather than silently degrading', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
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
        {
          op: 'convert',
          sources: [source],
          outputs: [output],
          target: 'pdf',
          options: { background: '#ffffff', keepMetadata: false },
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conversion-failed' })
  }, 125_000)
})
