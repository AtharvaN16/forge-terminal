import { describe, expect, it } from 'vitest'
import { macLauncher, windowsLauncher } from '../../src/menu/launcher.js'

const MAC = {
  node: '/usr/local/bin/node',
  execArgv: [],
  forge: '/usr/local/lib/node_modules/forge-terminal/dist/index.js',
  menuDir: '/Users/me/.config/forge/menu',
  bundles: [
    '/Users/me/Library/Services/Open Forge.workflow',
    '/Users/me/Library/Services/Convert in Forge.workflow',
  ],
}

describe('macLauncher', () => {
  it('runs Forge’s menu command with the action and files when Forge is there', () => {
    const sh = macLauncher(MAC)
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true)
    expect(sh).toContain(
      `exec '/usr/local/bin/node' '/usr/local/lib/node_modules/forge-terminal/dist/index.js' menu run "$@"`,
    )
    expect(sh).toContain(`if [ -f '${MAC.forge}' ] && [ -x '${MAC.node}' ]; then`)
  })

  it('keeps the flags Node was started with, so a source checkout runs too', () => {
    const sh = macLauncher({ ...MAC, execArgv: ['--import', 'tsx'] })
    expect(sh).toContain(`exec '/usr/local/bin/node' '--import' 'tsx' '${MAC.forge}' menu run "$@"`)
  })

  it('removes every Forge item and its own folder when Forge is gone, then says so once', () => {
    const sh = macLauncher(MAC)
    const gone = sh.slice(sh.indexOf('fi'))
    expect(gone).toContain(`rm -rf '/Users/me/Library/Services/Open Forge.workflow'`)
    expect(gone).toContain(`rm -rf '/Users/me/Library/Services/Convert in Forge.workflow'`)
    expect(gone).toContain(`rm -rf '/Users/me/.config/forge/menu'`)
    expect(gone).toContain('/System/Library/CoreServices/pbs -update')
    expect(gone).toContain(
      `display notification "Its menu items are removed." with title "Forge was uninstalled"`,
    )
  })
})

const WIN = {
  node: 'C:\\Program Files\\nodejs\\node.exe',
  execArgv: [],
  forge: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\forge-terminal\\dist\\index.js',
  menuDir: 'C:\\Users\\me\\AppData\\Roaming\\forge\\menu',
  keys: ['HKCU\\Software\\Classes\\Directory\\shell\\Forge'],
}

describe('windowsLauncher', () => {
  it('is a Node script naming Forge and the menu folder as JSON strings', () => {
    const js = windowsLauncher(WIN)
    expect(js).toContain(`const FORGE = ${JSON.stringify(WIN.forge)}`)
    expect(js).toContain(`const MENU = ${JSON.stringify(WIN.menuDir)}`)
  })

  it('hands the action and files to Forge’s menu command when Forge is there', () => {
    const js = windowsLauncher({ ...WIN, execArgv: ['--import', 'tsx'] })
    expect(js).toContain(`const ARGS = ["--import","tsx"]`)
    expect(js).toContain(`[...ARGS, FORGE, 'menu', 'run', ...process.argv.slice(2)]`)
  })

  it('deletes Forge’s registry keys and its folder when Forge is gone', () => {
    const js = windowsLauncher(WIN)
    expect(js).toContain(`const KEYS = ${JSON.stringify(WIN.keys)}`)
    expect(js).toContain(`execFileSync('reg.exe', ['delete', key, '/f']`)
    expect(js).toContain('rmSync(MENU, { recursive: true, force: true })')
    expect(js).toContain('Forge was uninstalled')
  })
})
