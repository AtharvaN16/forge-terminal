import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  services: ['com.forge-terminal.menu.open - Open Forge - runWorkflowAsService'],
}

describe('macLauncher', () => {
  it('runs Forge’s menu command with the action and files when Forge is there', () => {
    const sh = macLauncher(MAC)
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true)
    expect(sh).toContain(
      `exec '/usr/local/bin/node' '/usr/local/lib/node_modules/forge-terminal/dist/index.js' menu run "$@"`,
    )
  })

  it('carries a config folder override into the run, since Finder does not read the shell’s profile', () => {
    expect(macLauncher({ ...MAC, xdgConfigHome: '/Users/me/cfg' })).toContain(
      `export XDG_CONFIG_HOME='/Users/me/cfg'\nexec`,
    )
    expect(macLauncher(MAC)).not.toContain('XDG_CONFIG_HOME')
  })

  it('keeps the flags Node was started with, so a source checkout runs too', () => {
    const sh = macLauncher({ ...MAC, execArgv: ['--import', 'tsx'] })
    expect(sh).toContain(`exec '/usr/local/bin/node' '--import' 'tsx' '${MAC.forge}' menu run "$@"`)
  })

  it('removes every Forge item and its own folder when Forge is gone, then says so once', () => {
    const sh = macLauncher(MAC)
    const gone = sh.slice(sh.indexOf(`if [ ! -f '${MAC.forge}' ]`), sh.indexOf('exit 0'))
    expect(gone).toContain(`rm -rf '/Users/me/Library/Services/Open Forge.workflow'`)
    expect(gone).toContain(`rm -rf '/Users/me/Library/Services/Convert in Forge.workflow'`)
    expect(gone).toContain(`rm -rf '/Users/me/.config/forge/menu'`)
    expect(gone).toContain(`'/System/Library/CoreServices/pbs' -update`)
    expect(gone).toContain(`'-com.forge-terminal.menu.open - Open Forge - runWorkflowAsService'`)
    expect(gone.indexOf('-com.forge-terminal.menu.open')).toBeLessThan(gone.indexOf("pbs' -update"))
    expect(gone).toContain(
      `display notification "Its menu items are removed." with title "Forge was uninstalled"`,
    )
  })
})

// Runs the generated script with /bin/sh, which only the Mac has.
describe.skipIf(process.platform === 'win32')('macLauncher, run for real', () => {
  /** Writes the launcher for a Forge at `forge` and a Node at `node`, with stand-in tools, and runs it. */
  function run(o: { forgeExists: boolean; nodeExists: boolean }) {
    const root = mkdtempSync(join(tmpdir(), 'forge-launch-'))
    const forge = join(root, 'forge.js')
    const node = join(root, 'node')
    const log = join(root, 'log')
    const bundle = join(root, 'Services', 'Open Forge.workflow')
    const menuDir = join(root, 'menu')
    mkdirSync(bundle, { recursive: true })
    mkdirSync(menuDir)
    if (o.forgeExists) writeFileSync(forge, '')
    if (o.nodeExists) {
      writeFileSync(node, `#!/bin/sh\necho ran "$@" >> '${log}'\n`)
      chmodSync(node, 0o755)
    }
    const say = join(root, 'say')
    writeFileSync(say, `#!/bin/sh\necho said "$@" >> '${log}'\n`)
    chmodSync(say, 0o755)
    const script = join(root, 'run')
    writeFileSync(
      script,
      macLauncher({
        node,
        execArgv: [],
        forge,
        menuDir,
        bundles: [bundle],
        services: ['com.forge-terminal.menu.open - Open Forge - runWorkflowAsService'],
        tools: { osascript: say, pbs: '/usr/bin/true' },
      }),
    )
    chmodSync(script, 0o755)
    spawnSync(script, ['sharpen', '/a b.png'], { stdio: 'ignore' })
    const said = existsSync(log) ? readFileSync(log, 'utf8') : ''
    return { said, bundleLeft: existsSync(bundle), menuLeft: existsSync(menuDir) }
  }

  it('runs Forge with the action and files', () => {
    const r = run({ forgeExists: true, nodeExists: true })
    expect(r.said).toContain('ran')
    expect(r.said).toContain('menu run sharpen /a b.png')
    expect(r.bundleLeft).toBe(true)
  })

  it('takes the menu away when Forge itself is gone', () => {
    const r = run({ forgeExists: false, nodeExists: true })
    expect([r.bundleLeft, r.menuLeft]).toEqual([false, false])
    expect(r.said).toContain('Forge was uninstalled')
    expect(r.said).toContain('-com.forge-terminal.menu.open - Open Forge - runWorkflowAsService')
  })

  it('keeps the menu when only Node has moved, and says how to set it up again', () => {
    const r = run({ forgeExists: true, nodeExists: false })
    expect([r.bundleLeft, r.menuLeft]).toEqual([true, true])
    expect(r.said).toContain('Forge could not start')
    expect(r.said).not.toContain('uninstalled')
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

  it('carries a config folder override into the run', () => {
    const js = windowsLauncher({ ...WIN, xdgConfigHome: 'D:\\cfg' })
    expect(js).toContain(`const ENV = ${JSON.stringify({ XDG_CONFIG_HOME: 'D:\\cfg' })}`)
    expect(js).toContain('env: { ...process.env, ...ENV }')
  })

  it('deletes Forge’s registry keys and its folder when Forge is gone', () => {
    const js = windowsLauncher(WIN)
    expect(js).toContain(`const KEYS = ${JSON.stringify(WIN.keys)}`)
    expect(js).toContain(`execFileSync('reg.exe', ['delete', key, '/f']`)
    expect(js).toContain('rmSync(MENU, { recursive: true, force: true })')
    expect(js).toContain('Forge was uninstalled')
  })
})
