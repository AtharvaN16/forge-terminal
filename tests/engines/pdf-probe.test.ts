import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

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
})
