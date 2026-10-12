import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  knownFolder,
  parseRegQuery,
  resetKnownFoldersForTests,
} from '../../src/utils/known-folders.js'

describe('knownFolder', () => {
  beforeEach(resetKnownFoldersForTests)
  afterEach(() => vi.unstubAllEnvs())

  it('is <home>/Desktop on darwin, without asking the registry', () => {
    const query = vi.fn()
    expect(knownFolder('Desktop', 'darwin', query)).toBe(join(homedir(), 'Desktop'))
    expect(query).not.toHaveBeenCalled()
  })

  it('on win32, follows a redirected Desktop and expands %VAR%', () => {
    vi.stubEnv('USERPROFILE', 'C:\\Users\\a')
    expect(knownFolder('Desktop', 'win32', () => '%USERPROFILE%\\OneDrive\\Desktop')).toBe(
      'C:\\Users\\a\\OneDrive\\Desktop',
    )
  })

  it('on win32, falls back to <home>/Downloads when the registry has nothing', () => {
    expect(knownFolder('Downloads', 'win32', () => undefined)).toBe(join(homedir(), 'Downloads'))
  })
})

describe('parseRegQuery', () => {
  it('reads the value out of real `reg query` output', () => {
    const out =
      '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n' +
      '    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Desktop\r\n\r\n'
    expect(parseRegQuery(out, 'Desktop')).toBe('%USERPROFILE%\\OneDrive\\Desktop')
  })
})
