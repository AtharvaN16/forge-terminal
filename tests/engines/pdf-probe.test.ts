import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { probe } from '../../src/engines/registry.js'
import { makeCorruptPdf, makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

describe('probing a PDF', () => {
  it('reports it as a document with a page count', async () => {
    const dir = await makeTempDir()
    const path = await makePdf(dir, 'doc.pdf', 24)
    const info = await probe(path)
    expect(info.kind).toBe('document')
    expect(info.format).toBe('pdf')
    if (info.kind !== 'document') throw new Error('expected a document')
    expect(info.pages).toBe(24)
    expect(info.encrypted).toBe(false)
    expect(info.bytes).toBeGreaterThan(0)
  })

  it('recognises it by content, not by extension', async () => {
    const dir = await makeTempDir()
    const path = await makePdf(dir, 'doc.pdf', 3)
    const lying = join(dir, 'doc.txt')
    await rename(path, lying)
    const info = await probe(lying)
    expect(info.kind).toBe('document')
    expect(info.format).toBe('pdf')
  })

  it('still probes images as images', async () => {
    const dir = await makeTempDir()
    const path = await makeJpeg(dir, 'a.jpg')
    const info = await probe(path)
    expect(info.kind).toBe('image')
    expect(info.format).toBe('jpeg')
  })

  /**
   * A corrupt PDF fails to decode in *every* registered engine: Sharp
   * doesn't read PDFs as an image at all, and pdf-lib's parser throws on the
   * garbage body. `probe()` tries `imageEngine` first, so without care the
   * error that reaches the user would be `imageEngine`'s own — worded for
   * images specifically ("Damaged image" / "could not be read as an
   * image"), which is wrong and misleading for a document that was never an
   * image to begin with. At probe time no engine has actually identified a
   * format, so the message must not claim one.
   */
  it('reports a corrupt PDF without claiming it is an image', async () => {
    const dir = await makeTempDir()
    const path = await makeCorruptPdf(dir, 'bad.pdf')
    let error: unknown
    try {
      await probe(path)
    } catch (e) {
      error = e
    }
    if (!isForgeError(error)) throw new Error('expected a ForgeError')
    const message = `${error.title} ${error.detail}`.toLowerCase()
    expect(message).not.toContain('image')
  })
})
