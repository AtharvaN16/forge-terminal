import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { installMenu, isInstalled, type MenuEnv, removeMenu } from '../../src/menu/install.js'

function env(platform: 'darwin' | 'win32', over: Partial<MenuEnv> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forge-menu-'))
  const calls: [string, string[]][] = []
  const e: MenuEnv = {
    platform,
    home: join(root, 'home'),
    menuDir: join(root, 'config', 'forge', 'menu'),
    node: '/usr/local/bin/node',
    execArgv: [],
    forge: '/usr/local/lib/forge/dist/index.js',
    version: '0.4.0',
    sharpen: true,
    run: async (cmd, args) => {
      calls.push([cmd, args])
    },
    ...over,
  }
  return { e, calls, services: join(e.home, 'Library', 'Services') }
}

describe('installMenu on a Mac', () => {
  it('writes a Quick Action for each item, with the logo in its mode colour', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    for (const name of [
      'Open Forge',
      'Convert in Forge',
      'Compress in Forge',
      'Sharpen in Forge',
      'Open in Forge',
    ]) {
      expect(existsSync(join(services, `${name}.workflow`, 'Contents', 'Info.plist'))).toBe(true)
      const icon = join(services, `${name}.workflow`, 'Contents', 'Resources', 'forge.tiff')
      expect((await sharp(icon).metadata()).format).toBe('tiff')
    }
  })

  it('writes an executable launcher the items call', async () => {
    const { e } = env('darwin')
    await installMenu(e)
    const launcher = join(e.menuDir, 'run')
    // Windows has no execute bit to set.
    if (process.platform !== 'win32') expect(statSync(launcher).mode & 0o111).not.toBe(0)
    expect(readFileSync(launcher, 'utf8')).toContain('menu run "$@"')
    const doc = readFileSync(
      join(
        e.home,
        'Library',
        'Services',
        'Compress in Forge.workflow',
        'Contents',
        'document.wflow',
      ),
      'utf8',
    )
    expect(doc).toContain(`'${launcher}' compress`)
  })

  it('tells Finder to read the services again', async () => {
    const { e, calls } = env('darwin')
    await installMenu(e)
    expect(calls).toContainEqual(['/System/Library/CoreServices/pbs', ['-update']])
  })

  it('switches every item on for the right-click menu before telling Finder', async () => {
    const { e, calls } = env('darwin')
    await installMenu(e)
    const status = calls.findIndex(([cmd]) => cmd === '/usr/bin/osascript')
    const [, args] = calls[status] ?? ['', []]
    expect(args).toContain('pbs')
    for (const label of ['Open Forge', 'Convert in Forge', 'Sharpen in Forge', 'Open in Forge'])
      expect(
        args.some((a) => a.startsWith('+') && a.includes(` - ${label} - runWorkflowAsService`)),
      ).toBe(true)
    expect(status).toBeLessThan(calls.findIndex(([cmd]) => cmd.endsWith('/pbs')))
  })

  it('switches Sharpen off when Boost has gone', async () => {
    const { e, calls } = env('darwin', { sharpen: false })
    await installMenu(e)
    const [, args] = calls.find(([cmd]) => cmd === '/usr/bin/osascript') ?? ['', []]
    expect(args).toContain(
      '-com.forge-terminal.menu.sharpen - Sharpen in Forge - runWorkflowAsService',
    )
  })

  it('takes Sharpen out when Boost has gone since the last install', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    await installMenu({ ...e, sharpen: false })
    expect(existsSync(join(services, 'Sharpen in Forge.workflow'))).toBe(false)
    expect(existsSync(join(services, 'Convert in Forge.workflow'))).toBe(true)
  })

  it('leaves Quick Actions that are not Forge’s alone', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    const other = join(services, 'Open in ZCode.workflow')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(other, { recursive: true })
    await removeMenu(e)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(join(services, 'Open Forge.workflow'))).toBe(false)
  })

  it('removes every item and its own folder, and is no longer installed', async () => {
    const { e, calls, services } = env('darwin')
    await installMenu(e)
    expect(isInstalled(e)).toBe(true)
    await removeMenu(e)
    expect(existsSync(join(services, 'Convert in Forge.workflow'))).toBe(false)
    expect(existsSync(e.menuDir)).toBe(false)
    expect(isInstalled(e)).toBe(false)
    expect(calls.at(-1)).toEqual(['/System/Library/CoreServices/pbs', ['-update']])
  })

  it('switches every Forge item off in the services settings', async () => {
    const { e, calls } = env('darwin')
    await removeMenu(e)
    const [, args] = calls.find(([cmd]) => cmd === '/usr/bin/osascript') ?? ['', []]
    const keys = args.filter((a) => a.includes('runWorkflowAsService'))
    expect(keys).toHaveLength(5)
    expect(keys.every((k) => k.startsWith('-com.forge-terminal.menu.'))).toBe(true)
  })
})

