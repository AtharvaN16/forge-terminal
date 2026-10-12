import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { destinationOption } from '../../src/core/actions/destination.js'
import type { DocumentInfo } from '../../src/core/types.js'

const source: DocumentInfo = {
  kind: 'document',
  path: '/work/scans/doc.pdf',
  format: 'pdf',
  bytes: 1,
  pages: 1,
  encrypted: false,
}

describe('destinationOption', () => {
  it('opens on the configured default, listed first', () => {
    const spec = destinationOption(source, { ...DEFAULT_PREFERENCES, defaultOutput: '/work/out' })
    expect(spec.default).toBe('/work/out')
    expect(spec.presets[0]?.path).toBe('/work/out')
  })

  it('lists the source folder as Same folder, and the default once only', () => {
    const spec = destinationOption(source, {
      ...DEFAULT_PREFERENCES,
      defaultOutput: join(homedir(), 'Desktop'),
    })
    expect(spec.presets.map((p) => p.label)).toEqual(['Desktop', 'Same folder', 'Downloads'])
  })

  it('offers New subfolder only when asked (convert)', () => {
    const spec = destinationOption(source, DEFAULT_PREFERENCES, { subfolder: true })
    expect(spec.presets.at(-1)).toEqual({ label: 'New subfolder', path: '/work/scans/converted' })
  })
})
