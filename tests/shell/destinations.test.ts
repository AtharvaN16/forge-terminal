import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PathPreset } from '../../src/core/actions/index.js'
import { destinationRows, isPathQuery, NO_MATCH } from '../../src/shell/destinations.js'
import { makeTempDir } from '../helpers/fixtures.js'

const presets: PathPreset[] = [
  { label: 'Same folder', path: '/Users/me/Desktop' },
  { label: 'New subfolder', path: '/Users/me/Desktop/converted' },
  { label: 'Downloads', path: '/Users/me/Downloads' },
]
const preview = (p: string) => `${p}/photo.webp`

describe('destinationRows', () => {
  it('lists every place for empty text, tagging the default', () => {
    const rows = destinationRows('', presets, '/Users/me/Downloads', preview)
    expect(rows.map((r) => r.label)).toEqual(['Same folder', 'New subfolder', 'Downloads'])
    expect(rows[2]?.badge).toBe('default')
  })

  it('narrows the places by name', () => {
    expect(destinationRows('do', presets, '', preview).map((r) => r.label)).toEqual(['Downloads'])
  })

  it('treats ~ and / as a path, not a filter', () => {
    expect(destinationRows('~/out', presets, '', preview).map((r) => r.label)).toEqual([
      'Use this folder',
    ])
    expect(isPathQuery('~/out')).toBe(true)
    expect(isPathQuery('dow')).toBe(false)
  })

  it('saves next to a dropped file, unescaping what Finder pastes', async () => {
    const dir = join(await makeTempDir(), 'x y')
    await mkdir(dir)
    await writeFile(join(dir, 'a.png'), 'png')
    const [row] = destinationRows(join(dir, 'a.png').replace(/ /g, '\\ '), presets, '', preview)
    expect(row?.label).toBe('Next to a.png')
    expect(row?.value).toBe(dir)
  })

  it('says when nothing matches, as one row that cannot be chosen', () => {
    const rows = destinationRows('zzz', presets, '', preview)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe(NO_MATCH)
    expect(rows[0]?.disabled).toBe(true)
  })
})