describe('installMenu on Windows', () => {
  const win = () =>
    env('win32', { node: 'C:\\nodejs\\node.exe', forge: 'C:\\npm\\forge-terminal\\dist\\index.js' })

  it('writes the launcher, an icon per colour and the notification logo', async () => {
    const { e } = win()
    await installMenu(e)
    expect(readFileSync(join(e.menuDir, 'run.mjs'), 'utf8')).toContain("'menu', 'run'")
    for (const ico of ['forge', 'convert', 'compress', 'edit', 'pdf'])
      expect(readFileSync(join(e.menuDir, `${ico}.ico`)).readUInt16LE(2)).toBe(1)
    expect((await sharp(join(e.menuDir, 'forge.png')).metadata()).format).toBe('png')
  })

  it('writes the registry keys through PowerShell', async () => {
    const { e, calls } = win()
    await installMenu(e)
    const [cmd, args] = calls.at(-1) ?? ['', []]
    expect(cmd).toBe('powershell.exe')
    expect(args.at(-1)).toContain('Compress in Forge')
  })

  it('removes the keys and the folder', async () => {
    const { e, calls } = win()
    await installMenu(e)
    await removeMenu(e)
    expect(existsSync(e.menuDir)).toBe(false)
    const script = calls.at(-1)?.[1].at(-1) ?? ''
    expect(script).toContain('Remove-Item')
    expect(script).not.toContain('New-Item')
  })
})

describe('installMenu elsewhere', () => {
  it('does nothing on a platform with no menu to add to', async () => {
    const { e, calls } = env('freebsd' as 'darwin')
    await installMenu(e)
    expect(calls).toEqual([])
    expect(isInstalled(e)).toBe(false)
  })
})

