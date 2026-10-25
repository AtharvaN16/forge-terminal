import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { probe as probeWord } from '../../src/engines/word.js'
import { makeDocx, makeTempDir } from '../helpers/fixtures.js'

/**
 * The PDF and Word engines read a whole file before deciding it is not
 * theirs. A 1.5 GB disk image nobody else recognises used to be read twice
 * end to end just to be refused; the first bytes say as much.
 */
const reads = vi.hoisted(() => [] as string[])
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: ((path: Parameters<typeof real.readFile>[0], ...rest: unknown[]) => {
      reads.push(String(path))
      return (real.readFile as (...a: unknown[]) => unknown)(path, ...rest)
    }) as typeof real.readFile,
  }
})

afterEach(() => {
  reads.length = 0
})

async function unknownFile(dir: string): Promise<string> {
  const path = join(dir, 'disk.dmg')
  // Not a picture, not media, not a PDF, not a zip or OLE file.
  await writeFile(path, Buffer.alloc(256 * 1024, 0x6b))
  return path
}

async function pdfWithJunk(dir: string, junk: number): Promise<string> {
  const doc = await PDFDocument.create()
  doc.addPage([100, 100])
  const path = join(dir, `junk-${junk}.pdf`)
  await writeFile(path, Buffer.concat([Buffer.alloc(junk, 0x41), await doc.save()]))
  return path
}

describe('probing a file no engine recognises', () => {
  it('never reads it whole', async () => {
    const path = await unknownFile(await makeTempDir())
    await expect(probe(path)).rejects.toThrow()
    expect(reads.filter((r) => r === path)).toEqual([])
  })

  it('the PDF engine refuses it from its first bytes', async () => {
    const path = await unknownFile(await makeTempDir())
    await expect(pdfEngine.probe(path)).rejects.toThrow()
    expect(reads).not.toContain(path)
  })

  it('the Word engine refuses it from its first bytes, as before', async () => {
    const path = await unknownFile(await makeTempDir())
    await expect(probeWord(path)).rejects.toThrow('is not a Word document')
    expect(reads).not.toContain(path)
  })
})

describe('the PDF header gate', () => {
  // pdfium finds "%PDF" at any offset up to 1024 and no further (measured
  // against @hyzyla/pdfium); the gate tolerates exactly the same junk.
  it('still reads a PDF whose header follows 1024 bytes of junk', async () => {
    const path = await pdfWithJunk(await makeTempDir(), 1024)
    const info = await probe(path)
    expect(info.format).toBe('pdf')
  })

  it('refuses one whose header starts past byte 1024 without reading it whole', async () => {
    const path = await pdfWithJunk(await makeTempDir(), 1025)
    await expect(pdfEngine.probe(path)).rejects.toThrow()
    expect(reads).not.toContain(path)
  })
})

describe('the Word gate', () => {
  it('still reads a docx', async () => {
    const path = await makeDocx(await makeTempDir(), 'a.docx', ['Hello.'])
    expect((await probeWord(path)).format).toBe('docx')
  })
})
