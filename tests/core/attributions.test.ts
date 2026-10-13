import { describe, expect, it } from 'vitest'
import { attributions, parseLicences } from '../../src/core/attributions.js'

const RULE = '-'.repeat(72)
const FILE = [
  'Forge bundles the following packages.',
  '',
  'ink@7.1.1 — MIT',
  '',
  'MIT License',
  '',
  'Copyright (c) Vadym Demedes',
  '',
  RULE,
  '',
  'jszip@3.10.1 — (MIT OR GPL-3.0-or-later)',
  '',
  'text',
  '',
  RULE,
  '',
  '@xmldom/xmldom@0.8.15 — MIT',
  '',
  'text',
  '',
].join('\n')

describe('parseLicences', () => {
  it('reads each package’s name and licence from the build’s licence file', () => {
    expect(parseLicences(FILE)).toEqual([
      { name: 'ink', licence: 'MIT' },
      { name: 'jszip', licence: 'MIT OR GPL-3.0-or-later' },
      { name: '@xmldom/xmldom', licence: 'MIT' },
    ])
  })

  it('reads nothing from an empty or missing file', () => {
    expect(parseLicences('')).toEqual([])
  })
})

describe('attributions', () => {
  const bundled = parseLicences(FILE)

  it('lists App, then Extensions, then Others', () => {
    const sections = attributions({
      bundled,
      extensions: [{ name: 'ONNX Runtime', licence: 'MIT' }],
    })
    expect(sections.map((s) => s.title)).toEqual(['App', 'Extensions', 'Others'])
  })

  it('says what each of the app’s main parts does', () => {
    const app = attributions({ bundled, extensions: [] })[0]
    const sharp = app?.credits.find((c) => c.name.startsWith('sharp'))
    expect(sharp).toEqual({
      name: 'sharp · libvips',
      licence: 'Apache-2.0 · LGPL-3.0',
      does: 'images',
    })
  })

  it('leaves out Extensions when none is installed', () => {
    expect(attributions({ bundled, extensions: [] }).map((s) => s.title)).toEqual(['App', 'Others'])
  })

  it('lists a package named under App only once', () => {
    const others = attributions({ bundled, extensions: [] }).find((s) => s.title === 'Others')
    expect(others?.credits.map((c) => c.name)).not.toContain('ink')
    expect(others?.credits.map((c) => c.name)).toContain('jszip')
  })

  it('sorts Others A–Z, scope ignored, and keeps the native packages Forge installs beside its bundle', () => {
    const others = attributions({ bundled, extensions: [] }).find((s) => s.title === 'Others')
    const names = others?.credits.map((c) => c.name) ?? []
    expect(names).toContain('@hyzyla/pdfium')
    const bare = names.map((n) => n.replace(/^@/, ''))
    expect(bare).toEqual([...bare].sort((a, b) => a.localeCompare(b)))
  })
})
