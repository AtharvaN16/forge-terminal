import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/word.js'
import {
  makeCorruptFile,
  makeDoc,
  makeDocx,
  makeNonDocxZip,
  makeTempDir,
  makeZipWithCorruptCentralDirectory,
} from '../helpers/fixtures.js'

describe('word engine probing', () => {
  it('identifies a docx by its content, not its extension', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['First paragraph.', 'Second paragraph.'])
    const source = await probe(path)
    expect(source.kind).toBe('document')
    expect(source.format).toBe('docx')
  })

  it('reads the cached page count out of docProps/app.xml when present', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['One page of text.'])
    const source = await probe(path)
    expect(source.pages).toBeGreaterThanOrEqual(1)
  })

  it('rejects a zip that looks like OOXML but is not a Word document', async () => {
    const dir = await makeTempDir()
    const path = await makeNonDocxZip(dir, 'spreadsheet.docx')
    await expect(probe(path)).rejects.toThrow()
  })

  it('rejects plain garbage', async () => {
    const dir = await makeTempDir()
    const path = await makeCorruptFile(dir, 'garbage.docx')
    await expect(probe(path)).rejects.toThrow()
  })

  it('rejects a zip whose central directory is corrupt, rather than throwing an internal adm-zip error', async () => {
    // Construction alone (`new AdmZip()`) succeeds here — only the fixed-size
    // End Of Central Directory record is read at that point. `adm-zip`
    // defers parsing the entries themselves to the first `getEntry()` call,
    // so a try/catch around construction alone would miss this and let an
    // internal adm-zip error escape `probe()` instead of falling through to
    // "not a Word document".
    const dir = await makeTempDir()
    const path = await makeZipWithCorruptCentralDirectory(dir, 'corrupt.docx')
    await expect(probe(path)).rejects.toThrow('is not a Word document')
  })

  it('identifies a legacy .doc by its OLE content, reporting an unknown (0) page count', async (ctx) => {
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy Word file.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probe(path)
    expect(source.kind).toBe('document')
    expect(source.format).toBe('doc')
    expect(source.pages).toBe(0)
    expect(source.encrypted).toBe(false)
  })

  it('never trusts the extension — a .doc renamed to .docx is still probed as doc', async (ctx) => {
    const dir = await makeTempDir()
    const realDoc = await makeDoc(dir, 'legacy.doc', 'Some legacy content.')
    if (realDoc === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const misnamed = join(dir, 'renamed.docx')
    await copyFile(realDoc, misnamed)
    const source = await probe(misnamed)
    expect(source.format).toBe('doc')
  })
})
