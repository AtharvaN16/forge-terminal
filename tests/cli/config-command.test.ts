import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runConfig } from '../../src/cli/config-command.js'
import { execute } from '../../src/cli/execute.js'
import { loadPreferences } from '../../src/config/preferences.js'

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-cfgcmd-'))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

describe('forge config', () => {
  it('list prints every setting and its value', async () => {
    const { stdout, exitCode } = await runConfig({ kind: 'config', action: 'list' })
    expect(exitCode).toBe(0)
    const text = stdout.join('\n')
    expect(text).toContain('output')
    expect(text).toContain('~/Desktop')
    expect(text).toContain('quality')
    expect(text).toContain('80')
  })

  it('list says when no theme has been chosen', async () => {
    const { stdout } = await runConfig({ kind: 'config', action: 'list' })
    expect(stdout.join('\n')).toMatch(/theme\s+not set/)
  })

  it('path prints the config location', async () => {
    const { stdout, exitCode } = await runConfig({ kind: 'config', action: 'path' })
    expect(exitCode).toBe(0)
    expect(stdout[0]).toBe(join(dir, 'forge', 'config.json'))
  })

  it('set output writes the value', async () => {
    const { exitCode } = await runConfig({
      kind: 'config',
      action: 'set',
      key: 'output',
      value: '~/Pictures',
    })
    expect(exitCode).toBe(0)
    expect((await loadPreferences()).prefs.defaultOutput).toBe('~/Pictures')
  })

  it('set theme writes the value', async () => {
    await runConfig({ kind: 'config', action: 'set', key: 'theme', value: 'light' })
    expect((await loadPreferences()).prefs.theme).toBe('light')
  })

  it('set quality writes a number', async () => {
    await runConfig({ kind: 'config', action: 'set', key: 'quality', value: '55' })
    expect((await loadPreferences()).prefs.quality).toBe(55)
  })

  it('rejects an invalid theme as a usage error and leaves config untouched', async () => {
    await expect(
      runConfig({ kind: 'config', action: 'set', key: 'theme', value: 'chartreuse' }),
    ).rejects.toMatchObject({ code: 'invalid-arguments', detail: expect.stringContaining('dark') })
    expect((await loadPreferences()).prefs.theme).toBeUndefined()
  })

  it('rejects an out-of-range quality as a usage error', async () => {
    await expect(
      runConfig({ kind: 'config', action: 'set', key: 'quality', value: '500' }),
    ).rejects.toMatchObject({ code: 'invalid-arguments' })
    expect((await loadPreferences()).prefs.quality).toBe(80)
  })

  it('writes a rejected value to stderr with exit 2, nothing to stdout', async () => {
    const out = await execute({ kind: 'config', action: 'set', key: 'theme', value: 'chartreuse' })
    expect(out.exitCode).toBe(2)
    expect(out.stdout).toEqual([])
    expect(out.stderr.join('\n')).toContain('dark or light')
  })

  it('surfaces a config warning in the listing rather than hiding it', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(dir, 'forge'), { recursive: true })
    await writeFile(join(dir, 'forge', 'config.json'), '{ not json')
    const { stdout, exitCode } = await runConfig({ kind: 'config', action: 'list' })
    expect(exitCode).toBe(0)
    expect(stdout.join('\n')).toContain('⚠')
  })

  it('returns its facts as data for --json', async () => {
    const { config, warnings } = await runConfig({ kind: 'config', action: 'list' })
    expect(config).toEqual({
      output: '~/Desktop',
      theme: null,
      quality: 80,
      path: join(dir, 'forge', 'config.json'),
    })
    expect(warnings).toEqual([])
  })

  it('turns an unreadable config into a coded warning', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(dir, 'forge'), { recursive: true })
    await writeFile(join(dir, 'forge', 'config.json'), '{ not json')
    const { warnings } = await runConfig({ kind: 'config', action: 'list' })
    expect(warnings[0]?.code).toBe('config-unreadable')
  })
})
