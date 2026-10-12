import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configBase } from '../../src/config/config-base.js'

describe('configBase', () => {
  it('is ~/.config on darwin', () => {
    expect(configBase('darwin', {})).toBe(join(homedir(), '.config'))
  })

  it('lets XDG_CONFIG_HOME win', () => {
    expect(configBase('darwin', { XDG_CONFIG_HOME: '/x' })).toBe('/x')
  })

  it('is %APPDATA% on win32', () => {
    expect(configBase('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming',
    )
  })
})
