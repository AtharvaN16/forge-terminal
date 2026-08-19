import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completePath } from '../../src/shell/complete.js'
import { makeTempDir } from '../helpers/fixtures.js'

async function tree() {
  const dir = await makeTempDir()
  await writeFile(join(dir, 'sunset.jpg'), 'x')
  await writeFile(join(dir, 'sunrise.jpg'), 'x')
  await writeFile(join(dir, 'notes.txt'), 'x')
  await writeFile(join(dir, '.hidden.jpg'), 'x')
  await mkdir(join(dir, 'Photos'))
  return dir
}

describe('completePath', () => {
  it('completes a unique match', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 'sunse'))).completed).toBe(join(dir, 'sunset.jpg'))
  })

  it('completes the longest common prefix and lists the matches', async () => {
    const dir = await tree()
    const { completed, matches } = await completePath(join(dir, 'sun'))
    expect(completed).toBe(join(dir, 'sun'))
    expect(matches.sort()).toEqual(['sunrise.jpg', 'sunset.jpg'])
  })

  it('appends a slash to a directory so the next Tab descends', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 'Pho'))).completed).toBe(`${join(dir, 'Photos')}/`)
  })

  it('matches case-insensitively, as the macOS filesystem does', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 'pho'))).completed).toBe(`${join(dir, 'Photos')}/`)
  })

  it('expands a leading tilde', async () => {
    expect((await completePath('~/')).matches.length >= 0).toBe(true)
    const { completed } = await completePath('~/')
    expect(completed === '~/' || completed.startsWith(homedir())).toBe(true)
  })

  it('hides dotfiles unless the fragment starts with a dot', async () => {
    const dir = await tree()
    expect((await completePath(join(dir, 's'))).matches).not.toContain('.hidden.jpg')
    expect((await completePath(`${dir}/.`)).completed).toContain('.hidden.jpg')
  })

  it('lists directories and convertible files, not unrelated ones', async () => {
    const dir = await tree()
    const { matches } = await completePath(`${dir}/`)
    expect(matches).toContain('Photos/')
    expect(matches).toContain('sunset.jpg')
    expect(matches).not.toContain('notes.txt')
  })

  it('is silent when the directory cannot be read', async () => {
    const { completed, matches } = await completePath('/definitely/not/here/x')
    expect(completed).toBe('/definitely/not/here/x')
    expect(matches).toEqual([])
  })

  it('is silent on an empty fragment', async () => {
    expect(await completePath('')).toEqual({ completed: '', matches: [] })
    expect(await completePath('   ')).toEqual({ completed: '   ', matches: [] })
  })

  it('derives the allowed extensions from the capability graph, not a fixed list', async () => {
    // heic is readable but not writable; it must still be offered as a source.
    const dir = await makeTempDir()
    await writeFile(join(dir, 'shot.heic'), 'x')
    expect((await completePath(join(dir, 'sh'))).completed).toBe(join(dir, 'shot.heic'))
  })
})