describe('installMenu on Linux', () => {
  /** A Linux home in a temp folder, its XDG folders passed in as the shell had them. */
  function linux(over: Partial<MenuEnv> & { thunar?: boolean } = {}) {
    const { thunar, ...rest } = over
    const r = env('linux' as 'darwin', rest)
    const root = dirname(r.e.home)
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    if (thunar) {
      writeFileSync(join(bin, 'thunar'), '#!/bin/sh\n')
      chmodSync(join(bin, 'thunar'), 0o755)
    }
    const e: MenuEnv = {
      ...r.e,
      platform: 'linux',
      xdgDataHome: join(root, 'data'),
      xdgConfigHome: join(root, 'cfg'),
      xdgConfigDirs: join(root, 'etc-xdg'),
      path: bin,
      ...rest,
    }
    return {
      e,
      calls: r.calls,
      root,
      nautilus: join(root, 'data', 'nautilus', 'scripts', 'Forge'),
      nemo: join(root, 'data', 'nemo', 'actions'),
      dolphin: join(root, 'data', 'kio', 'servicemenus'),
      uca: join(root, 'cfg', 'Thunar', 'uca.xml'),
      systemUca: join(root, 'etc-xdg', 'Thunar', 'uca.xml'),
    }
  }
  const exec = (p: string) => (statSync(p).mode & 0o111) !== 0
  /** Every file under `dir`, relative to it. */
  const tree = (dir: string): string[] =>
    existsSync(dir)
      ? (readdirSync(dir, { recursive: true }) as string[])
          .filter((f) => statSync(join(dir, f)).isFile())
          .sort()
      : []

  it('writes a Nautilus script per item in a Forge folder, executable, calling the launcher', async () => {
    const { e, nautilus } = linux()
    await installMenu(e)
    expect(tree(nautilus)).toEqual([
      'Compress in Forge',
      'Convert in Forge',
      'Open Forge',
      'Open in Forge',
      'Sharpen in Forge',
    ])
    const script = join(nautilus, 'Convert in Forge')
    if (process.platform !== 'win32') expect(exec(script)).toBe(true)
    expect(readFileSync(script, 'utf8')).toContain(`'${join(e.menuDir, 'run')}' convert "$@"`)
  })

  it('writes a Nemo action per item and a Dolphin menu per kind, the menus executable for KDE 6', async () => {
    const { e, nemo, dolphin } = linux()
    await installMenu(e)
    expect(tree(nemo)).toEqual([
      'forge-1-open.nemo_action',
      'forge-2-convert.nemo_action',
      'forge-3-compress.nemo_action',
      'forge-4-sharpen.nemo_action',
      'forge-5-open-pdf.nemo_action',
    ])
    expect(tree(dolphin)).toEqual([
      'forge-folder.desktop',
      'forge-image.desktop',
      'forge-pdf.desktop',
    ])
    if (process.platform !== 'win32') expect(exec(join(dolphin, 'forge-image.desktop'))).toBe(true)
  })

  it('writes an executable launcher and an icon per colour into its own folder', async () => {
    const { e } = linux()
    await installMenu(e)
    const launcher = join(e.menuDir, 'run')
    if (process.platform !== 'win32') expect(exec(launcher)).toBe(true)
    expect(readFileSync(launcher, 'utf8')).toContain('menu run "$@"')
    for (const paint of ['forge', 'convert', 'compress', 'edit', 'pdf'])
      expect((await sharp(join(e.menuDir, `${paint}.png`)).metadata()).format).toBe('png')
    expect(isInstalled(e)).toBe(true)
  })

  it('runs nothing: there is no registry or service list to tell', async () => {
    const { e, calls } = linux()
    await installMenu(e)
    expect(calls).toEqual([])
  })

  it('takes Sharpen out everywhere once Boost has gone', async () => {
    const { e, nautilus, nemo, dolphin, uca } = linux({ thunar: true })
    await installMenu(e)
    await installMenu({ ...e, sharpen: false })
    expect(existsSync(join(nautilus, 'Sharpen in Forge'))).toBe(false)
    expect(existsSync(join(nemo, 'forge-4-sharpen.nemo_action'))).toBe(false)
    expect(readFileSync(join(dolphin, 'forge-image.desktop'), 'utf8')).not.toContain('sharpen')
    expect(readFileSync(uca, 'utf8')).not.toContain('sharpen')
    expect(existsSync(join(nautilus, 'Convert in Forge'))).toBe(true)
  })

  it('leaves Thunar alone when it is not installed', async () => {
    const { e, uca } = linux()
    await installMenu(e)
    expect(existsSync(uca)).toBe(false)
  })

  it('starts a new uca.xml from the actions Thunar ships with, so they are not lost', async () => {
    const { e, uca, systemUca } = linux({ thunar: true })
    mkdirSync(dirname(systemUca), { recursive: true })
    writeFileSync(systemUca, USER_UCA)
    await installMenu(e)
    const text = readFileSync(uca, 'utf8')
    expect(text).toContain('Open Terminal Here')
    expect(text).toContain('<unique-id>forge-terminal-menu-convert</unique-id>')
  })

  it('merges into the user’s own uca.xml and takes back out only its own', async () => {
    const { e, uca } = linux()
    mkdirSync(dirname(uca), { recursive: true })
    writeFileSync(uca, USER_UCA)
    await installMenu(e)
    await installMenu(e)
    const text = readFileSync(uca, 'utf8')
    expect(text.match(/forge-terminal-menu-open</g)).toHaveLength(1)
    await removeMenu(e)
    expect(readFileSync(uca, 'utf8')).toBe(USER_UCA)
  })

  it('leaves a uca.xml it cannot read exactly as it was', async () => {
    const { e, uca } = linux({ thunar: true })
    mkdirSync(dirname(uca), { recursive: true })
    writeFileSync(uca, 'garbage')
    await installMenu(e)
    expect(readFileSync(uca, 'utf8')).toBe('garbage')
  })

  it('removes everything it wrote, and the folders it made, and nothing else', async () => {
    const { e, root, nautilus, nemo, dolphin } = linux({ thunar: true })
    // The user's own, beside Forge's: a script, a Nemo action, a service menu.
    mkdirSync(join(root, 'data', 'nautilus', 'scripts'), { recursive: true })
    writeFileSync(join(root, 'data', 'nautilus', 'scripts', 'Mine'), '#!/bin/sh\n')
    mkdirSync(nemo, { recursive: true })
    writeFileSync(join(nemo, 'mine.nemo_action'), '[Nemo Action]\n')
    await installMenu(e)
    // Named like one of Forge's, but not marked as Forge's.
    writeFileSync(join(dolphin, 'forge-pdf.desktop'), '[Desktop Entry]\n')
    await removeMenu(e)
    expect(existsSync(e.menuDir)).toBe(false)
    expect(existsSync(nautilus)).toBe(false)
    expect(tree(join(root, 'data'))).toEqual([
      'kio/servicemenus/forge-pdf.desktop',
      'nautilus/scripts/Mine',
      'nemo/actions/mine.nemo_action',
    ])
    expect(existsSync(join(root, 'cfg', 'Thunar'))).toBe(false)
    expect(isInstalled(e)).toBe(false)
  })

  it('leaves no trace in a home that had none of the file managers’ folders', async () => {
    const { e, root } = linux({ thunar: true })
    await installMenu(e)
    await removeMenu(e)
    expect(existsSync(join(root, 'data'))).toBe(false)
    expect(existsSync(join(root, 'cfg'))).toBe(false)
  })

  it('removes what is there even when it was never installed', async () => {
    const { e } = linux()
    await expect(removeMenu(e)).resolves.toBeUndefined()
  })
})

const USER_UCA = `<?xml version="1.0" encoding="UTF-8"?>
<actions>
<action>
	<icon>utilities-terminal</icon>
	<name>Open Terminal Here</name>
	<unique-id>1234-1</unique-id>
	<command>exo-open --working-directory %f --launch TerminalEmulator</command>
	<patterns>*</patterns>
	<directories/>
</action>
</actions>
`
