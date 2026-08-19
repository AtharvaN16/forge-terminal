import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  configPath,
  DEFAULT_PREFERENCES,
  expandTilde,
  loadPreferences,
  savePreferences,
} from '../../src/config/preferences.js'

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-cfg-'))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

const write = async (contents: string) => {
  await mkdir(join(dir, 'forge'), { recursive: true })
  await writeFile(join(dir, 'forge', 'config.json'), contents)
}

describe('configPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(configPath()).toBe(join(dir, 'forge', 'config.json'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME
    expect(configPath()).toBe(join(homedir(), '.config', 'forge', 'config.json'))
  })
})

describe('expandTilde', () => {
  it('expands a bare tilde', () => {
    expect(expandTilde('~')).toBe(homedir())
  })

  it('expands a leading tilde path', () => {
    expect(expandTilde('~/Desktop')).toBe(join(homedir(), 'Desktop'))
  })

  it('leaves an absolute path alone', () => {
    expect(expandTilde('/tmp/x')).toBe('/tmp/x')
  })

  it('does not expand a tilde in the middle', () => {
    expect(expandTilde('/tmp/~/x')).toBe('/tmp/~/x')
  })
})

describe('loadPreferences', () => {
  it('returns defaults with no warning when the file is missing', async () => {
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeUndefined()
  })

  it('defaults theme to undefined so the first-run picker runs', async () => {
    const { prefs } = await loadPreferences()
    expect(prefs.theme).toBeUndefined()
    expect(prefs.defaultOutput).toBe('~/Desktop')
    expect(prefs.quality).toBe(80)
  })

  it('reads a valid file', async () => {
    await write(JSON.stringify({ theme: 'light', defaultOutput: '~/Pictures', quality: 60 }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual({ theme: 'light', defaultOutput: '~/Pictures', quality: 60 })
    expect(warning).toBeUndefined()
  })

  it('falls back to defaults with a warning on unparseable JSON', async () => {
    await write('{ not json')
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeTruthy()
    expect(warning).toContain('config')
  })

  it('falls back to defaults with a warning when the root is not an object', async () => {
    await write('[1, 2, 3]')
    const { prefs, warning } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(warning).toBeTruthy()
  })

  it('drops only the invalid keys and warns, keeping the valid ones', async () => {
    await write(JSON.stringify({ theme: 'chartreuse', defaultOutput: '~/Pictures', quality: 999 }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs.theme).toBeUndefined()
    expect(prefs.quality).toBe(80)
    expect(prefs.defaultOutput).toBe('~/Pictures')
    expect(warning).toBeTruthy()
  })

  it('never throws when the file cannot be read', async () => {
    await write(JSON.stringify({ theme: 'dark' }))
    await chmod(join(dir, 'forge', 'config.json'), 0o000)
    const { prefs } = await loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    await chmod(join(dir, 'forge', 'config.json'), 0o644)
  })
})

describe('savePreferences', () => {
  it('round-trips', async () => {
    await savePreferences({ theme: 'dark', defaultOutput: '~/Movies', quality: 42 })
    const { prefs } = await loadPreferences()
    expect(prefs).toEqual({ theme: 'dark', defaultOutput: '~/Movies', quality: 42 })
  })

  it('creates the directory when it does not exist', async () => {
    await savePreferences({ theme: 'light' })
    const raw = await readFile(join(dir, 'forge', 'config.json'), 'utf8')
    expect(JSON.parse(raw).theme).toBe('light')
  })

  it('merges a patch instead of replacing the file', async () => {
    await savePreferences({ theme: 'dark', quality: 50 })
    await savePreferences({ defaultOutput: '~/Downloads' })
    const { prefs } = await loadPreferences()
    expect(prefs.theme).toBe('dark')
    expect(prefs.quality).toBe(50)
    expect(prefs.defaultOutput).toBe('~/Downloads')
  })

  it('preserves unknown keys written by a future version', async () => {
    await write(JSON.stringify({ theme: 'dark', futureFeature: { nested: true } }))
    await savePreferences({ quality: 55 })
    const raw = JSON.parse(await readFile(join(dir, 'forge', 'config.json'), 'utf8'))
    expect(raw.futureFeature).toEqual({ nested: true })
    expect(raw.quality).toBe(55)
  })

  it('leaves no temp file behind', async () => {
    await savePreferences({ theme: 'dark' })
    const entries = await readdir(join(dir, 'forge'))
    expect(entries).toEqual(['config.json'])
  })
})
