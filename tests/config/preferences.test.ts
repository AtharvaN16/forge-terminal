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

  // Windows falls back to %APPDATA% instead; config-base.test.ts pins both.
  it.skipIf(process.platform === 'win32')(
    'falls back to ~/.config when XDG_CONFIG_HOME is unset',
    () => {
      delete process.env.XDG_CONFIG_HOME
      expect(configPath()).toBe(join(homedir(), '.config', 'forge', 'config.json'))
    },
  )
})

describe('expandTilde', () => {
  it('expands a bare tilde', () => {
    expect(expandTilde('~')).toBe(homedir())
  })

  it('expands a leading tilde path', () => {
    expect(expandTilde('~/Desktop', 'darwin')).toBe(join(homedir(), 'Desktop'))
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

  // chmod 0o000 cannot make a file unreadable on Windows.
  it.skipIf(process.platform === 'win32')('never throws when the file cannot be read', async () => {
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

describe('updateCheck', () => {
  it('is read from the file, and a value that is not true or false is rejected', async () => {
    const { savePreferences, loadPreferences: load } = await import(
      '../../src/config/preferences.js'
    )
    await savePreferences({ updateCheck: false })
    expect((await load()).prefs.updateCheck).toBe(false)
    const { configPath } = await import('../../src/config/preferences.js')
    await writeFile(configPath(), JSON.stringify({ updateCheck: 'yes' }))
    const bad = await load()
    expect(bad.prefs.updateCheck).toBeUndefined()
    expect(bad.warning).toContain('updateCheck')
  })
})

describe('rightClickMenu', () => {
  it('is read from the file, and a value that is not true or false is rejected', async () => {
    const { savePreferences, loadPreferences: load } = await import(
      '../../src/config/preferences.js'
    )
    await savePreferences({ rightClickMenu: false })
    expect((await load()).prefs.rightClickMenu).toBe(false)
    const { configPath } = await import('../../src/config/preferences.js')
    await writeFile(configPath(), JSON.stringify({ rightClickMenu: 'off' }))
    const bad = await load()
    expect(bad.prefs.rightClickMenu).toBeUndefined()
    expect(bad.warning).toContain('rightClickMenu')
  })
})

describe('presets', () => {
  const blog = { name: 'blog', steps: { to: 'webp' as const, quality: 80 }, saveTo: '~/Desktop' }

  it('round-trips through the file', async () => {
    await savePreferences({ presets: [blog] })
    expect((await loadPreferences()).prefs.presets).toEqual([blog])
  })

  it('keeps the presets that are fine and says which key had a bad one', async () => {
    await write(JSON.stringify({ presets: [blog, { name: 'my blog', steps: {}, saveTo: 'ask' }] }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs.presets).toEqual([blog])
    expect(warning).toContain('presets')
  })

  it('rejects presets that are not a list', async () => {
    await write(JSON.stringify({ presets: { blog } }))
    const { prefs, warning } = await loadPreferences()
    expect(prefs.presets).toBeUndefined()
    expect(warning).toContain('presets')
  })
})

describe('transcribeFormat', () => {
  it('is the format made the default on Format, and one Forge does not write is rejected', async () => {
    await savePreferences({ transcribeFormat: 'pdf' })
    expect((await loadPreferences()).prefs.transcribeFormat).toBe('pdf')
    await writeFile(configPath(), JSON.stringify({ transcribeFormat: 'rtf' }))
    const bad = await loadPreferences()
    expect(bad.prefs.transcribeFormat).toBeUndefined()
    expect(bad.warning).toContain('transcribeFormat')
  })
})
