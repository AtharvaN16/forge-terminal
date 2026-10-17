import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installMenu, type MenuEnv } from '../../src/menu/install.js'
import { uninstallForge } from '../../src/menu/uninstall.js'

function env(): MenuEnv {
  const root = mkdtempSync(join(tmpdir(), 'forge-uninstall-'))
  return {
    platform: 'darwin',
    home: join(root, 'home'),
    menuDir: join(root, 'config', 'forge', 'menu'),
    node: '/usr/local/bin/node',
    execArgv: [],
    forge: '/usr/local/lib/node_modules/forge-terminal/dist/index.js',
    version: '0.4.0',
    sharpen: false,
    run: async () => {},
  }
}

describe('forge uninstall', () => {
  it('takes the menu out, then uninstalls Forge with npm, saying each', async () => {
    const e = env()
    await installMenu(e)
    const ran: string[][] = []
    const lines: string[] = []
    const code = await uninstallForge(e, {
      npm: async (args) => {
        ran.push(args)
        return { code: 0, output: '' }
      },
      out: (l) => lines.push(l),
    })
    expect(code).toBe(0)
    expect(existsSync(join(e.home, 'Library', 'Services', 'Open Forge.workflow'))).toBe(false)
    expect(ran).toEqual([['uninstall', '--global', 'forge-terminal']])
    expect(lines).toEqual([
      '✓ Removed Forge from the right-click menu',
      '✓ Uninstalled forge-terminal',
    ])
  })

  it('says what npm said when it could not, with the menu already gone', async () => {
    const e = env()
    const lines: string[] = []
    const code = await uninstallForge(e, {
      npm: async () => ({ code: 1, output: 'npm error code EACCES\nnpm error permission denied' }),
      out: (l) => lines.push(l),
    })
    expect(code).toBe(1)
    expect(lines[0]).toBe('✓ Removed Forge from the right-click menu')
    expect(lines[1]).toBe('✕ npm could not uninstall forge-terminal: permission denied')
  })
})
