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

  it('lists the source folder as Same location, and the default once only', () => {
    const spec = destinationOption(source, {
      ...DEFAULT_PREFERENCES,
      defaultOutput: join(homedir(), 'Desktop'),
    })
    expect(spec.presets.map((p) => p.label)).toEqual(['Desktop', 'Same location', 'Downloads'])
  })

  it('a file on the Desktop: one row for it, Same location, where Desktop would be', () => {
    const onDesktop = { ...source, path: join(homedir(), 'Desktop', 'doc.pdf') }
    const spec = destinationOption(onDesktop, {
      ...DEFAULT_PREFERENCES,
      defaultOutput: '/work/out',
    })
    expect(spec.presets.map((p) => p.label)).toEqual(['out', 'Same location', 'Downloads'])
    expect(spec.presets[1]?.path).toBe(join(homedir(), 'Desktop'))
  })

  it('lists where the last file was saved after the default, and says which it is', () => {
    const spec = destinationOption(source, {
      ...DEFAULT_PREFERENCES,
      defaultOutput: '/work/out',
      lastOutput: '/work/projects',
    })
    expect(spec.presets.slice(0, 2)).toEqual([
      { label: 'out', path: '/work/out' },
      { label: 'projects', path: '/work/projects' },
    ])
    expect(spec.last).toBe('/work/projects')
  })

  it('names no last place when it is the default: the default row says enough', () => {
    const spec = destinationOption(source, {
      ...DEFAULT_PREFERENCES,
      defaultOutput: '/work/out',
      lastOutput: '/work/out',
    })
    expect(spec.last).toBeUndefined()
    expect(spec.presets.filter((p) => p.path === '/work/out')).toHaveLength(1)
  })

  it('offers New subfolder only when asked (convert)', () => {
    const spec = destinationOption(source, DEFAULT_PREFERENCES, { subfolder: true })
    expect(spec.presets.at(-1)).toEqual({
      label: 'New subfolder',
      path: join('/work/scans/converted'),
    })
  })
})
