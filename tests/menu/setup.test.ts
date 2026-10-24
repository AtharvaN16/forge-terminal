import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installMenu, type MenuEnv, readState } from '../../src/menu/install.js'
import { ensureMenu, rememberedTerminal, rememberTerminal, resync } from '../../src/menu/setup.js'

function env(over: Partial<MenuEnv> = {}): MenuEnv {
  const root = mkdtempSync(join(tmpdir(), 'forge-setup-'))
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
    ...over,
  }
}
const services = (e: MenuEnv) => join(e.home, 'Library', 'Services')

describe('ensureMenu', () => {
  it('sets the menu up the first time and says so', async () => {
    const e = env()
    expect(await ensureMenu(e, { global: true })).toBe('Added Forge to Finder’s Quick Actions')
    expect(existsSync(join(services(e), 'Open Forge.workflow'))).toBe(true)
  })

  it('says it in Windows’ words on Windows', async () => {
    const e = env({ platform: 'win32' })
    expect(await ensureMenu(e, { global: true })).toBe('Added Forge to the right-click menu')
  })

  it('says nothing, and changes nothing, once it is set up', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    const calls: string[] = []
    expect(
      await ensureMenu({ ...e, run: async (c) => void calls.push(c) }, { global: true }),
    ).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('sets it up again, quietly, after Forge is updated', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    expect(await ensureMenu({ ...e, version: '0.5.0' }, { global: true })).toBeUndefined()
    expect(readState(e)?.version).toBe('0.5.0')
  })

  it('sets it up again when Forge has moved, so the launcher points at it', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    const moved = '/opt/homebrew/lib/node_modules/forge-terminal/dist/index.js'
    await ensureMenu({ ...e, forge: moved }, { global: true })
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).toContain(moved)
  })

  it('sets it up again when Node has moved, so the launcher can still start Forge', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    await ensureMenu({ ...e, node: '/opt/homebrew/bin/node' }, { global: true })
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).toContain("'/opt/homebrew/bin/node'")
  })

  it('sets it up again when the config folder override changes', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    await ensureMenu({ ...e, xdgConfigHome: '/Users/me/cfg' }, { global: true })
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).toContain(
      "XDG_CONFIG_HOME='/Users/me/cfg'",
    )
  })

  it('leaves the menu alone for a Forge not installed with npm -g, such as a source checkout', async () => {
    const e = env()
    expect(await ensureMenu(e, { global: false })).toBeUndefined()
    expect(existsSync(services(e))).toBe(false)
  })

  it('never sets up a menu that was installed by hand from a checkout and then refreshed by npm', async () => {
    const e = env()
    await installMenu({ ...e, forge: '/src/forge/src/index.ts' })
    await ensureMenu(e, { global: true })
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).toContain(e.forge)
  })

  it('adds nothing, and says nothing, while it is switched off', async () => {
    const e = env()
    expect(await ensureMenu(e, { global: true, enabled: false })).toBeUndefined()
    expect(existsSync(services(e))).toBe(false)
  })

  it('takes the menu out at the next start if it was switched off some other way', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    await ensureMenu(e, { global: true, enabled: false })
    expect(existsSync(join(services(e), 'Open Forge.workflow'))).toBe(false)
    expect(readState(e)).toBeUndefined()
  })

  it('does nothing where there is no menu to add to', async () => {
    expect(await ensureMenu(env({ platform: 'freebsd' }), { global: true })).toBeUndefined()
  })
})

describe('resync', () => {
  it('adds Sharpen once Boost is installed, keeping the version the menu was set up with', async () => {
    const e = env({ sharpen: false })
    await ensureMenu(e, { global: true })
    await resync({ ...e, sharpen: true, version: 'ignored' })
    expect(existsSync(join(services(e), 'Sharpen in Forge.workflow'))).toBe(true)
    expect(readState(e)?.version).toBe('0.4.0')
  })

  it('keeps pointing at the Forge the menu was set up for, even run from a checkout', async () => {
    const e = env()
    await ensureMenu(e, { global: true })
    await resync({ ...e, sharpen: true, forge: '/src/forge/src/index.ts' })
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).toContain(e.forge)
    expect(readFileSync(join(e.menuDir, 'run'), 'utf8')).not.toContain('/src/forge/')
  })

  it('does nothing when the menu was never set up', async () => {
    const e = env({ sharpen: true })
    await resync(e)
    expect(existsSync(services(e))).toBe(false)
  })
})

