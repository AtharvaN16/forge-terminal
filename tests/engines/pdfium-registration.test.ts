import { describe, expect, it } from 'vitest'
import { targetIdsFor } from '../../src/core/capabilities.js'
import type { DocumentInfo } from '../../src/core/types.js'
import { ENGINES } from '../../src/engines/registry.js'

const doc: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.pdf',
  format: 'pdf',
  bytes: 1,
  pages: 3,
  encrypted: false,
}

describe('the pdfium engine', () => {
  it('is registered', () => {
    expect(ENGINES.map((e) => e.id)).toContain('pdfium')
  })

  it('declares what it reads and writes', () => {
    const engine = ENGINES.find((e) => e.id === 'pdfium')
    expect(engine?.reads.has('pdf')).toBe(true)
    expect(engine?.writes.has('jpeg')).toBe(true)
    expect(engine?.writes.has('png')).toBe(true)
  })

  it('makes a PDF convertible to images without any menu being edited', () => {
    // targetIdsFor unions across engines filtered by `reads`. Nothing in
    // capabilities.ts changes for this to work — that is invariant 2.
    const targets = targetIdsFor(doc)
    expect(targets).toContain('jpeg')
    expect(targets).toContain('png')
  })

  it('carries no AGPL dependency', async () => {
    // The reason this engine exists. A regression here is a licensing bug,
    // not a rendering one, and nothing else in the suite would catch it.
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    expect(Object.keys(pkg.default.dependencies)).not.toContain('mupdf')
  })
})
