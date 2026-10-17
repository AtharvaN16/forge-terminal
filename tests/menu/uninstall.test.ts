import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installMenu, type MenuEnv } from '../../src/menu/install.js'
import { uninstallForge } from '../../src/menu/uninstall.js'

function env(): { e: MenuEnv; forgeDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-uninstall-'))
  const forgeDir = join(root, 'config', 'forge')
  // what a used Forge leaves: its settings, an extension, the update cache
  mkdirSync(join(forgeDir, 'extensions', 'boost'), { recursive: true })
  writeFileSync(join(forgeDir, 'config.json'), '{}')
  writeFileSync(join(forgeDir, 'update-check.json'), '{}')
  const e: MenuEnv = {
    platform: 'darwin',
    home: join(root, 'home'),
    menuDir: join(forgeDir, 'menu'),
    node: '/usr/local/bin/node',
    execArgv: [],
    forge: '/usr/local/lib/node_modules/forge-terminal/dist/index.js',
    version: '0.4.0',
    sharpen: false,
    run: async () => {},
  }
  return { e, forgeDir }
}

describe('forge uninstall', () => {
  it('takes the menu out, uninstalls Forge with npm, then deletes its settings, saying each', async () => {
    const { e, forgeDir } = env()
    await installMenu(e)
    const ran: string[][] = []
    const lines: string[] = []
    const code = await uninstallForge(e, {
      forgeDir,
      npm: async (args) => {
        ran.push(args)
        return { code: 0, output: '' }
      },
      out: (l) => lines.push(l),
    })
    expect(code).toBe(0)
    expect(existsSync(join(e.home, 'Library', 'Services', 'Open Forge.workflow'))).toBe(false)
    expect(ran).toEqual([['uninstall', '--global', 'forge-terminal']])
    expect(existsSync(forgeDir)).toBe(false)
    expect(lines).toEqual([
      '✓ Removed Forge from the right-click menu',
      '✓ Uninstalled forge-terminal',
      '✓ Deleted Forge’s settings',
    ])
  })

  it('keeps the settings when npm could not uninstall, and says what npm said', async () => {
    const { e, forgeDir } = env()
    const lines: string[] = []
    const code = await uninstallForge(e, {
      forgeDir,
      npm: async () => ({ code: 1, output: 'npm error code EACCES\nnpm error permission denied' }),
      out: (l) => lines.push(l),
    })
    expect(code).toBe(1)
    expect(existsSync(join(forgeDir, 'config.json'))).toBe(true)
    expect(lines[0]).toBe('✓ Removed Forge from the right-click menu')
    expect(lines[1]).toBe('✕ npm could not uninstall forge-terminal: permission denied')
    expect(lines).toHaveLength(2)
  })
})