describe('rememberTerminal', () => {
  it('keeps the Mac terminal Forge was run in, for the menu to open next time', () => {
    const e = env()
    rememberTerminal(e, { TERM_PROGRAM: 'iTerm.app' })
    expect(rememberedTerminal(e)).toBe('iTerm.app')
  })

  it('records Windows Terminal by the session variable it sets', () => {
    const e = env({ platform: 'win32' })
    rememberTerminal(e, { WT_SESSION: 'abc' })
    expect(rememberedTerminal(e)).toBe('wt')
  })

  it('ignores a terminal it cannot open, such as VS Code’s, keeping the last one it can', () => {
    const e = env()
    rememberTerminal(e, { TERM_PROGRAM: 'ghostty' })
    rememberTerminal(e, { TERM_PROGRAM: 'vscode' })
    expect(rememberedTerminal(e)).toBe('ghostty')
  })

  it('goes back to a console on Windows once Forge is run outside Windows Terminal', () => {
    const e = env({ platform: 'win32' })
    rememberTerminal(e, { WT_SESSION: 'abc' })
    rememberTerminal(e, {})
    expect(rememberedTerminal(e)).toBe('console')
  })

  it('keeps the last one known when run somewhere that does not say', () => {
    const e = env()
    rememberTerminal(e, { TERM_PROGRAM: 'ghostty' })
    rememberTerminal(e, {})
    expect(rememberedTerminal(e)).toBe('ghostty')
  })
})

describe('on Linux', () => {
  const linux = () => {
    const e = env({ platform: 'linux' })
    const root = dirname(e.home)
    return {
      ...e,
      xdgDataHome: join(root, 'data'),
      xdgConfigHome: join(root, 'cfg'),
      path: join(root, 'bin'),
    }
  }

  it('sets the menu up the first time, in the file managers, and says so', async () => {
    const e = linux()
    expect(await ensureMenu(e, { global: true })).toBe('Added Forge to the right-click menu')
    expect(existsSync(join(e.xdgDataHome, 'nautilus', 'scripts', 'Forge', 'Open Forge'))).toBe(true)
    expect(await ensureMenu(e, { global: true })).toBeUndefined()
  })

  it('takes it out at the next start when switched off', async () => {
    const e = linux()
    await ensureMenu(e, { global: true })
    await ensureMenu(e, { global: true, enabled: false })
    expect(existsSync(join(e.xdgDataHome, 'nautilus'))).toBe(false)
    expect(readState(e)).toBeUndefined()
  })

  it('keeps the terminal Forge was run in, by the variable each terminal sets', () => {
    const cases: [NodeJS.ProcessEnv, string][] = [
      [{ GNOME_TERMINAL_SCREEN: '/org/gnome/Terminal/screen/1' }, 'gnome-terminal'],
      [{ KONSOLE_VERSION: '240202' }, 'konsole'],
      [{ KITTY_WINDOW_ID: '1' }, 'kitty'],
      [{ ALACRITTY_WINDOW_ID: '1' }, 'alacritty'],
      [{ TERM_PROGRAM: 'WezTerm' }, 'wezterm'],
      [{ TERM_PROGRAM: 'ghostty' }, 'ghostty'],
      [{ XTERM_VERSION: 'XTerm(379)' }, 'xterm'],
    ]
    for (const [vars, name] of cases) {
      const e = linux()
      rememberTerminal(e, vars)
      expect(rememberedTerminal(e)).toBe(name)
    }
  })

  it('reads nothing inside VS Code or tmux, where those may be left over', () => {
    const e = linux()
    rememberTerminal(e, { KONSOLE_VERSION: '1' })
    rememberTerminal(e, { TERM_PROGRAM: 'vscode', GNOME_TERMINAL_SCREEN: 'x' })
    rememberTerminal(e, { TMUX: '/tmp/tmux', KITTY_WINDOW_ID: '1' })
    expect(rememberedTerminal(e)).toBe('konsole')
  })
})
