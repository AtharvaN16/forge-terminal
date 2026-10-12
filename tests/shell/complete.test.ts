import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { completePath } from '../../src/shell/complete.js'
import { unescapePath } from '../../src/utils/unescape-path.js'
import { makeTempDir } from '../helpers/fixtures.js'

let home: string

beforeEach(async () => {
  home = await makeTempDir()
  await mkdir(join(home, 'Desktop', 'converted'), { recursive: true })
  await mkdir(join(home, 'Desktop', 'receipts'), { recursive: true })
  await mkdir(join(home, 'Documents'))
  await mkdir(join(home, 'Downloads'))
  await writeFile(join(home, 'Desktop', 'Screenshot 2026-10-11 at 9.41.52 AM.png'), '')
  await writeFile(join(home, 'Desktop', 'notes.txt'), '')
  await writeFile(join(home, 'Desktop', '.DS_Store'), '')
  await mkdir(join(home, '.config'))
})

const labels = async (text: string) =>
  (await completePath(text, { home, cwd: home })).map((c) => c.label)

describe('path completion', () => {
  it('offers the one folder a prefix names, then what is inside it (the mockup)', async () => {
    expect(await labels('~/Desk')).toEqual([
      '~/Desktop/',
      '~/Desktop/converted/',
      '~/Desktop/receipts/',
      '~/Desktop/Screenshot 2026-10-11 at 9.41.52 AM.png',
    ])
  })

  it('matches without regard to case, and lists every match', async () => {
    expect(await labels('~/d')).toEqual(['~/Desktop/', '~/Documents/', '~/Downloads/'])
  })

  it('lists a folder’s contents once the path ends in a slash', async () => {
    expect(await labels('~/Desktop/')).toEqual([
      '~/Desktop/converted/',
      '~/Desktop/receipts/',
      '~/Desktop/Screenshot 2026-10-11 at 9.41.52 AM.png',
    ])
  })

  it('leaves out files nothing can read, and hidden files until a dot is typed', async () => {
    expect(await labels('~/Desktop/n')).toEqual([])
    expect(await labels('~/.c')).toEqual(['~/.config/'])
    expect(await labels('~/')).not.toContain('~/.config/')
  })

  // Escaping a space is the Mac convention, so this is pinned to darwin. `~`
  // expands through the host's path.join: on a Windows host a `\` precedes the name.
  it('completes to a path that survives being sent, spaces and all', async () => {
    const [shot] = await completePath('~/Desktop/Scr', { home, cwd: home, platform: 'darwin' })
    expect(shot?.insert).toBe('~/Desktop/Screenshot\\ 2026-10-11\\ at\\ 9.41.52\\ AM.png')
    expect(unescapePath(shot?.insert ?? '', 'darwin').replace(/^.*Desktop[\\/]/, '')).toBe(
      'Screenshot 2026-10-11 at 9.41.52 AM.png',
    )
  })

  it('keeps what was typed before the last slash exactly as it was typed', async () => {
    const [first] = await completePath(`${home}/Desktop/con`, { home, cwd: home })
    expect(first?.label).toBe(`${home}/Desktop/converted/`)
    const [relative] = await completePath('Desktop/con', { home, cwd: home })
    expect(relative?.label).toBe('Desktop/converted/')
  })

  it('says nothing for a folder that is not there, or for nothing typed', async () => {
    expect(await labels('~/Nowhere/x')).toEqual([])
    expect(await labels('')).toEqual([])
    expect(await labels('   ')).toEqual([])
  })
})
